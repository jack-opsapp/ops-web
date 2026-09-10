import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createEngineHandoffHandlers,
  type EngineHandoffRepository,
  type EngineRunRecord,
} from "@/lib/ads/engine/handoff";
import { ADS_BRIEF_VERSION, BriefUnavailableError, type Brief } from "@/lib/ads/engine/brief";
import type { NormalizedProposal } from "@/lib/ads/engine/types";
import { ALLOWED_URLS, context, R, settings } from "./fixtures";

// The handoff holds proposals. It must have no path at all into Google, the
// apply layer, or the operator's notification rail; these spies fail the suite
// if any of those modules is even reached through an import.
const forbidden = vi.hoisted(() => ({
  mutate: vi.fn(),
  apply: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/lib/analytics/google-ads-client", () => ({
  mutateGoogleAds: forbidden.mutate,
  isGoogleAdsConfigured: () => true,
}));
vi.mock("@/lib/ads/engine/apply", () => ({
  applyProposal: forbidden.apply,
}));
vi.mock("@/lib/notifications/pmf-send", () => ({
  sendPmfNotification: forbidden.notify,
}));

const TOKEN = "ads-engine-token-with-at-least-32-characters";
const CLAIM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_CLAIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-20T15:05:00.000Z");

function run(overrides: Partial<EngineRunRecord> = {}): EngineRunRecord {
  return {
    id: RUN_ID,
    state: "claimed",
    worker: "routine",
    claim_token: CLAIM,
    lease_until: new Date(NOW.getTime() + 40 * 60_000).toISOString(),
    duties: [],
    brief_version: null,
    submission_counts: {},
    proposals_accepted: 0,
    proposals_rejected: 0,
    ...overrides,
  };
}

function brief(): Brief {
  return {
    version: ADS_BRIEF_VERSION,
    generated_at: NOW.toISOString(),
    duties: ["hygiene", "structure"],
    duty_notes: { hygiene: "Every run." },
    settings: settings(),
    windows: { metrics7d: { from: "2026-10-11", to: "2026-10-17" }, metrics28d: { from: "2026-09-20", to: "2026-10-17" } },
    snapshot: context().snapshot,
    metrics7d: context().metrics28d,
    metrics28d: context().metrics28d,
    funnel: { signals: context().funnel, by_keyword: [] },
    tests: context().tests,
    ledger_90d: context().ledger,
    proposals: { pending: [], rejected: [], failed: [] },
    copy_rules: {
      brief: { path: "docs/social/voice/ops-copywriter-brief.md", sha256: "abc", content: "# brief" },
      brand_facts: { version: "v", numbers: [], phrases: [], competitors: { names: [], forms: [] }, bannedWords: [], audienceWords: { banned: [], approved: [] }, allowedFinalUrls: ALLOWED_URLS },
      limits: { headline: 30, description: 90, headlines: { min: 8, max: 12 }, descriptions: { min: 3, max: 4 }, path: 15, pinnedHeadlines: { min: 2, max: 3 }, nearDuplicateDistance: 2 },
      allowed_final_urls: ALLOWED_URLS,
    },
    negative_taxonomy: { lists: [], classifications: [] },
    market_digest: null,
    validation_codes: [],
    structural_kinds: ["add_keywords", "create_rsa_challenger", "add_ad_group"],
  };
}

interface Rig {
  handlers: ReturnType<typeof createEngineHandoffHandlers>;
  repository: EngineHandoffRepository;
  accepted: Array<{ normalized: NormalizedProposal; index: number; mode: string }>;
  submissions: Array<{ index: number; detail: Record<string, unknown> }>;
  releases: Array<{ summary: string; outcome: string }>;
  checkpoints: Array<{ duties: string[]; version: string }>;
  set: (next: Partial<EngineRunRecord>) => void;
  claimQueue: EngineRunRecord[];
  briefs: number;
}

