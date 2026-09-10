import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  rail: vi.fn(),
  enabled: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/lib/notifications/notification-event-resolver", () => ({
  resolveNotificationEvent: seams.resolve,
}));
vi.mock("@/lib/notifications/server-notification-service", () => ({
  createTrustedNotifications: seams.rail,
  resolveNotificationPreferences: async () => ({
    inAppRecipientIds: ["recipient-1"],
    pushRecipientIds: ["recipient-1"],
    emailRecipientIds: [],
  }),
}));
vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: { isAIFeatureEnabled: seams.enabled },
}));

import { ProjectStatusLifecycleOutboxService } from "@/lib/api/services/project-status-lifecycle-outbox-service";
import { dispatchNotificationEvent } from "@/lib/notifications/dispatch-notification-event";

const eventId = "14f4d6e0-68b9-4b34-a48c-6c6d0b4aae28";
const rejection = {
  id: "",
  errors: ["All included players are not subscribed"],
};

function database() {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "terminalize_expired_project_status_lifecycle_events") {
      return { data: 0, error: null };
    }
    if (name === "claim_project_status_lifecycle_events") {
      return {
        data: [
          {
            event_id: eventId,
            lease_token: "lease-1",
            company_id: "company-1",
            project_id: "project-1",
            actor_user_id: "actor-1",
            old_status: "accepted",
            new_status: "in_progress",
            project_status_version: 1,
            project_updated_at: "2026-09-07T06:11:28Z",
            requested_at: "2026-09-07T06:11:28Z",
            attempt: 1,
          },
        ],
        error: null,
      };
    }
    if (name === "fail_project_status_lifecycle_event") {
      return {
        data: args?.p_retryable === false ? "failed" : "pending",
        error: null,
      };
    }
    if (name === "complete_project_status_lifecycle_event") {
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const from = (table: string) => {
    const rows: Record<string, unknown> = {
      users: { first_name: "Test", last_name: "Operator" },
      project_notes: { id: "existing-timeline" },
      projects: { status: "in_progress", status_version: 1 },
    };
    if (!(table in rows)) throw new Error(`Unexpected table: ${table}`);
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      contains: () => builder,
      maybeSingle: async () => ({ data: rows[table], error: null }),
    };
    return builder;
  };
  return { rpc, from };
}

