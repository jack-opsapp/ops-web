/**
 * P4-B / P4-D — ai_draft_history provenance + lifecycle-draft learning.
 *
 * Covers:
 *   - detectChanges surfaces a `subject` change type (P4-B).
 *   - recordDraftOutcome stamps discarded_at on discard, edited_at on edited
 *     send, status='superseded'+discarded_at on supersede, and records (but
 *     never promotes) an operator subject edit (P4-B + product decision).
 *   - recordDraftOutcome routes the edit delta through learnFromEdits (P4-D
 *     pipeline reuse).
 *   - recordLifecycleDraftOutcome bridges a never-AI template draft and learns
 *     only on SENT (P4-D machinery; invoked from the operator-send transition
 *     in the email send route, gated behind LIFECYCLE_LEARNING_ENABLED).
 *   - LIFECYCLE_LEARNING_ENABLED is true (enabled at go-live — the P3
 *     operator-send transition landed and calls the learning hook).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The GPT analysis client — return a deterministic systematic substitution so
// the >10% edit-distance branch is exercised without a real network call.
vi.mock("@/lib/api/services/openai-clients", () => ({
  getDraftingOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  toneShift: null,
                  substitutions: [],
                  structureChanges: [],
                  contentCorrections: [],
                }),
              },
            },
          ],
        })),
      },
    },
  }),
}));

// Milestone check is fire-and-forget; stub it out.
vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: {
    checkMilestonesAfterDraftFeedback: vi.fn(async () => {}),
    getAutonomyLevel: vi.fn(async () => ({ level: 0 })),
  },
}));

// ── Supabase double ──────────────────────────────────────────────────────────
interface DbState {
  // seed rows keyed by table
  aiDraftHistory: Map<string, Record<string, unknown>>;
  followUpDrafts: Map<string, Record<string, unknown>>;
  writingProfiles: Map<string, Record<string, unknown>>;
  // recorded mutations
  updates: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }>;
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  learnSentDrafts: Array<{ changes_made: unknown }>; // rows returned to learnFromEdits
  learnFromEditsReads: number; // count of learnFromEdits' recent-sent-drafts query
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
    chain.in = ret;
    chain.not = ret;
    chain.order = ret;
    chain.limit = ret;
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
    chain.maybeSingle = async () => resolveSingle();
    chain.single = async () => resolveSingle();
    function resolveSingle() {
      if (op === "insert") {
        const id = (insertPayload?.id as string) || `${table}-new`;
        return { data: { id }, error: null };
      }
      if (op === "update") {
        db.updates.push({ table, payload: updatePayload as Record<string, unknown>, filters: { ...filters } });
        return { data: null, error: null };
      }
      // select
      if (table === "ai_draft_history") {
        const id = filters.id as string;
        return { data: db.aiDraftHistory.get(id) ?? null, error: null };
      }
      if (table === "opportunity_follow_up_drafts") {
        const id = filters.id as string;
        return { data: db.followUpDrafts.get(id) ?? null, error: null };
      }
      if (table === "agent_writing_profiles") {
        return { data: db.writingProfiles.get("profile") ?? null, error: null };
      }
      return { data: null, error: null };
    }
    // Awaiting the chain directly (no .single()): covers update-then-await
    // (recordDraftOutcome discard path) and select-then-await (learnFromEdits
    // reading recent sent drafts).
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
      if (op === "update") {
        db.updates.push({ table, payload: updatePayload as Record<string, unknown>, filters: { ...filters } });
        resolve({ data: null, error: null });
        return;
      }
      if (table === "ai_draft_history") {
        // This awaited (non-single) select is learnFromEdits reading the last
        // 20 sent drafts. Count it so tests can assert it was/wasn't issued.
        db.learnFromEditsReads += 1;
        resolve({ data: db.learnSentDrafts, error: null });
        return;
      }
      resolve({ data: [], error: null });
    };
    return chain;
  }
  return {
    ...actual,
    requireSupabase: () => ({ from: (t: string) => builder(t) }),
  };
});

import {
  AIDraftService,
  detectChanges,
  LIFECYCLE_LEARNING_ENABLED,
} from "@/lib/api/services/ai-draft-service";

function freshDb(): DbState {
  return {
    aiDraftHistory: new Map(),
    followUpDrafts: new Map(),
    writingProfiles: new Map(),
    updates: [],
    inserts: [],
    learnSentDrafts: [],
    learnFromEditsReads: 0,
  };
}

beforeEach(() => {
  db = freshDb();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("P4-B — detectChanges subject delta", () => {
  it("surfaces a `subject` change when subjects differ", () => {
    const changes = detectChanges("Body", "Body", {
      original: "Re: Quote",
      edited: "Re: Updated quote",
    });
    expect(changes).toContainEqual({ type: "subject", from: "Re: Quote", to: "Re: Updated quote" });
  });

  it("emits no subject change when subjects match", () => {
    const changes = detectChanges("Body", "Body", { original: "X", edited: "X" });
    expect(changes.some((c) => c.type === "subject")).toBe(false);
  });

  it("emits no subject change when no subjects passed (body-only callers unaffected)", () => {
    const changes = detectChanges("Hi", "Hi");
    expect(changes.some((c) => c.type === "subject")).toBe(false);
  });
});

describe("P4-B — recordDraftOutcome provenance stamping", () => {
  it("stamps discarded_at + status=discarded on discard", async () => {
    db.aiDraftHistory.set("d1", { original_draft: "x", profile_type: "general", subject: null });
    await AIDraftService.recordDraftOutcome("d1", "co-1", "u-1", "discarded");
    const upd = db.updates.find((u) => u.table === "ai_draft_history");
    expect(upd?.payload).toMatchObject({ status: "discarded" });
    expect(upd?.payload.discarded_at).toBeTruthy();
  });

  it("stamps status=superseded + discarded_at on supersede", async () => {
    db.aiDraftHistory.set("d2", { original_draft: "x", profile_type: "general", subject: null });
    await AIDraftService.recordDraftOutcome("d2", "co-1", "u-1", "superseded");
    const upd = db.updates.find((u) => u.table === "ai_draft_history");
    expect(upd?.payload).toMatchObject({ status: "superseded" });
    expect(upd?.payload.discarded_at).toBeTruthy();
  });

  it("stamps edited_at on an edited send", async () => {
    db.aiDraftHistory.set("d3", { original_draft: "Hello there", profile_type: "general", subject: "Re: A" });
    await AIDraftService.recordDraftOutcome("d3", "co-1", "u-1", "sent", "Hello, friend.");
    const sentUpd = db.updates.find((u) => u.table === "ai_draft_history");
    expect(sentUpd?.payload).toMatchObject({ status: "sent", sent_without_changes: false });
    expect(sentUpd?.payload.edited_at).toBeTruthy();
  });

  it("records an operator subject edit (subject_source=operator) without promoting profile", async () => {
    db.aiDraftHistory.set("d4", {
      original_draft: "Same body",
      profile_type: "client_followup",
      subject: "Re: Quote",
    });
    // No writing profile present → even if learning ran, nothing promotes.
    await AIDraftService.recordDraftOutcome(
      "d4",
      "co-1",
      "u-1",
      "sent",
      "Same body", // body unchanged
      "client_followup",
      "Re: New subject" // subject changed
    );
    const sentUpd = db.updates.find((u) => u.table === "ai_draft_history");
    expect(sentUpd?.payload.subject).toBe("Re: New subject");
    expect(sentUpd?.payload.subject_source).toBe("operator");
    expect(sentUpd?.payload.sent_without_changes).toBe(false);
    // No writing-profile update was attempted/promoted.
    expect(db.updates.some((u) => u.table === "agent_writing_profiles")).toBe(false);
  });

  it("skips the learnFromEdits read for a subject-ONLY edit (subject never promotes the profile)", async () => {
    db.aiDraftHistory.set("d6", {
      original_draft: "Same body",
      profile_type: "client_followup",
      subject: "Re: Quote",
    });
    await AIDraftService.recordDraftOutcome(
      "d6",
      "co-1",
      "u-1",
      "sent",
      "Same body", // body unchanged
      "client_followup",
      "Re: Different subject" // subject changed → recorded, but no learning
    );
    // The subject delta is still recorded on the row...
    const sentUpd = db.updates.find((u) => u.table === "ai_draft_history");
    expect(sentUpd?.payload.subject_source).toBe("operator");
    // ...but learnFromEdits' recent-sent-drafts query was NOT issued.
    expect(db.learnFromEditsReads).toBe(0);
  });

  it("DOES run learnFromEdits when the body changed (alongside any subject edit)", async () => {
    db.aiDraftHistory.set("d7", {
      original_draft: "Original body text here",
      profile_type: "general",
      subject: "Re: Quote",
    });
    await AIDraftService.recordDraftOutcome(
      "d7",
      "co-1",
      "u-1",
      "sent",
      "Completely different body content now", // body changed
      "general",
      "Re: Also changed"
    );
    expect(db.learnFromEditsReads).toBeGreaterThan(0);
  });

  it("does not flip sent_without_changes false when nothing changed", async () => {
    db.aiDraftHistory.set("d5", { original_draft: "Body", profile_type: "general", subject: "S" });
    await AIDraftService.recordDraftOutcome("d5", "co-1", "u-1", "sent", "Body");
    const sentUpd = db.updates.find((u) => u.table === "ai_draft_history");
    expect(sentUpd?.payload.sent_without_changes).toBe(true);
    expect(sentUpd?.payload.edited_at).toBeUndefined();
  });
});

describe("P4-D — recordLifecycleDraftOutcome (operator-send learning)", () => {
  it("LIFECYCLE_LEARNING_ENABLED is live (true) — the P3 send-transition landed and calls the hook", () => {
    expect(LIFECYCLE_LEARNING_ENABLED).toBe(true);
  });

  it("bridges a never-AI template draft (creates ai_draft_history) and flips it to sent", async () => {
    db.followUpDrafts.set("fu-1", {
      id: "fu-1",
      company_id: "co-1",
      opportunity_id: "opp-1",
      connection_id: "conn-1",
      provider_thread_id: "pt-1",
      origin: "template_follow_up",
      subject: "Re: Hi",
      original_body: "Original template body",
      ai_draft_history_id: null,
    });

    await AIDraftService.recordLifecycleDraftOutcome(
      "fu-1",
      "co-1",
      "u-1",
      "Edited final body the operator actually sent",
      "Re: Hi"
    );

    // A bridge ai_draft_history row was inserted with origin=template_follow_up.
    const bridge = db.inserts.find((i) => i.table === "ai_draft_history");
    expect(bridge).toBeTruthy();
    expect(bridge?.payload).toMatchObject({
      origin: "template_follow_up",
      profile_type: "client_followup",
      original_draft: "Original template body",
    });

    // The follow-up draft was linked back to the bridge id.
    const linkUpd = db.updates.find(
      (u) => u.table === "opportunity_follow_up_drafts" && "ai_draft_history_id" in u.payload
    );
    expect(linkUpd?.payload.ai_draft_history_id).toBeTruthy();
  });

  it("returns silently when the follow-up draft does not exist (no learning from a phantom)", async () => {
    await AIDraftService.recordLifecycleDraftOutcome("missing", "co-1", "u-1", "body");
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });
});