function rig(options: { brief?: () => Promise<Brief>; initial?: Partial<EngineRunRecord> } = {}): Rig {
  let stored: EngineRunRecord | null = options.initial === undefined ? null : run(options.initial);
  const accepted: Rig["accepted"] = [];
  const submissions: Rig["submissions"] = [];
  const releases: Rig["releases"] = [];
  const checkpoints: Rig["checkpoints"] = [];
  const claimQueue: EngineRunRecord[] = [];
  const state = { briefs: 0 };
  let engineSettings = settings();
  let live = false;
  const owned = (id: string, token: string) =>
    !!stored &&
    stored.id === id &&
    stored.claim_token === token &&
    stored.state === "claimed" &&
    Date.parse(stored.lease_until) > NOW.getTime();
  const repository: EngineHandoffRepository = {
    claimRun: async (token, worker) => {
      const next = claimQueue.shift() ?? null;
      if (next) stored = { ...next, claim_token: token, worker };
      return stored && next ? stored : null;
    },
    readSettings: async () => engineSettings,
    hasLiveRun: async () => live,
    findRun: async (id) => (stored && stored.id === id ? stored : null),
    checkpointRun: async (id, token, duties, version) => {
      if (!owned(id, token)) return false;
      checkpoints.push({ duties, version });
      stored = { ...stored!, duties, brief_version: version };
      return true;
    },
    recordSubmission: async (id, token, index, detail) => {
      if (!owned(id, token)) return null;
      submissions.push({ index, detail });
      const key = String(index);
      const counts: Record<string, number> = { ...stored!.submission_counts, [key]: (stored!.submission_counts[key] ?? 0) + 1 };
      stored = { ...stored!, submission_counts: counts };
      return counts[key];
    },
    acceptProposal: async (id, token, normalized, index, mode) => {
      if (!owned(id, token)) return null;
      accepted.push({ normalized, index, mode });
      return `pppppppp-pppp-4ppp-8ppp-${String(accepted.length).padStart(12, "0")}`;
    },
    releaseRun: async (id, token, summary, outcome) => {
      if (!owned(id, token)) return null;
      releases.push({ summary, outcome });
      stored = { ...stored!, state: "released" };
      return "released";
    },
    validationContext: async () => {
      const ctx = context();
      return {
        settings: engineSettings,
        snapshot: ctx.snapshot,
        metrics28d: ctx.metrics28d,
        tests: ctx.tests,
        ledger: ctx.ledger,
        openProposals: accepted.map((a, i) => ({
          id: `pppppppp-pppp-4ppp-8ppp-${String(i + 1).padStart(12, "0")}`,
          kind: a.normalized.kind,
          target: a.normalized.target,
          state: "proposed" as const,
          runId: RUN_ID,
          payload: a.normalized.payload,
        })),
        funnel: ctx.funnel,
      };
    },
    structuralAcceptedInRun: async () => accepted.filter((a) => a.normalized.structural).length,
  };
  const handlers = createEngineHandoffHandlers({
    repository,
    now: () => NOW,
    buildBrief: async () => {
      state.briefs += 1;
      return options.brief ? options.brief() : brief();
    },
    allowedFinalUrls: ALLOWED_URLS,
  });
  return {
    handlers,
    repository,
    accepted,
    submissions,
    releases,
    checkpoints,
    claimQueue,
    get briefs() {
      return state.briefs;
    },
    set: (next) => {
      stored = { ...(stored ?? run()), ...next };
    },
    ...({
      setSettings: (next: ReturnType<typeof settings>) => {
        engineSettings = next;
      },
      setLive: (value: boolean) => {
        live = value;
      },
    } as Record<string, unknown>),
  } as Rig;
}

function post(path: string, body: unknown, token: string | null = TOKEN) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const negatives = {
  kind: "add_negatives",
  rationale: "Job-seeker intent.",
  evidence: [{ term: "job management jobs", clicks: 4 }],
  payload: {
    list: "NEG · Job seekers",
    classification: "job_seeker",
    terms: [{ text: "job management jobs", matchType: "PHRASE" }],
  },
};

