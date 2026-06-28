/**
 * P4-C / P4-E — phase_c mailbox draft + auto_archive CUSTOMER hard-refuse.
 *
 * P4-C: after a successful doAutoDraft, the router places or updates a real
 * provider draft in the connected Gmail/M365 mailbox, then stamps
 * ai_draft_history(status='auto_drafted', mailbox_draft_id=...). These drafts
 * are review-only in the user's mailbox, not Inbox-local lifecycle rows.
 *
 * P4-E: doAutoArchive refuses CUSTOMER (defense beyond allowedLevelsFor), and
 * allowedLevelsFor('CUSTOMER') excludes auto_archive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the AIDraft + mailbox + autonomy + autosend deps so doAutoDraft only
// exercises Phase C routing and provider draft placement.
const {
  generateDraftMock,
  createDraftMock,
  updateDraftMock,
  getConnectionMock,
} = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  createDraftMock: vi.fn(),
  updateDraftMock: vi.fn(),
  getConnectionMock: vi.fn(),
}));
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));
vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: vi.fn(() => ({
      createDraft: createDraftMock,
      updateDraft: updateDraftMock,
    })),
  },
}));
vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: { getAutonomyLevel: vi.fn(async () => ({ level: 4 })) },
}));
vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: { isEnabled: vi.fn(async () => ({ enabled: false, settings: null })) },
}));
vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: vi.fn(async () => ({ ok: true })) },
}));

// ── Supabase double — records inserts/updates by table ───────────────────────
interface DbState {
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  updates: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }>;
  priorMailboxDraftRows: Array<Record<string, unknown>>; // provider-draft idempotency
  // P4-A cost-guard fixtures.
  latestInboundMessageId: string | null; // activities latest inbound email_message_id
  matchingHistoryRow: Record<string, unknown> | null; // ai_draft_history match on source_message_id
}
let db: DbState;

vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/helpers")>(
    "@/lib/supabase/helpers"
  );
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let op: "select" | "insert" | "update" = "select";
    let insertPayload: Record<string, unknown> | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.select = ret;
    chain.eq = (c: string, v: unknown) => { filters[c] = v; return chain; };
    chain.is = (c: string, v: unknown) => { filters[c] = v; return chain; };
    chain.in = (c: string, v: unknown) => { filters[c] = v; return chain; };
    chain.not = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.insert = (p: Record<string, unknown>) => {
      op = "insert";
      insertPayload = p;
      db.inserts.push({ table, payload: p });
      return chain;
    };
    chain.update = (p: Record<string, unknown>) => {
      op = "update";
      updatePayload = p;
      return chain;
    };
    chain.maybeSingle = async () => {
      if (table === "activities") {
        // P4-A guard: latest inbound message id lookup.
        return {
          data: db.latestInboundMessageId
            ? { email_message_id: db.latestInboundMessageId }
            : null,
          error: null,
        };
      }
      if (table === "ai_draft_history" && op === "select") {
        // P4-A guard: does a phase_c draft already cover this source_message_id?
        return { data: db.matchingHistoryRow, error: null };
      }
      if (table === "email_connections") {
        return { data: { user_id: "owner-1" }, error: null };
      }
      return { data: null, error: null };
    };
    chain.single = async () => {
      if (op === "insert") return { data: { id: `${table}-new` }, error: null };
      return { data: null, error: null };
    };
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
      if (op === "update") {
        db.updates.push({ table, payload: updatePayload as Record<string, unknown>, filters: { ...filters } });
        resolve({ data: null, error: null });
        return;
      }
      if (table === "ai_draft_history" && op === "select") {
        resolve({ data: db.priorMailboxDraftRows, error: null });
        return;
      }
      resolve({ data: null, error: null });
    };
    return chain;
  }
  return {
    ...actual,
    requireSupabase: () => ({ from: (t: string) => builder(t) }),
  };
});

import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import { allowedLevelsFor } from "@/lib/api/services/phase-c-category-autonomy-service";
import type { EmailThread } from "@/lib/types/email-thread";

function thread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: "thr-1",
    companyId: "co-1",
    connectionId: "conn-1",
    providerThreadId: "pt-1",
    primaryCategory: "CUSTOMER",
    subject: "Re: Quote",
    latestSenderEmail: "client@acme.com",
    latestDirection: "inbound",
    opportunityId: "opp-1",
    categoryManuallySet: false,
    participants: ["client@acme.com"],
    labels: [],
    messageCount: 1,
    lastMessageAt: new Date(),
    archivedAt: null,
    snoozedUntil: null,
    ...(overrides as object),
  } as unknown as EmailThread;
}

beforeEach(() => {
  db = {
    inserts: [],
    updates: [],
    priorMailboxDraftRows: [],
    latestInboundMessageId: null,
    matchingHistoryRow: null,
  };
  generateDraftMock.mockReset();
  createDraftMock.mockReset();
  updateDraftMock.mockReset();
  getConnectionMock.mockReset();
  getConnectionMock.mockResolvedValue({
    id: "conn-1",
    companyId: "co-1",
    provider: "gmail",
    type: "company",
    userId: "owner-1",
    email: "owner@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date(),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 60,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: true,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createDraftMock.mockResolvedValue("gmail-draft-1");
});

afterEach(() => vi.clearAllMocks());

describe("P4-C — phase_c provider mailbox draft", () => {
  it("places a Gmail draft and stamps ai_draft_history after a successful doAutoDraft", async () => {
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-1",
    });

    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");
    expect(res.outcome).toBe("auto_drafted");

    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(createDraftMock).toHaveBeenCalledWith(
      "client@acme.com",
      "Re: Quote",
      "Generated body",
      "pt-1"
    );
    expect(updateDraftMock).not.toHaveBeenCalled();
    expect(db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")).toHaveLength(0);

    const update = db.updates.find((u) => u.table === "ai_draft_history");
    expect(update?.payload).toMatchObject({
      status: "auto_drafted",
      mailbox_draft_id: "gmail-draft-1",
      thread_id: "pt-1",
      subject: "Re: Quote",
    });
  });

  it("updates an existing unresolved provider draft instead of creating a duplicate", async () => {
    db.priorMailboxDraftRows = [
      { id: "adh-old", mailbox_draft_id: "gmail-existing", status: "auto_drafted" },
    ];
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Body",
      subject: "Re: Quote",
      draftHistoryId: "adh-2",
    });

    await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    expect(updateDraftMock).toHaveBeenCalledWith(
      "gmail-existing",
      "client@acme.com",
      "Re: Quote",
      "Body",
      "pt-1"
    );
    expect(createDraftMock).not.toHaveBeenCalled();
    const update = db.updates.find((u) => u.table === "ai_draft_history");
    expect(update?.payload).toMatchObject({
      status: "auto_drafted",
      mailbox_draft_id: "gmail-existing",
    });
  });

  it("does not create a paired draft when generate escalated (no draft)", async () => {
    generateDraftMock.mockResolvedValue({ available: false, escalated: true, reason: "needs input" });
    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");
    expect(res.outcome).toBe("escalated_to_operator");
    expect(db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")).toHaveLength(0);
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(updateDraftMock).not.toHaveBeenCalled();
  });
});

describe("P4-A — pre-LLM cost guard (no re-draft per re-sync)", () => {
  it("short-circuits BEFORE generateDraft when an open phase_c draft already covers the latest inbound message", async () => {
    // The thread's latest inbound message id...
    db.latestInboundMessageId = "msg-123";
    // ...is already covered by a phase_c ai_draft_history row.
    db.matchingHistoryRow = { id: "adh-open" };

    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    // No LLM call, no mailbox draft placement.
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")).toHaveLength(0);
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(res.outcome).toBe("auto_drafted");
    expect(res.detail).toMatch(/no re-draft|existing/i);
  });

  it("DOES draft when the latest inbound message has no covering phase_c draft", async () => {
    db.latestInboundMessageId = "msg-456";
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Fresh body",
      subject: "Re: Quote",
      draftHistoryId: "adh-fresh",
    });

    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    expect(generateDraftMock).toHaveBeenCalledTimes(1);
    expect(res.outcome).toBe("auto_drafted");
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")).toHaveLength(0);
  });

  it("DOES draft when the provider gave no message id to dedup on (can't key, must draft)", async () => {
    db.latestInboundMessageId = null;
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Body",
      subject: "Re: Quote",
      draftHistoryId: "adh-x",
    });

    await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");
    expect(generateDraftMock).toHaveBeenCalledTimes(1);
  });
});

describe("P4-E — auto_archive CUSTOMER hard-refuse", () => {
  it("allowedLevelsFor('CUSTOMER') excludes auto_archive", () => {
    expect(allowedLevelsFor("CUSTOMER")).not.toContain("auto_archive");
  });

  it("doAutoArchive refuses a CUSTOMER thread and returns error", async () => {
    const res = await PhaseCAutonomyRouter.doAutoArchive(thread({ primaryCategory: "CUSTOMER" }), "auto_archive");
    expect(res.outcome).toBe("error");
    expect(res.detail).toMatch(/CUSTOMER/);
  });

  it("doAutoArchive proceeds for a non-CUSTOMER thread", async () => {
    const res = await PhaseCAutonomyRouter.doAutoArchive(thread({ primaryCategory: "MARKETING" }), "auto_archive");
    expect(res.outcome).toBe("auto_archived");
  });
});
