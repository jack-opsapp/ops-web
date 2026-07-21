import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  drainPersonalMailboxLifecycleMock,
  processImportProviderOperationsMock,
  heartbeatState,
  sendInboxConnectionDownMock,
} = vi.hoisted(() => ({
  drainPersonalMailboxLifecycleMock: vi.fn(),
  processImportProviderOperationsMock: vi.fn(),
  heartbeatState: {
    notificationInsertError: null as { message: string } | null,
    notificationCreated: true,
    heartbeatLogInserts: [] as Array<Record<string, unknown>>,
    notificationInserts: [] as Array<Record<string, unknown>>,
    notificationResolutions: [] as Array<{
      payload: Record<string, unknown>;
      dedupeKeys: unknown[];
    }>,
    rpcCalls: [] as Array<{
      name: string;
      params: Record<string, unknown>;
    }>,
    integrationPermissionAllowed: true,
    connectionHealthy: false,
  },
  sendInboxConnectionDownMock: vi.fn(),
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendInboxConnectionDown: sendInboxConnectionDownMock,
}));

vi.mock(
  "@/lib/api/services/personal-email-connection-lifecycle-service",
  () => ({
    PersonalEmailConnectionLifecycleService: {
      drainPending: drainPersonalMailboxLifecycleMock,
    },
  })
);

