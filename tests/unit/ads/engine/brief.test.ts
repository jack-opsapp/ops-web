import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ADS_BRIEF_VERSION,
  BriefUnavailableError,
  buildBrief,
  computeDuties,
  type BriefRepository,
} from "@/lib/ads/engine/brief";
import { BRAND_FACTS } from "@/lib/ads/copy-rules";
import { ledger, metrics28d, NOW, settings, snapshot, tests } from "./fixtures";

const COPY_CONTENT = "# OPS copywriter brief\nSay less. Mean more.\n";
const COPY = {
  path: "docs/social/voice/ops-copywriter-brief.md",
  sha256: createHash("sha256").update(COPY_CONTENT).digest("hex"),
  content: COPY_CONTENT,
};

function repository(overrides: Partial<BriefRepository> = {}) {
  const digests: Array<{ text: string; generatedAt: string }> = [];
  const repo: BriefRepository & { digests: typeof digests } = {
    digests,
    readSettings: async () => settings(),
    readSnapshot: async () => snapshot(),
    readMetrics: async (window) => ({ ...metrics28d(), from: window.from, to: window.to }),
    readTests: async () => tests(),
    readLedger: async () => ledger(),
    readProposals: async () => ({
      pending: [{ id: "p1", kind: "add_negatives", target: "negatives:x", state: "proposed", payload: { terms: [] }, rationale: "r", review_notes: null, error: null, google_validation: null, created_at: "2026-10-19T15:10:00.000Z", expires_at: "2026-11-02T15:10:00.000Z" }],
      rejected: [{ id: "p0", kind: "adjust_budget", target: "budget:x", state: "rejected", payload: {}, rationale: "r", review_notes: "Not yet.", error: null, google_validation: null, created_at: "2026-10-12T15:10:00.000Z", expires_at: "2026-10-26T15:10:00.000Z" }],
      failed: [],
    }),
    readFunnel: async () => ({ trialStartsLast30: 2, trialStartsPrev30: 1, monthToDateSpend: 400, daysLeftInMonth: 12 }),
    readFunnelByKeyword: async () => [{ campaign_name: "CORE · CA", ad_group_name: "Job management", keyword: "job management app", clicks: 40, trials: 1, activated: 0, paid: 0, spend: 180, cost_per_trial: 180, cost_per_paid: null }],
    readRuns: async () => [],
    readMarketDigest: async () => null,
    writeMarketDigest: async (text, generatedAt) => {
      digests.push({ text, generatedAt });
    },
    ...overrides,
  };
  return repo;
}

describe("computeDuties", () => {
  const base = {
    now: NOW,
    snapshot: snapshot(),
    metrics28d: { ...metrics28d(), ads: metrics28d().ads.map((ad) => ({ ...ad, firstSeen: "2026-09-01" })) },
    tests: tests(),
    runsThisMonth: [] as Array<{ duties: string[]; state: string }>,
    funnel: { trialStartsLast30: 2, trialStartsPrev30: 1, monthToDateSpend: 400, daysLeftInMonth: 12 },
  };

  it("always includes hygiene", () => {
    expect(computeDuties(base).duties).toContain("hygiene");
  });

  it("adds creative when an enabled control is four weeks old with no running test", () => {
    const result = computeDuties(base);
    expect(result.duties).toContain("creative");
    expect(result.notes.creative).toMatch(/Job management/);
  });

  it("skips creative while every eligible ad group has a running test or a young control", () => {
    const result = computeDuties({
      ...base,
      metrics28d: { ...metrics28d(), ads: metrics28d().ads.map((ad) => ({ ...ad, firstSeen: "2026-10-10" })) },
    });
    expect(result.duties).not.toContain("creative");
  });

  it("adds structure on the first run of a month and not after one has released", () => {
    expect(computeDuties(base).duties).toContain("structure");
    expect(
      computeDuties({ ...base, runsThisMonth: [{ duties: ["hygiene", "structure"], state: "released" }] }).duties
    ).not.toContain("structure");
    expect(
      computeDuties({ ...base, runsThisMonth: [{ duties: ["hygiene", "structure"], state: "expired" }] }).duties
    ).toContain("structure");
  });

  it("adds the bidding ladder only when the trial-start trigger is met", () => {
    expect(computeDuties(base).duties).not.toContain("bidding_ladder");
    expect(
      computeDuties({ ...base, funnel: { ...base.funnel, trialStartsLast30: 15, trialStartsPrev30: 15 } }).duties
    ).toContain("bidding_ladder");
    expect(
      computeDuties({ ...base, funnel: { ...base.funnel, trialStartsLast30: 30, trialStartsPrev30: 3 } }).duties
    ).toContain("bidding_ladder");
  });
});

