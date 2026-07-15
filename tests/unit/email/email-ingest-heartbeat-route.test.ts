import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { heartbeatState, sendInboxConnectionDownMock } = vi.hoisted(() => ({
  heartbeatState: {
    notificationInsertError: null as { message: string } | null,
    heartbeatLogInserts: [] as Array<Record<string, unknown>>,
  },
  sendInboxConnectionDownMock: vi.fn(),
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendInboxConnectionDown: sendInboxConnectionDownMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "email_connections") {
        return {
          select: async () => ({
            data: [
              {
                id: "connection-1",
                company_id: "company-1",
                user_id: "user-1",
                email: "owner@example.com",
                provider: "gmail",
                type: "company",
                status: "active",
                sync_enabled: true,
                webhook_subscription_id: null,
                webhook_expires_at: null,
                last_synced_at: null,
                created_at: "2020-01-01T00:00:00.000Z",
              },
            ],
            error: null,
          }),
        };
      }

      if (table === "email_ingest_heartbeat_log") {
        return {
          select: () => ({
            gte: () => ({
              in: async () => ({ data: [], error: null }),
            }),
          }),
          insert: async (payload: Record<string, unknown>) => {
            heartbeatState.heartbeatLogInserts.push(payload);
            return { error: null };
          },
        };
      }

      if (table === "companies") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  id: "company-1",
                  name: "Canpro",
                  admin_ids: ["admin-1"],
                },
              ],
              error: null,
            }),
          }),
        };
      }

      if (table === "users") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  id: "admin-1",
                  email: "admin@example.com",
                  company_id: "company-1",
                },
              ],
              error: null,
            }),
          }),
        };
      }

      if (table === "notifications") {
        return {
          insert: async () => ({
            error: heartbeatState.notificationInsertError,
          }),
        };
      }

      throw new Error(`Unexpected Supabase table in heartbeat test: ${table}`);
    },
  }),
}));

import { GET } from "@/app/api/cron/email-ingest-heartbeat/route";

function request(): NextRequest {
  return new NextRequest("https://ops.test/api/cron/email-ingest-heartbeat", {
    headers: { authorization: "Bearer cron-test-secret" },
  });
}

describe("email ingest heartbeat delivery semantics", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://ops.test";
    heartbeatState.notificationInsertError = null;
    heartbeatState.heartbeatLogInserts.length = 0;
    sendInboxConnectionDownMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.restoreAllMocks();
  });

  it.each([
    {
      delivery: "suppressed",
      outcome: {
        result: {
          status: "suppression_skipped",
          reason: "suppressed",
        },
      },
    },
    {
      delivery: "paused",
      outcome: {
        result: {
          status: "paused_skipped",
          scope: "global",
        },
      },
    },
    {
      delivery: "failed",
      outcome: { error: new Error("SendGrid unavailable") },
    },
  ])(
    "does not dedupe a failed alert when in-app insert fails and email is $delivery",
    async ({ outcome }) => {
      heartbeatState.notificationInsertError = {
        message: "notification insert failed",
      };
      if ("error" in outcome) {
        sendInboxConnectionDownMock.mockRejectedValue(outcome.error);
      } else {
        sendInboxConnectionDownMock.mockResolvedValue(outcome.result);
      }

      const response = await GET(request());
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toEqual({
        ok: false,
        checked: 1,
        failed: 1,
        alerted: 0,
        deliveryFailures: 1,
      });
      expect(heartbeatState.heartbeatLogInserts).toEqual([]);
    }
  );

  it.each([
    {
      delivery: "in-app only",
      notificationError: null,
      sendResult: {
        status: "suppression_skipped",
        reason: "suppressed",
      },
      expectedReason: "webhook_setup_failed_inapp_only",
    },
    {
      delivery: "email only",
      notificationError: { message: "notification insert failed" },
      sendResult: { status: "sent", messageId: "sg-message-1" },
      expectedReason: "webhook_setup_failed_email_only",
    },
    {
      delivery: "email and in-app",
      notificationError: null,
      sendResult: { status: "sent", messageId: "sg-message-1" },
      expectedReason: "webhook_setup_failed_email_and_inapp",
    },
  ])(
    "logs the exact $delivery channel and counts the alert",
    async ({ notificationError, sendResult, expectedReason }) => {
      heartbeatState.notificationInsertError = notificationError;
      sendInboxConnectionDownMock.mockResolvedValue(sendResult);

      const response = await GET(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        checked: 1,
        failed: 1,
        alerted: 1,
        deliveryFailures: 0,
      });
      expect(heartbeatState.heartbeatLogInserts).toHaveLength(1);
      expect(heartbeatState.heartbeatLogInserts[0]).toEqual({
        company_id: "company-1",
        triggered_at: expect.any(String),
        reason: expectedReason,
      });
    }
  );
});
