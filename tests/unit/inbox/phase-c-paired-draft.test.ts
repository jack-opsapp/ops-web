/**
 * P4-C / P4-E — phase_c paired draft + auto_archive CUSTOMER hard-refuse.
 *
 * P4-C: after a successful doAutoDraft, the router creates a paired
 * opportunity_follow_up_drafts(origin='phase_c', ai_draft_history_id=...) row,
 * supersedes a prior OPEN phase_c draft on the same thread, and NEVER touches
 * operator/template drafts.
 *
 * P4-E: doAutoArchive refuses CUSTOMER (defense beyond allowedLevelsFor), and
 * allowedLevelsFor('CUSTOMER') excludes auto_archive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the AIDraft + autonomy + autosend deps so doAutoDraft only exercises
// the paired-draft creation path.
const { generateDraftMock } = vi.hoisted(() => ({ generateDraftMock: vi.fn() }));
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
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
  existingPairedDraft: Record<string, unknown> | null; // for idempotency check
  // P4-A cost-guard fixtures.
  latestInboundMessageId: string | null; // activities latest inbound email_message_id
  openPhaseCBridgeIds: Array<{ ai_draft_history_id: string | null }>; // open phase_c drafts
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
        // P4-A guard: does an open phase_c bridge match this source_message_id?
        return { data: db.matchingHistoryRow, error: null };
      }
      if (table === "opportunity_follow_up_drafts" && op === "select") {
        return { data: db.existingPairedDraft, error: null };
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
      // P4-A guard: awaited (non-single) select of open phase_c bridge ids.
      if (table === "opportunity_follow_up_drafts" && op === "select") {
        resolve({ data: db.openPhaseCBridgeIds, error: null });
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
    existingPairedDraft: null,
    latestInboundMessageId: null,
    openPhaseCBridgeIds: [],
    matchingHistoryRow: null,
  };
  generateDraftMock.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("P4-C — phase_c paired draft", () => {
  it("creates a paired phase_c draft bridged to ai_draft_history after a successful doAutoDraft", async () => {
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-1",
    });

    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");
    expect(res.outcome).toBe("auto_drafted");

    const insert = db.inserts.find((i) => i.table === "opportunity_follow_up_drafts");
    expect(insert).toBeTruthy();
    expect(insert?.payload).toMatchObject({
      origin: "phase_c",
      status: "drafted",
      ai_draft_history_id: "adh-1",
      opportunity_id: "opp-1",
      original_body: "Generated body",
      subject: "Re: Quote",
    });

    // The supersede update only ever targets origin='phase_c' + status='drafted'.
    const supersede = db.updates.find(
      (u) => u.table === "opportunity_follow_up_drafts" && u.payload.status === "superseded"
    );
    expect(supersede?.filters).toMatchObject({ origin: "phase_c", status: "drafted" });
    expect(supersede?.filters.origin).not.toBe("template_follow_up");
    expect(supersede?.filters.origin).not.toBe("operator");
  });

  it("does not double-insert when the bridge already produced a paired draft (idempotent)", async () => {
    db.existingPairedDraft = { id: "fu-existing" };
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Body",
      subject: "Re: Quote",
      draftHistoryId: "adh-2",
    });

    await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    const inserts = db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts");
    expect(inserts).toHaveLength(0);
  });

  it("does not create a paired draft when generate escalated (no draft)", async () => {
    generateDraftMock.mockResolvedValue({ available: false, escalated: true, reason: "needs input" });
    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");
    expect(res.outcome).toBe("escalated_to_operator");
    expect(db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")).toHaveLength(0);
  });
});

describe("P4-A — pre-LLM cost guard (no re-draft per re-sync)", () => {
  it("short-circuits BEFORE generateDraft when an open phase_c draft already covers the latest inbound message", async () => {
    // The thread's latest inbound message id...
    db.latestInboundMessageId = "msg-123";
    // ...is already bridged to an open phase_c draft (adh-open)...
    db.openPhaseCBridgeIds = [{ ai_draft_history_id: "adh-open" }];
    // ...whose ai_draft_history.source_message_id matches msg-123.
    db.matchingHistoryRow = { id: "adh-open" };

    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    // No LLM call, no new draft insert.
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")).toHaveLength(0);
    expect(res.outcome).toBe("auto_drafted");
    expect(res.detail).toMatch(/no re-draft|existing/i);
  });

  it("DOES draft when the latest inbound message has no covering phase_c draft", async () => {
    db.latestInboundMessageId = "msg-456";
    db.openPhaseCBridgeIds = []; // no open phase_c draft for this opportunity+thread
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Fresh body",
      subject: "Re: Quote",
      draftHistoryId: "adh-fresh",
    });

    const res = await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    expect(generateDraftMock).toHaveBeenCalledTimes(1);
    expect(res.outcome).toBe("auto_drafted");
    expect(db.inserts.find((i) => i.table === "opportunity_follow_up_drafts")).toBeTruthy();
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
