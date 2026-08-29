import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  actorResolverMock,
  accessResolverMock,
  categoryAutonomyMock,
  categoryGraduationMock,
  notificationInserts,
  notificationDedupeReads,
  threadUpdates,
  companyAdminIds,
  companyAdminUsers,
  existingOpenNotifications,
} = vi.hoisted(() => ({
  actorResolverMock: vi.fn(),
  accessResolverMock: vi.fn(),
  categoryAutonomyMock: vi.fn(),
  categoryGraduationMock: vi.fn(),
  notificationInserts: [] as Array<Record<string, unknown>>,
  notificationDedupeReads: [] as Array<Record<string, unknown>>,
  threadUpdates: [] as Array<Record<string, unknown>>,
  companyAdminIds: { value: null as string[] | null },
  companyAdminUsers: {
    value: [] as Array<{
      id: string;
      deleted_at: string | null;
      is_active: boolean | null;
    }>,
  },
  existingOpenNotifications: { value: [] as Array<{ id: string }> },
}));

vi.mock("@/lib/email/phase-c-email-actor", () => ({
  resolvePhaseCEmailActor: actorResolverMock,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: accessResolverMock,
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: categoryAutonomyMock,
    isGraduated: categoryGraduationMock,
    profileTypesFor: vi.fn(() => ["general"]),
  },
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: vi.fn() },
}));

vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: { getAutonomyLevel: vi.fn(async () => ({ level: 0 })) },
}));

vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: {
    isEnabled: vi.fn(async () => ({ enabled: false, settings: null })),
    scheduleAutoSend: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getConnection: vi.fn(), getProvider: vi.fn() },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: vi.fn() },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  renderMailboxDraftWithSignature: vi.fn(),
  resolveEmailSignatureForMessage: vi.fn(),
}));

vi.mock("@/lib/email/email-sync-continuation-state", () => ({
  emailSyncContinuationPendingForConnection: vi.fn(async () => false),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = { table };
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          threadUpdates.push({ table, payload });
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          if (table === "notifications") notificationInserts.push(payload);
          return builder;
        },
        async maybeSingle() {
          if (table === "companies") {
            return { data: { admin_ids: companyAdminIds.value }, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          return { data: { id: "notification-1" }, error: null };
        },
        then(resolve: (result: { data: unknown; error: null }) => unknown) {
          if (table === "users") {
            return resolve({ data: companyAdminUsers.value, error: null });
          }
          if (table === "notifications") {
            notificationDedupeReads.push({ ...filters });
            return resolve({ data: existingOpenNotifications.value, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import type { EmailThread } from "@/lib/types/email-thread";

const COMPANY_ID = "00000000-0000-4000-8000-0000000000a1";
const CONNECTION_ID = "00000000-0000-4000-8000-0000000000a3";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-0000000000a4";
const THREAD_ID = "00000000-0000-4000-8000-0000000000a5";
const OPERATOR_ID = "00000000-0000-4000-8000-0000000000a6";

function thread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: THREAD_ID,
    companyId: COMPANY_ID,
    connectionId: CONNECTION_ID,
    providerThreadId: "provider-thread-1",
    opportunityId: OPPORTUNITY_ID,
    primaryCategory: "CUSTOMER",
    latestDirection: "inbound",
    latestSenderEmail: "client@example.com",
    archivedAt: null,
    snoozedUntil: null,
    subject: "Quote request",
    labels: [],
    participants: ["client@example.com"],
    lastMessageAt: new Date(),
    ...overrides,
  } as unknown as EmailThread;
}

describe("phase c actor-unavailable is surfaced and re-deferred", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationInserts.length = 0;
    notificationDedupeReads.length = 0;
    threadUpdates.length = 0;
    companyAdminIds.value = [OPERATOR_ID];
    companyAdminUsers.value = [];
    existingOpenNotifications.value = [];
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "auto_draft" });
    categoryGraduationMock.mockResolvedValue({
      ready: true,
      approvalRate: 1,
      sampleSize: 20,
    });
    actorResolverMock.mockResolvedValue({
      kind: "no_work",
      reason: "opportunity_unassigned",
    });
  });

  it("raises one actionable alert and re-arms the thread", async () => {
    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result).toEqual({
      outcome: "noop_actor_unavailable",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "opportunity_unassigned",
    });

    expect(notificationInserts).toHaveLength(1);
    const notification = notificationInserts[0];
    expect(notification.user_id).toBe(OPERATOR_ID);
    expect(notification.company_id).toBe(COMPANY_ID);
    expect(notification.type).toBe("system");
    expect(notification.persistent).toBe(true);
    expect(notification.dedupe_key).toBe(
      `phase-c-actor-unavailable:${THREAD_ID}`
    );
    expect(notification.action_url).toBe(`/inbox/${THREAD_ID}`);
    expect(notification.action_label).toBe("Assign this lead");
    expect(String(notification.body)).toMatch(/assigned/i);

    // The thread is re-armed so the router re-runs once an assignee exists,
    // instead of waiting for new mail to arrive.
    expect(threadUpdates).toEqual([
      { table: "email_threads", payload: { category_classified_at: null } },
    ]);
  });

  it("raises exactly one open alert for a recurring condition", async () => {
    existingOpenNotifications.value = [{ id: "notification-1" }];

    await PhaseCAutonomyRouter.route(thread());

    expect(notificationDedupeReads).toHaveLength(1);
    expect(notificationDedupeReads[0]).toMatchObject({
      dedupe_key: `phase-c-actor-unavailable:${THREAD_ID}`,
      resolved_at: null,
    });
    expect(notificationInserts).toHaveLength(0);
    // The deferral still happens — the work is still owed.
    expect(threadUpdates).toHaveLength(1);
  });

  it("stays a silent noop below auto_draft", async () => {
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "draft_on_request" });

    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result.outcome).toBe("noop_draft_on_request");
    expect(notificationInserts).toHaveLength(0);
    expect(threadUpdates).toHaveLength(0);
  });

  it("stays a silent noop for a non-customer thread", async () => {
    categoryAutonomyMock.mockResolvedValue({ VENDOR: "auto_draft" });

    const result = await PhaseCAutonomyRouter.route(
      thread({ primaryCategory: "VENDOR" })
    );

    expect(result.outcome).toBe("noop_actor_unavailable");
    expect(notificationInserts).toHaveLength(0);
    expect(threadUpdates).toHaveLength(0);
  });

  it("never lets a notification failure change the routing outcome", async () => {
    companyAdminIds.value = null;
    companyAdminUsers.value = [];

    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result.outcome).toBe("noop_actor_unavailable");
    expect(notificationInserts).toHaveLength(0);
    // No operator to tell, but the thread is still re-armed.
    expect(threadUpdates).toHaveLength(1);
  });

  it("skips the trace when placement-only work is running", async () => {
    const result = await PhaseCAutonomyRouter.route(thread(), {
      placementOnly: true,
    });

    expect(result.outcome).toBe("noop_actor_unavailable");
    expect(notificationInserts).toHaveLength(0);
    expect(threadUpdates).toHaveLength(0);
  });
});

