import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  createEngineAdminHandlers,
  nextRoutineDue,
  type AdminProposalRow,
  type EngineAdminDependencies,
  type EngineAdminRepository,
  type EngineSettingsRow,
} from "@/lib/ads/engine/admin";
import type { ApplyOutcome, ApplyProposalRecord } from "@/lib/ads/engine/apply";
import { NOW, R, settings, snapshot } from "./fixtures";

function row(overrides: Partial<AdminProposalRow> = {}): AdminProposalRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    run_id: "22222222-2222-4222-8222-222222222222",
    kind: "add_negatives",
    target: "negatives:NEG · Job seekers:abcdef01",
    submission_index: 0,
    state: "proposed",
    mode_at_submit: "propose",
    payload: { list: "NEG · Job seekers", listResourceName: R.negJobSeekers, classification: "job_seeker", terms: [{ text: "job management jobs", matchType: "PHRASE" }] },
    evidence: [{ term: "job management jobs", clicks: 4 }],
    rationale: "Job-seeker intent.",
    review_notes: null,
    reviewed_by: null,
    reviewed_at: null,
    applied_at: null,
    applied_by: null,
    applied_resource_names: null,
    label: null,
    error: null,
    google_validation: null,
    created_at: "2026-10-20T15:10:00.000Z",
    expires_at: "2026-11-03T15:10:00.000Z",
    updated_at: "2026-10-20T15:10:00.000Z",
    ...overrides,
  };
}

function settingsRow(overrides: Partial<EngineSettingsRow> = {}): EngineSettingsRow {
  return { ...settings(), stall_notified_on: null, updated_at: "2026-10-19T00:00:00.000Z", ...overrides };
}

interface Rig {
  handlers: ReturnType<typeof createEngineAdminHandlers>;
  reviews: Array<{ id: string; decision: string; reviewer: string; notes: string | null }>;
  applied: ApplyProposalRecord[];
  patches: Array<Record<string, unknown>>;
}

function rig(options: {
  rows?: AdminProposalRow[];
  apply?: null | ((p: ApplyProposalRecord) => Promise<ApplyOutcome>);
  applyTimeoutMs?: number;
  settings?: EngineSettingsRow;
  heartbeat?: string | null;
} = {}): Rig {
  let rows = options.rows ?? [row()];
  const reviews: Rig["reviews"] = [];
  const applied: ApplyProposalRecord[] = [];
  const patches: Rig["patches"] = [];
  let current = options.settings ?? settingsRow({ heartbeat_at: options.heartbeat === undefined ? "2026-10-20T14:00:00.000Z" : options.heartbeat });
  const repository: EngineAdminRepository = {
    listProposals: async (states) => rows.filter((r) => states.includes(r.state)),
    findProposal: async (id) => rows.find((r) => r.id === id) ?? null,
    reviewProposal: async (id, decision, reviewer, notes) => {
      const target = rows.find((r) => r.id === id);
      if (!target || target.state !== "proposed") return null;
      reviews.push({ id, decision, reviewer, notes });
      const next = decision === "approve" ? "approved" : "rejected";
      rows = rows.map((r) => (r.id === id ? { ...r, state: next, reviewed_by: reviewer, review_notes: notes, reviewed_at: NOW.toISOString() } : r));
      return next;
    },
    readSettingsRow: async () => current,
    updateSettings: async (patch) => {
      patches.push(patch as Record<string, unknown>);
      current = { ...current, ...patch, modes: { ...current.modes, ...(patch.modes ?? {}) } } as EngineSettingsRow;
      return current;
    },
    listTests: async () => [],
    listChanges: async () => [],
    funnelByKeyword: async () => [],
    lastRuns: async () => [
      { id: "run-1", state: "released", worker: "routine", duties: ["hygiene"], outcome: "done", summary: "FILED 1", proposals_accepted: 1, proposals_rejected: 0, brief_version: "ads-brief-2026-09-10-v1", created_at: "2026-10-20T15:00:00.000Z", released_at: "2026-10-20T15:09:00.000Z" },
    ],
    countByState: async () => ({ proposed: rows.filter((r) => r.state === "proposed").length, approved: 0, rejected: 0, applied: 0, failed: 0, expired: 0 }),
    readSnapshot: async () => snapshot(),
  };
  const deps: EngineAdminDependencies = {
    repository,
    now: () => NOW,
    apply:
      options.apply === null
        ? null
        : options.apply ??
          (async (proposal) => {
            applied.push(proposal);
            return { state: "applied", validation: { results: [], failures: [] }, resourceNames: ["customers/1/sharedCriteria/501~9"], label: "gen-x", changeId: "c1", testId: null };
          }),
    applyTimeoutMs: options.applyTimeoutMs ?? 25_000,
    googleAvailable: options.apply !== null,
    rehearsal: false,
  };
  return { handlers: createEngineAdminHandlers(deps), reviews, applied, patches };
}

