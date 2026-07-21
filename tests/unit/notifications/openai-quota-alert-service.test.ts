import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createOpenAIQuotaAlertService } from "@/lib/notifications/openai-quota-alert-service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const NOTIFICATION_ID = "33333333-3333-4333-8333-333333333333";
const DEDUPE_KEY = "platform-provider:openai:insufficient-quota:OPENAI_API_KEY";

interface QueryOperation {
  method: string;
  args: unknown[];
}

interface QueryRecord {
  table: string;
  operations: QueryOperation[];
}

function createDbFixture(overrides?: {
  user?: Record<string, unknown> | null;
  userError?: { message: string } | null;
  company?: Record<string, unknown> | null;
  companyError?: { message: string } | null;
  admin?: Record<string, unknown> | null;
  adminError?: { message: string } | null;
  adminStalls?: boolean;
  notification?: Record<string, unknown> | null;
  notificationError?: { message: string } | null;
  rpcData?: unknown;
  rpcError?: { message: string } | null;
}) {
  const records: QueryRecord[] = [];
  const responses = {
    users: {
      data:
        overrides?.user === undefined
          ? {
              id: USER_ID,
              company_id: COMPANY_ID,
              email: "ops-owner@example.com",
              is_active: true,
              is_company_admin: true,
              deleted_at: null,
            }
          : overrides.user,
      error: overrides?.userError ?? null,
    },
    companies: {
      data:
        overrides?.company === undefined
          ? {
              id: COMPANY_ID,
              account_holder_id: USER_ID,
              admin_ids: [],
              deleted_at: null,
            }
          : overrides.company,
      error: overrides?.companyError ?? null,
    },
    admins: {
      data:
        overrides?.admin === undefined
          ? { email: "ops-owner@example.com" }
          : overrides.admin,
      error: overrides?.adminError ?? null,
    },
    notifications: {
      data:
        overrides?.notification === undefined
          ? { id: NOTIFICATION_ID }
          : overrides.notification,
      error: overrides?.notificationError ?? null,
    },
  };

  const from = vi.fn((table: keyof typeof responses) => {
    const record: QueryRecord = { table, operations: [] };
    records.push(record);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        record.operations.push({ method, args });
        return builder;
      };
    }
    builder.maybeSingle = () =>
      table === "admins" && overrides?.adminStalls
        ? new Promise(() => {})
        : Promise.resolve(responses[table]);
    return builder;
  });
  const rpc = vi.fn().mockResolvedValue({
    data: overrides?.rpcData ?? true,
    error: overrides?.rpcError ?? null,
  });

  return {
    db: { from, rpc } as unknown as SupabaseClient,
    from,
    records,
    rpc,
  };
}

function serviceFixture(options?: {
  db?: ReturnType<typeof createDbFixture>;
  created?: boolean;
  createNotifications?: ReturnType<typeof vi.fn>;
  sendPush?: ReturnType<typeof vi.fn>;
  databaseTimeoutMs?: number;
  pushTimeoutMs?: number;
  actionAccessTimeoutMs?: number;
  log?: ReturnType<typeof vi.fn>;
}) {
  const db = options?.db ?? createDbFixture();
  const createNotifications =
    options?.createNotifications ??
    vi.fn().mockResolvedValue({
      attempted: 1,
      errors: 0,
      createdRecipientIds: options?.created === false ? [] : [USER_ID],
      createdNotifications:
        options?.created === false
          ? []
          : [
              {
                notificationId: NOTIFICATION_ID,
                recipientUserId: USER_ID,
              },
            ],
    });
  const sendPush =
    options?.sendPush ??
    vi.fn().mockResolvedValue({ ok: true, recipients: 1, onesignalId: "os-1" });
  const log = options?.log ?? vi.fn();
  const service = createOpenAIQuotaAlertService({
    db: db.db,
    env: {
      OPS_PLATFORM_ALERT_USER_ID: USER_ID,
      OPS_PLATFORM_ALERT_COMPANY_ID: COMPANY_ID,
    },
    createNotifications,
    sendPush,
    databaseTimeoutMs: options?.databaseTimeoutMs,
    pushTimeoutMs: options?.pushTimeoutMs,
    actionAccessTimeoutMs: options?.actionAccessTimeoutMs,
    log,
  });
  return { service, db, createNotifications, sendPush, log };
}

function operationsFor(
  records: QueryRecord[],
  table: string
): QueryOperation[] {
  return records.find((record) => record.table === table)?.operations ?? [];
}