beforeEach(() => {
  vi.stubEnv("ADS_ENGINE_TOKEN", TOKEN);
  forbidden.mutate.mockClear();
  forbidden.apply.mockClear();
  forbidden.notify.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("engine handoff authentication", () => {
  it("fails closed when the token is not configured", async () => {
    vi.stubEnv("ADS_ENGINE_TOKEN", "");
    const r = rig();
    const response = await r.handlers.claim(post("/api/internal/ads/engine/claim", { worker: "routine" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ code: "ADS_ENGINE_NOT_CONFIGURED" });
  });

  it("rejects a short configured token instead of accepting a weak secret", async () => {
    vi.stubEnv("ADS_ENGINE_TOKEN", "too-short");
    const r = rig();
    const response = await r.handlers.claim(post("/claim", { worker: "routine" }, "too-short"));
    expect(response.status).toBe(503);
  });

  it("rejects a wrong bearer token on every handler", async () => {
    const r = rig({ initial: {} });
    for (const response of [
      await r.handlers.claim(post("/claim", { worker: "w" }, "wrong")),
      await r.handlers.proposals(post("/x", { claim_token: CLAIM, proposals: [] }, "wrong"), RUN_ID),
      await r.handlers.release(post("/x", { claim_token: CLAIM, outcome: "done", summary: "" }, "wrong"), RUN_ID),
    ]) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ code: "ADS_ENGINE_INVALID" });
    }
  });

  it("answers 405 to anything but POST", async () => {
    const r = rig();
    const response = await r.handlers.claim(
      new NextRequest("http://localhost/claim", { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } })
    );
    expect(response.status).toBe(405);
  });

  it("refuses a body larger than 200 KB before parsing it", async () => {
    const r = rig();
    const request = new NextRequest("http://localhost/x", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "content-length": "200001" },
      body: JSON.stringify({ worker: "routine" }),
    });
    const response = await r.handlers.claim(request);
    expect(response.status).toBe(413);
  });
});