const get = (path: string) => new NextRequest(`http://localhost${path}`, { method: "GET" });
const send = (path: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("proposals list", () => {
  it("defaults to what needs Jackson and honours a state filter", async () => {
    const r = rig({ rows: [row(), row({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", state: "applied" })] });
    const waiting = await (await r.handlers.listProposals(get("/proposals"))).json();
    expect(waiting.proposals.map((p: AdminProposalRow) => p.state)).toEqual(["proposed"]);
    expect(waiting.counts.proposed).toBe(1);
    const applied = await (await r.handlers.listProposals(get("/proposals?state=applied,rejected"))).json();
    expect(applied.proposals.map((p: AdminProposalRow) => p.state)).toEqual(["applied"]);
    const all = await (await r.handlers.listProposals(get("/proposals?state=all"))).json();
    expect(all.proposals).toHaveLength(2);
    const bad = await r.handlers.listProposals(get("/proposals?state=bogus"));
    expect(bad.status).toBe(422);
  });
});

describe("review", () => {
  it("approves, applies synchronously, and returns the applied proposal with the outcome", async () => {
    const r = rig();
    const response = await r.handlers.reviewProposal(send("/p", "POST", { decision: "approve" }), row().id, "jackson@opsapp.co");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(r.reviews).toEqual([{ id: row().id, decision: "approve", reviewer: "jackson@opsapp.co", notes: null }]);
    expect(r.applied.map((p) => p.state)).toEqual(["approved"]);
    expect(body.outcome).toMatchObject({ state: "applied", resourceNames: ["customers/1/sharedCriteria/501~9"] });
    expect(body.proposal.id).toBe(row().id);
  });

  it("rejects with Jackson's reason and never touches Google", async () => {
    const r = rig();
    const response = await r.handlers.reviewProposal(send("/p", "POST", { decision: "reject", notes: "Keep it a week longer." }), row().id, "jackson@opsapp.co");
    expect(response.status).toBe(200);
    expect(r.reviews[0]).toMatchObject({ decision: "reject", notes: "Keep it a week longer." });
    expect(r.applied).toEqual([]);
    expect((await response.json()).proposal.state).toBe("rejected");
  });

  it("returns the Google validation when an approved proposal fails to apply", async () => {
    const r = rig({
      apply: async () => ({ state: "failed", validation: { results: [], failures: [{ index: 0, code: "POLICY_FINDING", message: "Trademark" }] }, error: "POLICY_FINDING@0: Trademark", policyTopics: ["TRADEMARKS"] }),
    });
    const body = await (await r.handlers.reviewProposal(send("/p", "POST", { decision: "approve" }), row().id, "jackson@opsapp.co")).json();
    expect(body.outcome).toMatchObject({ state: "failed", policyTopics: ["TRADEMARKS"] });
  });

  it("leaves an approved proposal for the worker when Google cannot be reached or the apply runs past its budget", async () => {
    const dark = rig({ apply: null });
    const body = await (await dark.handlers.reviewProposal(send("/p", "POST", { decision: "approve" }), row().id, "jackson@opsapp.co")).json();
    expect(body.outcome).toEqual({ state: "pending", reason: "google_unavailable" });
    const slow = rig({ apply: () => new Promise(() => {}), applyTimeoutMs: 10 });
    const late = await (await slow.handlers.reviewProposal(send("/p", "POST", { decision: "approve" }), row().id, "jackson@opsapp.co")).json();
    expect(late.outcome).toEqual({ state: "pending", reason: "apply_timeout" });
  });

  it("refuses a second review, an unknown proposal and a malformed decision", async () => {
    const r = rig({ rows: [row({ state: "approved" })] });
    expect((await r.handlers.reviewProposal(send("/p", "POST", { decision: "approve" }), row().id, "j")).status).toBe(409);
    expect((await r.handlers.reviewProposal(send("/p", "POST", { decision: "approve" }), "44444444-4444-4444-8444-444444444444", "j")).status).toBe(404);
    expect((await r.handlers.reviewProposal(send("/p", "POST", { decision: "maybe" }), row().id, "j")).status).toBe(422);
  });
});

describe("settings", () => {
  it("reads the row with the kinds that must stay human", async () => {
    const r = rig();
    const body = await (await r.handlers.getSettings()).json();
    expect(body.settings.monthly_cap).toBe(1500);
    expect(body.human_only_kinds).toEqual(["create_rsa_challenger", "adjust_budget", "adjust_cpc_cap", "set_bidding_strategy", "add_ad_group"]);
  });

  it("flips negatives to auto but refuses auto for the human-only kinds", async () => {
    const r = rig();
    const ok = await r.handlers.patchSettings(send("/s", "PATCH", { modes: { add_negatives: "auto" }, daily_cap: 55 }));
    expect(ok.status).toBe(200);
    expect(r.patches).toEqual([{ modes: { add_negatives: "auto" }, daily_cap: 55 }]);
    expect((await ok.json()).settings.modes.add_negatives).toBe("auto");
    const refused = await r.handlers.patchSettings(send("/s", "PATCH", { modes: { adjust_budget: "auto" } }));
    expect(refused.status).toBe(422);
    await expect(refused.json()).resolves.toMatchObject({ code: "HUMAN_ONLY_KIND" });
    expect(r.patches).toHaveLength(1);
  });

  it("validates ranges and rejects unknown fields", async () => {
    const r = rig();
    expect((await r.handlers.patchSettings(send("/s", "PATCH", { max_budget_change_pct: 90 }))).status).toBe(422);
    expect((await r.handlers.patchSettings(send("/s", "PATCH", { lease_minutes: 10 }))).status).toBe(422);
    expect((await r.handlers.patchSettings(send("/s", "PATCH", {}))).status).toBe(422);
  });
});

describe("health", () => {
  it("reports the last run, the next due time, the heartbeat and the stall state", async () => {
    const r = rig();
    const body = await (await r.handlers.health()).json();
    expect(body.last_run).toMatchObject({ id: "run-1", outcome: "done", duties: ["hygiene"] });
    expect(body.next_due_at).toBe("2026-10-21T15:00:00.000Z");
    expect(body.heartbeat_at).toBe("2026-10-20T14:00:00.000Z");
    expect(body.stall).toEqual({ stalled: false, threshold_hours: 50, campaigns_live: true });
    expect(body.google).toBe("available");
    expect(body.counts.proposed).toBe(1);
    expect(body.modes.add_negatives).toBe("propose");
  });

  it("flags a stall only when campaigns are live and the routine has gone quiet", async () => {
    const quiet = rig({ heartbeat: "2026-10-17T14:00:00.000Z" });
    expect((await (await quiet.handlers.health()).json()).stall.stalled).toBe(true);
  });
});

describe("nextRoutineDue", () => {
  it("is the next 15:00 UTC strictly after now", () => {
    expect(nextRoutineDue(new Date("2026-10-20T14:59:00.000Z")).toISOString()).toBe("2026-10-20T15:00:00.000Z");
    expect(nextRoutineDue(new Date("2026-10-20T15:00:00.000Z")).toISOString()).toBe("2026-10-21T15:00:00.000Z");
  });
});
