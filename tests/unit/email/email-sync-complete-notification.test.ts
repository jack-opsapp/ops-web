import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createEmailSyncCompleteNotification } from "@/lib/email/email-sync-complete-notification";

const CONNECTION_ID = "00000000-0000-4000-8000-000000000001";
const OWNER_ID = "00000000-0000-4000-8000-000000000002";

function input(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: CONNECTION_ID,
    connectionType: "individual" as const,
    expectedOwnerUserId: OWNER_ID,
    newLeads: 2,
    matched: 3,
    needsReview: 1,
    ...overrides,
  };
}

describe("createEmailSyncCompleteNotification", () => {
  it("never calls the notification RPC for a shared mailbox connector", async () => {
    const rpc = vi.fn();

    await expect(
      createEmailSyncCompleteNotification({
        ...input({ connectionType: "company" }),
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).resolves.toBe(false);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("never treats a missing or malformed legacy owner as an OPS user", async () => {
    for (const expectedOwnerUserId of [null, "legacy-connector-user"]) {
      const rpc = vi.fn();

      await expect(
        createEmailSyncCompleteNotification({
          ...input({ expectedOwnerUserId }),
          supabase: { rpc } as unknown as SupabaseClient,
        })
      ).resolves.toBe(false);

      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("passes only the exact personal owner and bounded sync counts", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));

    await expect(
      createEmailSyncCompleteNotification({
        ...input(),
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith(
      "create_email_sync_complete_notification_as_system",
      {
        p_connection_id: CONNECTION_ID,
        p_expected_owner_user_id: OWNER_ID,
        p_new_leads: 2,
        p_matched: 3,
        p_needs_review: 1,
      }
    );
  });

  it("treats a stale, inactive, or unauthorized owner as typed no-work", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));

    await expect(
      createEmailSyncCompleteNotification({
        ...input(),
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).resolves.toBe(false);
  });

  it("does not call the RPC for empty or out-of-range sync counts", async () => {
    for (const counts of [
      { newLeads: 0, matched: 0, needsReview: 0 },
      { newLeads: -1, matched: 0, needsReview: 0 },
      { newLeads: 10_001, matched: 0, needsReview: 0 },
      { newLeads: 0.5, matched: 0, needsReview: 0 },
    ]) {
      const rpc = vi.fn();

      await expect(
        createEmailSyncCompleteNotification({
          ...input(counts),
          supabase: { rpc } as unknown as SupabaseClient,
        })
      ).resolves.toBe(false);

      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("surfaces database errors without retrying the notification operation", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "database unavailable" },
    }));

    await expect(
      createEmailSyncCompleteNotification({
        ...input(),
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).rejects.toThrow(
      "email sync-complete notification failed: database unavailable"
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