// ─── Placement-recovery age-out (bf45611d residual) ────────────────────────

import {
  recoverStrandedPhaseCMailboxDraftsForConnection,
  PHASE_C_PLACEMENT_RECOVERY_WINDOW_DAYS,
} from "@/lib/api/services/phase-c-draft-placement-recovery";

interface RecoveryQueryLog {
  table: string;
  filters: Record<string, unknown>;
  updates: Record<string, unknown> | null;
}

function recoverySupabase(options: {
  windowedThreadIds: string[];
  agedOutRows: Array<{ id: string; created_at: string }>;
  threadRows: Array<Record<string, unknown>>;
  agedOutUpdateError?: { message: string };
}) {
  const log: RecoveryQueryLog[] = [];
  return {
    log,
    client: {
      from(table: string) {
        const entry: RecoveryQueryLog = { table, filters: {}, updates: null };
        log.push(entry);
        const builder: Record<string, unknown> = {
          select(columns: string) {
            entry.filters.select = columns;
            return builder;
          },
          update(payload: Record<string, unknown>) {
            entry.updates = payload;
            return builder;
          },
          eq(column: string, value: unknown) {
            entry.filters[column] = value;
            return builder;
          },
          is(column: string, value: unknown) {
            entry.filters[`is:${column}`] = value;
            return builder;
          },
          not(column: string, operator: string, value: unknown) {
            entry.filters[`not:${column}`] = `${operator}:${String(value)}`;
            return builder;
          },
          in(column: string, values: unknown[]) {
            entry.filters[`in:${column}`] = values;
            return builder;
          },
          gte(column: string, value: unknown) {
            entry.filters[`gte:${column}`] = value;
            return builder;
          },
          lt(column: string, value: unknown) {
            entry.filters[`lt:${column}`] = value;
            return builder;
          },
          order() {
            return builder;
          },
          limit(count: number) {
            entry.filters.limit = count;
            return builder;
          },
          then(resolve: (result: { data: unknown; error: unknown }) => unknown) {
            if (entry.table === "email_threads") {
              return resolve({ data: options.threadRows, error: null });
            }
            if (entry.updates) {
              return resolve({
                data: null,
                error: options.agedOutUpdateError ?? null,
              });
            }
            if (entry.filters["lt:created_at"]) {
              return resolve({ data: options.agedOutRows, error: null });
            }
            return resolve({
              data: options.windowedThreadIds.map((id) => ({ thread_id: id })),
              error: null,
            });
          },
        };
        return builder;
      },
    },
  };
}

