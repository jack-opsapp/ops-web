import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/helpers")>(
    "@/lib/supabase/helpers"
  );
  return { ...actual, requireSupabase: requireSupabaseMock };
});

import { EmailService } from "@/lib/api/services/email-service";
import { GmailService } from "@/lib/api/services/gmail-service";

describe("email connection identity retention", () => {
  const update = vi.fn();
  const remove = vi.fn();
  const eq = vi.fn(async () => ({ error: null }));

  beforeEach(() => {
    vi.clearAllMocks();
    update.mockReturnValue({ eq });
    requireSupabaseMock.mockReturnValue({
      from: vi.fn(() => ({ update, delete: remove })),
    });
  });

  it.each([
    ["provider-neutral", EmailService.deleteConnection],
    ["legacy Gmail", GmailService.deleteConnection],
  ])(
    "soft-disconnects %s connections without deleting their dedupe identity",
    async (_label, disconnect) => {
      await disconnect("connection-1");

      expect(remove).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "disconnected",
          sync_enabled: false,
          access_token: "",
          refresh_token: "",
          webhook_subscription_id: null,
          webhook_expires_at: null,
          webhook_client_state_hash: null,
          history_recovery_anchor: null,
          history_recovery_page_token: null,
          history_recovery_target_token: null,
        })
      );
      expect(eq).toHaveBeenCalledWith("id", "connection-1");
    }
  );

  it("round-trips the durable Gmail history-recovery checkpoint", async () => {
    const recoveryAnchor = new Date("2026-07-13T20:00:00.000Z");
    const updatedRow = {
      id: "connection-1",
      company_id: "company-1",
      provider: "gmail",
      type: "company",
      user_id: null,
      email: "operator@example.com",
      access_token: "token",
      refresh_token: "refresh",
      expires_at: "2026-07-14T20:00:00.000Z",
      history_id: "expired-history-token",
      sync_enabled: true,
      last_synced_at: "2026-07-13T19:45:00.000Z",
      sync_interval_minutes: 15,
      sync_filters: {},
      history_recovery_anchor: recoveryAnchor.toISOString(),
      history_recovery_page_token: "page-2",
      history_recovery_target_token: "fresh-history-token",
      webhook_subscription_id: null,
      webhook_expires_at: null,
      webhook_client_state_hash: null,
      ops_label_id: null,
      ai_review_enabled: false,
      ai_memory_enabled: false,
      status: "active",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-13T20:00:00.000Z",
    };
    const single = vi.fn(async () => ({ data: updatedRow, error: null }));
    const select = vi.fn(() => ({ single }));
    const updateEq = vi.fn(() => ({ select }));
    const recoveryUpdate = vi.fn(() => ({ eq: updateEq }));
    requireSupabaseMock.mockReturnValue({
      from: vi.fn(() => ({ update: recoveryUpdate })),
    });

    const connection = await EmailService.updateConnection("connection-1", {
      historyRecoveryAnchor: recoveryAnchor,
      historyRecoveryPageToken: "page-2",
      historyRecoveryTargetToken: "fresh-history-token",
    });

    expect(recoveryUpdate).toHaveBeenCalledWith({
      history_recovery_anchor: recoveryAnchor.toISOString(),
      history_recovery_page_token: "page-2",
      history_recovery_target_token: "fresh-history-token",
    });
    expect(connection).toEqual(
      expect.objectContaining({
        historyRecoveryAnchor: recoveryAnchor,
        historyRecoveryPageToken: "page-2",
        historyRecoveryTargetToken: "fresh-history-token",
      })
    );
  });
});