describe("OpenAI quota alert service", () => {
  it("fails closed on missing canonical UUID configuration without touching storage", async () => {
    const db = createDbFixture();
    const createNotifications = vi.fn();
    const service = createOpenAIQuotaAlertService({
      db: db.db,
      env: {
        OPS_PLATFORM_ALERT_USER_ID: "not-a-uuid",
        OPS_PLATFORM_ALERT_COMPANY_ID: COMPANY_ID,
      },
      createNotifications,
      sendPush: vi.fn(),
      log: vi.fn(),
    });

    await expect(
      service.reportOpenAIQuotaExhausted({
        keySource: "OPENAI_API_KEY",
        workload: "email_sync",
      })
    ).resolves.toBeUndefined();
    await expect(
      service.captureOpenAIQuotaIncident("OPENAI_API_KEY")
    ).rejects.toThrow("OPS platform alert identity is not configured");
    expect(db.from).not.toHaveBeenCalled();
    expect(createNotifications).not.toHaveBeenCalled();
  });

  it("rejects unsafe key-source and workload tokens before storage or logging", async () => {
    for (const keySource of [
      "OPENAI_API_KEY/../../secret",
      " OPENAI_API_KEY",
      "OPENAI_API_KEY ",
      "sk-secret-material",
      `OPENAI_API_KEY_${"A".repeat(64)}`,
    ]) {
      const fixture = serviceFixture();
      await expect(
        fixture.service.reportOpenAIQuotaExhausted({
          keySource,
          workload: "email_sync",
        })
      ).resolves.toBeUndefined();
      await expect(
        fixture.service.captureOpenAIQuotaIncident(keySource)
      ).rejects.toThrow("OpenAI key source is invalid");
      expect(fixture.db.from).not.toHaveBeenCalled();
      expect(fixture.log).not.toHaveBeenCalled();
    }

    const invalidWorkload = serviceFixture();
    await expect(
      invalidWorkload.service.reportOpenAIQuotaExhausted({
        keySource: "OPENAI_API_KEY_SYNC",
        workload: "email/sync secret",
      })
    ).resolves.toBeUndefined();
    expect(invalidWorkload.db.from).not.toHaveBeenCalled();
    expect(invalidWorkload.createNotifications).not.toHaveBeenCalled();
    expect(invalidWorkload.log).not.toHaveBeenCalled();
  });

  it("logs only bounded operational metadata for confirmed exhaustion", async () => {
    const { service, log } = serviceFixture();

    await service.reportOpenAIQuotaExhausted({
      keySource: "OPENAI_API_KEY_SYNC",
      workload: "email_sync",
      errorMetadata: {
        status: 429,
        code: "insufficient_quota",
        type: "insufficient_quota\ncustomer-prompt",
        requestId: "req_safe_123",
        endpoint: "/v1/chat/completions/customer-secret",
      },
    });

    expect(log).toHaveBeenCalledWith("openai_quota_exhausted", {
      code: "insufficient_quota",
      endpointClass: "chat_completions",
      keySource: "OPENAI_API_KEY_SYNC",
      requestId: "req_safe_123",
      status: 429,
      workload: "email_sync",
    });
    const serializedLog = JSON.stringify(log.mock.calls);
    expect(serializedLog).not.toContain("customer-prompt");
    expect(serializedLog).not.toContain("customer-secret");
  });

  it("accepts the bounded specialized OpenAI key-source namespace", async () => {
    const fixture = serviceFixture({
      db: createDbFixture({ notification: null }),
    });

    await expect(
      fixture.service.captureOpenAIQuotaIncident("OPENAI_API_KEY_SYNC")
    ).resolves.toBeNull();
    expect(operationsFor(fixture.db.records, "notifications")).toContainEqual({
      method: "eq",
      args: [
        "dedupe_key",
        "platform-provider:openai:insufficient-quota:OPENAI_API_KEY_SYNC",
      ],
    });
  });

  it("validates canonical OPS identity and company before durable-row-first push", async () => {
    const { service, db, createNotifications, sendPush } = serviceFixture();

    await service.reportOpenAIQuotaExhausted({
      keySource: "OPENAI_API_KEY",
      workload: "email_sync",
      errorMetadata: {
        status: 429,
        code: "insufficient_quota",
        requestId: "secret-provider-request-id",
      },
    });

    expect(operationsFor(db.records, "users")).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", USER_ID] },
        { method: "is", args: ["deleted_at", null] },
      ])
    );
    expect(operationsFor(db.records, "companies")).toContainEqual({
      method: "eq",
      args: ["id", COMPANY_ID],
    });
    expect(operationsFor(db.records, "admins")).toContainEqual({
      method: "eq",
      args: ["email", "ops-owner@example.com"],
    });
    expect(createNotifications).toHaveBeenCalledWith(
      {
        actionLabel: "CHECK OPENAI",
        actionUrl: "/admin/platform-health",
        body: "OpenAI calls stopped. Add credits now.",
        companyId: COMPANY_ID,
        dedupeKey: DEDUPE_KEY,
        deepLinkType: null,
        persistent: true,
        recipientUserIds: [USER_ID],
        title: "OPENAI CREDITS EXHAUSTED",
        type: "ai_provider_quota",
      },
      db.db
    );
    expect(sendPush).toHaveBeenCalledWith({
      body: "OpenAI calls stopped. Add credits now.",
      data: { screen: "notifications", type: "ai_provider_quota" },
      idempotencyKey: NOTIFICATION_ID,
      recipientUserIds: [USER_ID],
      timeoutMs: 2_000,
      title: "OPENAI CREDITS EXHAUSTED",
    });
    expect(
      vi.mocked(createNotifications).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(sendPush).mock.invocationCallOrder[0]);
    expect(JSON.stringify(createNotifications.mock.calls)).not.toContain(
      "secret-provider-request-id"
    );
  });

  it("omits the admin action when access cannot be verified but still creates the rail item", async () => {
    const db = createDbFixture({
      admin: null,
      adminError: { message: "admin access lookup unavailable" },
    });
    const { service, createNotifications } = serviceFixture({ db });

    await service.reportOpenAIQuotaExhausted({
      keySource: "OPENAI_API_KEY",
      workload: "catalog_setup",
    });

    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ actionLabel: null, actionUrl: null }),
      db.db
    );
  });

  it("does not let a stalled optional access probe block the durable rail", async () => {
    const db = createDbFixture({ adminStalls: true });
    const { service, createNotifications } = serviceFixture({
      db,
      databaseTimeoutMs: 50,
      actionAccessTimeoutMs: 5,
    });

    await expect(
      service.reportOpenAIQuotaExhausted({
        keySource: "OPENAI_API_KEY",
        workload: "email_sync",
      })
    ).resolves.toBeUndefined();
    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ actionLabel: null, actionUrl: null }),
      db.db
    );
  });

  it("rejects a company mismatch before creating or reading an incident", async () => {
    const db = createDbFixture({
      user: {
        id: USER_ID,
        company_id: "44444444-4444-4444-8444-444444444444",
        email: "ops-owner@example.com",
        is_active: true,
        is_company_admin: true,
        deleted_at: null,
      },
    });
    const { service, createNotifications } = serviceFixture({ db });

    await expect(
      service.reportOpenAIQuotaExhausted({
        keySource: "OPENAI_API_KEY",
        workload: "email_import",
      })
    ).resolves.toBeUndefined();
    await expect(
      service.captureOpenAIQuotaIncident("OPENAI_API_KEY")
    ).rejects.toThrow("configured recipient is unavailable");
    expect(createNotifications).not.toHaveBeenCalled();
    expect(db.records.some((record) => record.table === "notifications")).toBe(
      false
    );
  });

  it("uses the canonical OPS company-admin union and rejects none-of-three", async () => {
    const accountHolder = serviceFixture({
      db: createDbFixture({
        user: {
          id: USER_ID,
          company_id: COMPANY_ID,
          email: "ops-owner@example.com",
          is_active: true,
          is_company_admin: false,
          deleted_at: null,
        },
        company: {
          id: COMPANY_ID,
          account_holder_id: USER_ID,
          admin_ids: [],
          deleted_at: null,
        },
      }),
    });
    await accountHolder.service.reportOpenAIQuotaExhausted({
      keySource: "OPENAI_API_KEY",
      workload: "email_sync",
    });
    expect(accountHolder.createNotifications).toHaveBeenCalledTimes(1);

    const listedAdmin = serviceFixture({
      db: createDbFixture({
        user: {
          id: USER_ID,
          company_id: COMPANY_ID,
          email: "ops-owner@example.com",
          is_active: true,
          is_company_admin: false,
          deleted_at: null,
        },
        company: {
          id: COMPANY_ID,
          account_holder_id: "44444444-4444-4444-8444-444444444444",
          admin_ids: [USER_ID],
          deleted_at: null,
        },
      }),
    });
    await listedAdmin.service.reportOpenAIQuotaExhausted({
      keySource: "OPENAI_API_KEY",
      workload: "email_sync",
    });
    expect(listedAdmin.createNotifications).toHaveBeenCalledTimes(1);

    const notAdmin = serviceFixture({
      db: createDbFixture({
        user: {
          id: USER_ID,
          company_id: COMPANY_ID,
          email: "ops-owner@example.com",
          is_active: true,
          is_company_admin: false,
          deleted_at: null,
        },
        company: {
          id: COMPANY_ID,
          account_holder_id: "44444444-4444-4444-8444-444444444444",
          admin_ids: [],
          deleted_at: null,
        },
      }),
    });
    await expect(
      notAdmin.service.reportOpenAIQuotaExhausted({
        keySource: "OPENAI_API_KEY",
        workload: "email_sync",
      })
    ).resolves.toBeUndefined();
    await expect(
      notAdmin.service.captureOpenAIQuotaIncident("OPENAI_API_KEY")
    ).rejects.toThrow("configured recipient is not a company administrator");
    expect(notAdmin.createNotifications).not.toHaveBeenCalled();
  });

  it("pushes only for a newly created durable notification", async () => {
    const { service, sendPush } = serviceFixture({ created: false });

    await service.reportOpenAIQuotaExhausted({
      keySource: "OPENAI_API_KEY",
      workload: "email_drafting",
    });

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("keeps reporting bounded and nonthrowing when the durable write stalls", async () => {
    const createNotifications = vi.fn(() => new Promise(() => {}));
    const { service, sendPush } = serviceFixture({
      createNotifications,
      databaseTimeoutMs: 5,
      pushTimeoutMs: 5,
    });

    const result = await Promise.race([
      service
        .reportOpenAIQuotaExhausted({
          keySource: "OPENAI_API_KEY",
          workload: "email_sync",
        })
        .then(() => "settled" as const),
      new Promise<"unbounded">((resolve) =>
        setTimeout(() => resolve("unbounded"), 50)
      ),
    ]);

    expect(result).toBe("settled");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("captures only the exact open incident for the configured identity", async () => {
    const { service, db } = serviceFixture();

    await expect(
      service.captureOpenAIQuotaIncident("OPENAI_API_KEY")
    ).resolves.toEqual({
      notificationId: NOTIFICATION_ID,
      recipientUserId: USER_ID,
      dedupeKey: DEDUPE_KEY,
    });
    expect(operationsFor(db.records, "notifications")).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["user_id", USER_ID] },
        { method: "eq", args: ["company_id", COMPANY_ID] },
        { method: "eq", args: ["type", "ai_provider_quota"] },
        { method: "eq", args: ["dedupe_key", DEDUPE_KEY] },
        { method: "eq", args: ["is_read", false] },
        { method: "is", args: ["resolved_at", null] },
      ])
    );
    expect(db.records.some((record) => record.table === "admins")).toBe(false);
  });

  it("distinguishes a clean empty capture from an infrastructure failure", async () => {
    const empty = serviceFixture({
      db: createDbFixture({ notification: null }),
    });
    const failed = serviceFixture({
      db: createDbFixture({
        notification: null,
        notificationError: { message: "notification read unavailable" },
      }),
    });

    await expect(
      empty.service.captureOpenAIQuotaIncident("OPENAI_API_KEY")
    ).resolves.toBeNull();
    await expect(
      failed.service.captureOpenAIQuotaIncident("OPENAI_API_KEY")
    ).rejects.toThrow("notification read unavailable");
  });

  it("resolves the exact captured incident through the service-only RPC", async () => {
    const { service, db } = serviceFixture();
    const capture = {
      notificationId: NOTIFICATION_ID,
      recipientUserId: USER_ID,
      dedupeKey: DEDUPE_KEY,
    };

    await expect(
      service.resolveCapturedOpenAIQuotaIncident(capture)
    ).resolves.toBeUndefined();
    expect(db.rpc).toHaveBeenCalledWith(
      "resolve_openai_quota_notification_as_system",
      {
        p_company_id: COMPANY_ID,
        p_dedupe_key: DEDUPE_KEY,
        p_notification_id: NOTIFICATION_ID,
        p_user_id: USER_ID,
      }
    );
  });

  it("rejects failed exact recovery so the caller can force the next probe", async () => {
    const { service } = serviceFixture({
      db: createDbFixture({ rpcData: false }),
    });

    await expect(
      service.resolveCapturedOpenAIQuotaIncident({
        notificationId: NOTIFICATION_ID,
        recipientUserId: USER_ID,
        dedupeKey: DEDUPE_KEY,
      })
    ).rejects.toThrow("quota incident was not resolved");
  });
});
