/**
 * Integration tests for /api/cron/email/worker.
 *
 * Covers: auth gating, claimed jobs dispatch via gatedSend, suppressed
 * jobs increment the suppressed counter, completion fires a notification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const completeCampaignIfDoneMock = vi.fn();
const senderMock = vi.fn();

const inserts: Array<{ table: string; payload: unknown }> = [];
const updates: Array<{ table: string; payload: unknown }> = [];

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

vi.mock("@/lib/email/campaigns", () => ({
  completeCampaignIfDone: (...args: unknown[]) =>
    completeCampaignIfDoneMock(...args),
}));

vi.mock("@/lib/email/campaign-templates-bootstrap", () => ({
  bootstrapCampaignTemplates: vi.fn(),
}));

vi.mock("@/lib/email/campaign-templates", () => ({
  getCampaignTemplate: () => ({
    id: "product_update",
    label: "X",
    description: "X",
    sender: senderMock,
  }),
}));

import { GET } from "@/app/api/cron/email/worker/route";

function buildRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(
    new URL("https://example.com/api/cron/email/worker"),
    { headers }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
  process.env.CRON_SECRET = "test-secret";
  completeCampaignIfDoneMock.mockResolvedValue(true);
});

function buildBuilder(table: string) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    in() {
      // For email_campaigns lookup by ids
      if (table === "email_campaigns") {
        return Promise.resolve({
          data: [
            {
              id: "c1",
              template_id: "product_update",
              send_status: "in_flight",
              name: "Test Campaign",
              created_by_user_id: "operator-uid",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
    single() {
      // Used after .insert(...).select() and after the per-cid completion select
      if (table === "email_campaigns") {
        return Promise.resolve({
          data: {
            id: "c1",
            name: "Test Campaign",
            send_status: "completed",
            completed_at: "2026-04-27T00:00:00Z",
            created_by_user_id: "operator-uid",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle() {
      if (table === "users") {
        return Promise.resolve({
          data: { company_id: "co1" },
          error: null,
        });
      }
      if (table === "email_campaigns") {
        return Promise.resolve({
          data: {
            id: "c1",
            name: "Test Campaign",
            send_status: "completed",
            completed_at: "2026-04-27T00:00:00Z",
            created_by_user_id: "operator-uid",
          },
          error: null,
        });
      }
      if (table === "notifications") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    update(payload: unknown) {
      updates.push({ table, payload });
      return builder;
    },
    insert(payload: unknown) {
      inserts.push({ table, payload });
      return builder;
    },
  };
  return builder;
}

describe("email worker cron", () => {
  it("rejects requests without bearer auth", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it("dispatches claimed jobs and increments sent_count", async () => {
    rpcMock.mockImplementation((name: string, args: unknown) => {
      if (name === "claim_email_jobs") {
        return Promise.resolve({
          data: [
            {
              id: "j1",
              campaign_id: "c1",
              recipient_email: "a@example.com",
              recipient_user_id: "u1",
              template_payload: {},
              retry_count: 0,
            },
          ],
          error: null,
        });
      }
      if (name === "increment_campaign_counter") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    fromMock.mockImplementation((table: string) => buildBuilder(table));
    senderMock.mockResolvedValue({ status: "sent", messageId: "msg-1" });

    const res = await GET(buildRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body.sent).toBe(1);
    // Counter RPC was called for sent_count
    const incCall = rpcMock.mock.calls.find(
      ([name, args]) =>
        name === "increment_campaign_counter" &&
        (args as { p_field?: string }).p_field === "sent_count"
    );
    expect(incCall).toBeTruthy();
    // sg_message_id propagated
    const sentUpdate = updates.find(
      (u) =>
        u.table === "email_jobs" &&
        (u.payload as { status?: string }).status === "sent"
    );
    expect(sentUpdate).toBeTruthy();
    expect(
      (sentUpdate?.payload as { sg_message_id: string }).sg_message_id
    ).toBe("msg-1");
    // Notification rail entry on completion
    const notif = inserts.find((i) => i.table === "notifications");
    expect(notif).toBeTruthy();
    expect(
      (notif?.payload as { type?: string }).type
    ).toBe("campaign_done");
  });

  it("marks suppressed jobs and increments suppressed_skipped_count", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "claim_email_jobs") {
        return Promise.resolve({
          data: [
            {
              id: "j2",
              campaign_id: "c1",
              recipient_email: "blocked@example.com",
              recipient_user_id: null,
              template_payload: {},
              retry_count: 0,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    fromMock.mockImplementation((table: string) => buildBuilder(table));
    senderMock.mockResolvedValue({ status: "suppression_skipped", reason: "suppressed" });

    const res = await GET(buildRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.sent).toBe(0);
    const incCall = rpcMock.mock.calls.find(
      ([name, args]) =>
        name === "increment_campaign_counter" &&
        (args as { p_field?: string }).p_field === "suppressed_skipped_count"
    );
    expect(incCall).toBeTruthy();
  });

  it("retries transient errors and finalises after MAX_RETRIES", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "claim_email_jobs") {
        return Promise.resolve({
          data: [
            {
              id: "j3",
              campaign_id: "c1",
              recipient_email: "c@example.com",
              recipient_user_id: "u3",
              template_payload: {},
              retry_count: 2, // 3rd attempt → final
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    fromMock.mockImplementation((table: string) => buildBuilder(table));
    senderMock.mockRejectedValue(new Error("transient"));

    const res = await GET(buildRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body.failed).toBe(1);
    const failedUpdate = updates.find(
      (u) =>
        u.table === "email_jobs" &&
        (u.payload as { status?: string }).status === "failed"
    );
    expect(failedUpdate).toBeTruthy();
    const incCall = rpcMock.mock.calls.find(
      ([name, args]) =>
        name === "increment_campaign_counter" &&
        (args as { p_field?: string }).p_field === "failed_count"
    );
    expect(incCall).toBeTruthy();
  });
});