const RECOVERY_COMPANY_ID = "00000000-0000-4000-8000-0000000000b1";
const RECOVERY_CONNECTION_ID = "00000000-0000-4000-8000-0000000000b3";

describe("stranded phase c drafts older than the recovery window age out", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("terminalizes rows the sweep can never reach again", async () => {
    const harness = recoverySupabase({
      windowedThreadIds: [],
      agedOutRows: [
        { id: "draft-old-1", created_at: "2026-08-05T18:00:00.000Z" },
        { id: "draft-old-2", created_at: "2026-08-06T09:00:00.000Z" },
      ],
      threadRows: [],
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      companyId: RECOVERY_COMPANY_ID,
      connectionId: RECOVERY_CONNECTION_ID,
      supabase: harness.client as never,
    });

    expect(summary.agedOut).toBe(2);
    expect(summary.placed).toBe(0);

    const ageOutRead = harness.log.find(
      (entry) => entry.table === "ai_draft_history" && entry.filters["lt:created_at"]
    );
    expect(ageOutRead).toBeTruthy();
    expect(ageOutRead!.filters).toMatchObject({
      company_id: RECOVERY_COMPANY_ID,
      connection_id: RECOVERY_CONNECTION_ID,
      origin: "phase_c",
      status: "drafted",
      "is:mailbox_draft_id": null,
      limit: 50,
    });
    // The contact-form worker owns the thread-less phase_c rows and retries
    // them from its own durable queue. Two owners on one row is a bug.
    expect(ageOutRead!.filters["not:thread_id"]).toBe("is:null");

    const supersedes = harness.log.filter((entry) => entry.updates);
    expect(supersedes).toHaveLength(2);
    for (const entry of supersedes) {
      expect(entry.updates).toMatchObject({ status: "superseded" });
      expect(String(entry.updates!.discarded_at)).toMatch(
        /^\d{4}-\d{2}-\d{2}T/
      );
    }
    expect(supersedes.map((entry) => entry.filters.id)).toEqual([
      "draft-old-1",
      "draft-old-2",
    ]);
  });

  it("leaves rows inside the window to placement retry", async () => {
    const retry = vi
      .spyOn(PhaseCAutonomyRouter, "retryStrandedMailboxDraft")
      .mockResolvedValue({
        outcome: "auto_drafted",
        category: "CUSTOMER",
        effectiveLevel: "auto_draft",
      });
    const harness = recoverySupabase({
      windowedThreadIds: ["provider-thread-fresh"],
      agedOutRows: [],
      threadRows: [
        {
          id: THREAD_ID,
          company_id: RECOVERY_COMPANY_ID,
          connection_id: RECOVERY_CONNECTION_ID,
          provider_thread_id: "provider-thread-fresh",
          primary_category: "CUSTOMER",
          archived_at: null,
          snoozed_until: null,
        },
      ],
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      companyId: RECOVERY_COMPANY_ID,
      connectionId: RECOVERY_CONNECTION_ID,
      supabase: harness.client as never,
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(summary.placed).toBe(1);
    expect(summary.agedOut).toBe(0);
    expect(harness.log.some((entry) => entry.updates)).toBe(false);
  });

  it("cuts the age-out at the same window placement retry uses", async () => {
    const harness = recoverySupabase({
      windowedThreadIds: [],
      agedOutRows: [],
      threadRows: [],
    });

    await recoverStrandedPhaseCMailboxDraftsForConnection({
      companyId: RECOVERY_COMPANY_ID,
      connectionId: RECOVERY_CONNECTION_ID,
      supabase: harness.client as never,
    });

    const windowed = harness.log.find(
      (entry) => entry.filters["gte:created_at"]
    );
    const agedOut = harness.log.find((entry) => entry.filters["lt:created_at"]);
    expect(windowed!.filters["gte:created_at"]).toBe(
      agedOut!.filters["lt:created_at"]
    );

    const cutoffAgeDays =
      (Date.now() - Date.parse(String(agedOut!.filters["lt:created_at"]))) /
      86_400_000;
    expect(cutoffAgeDays).toBeCloseTo(PHASE_C_PLACEMENT_RECOVERY_WINDOW_DAYS, 2);
  });

  it("never throws when an age-out write fails", async () => {
    const harness = recoverySupabase({
      windowedThreadIds: [],
      agedOutRows: [{ id: "draft-old-1", created_at: "2026-08-05T18:00:00.000Z" }],
      threadRows: [],
      agedOutUpdateError: { message: "permission denied" },
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      companyId: RECOVERY_COMPANY_ID,
      connectionId: RECOVERY_CONNECTION_ID,
      supabase: harness.client as never,
    });

    expect(summary.agedOut).toBe(0);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
  });
});