describe("buildBrief", () => {
  it("assembles everything the routine needs and nothing it should not have", async () => {
    const repo = repository();
    const brief = await buildBrief({
      repository: repo,
      now: () => NOW,
      loadCopyBrief: () => COPY,
      brandFacts: BRAND_FACTS,
      marketResearch: async () => "Competitors are pushing annual plans.",
    });
    expect(brief.version).toBe(ADS_BRIEF_VERSION);
    expect(brief.generated_at).toBe(NOW.toISOString());
    expect(brief.duties).toEqual(expect.arrayContaining(["hygiene", "structure"]));
    expect(brief.windows).toEqual({
      metrics7d: { from: "2026-10-11", to: "2026-10-17" },
      metrics28d: { from: "2026-09-20", to: "2026-10-17" },
    });
    expect(brief.metrics7d.from).toBe("2026-10-11");
    expect(brief.metrics28d.from).toBe("2026-09-20");
    expect(brief.snapshot.campaigns.map((c) => c.name)).toContain("CORE · CA");
    expect(brief.settings.modes.add_negatives).toBe("propose");
    expect(brief.settings.monthly_cap).toBe(1500);
    expect(brief.tests).toHaveLength(3);
    expect(brief.ledger_90d).toHaveLength(2);
    expect(brief.proposals.pending[0].id).toBe("p1");
    expect(brief.proposals.rejected[0].review_notes).toBe("Not yet.");
    expect(brief.funnel.signals.trialStartsLast30).toBe(2);
    expect(brief.funnel.by_keyword[0].keyword).toBe("job management app");
    expect(brief.copy_rules.brief).toEqual(COPY);
    expect(brief.copy_rules.brand_facts.version).toBe(BRAND_FACTS.version);
    expect(brief.copy_rules.allowed_final_urls).toEqual(BRAND_FACTS.allowedFinalUrls);
    expect(brief.copy_rules.limits.headlines).toEqual({ min: 8, max: 12 });
    expect(brief.negative_taxonomy.lists.map((l) => l.classification)).toEqual(["job_seeker", "homeowner"]);
    expect(brief.market_digest).toEqual({
      generated_at: NOW.toISOString(),
      text: "Competitors are pushing annual plans.",
    });
    expect(repo.digests).toEqual([{ text: "Competitors are pushing annual plans.", generatedAt: NOW.toISOString() }]);
    expect(brief.validation_codes).toContain("TERM_PRODUCED_TRIAL");
    expect(brief.structural_kinds).toEqual(["add_keywords", "create_rsa_challenger", "add_ad_group"]);
    // Nothing that could reach Google or a secret travels with the brief.
    expect(JSON.stringify(brief)).not.toMatch(/ADS_ENGINE_TOKEN|developer-token|Bearer |googleapis\.com|service_role/i);
  });

  it("reuses a market digest younger than a week without calling the research step", async () => {
    let called = 0;
    const repo = repository({
      readMarketDigest: async () => ({ text: "Fresh enough.", generatedAt: "2026-10-16T15:00:00.000Z" }),
    });
    const brief = await buildBrief({
      repository: repo,
      now: () => NOW,
      loadCopyBrief: () => COPY,
      brandFacts: BRAND_FACTS,
      marketResearch: async () => {
        called += 1;
        return "new";
      },
    });
    expect(called).toBe(0);
    expect(brief.market_digest?.text).toBe("Fresh enough.");
    expect(repo.digests).toEqual([]);
  });

  it("keeps the stale digest when research fails, so a Tavily outage never blocks a run", async () => {
    const repo = repository({
      readMarketDigest: async () => ({ text: "Old but present.", generatedAt: "2026-09-01T15:00:00.000Z" }),
    });
    const brief = await buildBrief({
      repository: repo,
      now: () => NOW,
      loadCopyBrief: () => COPY,
      brandFacts: BRAND_FACTS,
      marketResearch: async () => {
        throw new Error("tavily down");
      },
    });
    expect(brief.market_digest?.text).toBe("Old but present.");
    expect(brief.market_digest?.stale).toBe(true);
  });

  it("refuses to brief an account with no engine campaigns", async () => {
    const empty = snapshot();
    empty.campaigns = empty.campaigns.filter((c) => c.kind === "legacy");
    await expect(
      buildBrief({
        repository: repository({ readSnapshot: async () => empty }),
        now: () => NOW,
        loadCopyBrief: () => COPY,
        brandFacts: BRAND_FACTS,
      })
    ).rejects.toBeInstanceOf(BriefUnavailableError);
  });

  it("wraps a warehouse read failure as unavailable instead of a generic error", async () => {
    await expect(
      buildBrief({
        repository: repository({
          readSnapshot: async () => {
            throw new Error('relation "public.ads_entities" does not exist');
          },
        }),
        now: () => NOW,
        loadCopyBrief: () => COPY,
        brandFacts: BRAND_FACTS,
      })
    ).rejects.toMatchObject({ name: "BriefUnavailableError", reason: "WAREHOUSE_UNAVAILABLE" });
  });
});