describe("claim", () => {
  it("distinguishes an engine that is off from a run already in flight and from idle", async () => {
    const r = rig();
    (r as unknown as { setSettings: (s: ReturnType<typeof settings>) => void }).setSettings(
      settings({ modes: Object.fromEntries(Object.keys(settings().modes).map((k) => [k, "off"])) as never })
    );
    await expect(r.handlers.claim(post("/claim", { worker: "routine" })).then((x) => x.json())).resolves.toEqual({
      run: null,
      reason: "engine_off",
    });
    const r2 = rig();
    (r2 as unknown as { setLive: (v: boolean) => void }).setLive(true);
    await expect(r2.handlers.claim(post("/claim", { worker: "routine" })).then((x) => x.json())).resolves.toEqual({
      run: null,
      reason: "run_active",
    });
    const r3 = rig();
    await expect(r3.handlers.claim(post("/claim", { worker: "routine" })).then((x) => x.json())).resolves.toEqual({
      run: null,
      reason: "idle",
    });
  });

  it("rejects a missing worker name", async () => {
    const r = rig();
    const response = await r.handlers.claim(post("/claim", {}));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("hands over the run and the whole brief, and checkpoints the duties on the run", async () => {
    const r = rig();
    r.claimQueue.push(run());
    const response = await r.handlers.claim(post("/claim", { worker: "routine" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run).toEqual({
      id: RUN_ID,
      // The token is minted by OPS on the claim, never chosen by the routine.
      claim_token: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      lease_until: run().lease_until,
      current_time: NOW.toISOString(),
      worker: "routine",
    });
    expect(body.brief.version).toBe(ADS_BRIEF_VERSION);
    expect(body.brief.duties).toEqual(["hygiene", "structure"]);
    expect(r.checkpoints).toEqual([{ duties: ["hygiene", "structure"], version: ADS_BRIEF_VERSION }]);
    expect(r.briefs).toBe(1);
  });

  it("releases the run and answers not_ready when the brief cannot be built", async () => {
    const r = rig({
      brief: async () => {
        throw new BriefUnavailableError("NO_ENGINE_CAMPAIGNS");
      },
    });
    r.claimQueue.push(run());
    const response = await r.handlers.claim(post("/claim", { worker: "routine" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: null, reason: "not_ready", detail: "NO_ENGINE_CAMPAIGNS" });
    expect(r.releases).toEqual([{ summary: "NO_ENGINE_CAMPAIGNS", outcome: "brief_unavailable" }]);
  });

  it("releases the run with an error and answers 500 when the brief throws unexpectedly", async () => {
    const r = rig({
      brief: async () => {
        throw new Error("boom");
      },
    });
    r.claimQueue.push(run());
    const response = await r.handlers.claim(post("/claim", { worker: "routine" }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: "BRIEF_FAILED" });
    expect(r.releases).toEqual([{ summary: "BRIEF_FAILED: boom", outcome: "error" }]);
  });

  it("never calls Google, the apply layer or the rail", async () => {
    const r = rig();
    r.claimQueue.push(run());
    await r.handlers.claim(post("/claim", { worker: "routine" }));
    expect(forbidden.mutate).not.toHaveBeenCalled();
    expect(forbidden.apply).not.toHaveBeenCalled();
    expect(forbidden.notify).not.toHaveBeenCalled();
  });
});

describe("proposals", () => {
  it("does not know about a run that does not exist", async () => {
    const r = rig();
    const response = await r.handlers.proposals(
      post("/proposals", { claim_token: CLAIM, proposals: [negatives] }),
      "44444444-4444-4444-8444-444444444444"
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: "RUN_NOT_FOUND" });
  });

  it("refuses a routine that does not hold the claim, or whose lease expired", async () => {
    const r = rig({ initial: {} });
    const wrong = await r.handlers.proposals(post("/proposals", { claim_token: OTHER_CLAIM, proposals: [negatives] }), RUN_ID);
    expect(wrong.status).toBe(409);
    await expect(wrong.json()).resolves.toEqual({ code: "CLAIM_NOT_OWNED" });
    r.set({ lease_until: new Date(NOW.getTime() - 1000).toISOString() });
    const late = await r.handlers.proposals(post("/proposals", { claim_token: CLAIM, proposals: [negatives] }), RUN_ID);
    expect(late.status).toBe(409);
  });

  it("rejects a body that is not a proposals envelope", async () => {
    const r = rig({ initial: {} });
    const response = await r.handlers.proposals(post("/proposals", { claim_token: CLAIM, proposals: "nope" }), RUN_ID);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("accepts a valid proposal as proposed with the kind's mode and answers per item", async () => {
    const r = rig({ initial: {} });
    const response = await r.handlers.proposals(
      post("/proposals", { claim_token: CLAIM, proposals: [negatives, { kind: "observation", payload: { text: "Budget capped on Tuesday." }, evidence: [], rationale: "" }] }),
      RUN_ID
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual([
      { index: 0, accepted: true, id: "pppppppp-pppp-4ppp-8ppp-000000000001", kind: "add_negatives", mode: "propose", target: expect.stringMatching(/^negatives:/) },
      { index: 1, accepted: true, id: "pppppppp-pppp-4ppp-8ppp-000000000002", kind: "observation", mode: "propose", target: expect.stringMatching(/^observation:/) },
    ]);
    expect(r.accepted.map((a) => a.mode)).toEqual(["propose", "propose"]);
    expect(r.submissions).toHaveLength(2);
    expect(forbidden.mutate).not.toHaveBeenCalled();
    expect(forbidden.apply).not.toHaveBeenCalled();
    expect(forbidden.notify).not.toHaveBeenCalled();
  });

  it("stamps auto on a kind Jackson has flipped, and refuses a kind that is off", async () => {
    const r = rig({ initial: {} });
    (r as unknown as { setSettings: (s: ReturnType<typeof settings>) => void }).setSettings(
      settings({ modes: { ...settings().modes, add_negatives: "auto", observation: "off" } })
    );
    const response = await r.handlers.proposals(
      post("/proposals", { claim_token: CLAIM, proposals: [negatives, { kind: "observation", payload: { text: "x" }, evidence: [], rationale: "" }] }),
      RUN_ID
    );
    const body = await response.json();
    expect(body.results[0]).toMatchObject({ accepted: true, mode: "auto" });
    expect(body.results[1]).toMatchObject({ accepted: false, code: "KIND_OFF" });
    expect(r.accepted).toHaveLength(1);
  });

  it("returns a fixable code and issues for a rejected proposal, keeping the claim live", async () => {
    const r = rig({ initial: {} });
    const response = await r.handlers.proposals(
      post("/proposals", {
        claim_token: CLAIM,
        proposals: [{ ...negatives, payload: { ...negatives.payload, terms: [{ text: "plumber salary", matchType: "PHRASE" }] } }],
      }),
      RUN_ID
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results[0]).toMatchObject({
      index: 0,
      accepted: false,
      code: "TERM_NOT_IN_REPORT",
      issues: [{ code: "TERM_NOT_IN_REPORT", field: "payload.terms[0]" }],
    });
    expect(r.accepted).toHaveLength(0);
    expect(r.releases).toHaveLength(0);
  });

  it("honours the routine's own index and exhausts it on the fourth submission", async () => {
    const r = rig({ initial: {} });
    const bad = { ...negatives, index: 7, payload: { ...negatives.payload, terms: [{ text: "plumber salary", matchType: "PHRASE" }] } };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await r.handlers.proposals(post("/proposals", { claim_token: CLAIM, proposals: [bad] }), RUN_ID);
      expect(response.status).toBe(200);
      expect((await response.json()).results[0]).toMatchObject({ index: 7, accepted: false, code: "TERM_NOT_IN_REPORT" });
    }
    const fourth = await r.handlers.proposals(post("/proposals", { claim_token: CLAIM, proposals: [bad] }), RUN_ID);
    expect(fourth.status).toBe(429);
    expect((await fourth.json()).results[0]).toMatchObject({ index: 7, accepted: false, code: "SUBMISSIONS_EXHAUSTED" });
  });

  it("catches a duplicate within one batch and caps structural proposals across the run", async () => {
    const r = rig({ initial: {} });
    const keywords = (text: string) => ({
      kind: "add_keywords",
      rationale: "",
      evidence: [],
      payload: { ad_group: R.jobManagement, terms: [{ text, matchType: "PHRASE" }] },
    });
    const response = await r.handlers.proposals(
      post("/proposals", {
        claim_token: CLAIM,
        proposals: [negatives, negatives, keywords("job tracking app"), keywords("job tracker"), keywords("job board software"), keywords("job costing app")],
      }),
      RUN_ID
    );
    const body = await response.json();
    expect(body.results.map((x: { accepted: boolean; code?: string }) => x.accepted ? "ok" : x.code)).toEqual([
      "ok",
      "DUPLICATE_PROPOSAL",
      "ok",
      "ok",
      "ok",
      "STRUCTURAL_LIMIT",
    ]);
  });

  it("is idempotent when the routine replays a batch it already won", async () => {
    const r = rig({ initial: {} });
    await r.handlers.proposals(post("/proposals", { claim_token: CLAIM, proposals: [negatives] }), RUN_ID);
    const replay = await r.handlers.proposals(post("/proposals", { claim_token: CLAIM, proposals: [negatives] }), RUN_ID);
    const body = await replay.json();
    expect(body.results[0]).toMatchObject({ accepted: true, id: "pppppppp-pppp-4ppp-8ppp-000000000001", replay: true });
    expect(r.accepted).toHaveLength(1);
  });
});

describe("release", () => {
  it("closes the run with the routine's summary", async () => {
    const r = rig({ initial: {} });
    const response = await r.handlers.release(
      post("/release", { claim_token: CLAIM, outcome: "done", summary: "FILED add_negatives NEG · Job seekers (3 terms)" }),
      RUN_ID
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "released", outcome: "done" });
    expect(r.releases).toEqual([{ summary: "FILED add_negatives NEG · Job seekers (3 terms)", outcome: "done" }]);
  });

  it("refuses a release from a routine that does not hold the claim", async () => {
    const r = rig({ initial: {} });
    const response = await r.handlers.release(post("/release", { claim_token: OTHER_CLAIM, outcome: "done", summary: "" }), RUN_ID);
    expect(response.status).toBe(409);
  });

  it("rejects an unknown outcome", async () => {
    const r = rig({ initial: {} });
    const response = await r.handlers.release(post("/release", { claim_token: CLAIM, outcome: "published", summary: "" }), RUN_ID);
    expect(response.status).toBe(422);
  });
});