vi.mock("@/lib/api/services/email-import-provider-operation-service", () => ({
  runEmailImportProviderOperations: processImportProviderOperationsMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "email_connections") {
        const healthy = heartbeatState.connectionHealthy;
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
                webhook_subscription_id: healthy ? "watch-1" : null,
                webhook_expires_at: healthy ? "2999-01-01T00:00:00.000Z" : null,
                last_synced_at: healthy ? new Date().toISOString() : null,
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
        const users = [
          {
            id: "admin-1",
            email: "admin@example.com",
            company_id: "company-1",
            is_active: true,
            deleted_at: null,
          },
        ];
        let filtered = [...users];
        const query = {
          select: () => query,
          in: (column: string, values: unknown[]) => {
            filtered = filtered.filter((row) =>
              values.includes(row[column as keyof typeof row])
            );
            return query;
          },
          eq: (column: string, value: unknown) => {
            filtered = filtered.filter(
              (row) => row[column as keyof typeof row] === value
            );
            return query;
          },
          is: (column: string, value: unknown) => {
            filtered = filtered.filter(
              (row) => row[column as keyof typeof row] === value
            );
            return query;
          },
          then: (
            resolve: (value: { data: typeof users; error: null }) => unknown
          ) => Promise.resolve({ data: filtered, error: null }).then(resolve),
        };
        return {
          select: query.select,
        };
      }

      if (table === "notifications") {
        return {
          update: (payload: Record<string, unknown>) => ({
            in: (_column: string, dedupeKeys: unknown[]) => ({
              is: async () => {
                heartbeatState.notificationResolutions.push({
                  payload,
                  dedupeKeys,
                });
                return { error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected Supabase table in heartbeat test: ${table}`);
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      heartbeatState.rpcCalls.push({ name, params });
      if (name === "create_notification_if_new_with_identity") {
        heartbeatState.notificationInserts.push({
          user_id: params.p_user_id,
          company_id: params.p_company_id,
          type: params.p_type,
          title: params.p_title,
          body: params.p_body,
          persistent: params.p_persistent,
          action_url: params.p_action_url,
          action_label: params.p_action_label,
          dedupe_key: params.p_dedupe_key,
        });
        return heartbeatState.notificationInsertError
          ? { data: null, error: heartbeatState.notificationInsertError }
          : {
              data: [
                {
                  notification_id: "notification-1",
                  created: heartbeatState.notificationCreated,
                  incident_version: 0,
                },
              ],
              error: null,
            };
      }
      if (name !== "has_permission") throw new Error(`Unexpected RPC: ${name}`);
      return {
        data:
          heartbeatState.integrationPermissionAllowed &&
          params.p_user_id === "admin-1" &&
          params.p_permission === "settings.integrations" &&
          params.p_required_scope === "all",
        error: null,
      };
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
    heartbeatState.notificationCreated = true;
    heartbeatState.heartbeatLogInserts.length = 0;
    heartbeatState.notificationInserts.length = 0;
    heartbeatState.notificationResolutions.length = 0;
    heartbeatState.rpcCalls.length = 0;
    heartbeatState.integrationPermissionAllowed = true;
    heartbeatState.connectionHealthy = false;
    sendInboxConnectionDownMock.mockReset();
    drainPersonalMailboxLifecycleMock.mockResolvedValue({
      selected: 0,
      processed: 0,
      failed: 0,
    });
    processImportProviderOperationsMock.mockResolvedValue({
      claimed: 0,
      applied: 0,
      failed: 0,
      staleCompletions: 0,
      staleFailures: 0,
      errors: [],
    });
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

  it("drains durable personal-mailbox lifecycle events without invoking a mailbox provider", async () => {
    sendInboxConnectionDownMock.mockResolvedValue({
      status: "suppression_skipped",
      reason: "suppressed",
    });

    await GET(request());

    expect(drainPersonalMailboxLifecycleMock).toHaveBeenCalledWith(
      100,
      expect.anything()
    );
  });

  it("processes a bounded provider-label batch through the existing hourly heartbeat", async () => {
    sendInboxConnectionDownMock.mockResolvedValue({
      status: "suppression_skipped",
      reason: "suppressed",
    });

    await GET(request());

    expect(processImportProviderOperationsMock).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 5, leaseSeconds: 300 }
    );
  });

  it("targets a current integration manager instead of the legacy company connector", async () => {
    sendInboxConnectionDownMock.mockResolvedValue({
      status: "sent",
      messageId: "sg-message-1",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(heartbeatState.notificationInserts).toContainEqual(
      expect.objectContaining({
        user_id: "admin-1",
        company_id: "company-1",
      })
    );
    expect(sendInboxConnectionDownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "admin@example.com",
        reconnectUrl: expect.stringContaining("userId=admin-1"),
      })
    );
    expect(
      JSON.stringify(heartbeatState.notificationInserts) +
        JSON.stringify(sendInboxConnectionDownMock.mock.calls)
    ).not.toContain("userId=user-1");
  });

  it("creates the persistent rail alert through a connection-scoped dedupe identity", async () => {
    sendInboxConnectionDownMock.mockResolvedValue({
      status: "suppression_skipped",
      reason: "suppressed",
    });

    await GET(request());

    expect(heartbeatState.rpcCalls).toContainEqual({
      name: "create_notification_if_new_with_identity",
      params: expect.objectContaining({
        p_user_id: "admin-1",
        p_company_id: "company-1",
        p_type: "system_alert",
        p_persistent: true,
        p_dedupe_key: "email-ingest-health:connection-1",
      }),
    });
  });

  it("treats an already-open deduped rail alert as delivered", async () => {
    heartbeatState.notificationCreated = false;
    sendInboxConnectionDownMock.mockResolvedValue({
      status: "suppression_skipped",
      reason: "suppressed",
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alerted).toBe(1);
    expect(heartbeatState.heartbeatLogInserts).toHaveLength(1);
  });

  it("resolves the exact persistent connection alert after provider health recovers", async () => {
    heartbeatState.connectionHealthy = true;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(heartbeatState.notificationResolutions).toEqual([
      {
        payload: expect.objectContaining({
          resolved_at: expect.any(String),
          is_read: true,
          resolution_reason: "email_ingest_recovered",
        }),
        dedupeKeys: ["email-ingest-health:connection-1"],
      },
    ]);
    expect(sendInboxConnectionDownMock).not.toHaveBeenCalled();
  });

  it("fails closed when a company mailbox has no current integration manager", async () => {
    heartbeatState.integrationPermissionAllowed = false;

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(heartbeatState.notificationInserts).toEqual([]);
    expect(sendInboxConnectionDownMock).not.toHaveBeenCalled();
    expect(heartbeatState.heartbeatLogInserts).toEqual([]);
  });
});