async function run() {
  const db = database();
  const result = await ProjectStatusLifecycleOutboxService.processBatch(
    db as never,
    { limit: 1 }
  );
  return { db, result };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ONESIGNAL_REST_API_KEY", "test-only-no-network");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(rejection), { status: 200 }))
  );
  seams.enabled.mockResolvedValue(false);
  seams.rail.mockResolvedValue({
    errors: 0,
    createdRecipientIds: ["recipient-1"],
  });
  seams.resolve.mockResolvedValue({
    ok: true,
    event: {
      companyId: "company-1",
      recipientUserIds: ["recipient-1"],
      preferenceKey: "project_updates",
      type: "project_status_change",
      title: "Status changed",
      body: "Project started",
      projectId: "project-1",
      dedupeKey: `project-status-lifecycle:${eventId}`,
      pushData: {},
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("project-status push retry boundary (2b23d92f)", () => {
  it("preserves mention delivery retry behavior for the same provider response", async () => {
    const result = await dispatchNotificationEvent({
      db: database() as never,
      actor: {
        companyId: "company-1",
        userId: "actor-1",
        name: "Test Operator",
      },
      request: { eventType: "mention_edit", mentionEventId: eventId },
    });
    expect(result).toEqual({
      ok: false,
      status: 500,
      reason: "Notification push failed",
    });
  });

  it.each([false, true])(
    "retains a terminal push failure after rail persistence (existing=%s)",
    async (existing) => {
      if (existing)
        seams.rail.mockResolvedValue({ errors: 0, createdRecipientIds: [] });
      const { db, result } = await run();
      expect(db.rpc).toHaveBeenCalledWith(
        "fail_project_status_lifecycle_event",
        {
          p_event_id: eventId,
          p_lease_token: "lease-1",
          p_retryable: false,
          p_error: expect.stringContaining("no subscribed recipients"),
        }
      );
      expect(db.rpc).not.toHaveBeenCalledWith(
        "complete_project_status_lifecycle_event",
        expect.anything()
      );
      expect(result).toMatchObject({ completed: 0, requeued: 0, failed: 1 });
      expect(result.errors).toHaveLength(1);
      expect(seams.enabled).toHaveBeenCalled();
    }
  );

  it.each([
    { status: 503, body: rejection },
    { status: 429, body: rejection },
    { status: 200, body: { errors: rejection.errors } },
    { status: 200, body: { id: "", errors: [] } },
    {
      status: 200,
      body: { id: "", errors: [...rejection.errors, "unknown failure"] },
    },
    {
      status: 200,
      body: {
        id: "",
        errors: { invalid_aliases: { external_id: ["recipient-1"] } },
      },
    },
  ])(
    "keeps ambiguous and transient provider failures retryable: %j",
    async ({ status, body }) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(body), { status })
      );
      const { db, result } = await run();
      expect(db.rpc).toHaveBeenCalledWith(
        "fail_project_status_lifecycle_event",
        expect.objectContaining({ p_retryable: true })
      );
      expect(result.requeued).toBe(1);
    }
  );

  it("keeps network failures retryable", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network unavailable"));
    const { db, result } = await run();
    expect(db.rpc).toHaveBeenCalledWith(
      "fail_project_status_lifecycle_event",
      expect.objectContaining({ p_retryable: true })
    );
    expect(result.requeued).toBe(1);
  });

  it("does not mask a later lifecycle failure with the terminal push result", async () => {
    seams.enabled.mockRejectedValueOnce(
      new Error("feature lookup unavailable")
    );
    const { db, result } = await run();
    expect(db.rpc).toHaveBeenCalledWith(
      "fail_project_status_lifecycle_event",
      expect.objectContaining({
        p_retryable: true,
        p_error: "feature lookup unavailable",
      })
    );
    expect(result.requeued).toBe(1);
  });

  it("retries failed rail persistence without sending a push", async () => {
    seams.rail.mockResolvedValueOnce({ errors: 1, createdRecipientIds: [] });
    const { db, result } = await run();
    expect(fetch).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith(
      "fail_project_status_lifecycle_event",
      expect.objectContaining({
        p_retryable: true,
        p_error: "Notification persistence failed",
      })
    );
    expect(result.requeued).toBe(1);
  });

  it("completes successful provider delivery with the stable event identity", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "provider-id", recipients: 1 }), {
        status: 200,
      })
    );
    const { db, result } = await run();
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(payload.idempotency_key).toBe(eventId);
    expect(db.rpc).toHaveBeenCalledWith(
      "complete_project_status_lifecycle_event",
      {
        p_event_id: eventId,
        p_lease_token: "lease-1",
      }
    );
    expect(result).toMatchObject({ completed: 1, failed: 0, requeued: 0 });
  });

  it("keeps a failed durable completion retryable after successful push", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "provider-id", recipients: 1 }), {
        status: 200,
      })
    );
    const db = database();
    const implementation = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, args) =>
      name === "complete_project_status_lifecycle_event"
        ? { data: false, error: null }
        : implementation(name, args)
    );
    const result = await ProjectStatusLifecycleOutboxService.processBatch(
      db as never,
      { limit: 1 }
    );
    expect(db.rpc).toHaveBeenCalledWith(
      "fail_project_status_lifecycle_event",
      expect.objectContaining({
        p_retryable: true,
        p_error: "Project lifecycle lease was lost",
      })
    );
    expect(result).toMatchObject({ completed: 0, requeued: 1 });
  });
});
