import { describe, expect, it } from "vitest";

import { emailSyncContinuationPendingForConnection } from "@/lib/email/email-sync-continuation-state";

/**
 * Acquiring this connection's mailbox lease WRITES `sync_in_progress_at`
 * (`acquire_email_connection_sync_lock_as_system` does
 * `set sync_in_progress_at = v_claimed_at`). So a caller that already holds the
 * lease and then asks "is a sync running?" is reading its own lock and blocking
 * on itself — which is exactly how Phase C mailbox draft placement deadlocked.
 * Holding the lease is proof the mailbox is ours, not proof it is busy.
 */
function connectionRow(overrides: {
  syncInProgressAt?: string | null;
  recoveryPageToken?: string | null;
  historyId?: string | null;
}) {
  const data = {
    sync_in_progress_at: overrides.syncInProgressAt ?? null,
    history_recovery_page_token: overrides.recoveryPageToken ?? null,
    history_id: overrides.historyId ?? "200",
  };
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error: null }),
        }),
      }),
    }),
  } as never;
}

describe("emailSyncContinuationPendingForConnection", () => {
  it("treats a sync it does not own as pending", async () => {
    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionRow({
          syncInProgressAt: "2026-08-06T17:00:00.000Z",
        }),
        connectionId: "connection-1",
        context: "test",
      })
    ).resolves.toBe(true);
  });

  it("does not count the caller's own mailbox lease as a foreign sync", async () => {
    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionRow({
          syncInProgressAt: "2026-08-06T17:00:00.000Z",
        }),
        connectionId: "connection-1",
        context: "test",
        ownsMailboxLease: true,
      })
    ).resolves.toBe(false);
  });

  it("still refuses while an expired-history recovery has another page, lease or not", async () => {
    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionRow({
          syncInProgressAt: "2026-08-06T17:00:00.000Z",
          recoveryPageToken: "page-2",
        }),
        connectionId: "connection-1",
        context: "test",
        ownsMailboxLease: true,
      })
    ).resolves.toBe(true);
  });

  it("still refuses while the provider cursor itself is mid-catch-up, lease or not", async () => {
    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionRow({
          historyId: 'gmail:v1:{"pendingMessageIds":["m-2"]}',
        }),
        connectionId: "connection-1",
        context: "test",
        ownsMailboxLease: true,
      })
    ).resolves.toBe(true);
  });

  it("reports terminal when nothing is outstanding", async () => {
    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionRow({}),
        connectionId: "connection-1",
        context: "test",
      })
    ).resolves.toBe(false);
  });

  it("fails closed when the cursor cannot be read", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: "boom" },
            }),
          }),
        }),
      }),
    } as never;

    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: broken,
        connectionId: "connection-1",
        context: "test",
        ownsMailboxLease: true,
      })
    ).rejects.toThrow(/mailbox continuation read failed/);
  });
});
