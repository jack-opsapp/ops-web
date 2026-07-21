import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProviderMock,
  requireSupabaseMock,
  runWithEmailConnectionSyncLockMock,
} = vi.hoisted(() => ({
  getProviderMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
  runWithEmailConnectionSyncLockMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/helpers")>(
    "@/lib/supabase/helpers"
  );
  return { ...actual, requireSupabase: requireSupabaseMock };
});

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getProvider: getProviderMock },
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));

import { EmailThreadService } from "@/lib/api/services/email-thread-service";

function connectionRow() {
  return {
    id: "connection-1",
    company_id: "company-1",
    provider: "gmail",
    type: "company",
    user_id: "legacy-connector",
    email: "office@example.com",
    access_token: "token",
    refresh_token: "refresh",
    expires_at: "2027-01-01T00:00:00.000Z",
    history_id: null,
    sync_enabled: true,
    last_synced_at: null,
    sync_interval_minutes: 60,
    sync_filters: {},
    webhook_subscription_id: null,
    webhook_expires_at: null,
    ops_label_id: null,
    ai_review_enabled: true,
    ai_memory_enabled: true,
    archive_writeback_preference: "archive_in_gmail",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function supabaseDouble(
  events: string[],
  options: {
    updateErrorTables?: string[];
    threadLabels?: string[];
  } = {}
) {
  const thread = {
    id: "thread-1",
    connection_id: "connection-1",
    provider_thread_id: "provider-thread-1",
    unread_count: 3,
    labels: options.threadLabels ?? ["AWAITING_REPLY"],
  };

  class Query {
    private action: "select" | "update" = "select";
    private payload: Record<string, unknown> | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq() {
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      return this;
    }

    single() {
      return Promise.resolve({
        data: this.table === "email_threads" ? thread : connectionRow(),
        error: null,
      });
    }

    maybeSingle() {
      return this.single();
    }

    then<A = unknown, B = never>(
      fulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
      rejected?: ((reason: unknown) => B | PromiseLike<B>) | null
    ) {
      if (this.action === "update") {
        events.push(`db:${JSON.stringify(this.payload)}`);
      }
      const error = options.updateErrorTables?.includes(this.table)
        ? { message: `${this.table} mirror unavailable` }
        : null;
      return Promise.resolve({ data: null, error }).then(fulfilled, rejected);
    }
  }

  return { from: (table: string) => new Query(table) };
}

describe("EmailThreadService provider mailbox lease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails busy before provider construction and local mutation", async () => {
    const events: string[] = [];
    requireSupabaseMock.mockReturnValue(supabaseDouble(events));
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });

    await expect(EmailThreadService.markRead("thread-1", true)).rejects.toThrow(
      "EMAIL_THREAD_MAILBOX_BUSY"
    );

    expect(getProviderMock).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("runs provider mutation between mailbox checkpoints before local mutation", async () => {
    const events: string[] = [];
    const checkpoint = vi.fn(async () => {
      events.push("checkpoint");
    });
    requireSupabaseMock.mockReturnValue(supabaseDouble(events));
    getProviderMock.mockReturnValue({
      markThreadRead: vi.fn(async () => {
        events.push("provider");
      }),
    });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({ run }: { run: (renew: typeof checkpoint) => unknown }) => ({
        acquired: true,
        value: await run(checkpoint),
      })
    );

    await EmailThreadService.markRead("thread-1", true);

    expect(events).toEqual([
      "checkpoint",
      "provider",
      "checkpoint",
      'db:{"unread_count":0}',
    ]);
  });

  it("does not publish local success when ownership is lost after provider mutation", async () => {
    const events: string[] = [];
    const checkpoint = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("mailbox ownership lost"));
    requireSupabaseMock.mockReturnValue(supabaseDouble(events));
    getProviderMock.mockReturnValue({
      markThreadRead: vi.fn(async () => {
        events.push("provider");
      }),
    });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({ run }: { run: (renew: typeof checkpoint) => unknown }) => ({
        acquired: true,
        value: await run(checkpoint),
      })
    );

    await expect(EmailThreadService.markRead("thread-1", true)).rejects.toThrow(
      "EMAIL_THREAD_MAILBOX_BUSY_LEASE_LOST"
    );

    expect(events).toEqual(["provider"]);
  });

  it.each([
    [
      "unarchive",
      () =>
        EmailThreadService.unarchive({
          threadId: "thread-1",
          authorizeProviderMutation: async () => true,
        }),
    ],
    [
      "snooze",
      () =>
        EmailThreadService.snooze({
          threadId: "thread-1",
          until: new Date("2027-01-01T00:00:00.000Z"),
        }),
    ],
    ["unsnooze", () => EmailThreadService.unsnooze("thread-1")],
    ["markRead", () => EmailThreadService.markRead("thread-1", true)],
  ])(
    "surfaces %s provider rejection and skips the local mirror",
    async (_, run) => {
      const events: string[] = [];
      requireSupabaseMock.mockReturnValue(supabaseDouble(events));
      const providerFailure = new Error("provider rejected thread mutation");
      getProviderMock.mockReturnValue({
        unarchiveThread: vi.fn().mockRejectedValue(providerFailure),
        snoozeThread: vi.fn().mockRejectedValue(providerFailure),
        markThreadRead: vi.fn().mockRejectedValue(providerFailure),
      });
      runWithEmailConnectionSyncLockMock.mockImplementation(
        async ({
          run: operation,
        }: {
          run: (checkpoint: () => Promise<void>) => unknown;
        }) => ({
          acquired: true,
          value: await operation(async () => undefined),
        })
      );

      await expect(run()).rejects.toBe(providerFailure);
      expect(events).toEqual([]);
    }
  );

  it("surfaces a failed local mirror instead of reporting provider success", async () => {
    const events: string[] = [];
    requireSupabaseMock.mockReturnValue(
      supabaseDouble(events, { updateErrorTables: ["email_threads"] })
    );
    getProviderMock.mockReturnValue({
      markThreadRead: vi.fn(async () => {
        events.push("provider");
      }),
    });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({
        run,
      }: {
        run: (checkpoint: () => Promise<void>) => unknown;
      }) => ({
        acquired: true,
        value: await run(async () => undefined),
      })
    );

    await expect(EmailThreadService.markRead("thread-1", true)).rejects.toThrow(
      "markRead mirror update failed: email_threads mirror unavailable"
    );
    expect(events).toEqual(["provider", 'db:{"unread_count":0}']);
  });

  it("records a batch provider failure and skips that thread's local mirror", async () => {
    const events: string[] = [];
    requireSupabaseMock.mockReturnValue(supabaseDouble(events));
    getProviderMock.mockReturnValue({
      archiveThread: vi
        .fn()
        .mockRejectedValue(new Error("provider archive unavailable")),
    });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({
        run,
      }: {
        run: (checkpoint: () => Promise<void>) => unknown;
      }) => ({
        acquired: true,
        value: await run(async () => undefined),
      })
    );

    const result = await EmailThreadService.archiveBatch({
      companyId: "company-1",
      threadIds: ["thread-1"],
      archiveOpportunityId: null,
      authorizeProviderMutation: async () => true,
    });

    expect(result).toMatchObject({
      archivedThreadIds: [],
      failedThreadIds: ["thread-1"],
      failedOpportunityId: null,
    });
    expect(events).toEqual([]);
  });

  it("records a batch mirror failure after provider success and does not claim the thread succeeded", async () => {
    const events: string[] = [];
    requireSupabaseMock.mockReturnValue(
      supabaseDouble(events, { updateErrorTables: ["email_threads"] })
    );
    getProviderMock.mockReturnValue({
      archiveThread: vi.fn(async () => {
        events.push("provider");
      }),
    });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({
        run,
      }: {
        run: (checkpoint: () => Promise<void>) => unknown;
      }) => ({
        acquired: true,
        value: await run(async () => undefined),
      })
    );

    const result = await EmailThreadService.archiveBatch({
      companyId: "company-1",
      threadIds: ["thread-1"],
      archiveOpportunityId: "opportunity-1",
      authorizeProviderMutation: async () => true,
    });

    expect(result).toMatchObject({
      archivedThreadIds: [],
      failedThreadIds: ["thread-1"],
      leadArchivedOpportunityId: null,
      failedOpportunityId: "opportunity-1",
    });
    expect(events).toEqual([
      "provider",
      expect.stringContaining('db:{"archived_at":'),
    ]);
  });

  it("fails a batch item closed when final canonical authorization is revoked inside the mailbox lease", async () => {
    const events: string[] = [];
    requireSupabaseMock.mockReturnValue(supabaseDouble(events));
    const archiveThread = vi.fn(async () => {
      events.push("provider");
    });
    getProviderMock.mockReturnValue({ archiveThread });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({
        run,
      }: {
        run: (checkpoint: () => Promise<void>) => unknown;
      }) => ({
        acquired: true,
        value: await run(async () => undefined),
      })
    );

    const result = await EmailThreadService.archiveBatch({
      companyId: "company-1",
      threadIds: ["thread-1"],
      archiveOpportunityId: null,
      authorizeProviderMutation: async () => false,
    });

    expect(result.failedThreadIds).toEqual(["thread-1"]);
    expect(archiveThread).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each([
    [
      "dismissAwaitingReply",
      ["AWAITING_REPLY"],
      () => EmailThreadService.dismissAwaitingReply("thread-1", "company-1"),
    ],
    [
      "restoreAwaitingReply",
      [],
      () => EmailThreadService.restoreAwaitingReply("thread-1", "company-1"),
    ],
  ])("surfaces a failed %s OPS-only mirror write", async (_, labels, run) => {
    const events: string[] = [];
    requireSupabaseMock.mockReturnValue(
      supabaseDouble(events, {
        updateErrorTables: ["email_threads"],
        threadLabels: labels,
      })
    );

    await expect(run()).rejects.toThrow("mirror update failed");
    expect(events).toHaveLength(1);
  });
});
