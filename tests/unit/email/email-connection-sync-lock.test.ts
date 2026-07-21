import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

import {
  acquireEmailConnectionSyncLock,
  completeGmailImportJobUnderSyncLock,
  createEmailConnectionSyncLockRenewer,
  persistEmailConnectionRecoveryCheckpoint,
  persistEmailConnectionSyncCompletion,
  renewEmailConnectionSyncLock,
  releaseEmailConnectionSyncLock,
  runWithEmailConnectionSyncLock,
} from "@/lib/api/services/email-connection-sync-lock";

function makeSupabaseDouble(options?: {
  acquireData?: unknown;
  acquireError?: string;
  renewData?: unknown;
  renewError?: string;
  releaseData?: unknown;
  releaseError?: string;
  writeData?: unknown;
  writeError?: string;
}) {
  return {
    rpc: vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === "acquire_email_connection_sync_lock_as_system") {
        return {
          data: Object.prototype.hasOwnProperty.call(
            options ?? {},
            "acquireData"
          )
            ? options?.acquireData
            : "00000000-0000-4000-8000-000000000001",
          error: options?.acquireError
            ? { message: options.acquireError }
            : null,
        };
      }
      if (name === "renew_email_connection_sync_lock_as_system") {
        return {
          data: Object.prototype.hasOwnProperty.call(options ?? {}, "renewData")
            ? options?.renewData
            : true,
          error: options?.renewError ? { message: options.renewError } : null,
        };
      }
      if (name === "release_email_connection_sync_lock_as_system") {
        return {
          data: Object.prototype.hasOwnProperty.call(
            options ?? {},
            "releaseData"
          )
            ? options?.releaseData
            : true,
          error: options?.releaseError
            ? { message: options.releaseError }
            : null,
        };
      }
      if (
        name === "persist_email_connection_recovery_checkpoint_as_system" ||
        name === "persist_email_connection_sync_completion_as_system" ||
        name === "complete_gmail_import_job_as_system"
      ) {
        return {
          data: Object.prototype.hasOwnProperty.call(options ?? {}, "writeData")
            ? options?.writeData
            : true,
          error: options?.writeError ? { message: options.writeError } : null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
    from: vi.fn(() => {
      throw new Error("sync locks must not write email_connections directly");
    }),
  };
}

describe("email connection sync lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("claims the shared mailbox lease through the atomic service RPC", async () => {
    const supabase = makeSupabaseDouble();
    requireSupabaseMock.mockReturnValue(supabase);

    await expect(
      acquireEmailConnectionSyncLock("connection-1", "gmail-scan-preview")
    ).resolves.toBe("00000000-0000-4000-8000-000000000001");

    expect(supabase.rpc).toHaveBeenCalledWith(
      "acquire_email_connection_sync_lock_as_system",
      {
        p_connection_id: "connection-1",
        p_lease_seconds: 600,
      }
    );
  });

  it("can use the route's service client without relying on async context", async () => {
    const supabase = makeSupabaseDouble();

    await expect(
      acquireEmailConnectionSyncLock(
        "connection-1",
        "gmail-scan-start",
        supabase as never
      )
    ).resolves.toBe("00000000-0000-4000-8000-000000000001");

    expect(requireSupabaseMock).not.toHaveBeenCalled();
  });

  it("returns null when another worker owns the mailbox lease", async () => {
    const supabase = makeSupabaseDouble({ acquireData: null });
    requireSupabaseMock.mockReturnValue(supabase);

    await expect(
      acquireEmailConnectionSyncLock("connection-1", "gmail-scan-preview")
    ).resolves.toBeNull();
  });

  it("fails closed when acquisition or renewal cannot prove ownership", async () => {
    requireSupabaseMock.mockReturnValue(
      makeSupabaseDouble({ acquireError: "rpc unavailable" })
    );
    await expect(
      acquireEmailConnectionSyncLock("connection-1", "gmail-scan-preview")
    ).rejects.toThrow(
      "[gmail-scan-preview] email connection lock acquisition failed: rpc unavailable"
    );

    requireSupabaseMock.mockReturnValue(
      makeSupabaseDouble({ renewData: false })
    );
    await expect(
      renewEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview"
      )
    ).rejects.toThrow(
      "[gmail-scan-preview] email connection lock ownership was lost for connection-1"
    );
  });

  it("releases only the matching owner without throwing on cleanup failure", async () => {
    const supabase = makeSupabaseDouble({ releaseError: "write unavailable" });
    requireSupabaseMock.mockReturnValue(supabase);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      releaseEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview"
      )
    ).resolves.toBeUndefined();

    expect(supabase.rpc).toHaveBeenCalledWith(
      "release_email_connection_sync_lock_as_system",
      {
        p_connection_id: "connection-1",
        p_owner_id: "owner-1",
      }
    );
    expect(supabase.from).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[gmail-scan-preview] email connection lock release failed (non-fatal):",
      "write unavailable"
    );
  });

  it("treats release by a stale owner as an idempotent no-op", async () => {
    const supabase = makeSupabaseDouble({ releaseData: false });

    await expect(
      releaseEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview",
        supabase as never
      )
    ).resolves.toBeUndefined();

    expect(supabase.rpc).toHaveBeenCalledWith(
      "release_email_connection_sync_lock_as_system",
      {
        p_connection_id: "connection-1",
        p_owner_id: "owner-1",
      }
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("fails closed when renewal returns a non-boolean contract value", async () => {
    const supabase = makeSupabaseDouble({ renewData: "true" });

    await expect(
      renewEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview",
        supabase as never
      )
    ).rejects.toThrow(
      "[gmail-scan-preview] email connection lock renewal returned an invalid result"
    );

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("fails cleanup closed on a non-boolean release contract value", async () => {
    const supabase = makeSupabaseDouble({ releaseData: "true" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      releaseEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview",
        supabase as never
      )
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[gmail-scan-preview] email connection lock release returned an invalid result"
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("renews only through the owner-fenced global mailbox RPC", async () => {
    const supabase = makeSupabaseDouble();

    await expect(
      renewEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview",
        supabase as never
      )
    ).resolves.toBeUndefined();

    expect(supabase.rpc).toHaveBeenCalledWith(
      "renew_email_connection_sync_lock_as_system",
      {
        p_connection_id: "connection-1",
        p_owner_id: "owner-1",
        p_lease_seconds: 600,
      }
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("surfaces renewal RPC failures without touching the connection row", async () => {
    const supabase = makeSupabaseDouble({ renewError: "rpc unavailable" });

    await expect(
      renewEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview",
        supabase as never
      )
    ).rejects.toThrow(
      "[gmail-scan-preview] email connection lock renewal failed: rpc unavailable"
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("does not leak another mailbox lease holder through contention", async () => {
    const supabase = makeSupabaseDouble({ acquireData: null });

    await expect(
      acquireEmailConnectionSyncLock(
        "connection-2",
        "cross-company-sync",
        supabase as never
      )
    ).resolves.toBeNull();

    expect(supabase.rpc).toHaveBeenCalledWith(
      "acquire_email_connection_sync_lock_as_system",
      {
        p_connection_id: "connection-2",
        p_lease_seconds: 600,
      }
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("keeps cleanup RPC errors non-fatal", async () => {
    const supabase = makeSupabaseDouble({ releaseError: "write unavailable" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      releaseEmailConnectionSyncLock(
        "connection-1",
        "owner-1",
        "gmail-scan-preview",
        supabase as never
      )
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[gmail-scan-preview] email connection lock release failed (non-fatal):",
      "write unavailable"
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("never returns a competing lease owner from renewal", async () => {
    const supabase = makeSupabaseDouble({ renewData: false });

    await expect(
      renewEmailConnectionSyncLock(
        "connection-2",
        "stale-owner",
        "cross-company-sync",
        supabase as never
      )
    ).rejects.toThrow(
      "[cross-company-sync] email connection lock ownership was lost for connection-2"
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("uses the fixed lease TTL for every owner-fenced renewal", async () => {
    const supabase = makeSupabaseDouble();

    await renewEmailConnectionSyncLock(
      "connection-1",
      "owner-1",
      "gmail-scan-preview",
      supabase as never
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "renew_email_connection_sync_lock_as_system",
      expect.objectContaining({
        p_lease_seconds: 600,
      })
    );
  });

  it("does not use tenant or mailbox address in the lock transport contract", async () => {
    const supabase = makeSupabaseDouble();

    await acquireEmailConnectionSyncLock(
      "connection-1",
      "gmail-scan-preview",
      supabase as never
    );

    const [, args] = supabase.rpc.mock.calls[0];
    expect(args).toEqual({
      p_connection_id: "connection-1",
      p_lease_seconds: 600,
    });
    expect(args).not.toHaveProperty("company_id");
    expect(args).not.toHaveProperty("email");
  });

  it("publishes every cursor boundary through the exact owner-fenced RPC", async () => {
    const supabase = makeSupabaseDouble();

    await persistEmailConnectionRecoveryCheckpoint({
      connectionId: "connection-1",
      ownerId: "owner-1",
      anchor: new Date("2026-07-21T08:00:00.000Z"),
      pageToken: "page-2",
      targetToken: "history-20",
      context: "email-sync",
      client: supabase as never,
    });
    await persistEmailConnectionSyncCompletion({
      connectionId: "connection-1",
      ownerId: "owner-1",
      lastSyncedAt: new Date("2026-07-21T08:05:00.000Z"),
      historyId: "history-20",
      clearRecovery: true,
      context: "email-sync",
      client: supabase as never,
    });
    await completeGmailImportJobUnderSyncLock({
      connectionId: "connection-1",
      ownerId: "owner-1",
      jobId: "job-1",
      historyId: "history-21",
      processed: 8,
      matched: 5,
      unmatched: 3,
      needsReview: 1,
      clientsCreated: 2,
      leadsCreated: 2,
      completedAt: new Date("2026-07-21T08:06:00.000Z"),
      context: "gmail-historical-import",
      client: supabase as never,
    });

    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      "persist_email_connection_recovery_checkpoint_as_system",
      expect.objectContaining({
        p_connection_id: "connection-1",
        p_owner_id: "owner-1",
      })
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      "persist_email_connection_sync_completion_as_system",
      expect.objectContaining({
        p_connection_id: "connection-1",
        p_owner_id: "owner-1",
        p_clear_recovery: true,
      })
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      3,
      "complete_gmail_import_job_as_system",
      expect.objectContaining({
        p_connection_id: "connection-1",
        p_owner_id: "owner-1",
        p_job_id: "job-1",
      })
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects stale-owner cursor publication without a fallback write", async () => {
    const supabase = makeSupabaseDouble({ writeData: false });

    await expect(
      persistEmailConnectionSyncCompletion({
        connectionId: "connection-1",
        ownerId: "stale-owner",
        lastSyncedAt: new Date("2026-07-21T08:05:00.000Z"),
        historyId: "history-20",
        clearRecovery: false,
        context: "email-sync",
        client: supabase as never,
      })
    ).rejects.toThrow("mailbox lock ownership was lost before write");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("retries Gmail import completion persistence exactly once after response loss", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "response unavailable" },
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const supabase = {
      rpc,
      from: vi.fn(() => {
        throw new Error("owner-fenced completion cannot fall back");
      }),
    };

    await expect(
      completeGmailImportJobUnderSyncLock({
        connectionId: "connection-1",
        ownerId: "owner-1",
        jobId: "job-1",
        historyId: "history-21",
        processed: 8,
        matched: 5,
        unmatched: 3,
        needsReview: 1,
        clientsCreated: 2,
        leadsCreated: 2,
        completedAt: new Date("2026-07-21T08:06:00.000Z"),
        context: "gmail-historical-import",
        client: supabase as never,
      })
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("renews long-running work only after the shared renewal interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    const supabase = makeSupabaseDouble();
    const renewIfNeeded = createEmailConnectionSyncLockRenewer({
      connectionId: "connection-1",
      ownerId: "owner-1",
      context: "gmail-historical-import",
      client: supabase as never,
    });

    await renewIfNeeded();
    expect(supabase.rpc).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-07-21T08:02:00.001Z"));
    await renewIfNeeded();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "renew_email_connection_sync_lock_as_system",
      expect.any(Object)
    );

    await renewIfNeeded.stop();
  });

  it("heartbeats the lease while a Gmail operation is blocked inside one long read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    const supabase = makeSupabaseDouble();
    const renewIfNeeded = createEmailConnectionSyncLockRenewer({
      connectionId: "connection-1",
      ownerId: "owner-1",
      context: "phase-c-email-scan",
      client: supabase as never,
    });

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "renew_email_connection_sync_lock_as_system",
      expect.any(Object)
    );
    await renewIfNeeded.stop();
  });

  it("runs mailbox work under one owner and releases only after a final ownership proof", async () => {
    const supabase = makeSupabaseDouble();
    const work = vi.fn(
      async (checkpoint: (force?: boolean) => Promise<void>) => {
        await checkpoint(true);
        return "complete";
      }
    );

    await expect(
      runWithEmailConnectionSyncLock({
        connectionId: "connection-1",
        context: "email-attachment-worker",
        client: supabase as never,
        run: work,
      })
    ).resolves.toEqual({ acquired: true, value: "complete" });

    expect(work).toHaveBeenCalledOnce();
    // One explicit checkpoint from the work and one final ownership proof.
    expect(
      supabase.rpc.mock.calls.filter(
        ([name]) => name === "renew_email_connection_sync_lock_as_system"
      )
    ).toHaveLength(2);
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      "release_email_connection_sync_lock_as_system",
      {
        p_connection_id: "connection-1",
        p_owner_id: "00000000-0000-4000-8000-000000000001",
      }
    );
  });

  it("does not start mailbox work when another operation owns the lease", async () => {
    const supabase = makeSupabaseDouble({ acquireData: null });
    const work = vi.fn();

    await expect(
      runWithEmailConnectionSyncLock({
        connectionId: "connection-1",
        context: "inbox-drafts-list",
        client: supabase as never,
        run: work,
      })
    ).resolves.toEqual({ acquired: false });

    expect(work).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("releases the lease after mailbox work fails without hiding the original error", async () => {
    const supabase = makeSupabaseDouble();
    const original = new Error("provider read failed");

    await expect(
      runWithEmailConnectionSyncLock({
        connectionId: "connection-1",
        context: "phase-c-backfill",
        client: supabase as never,
        run: async () => {
          throw original;
        },
      })
    ).rejects.toBe(original);

    expect(supabase.rpc).toHaveBeenLastCalledWith(
      "release_email_connection_sync_lock_as_system",
      {
        p_connection_id: "connection-1",
        p_owner_id: "00000000-0000-4000-8000-000000000001",
      }
    );
  });
});
