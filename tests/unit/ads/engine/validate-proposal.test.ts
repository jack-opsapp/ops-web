import { describe, expect, it } from "vitest";
import { validateProposal } from "@/lib/ads/engine/validate-proposal";
import type { ValidationContext, ValidationResult } from "@/lib/ads/engine/types";
import { context, goodRsa, R, snapshot } from "./fixtures";

function run(
  proposal: unknown,
  overrides: Partial<ValidationContext> = {}
): ValidationResult {
  return validateProposal(proposal, context(overrides));
}

function expectOk(result: ValidationResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${JSON.stringify(result.issues)}`);
  return result.normalized;
}

function expectCode(result: ValidationResult, code: string) {
  if (result.ok) throw new Error(`expected ${code}, got ok (${result.normalized.target})`);
  expect(result.code).toBe(code);
  return result;
}

const negatives = {
  kind: "add_negatives",
  rationale: "Job-seeker intent wasted four clicks.",
  evidence: [{ term: "job management jobs", clicks: 4, spend: 18, conversions: 0 }],
  payload: {
    list: "NEG · Job seekers",
    classification: "job_seeker",
    terms: [{ text: "job management jobs", matchType: "PHRASE" }],
  },
};

describe("validateProposal — accepted fixture per kind", () => {
  it("add_negatives", () => {
    const normalized = expectOk(run(negatives));
    expect(normalized.kind).toBe("add_negatives");
    expect(normalized.target).toMatch(/^negatives:NEG · Job seekers:[0-9a-f]{8}$/);
    expect(normalized.structural).toBe(false);
    expect(normalized.payload).toMatchObject({
      list: "NEG · Job seekers",
      listResourceName: R.negJobSeekers,
      terms: [{ text: "job management jobs", matchType: "PHRASE" }],
    });
  });

  it("pause_keyword", () => {
    const normalized = expectOk(
      run({
        kind: "pause_keyword",
        rationale: "Forty clicks, no trial in six weeks.",
        evidence: [{ clicks: 40, spend: 180, conversions: 0 }],
        payload: { criterion: R.kwJobManagementApp },
      })
    );
    expect(normalized.target).toBe(`keyword:${R.kwJobManagementApp}`);
    expect(normalized.payload).toMatchObject({
      criterion: R.kwJobManagementApp,
      text: "job management app",
      matchType: "PHRASE",
    });
  });

  it("add_keywords", () => {
    const normalized = expectOk(
      run({
        kind: "add_keywords",
        rationale: "The search-term report shows steady job tracking demand.",
        evidence: [],
        payload: {
          ad_group: R.jobManagement,
          terms: [{ text: "job tracking app", matchType: "PHRASE" }],
        },
      })
    );
    expect(normalized.target).toMatch(new RegExp(`^keywords:${R.jobManagement}:`));
    expect(normalized.structural).toBe(true);
  });

  it("create_rsa_challenger", () => {
    const normalized = expectOk(
      run({
        kind: "create_rsa_challenger",
        rationale: "Test a crew-first angle against the control.",
        evidence: [],
        payload: {
          ad_group: R.crewScheduling,
          hypothesis: "Naming the crew in headline one lifts CTR.",
          ...goodRsa(),
        },
      })
    );
    expect(normalized.target).toBe(`challenger:${R.crewScheduling}`);
    expect(normalized.payload).toMatchObject({
      controlAd: R.csControl,
      campaign: R.core,
      campaignKind: "core",
    });
  });

  it("promote_challenger", () => {
    const normalized = expectOk(
      run({
        kind: "promote_challenger",
        rationale: "The challenger won at p below 0.05.",
        evidence: [],
        payload: { test_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" },
      })
    );
    expect(normalized.target).toBe("test:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(normalized.payload).toMatchObject({
      winner: R.jmChallenger,
      loser: R.jmControl,
      adGroup: R.jobManagement,
    });
  });

  it("pause_ad", () => {
    const normalized = expectOk(
      run({
        kind: "pause_ad",
        rationale: "The losing control retires after the verdict.",
        evidence: [],
        payload: { ad: R.jmControl, reason: "Lost its test." },
      })
    );
    expect(normalized.target).toBe(`ad:${R.jmControl}`);
  });

  it("adjust_budget", () => {
    const normalized = expectOk(
      run({
        kind: "adjust_budget",
        rationale: "CORE is the only campaign producing trials.",
        evidence: [],
        payload: { campaign: R.core, new_daily_amount: 36, reason: "More of what works." },
      })
    );
    expect(normalized.target).toBe(`budget:${R.core}`);
    expect(normalized.payload).toMatchObject({
      budgetResourceName: R.coreBudget,
      currentDailyAmount: 32,
      new_daily_amount: 36,
    });
  });

  it("adjust_cpc_cap", () => {
    const normalized = expectOk(
      run({
        kind: "adjust_cpc_cap",
        rationale: "Impression share lost to rank.",
        evidence: [],
        payload: { campaign: R.core, new_cpc_cap: 9, reason: "Rank." },
      })
    );
    expect(normalized.target).toBe(`cpc:${R.core}`);
  });

  it("set_bidding_strategy", () => {
    const normalized = expectOk(
      run(
        {
          kind: "set_bidding_strategy",
          rationale: "Two months above fifteen trial starts.",
          evidence: [],
          payload: { campaign: R.core, strategy: "MAXIMIZE_CONVERSIONS" },
        },
        {
          funnel: {
            trialStartsLast30: 16,
            trialStartsPrev30: 15,
            monthToDateSpend: 400,
            daysLeftInMonth: 10,
          },
        }
      )
    );
    expect(normalized.target).toBe(`bidding:${R.core}`);
  });

  it("add_ad_group", () => {
    const normalized = expectOk(
      run({
        kind: "add_ad_group",
        rationale: "Deck builders are the first trade with a paying customer.",
        evidence: [],
        payload: {
          campaign: R.core,
          name: "Deck builder software",
          theme: "deck",
          final_url: "https://try.opsapp.co/job-management",
          keywords: [
            { text: "deck builder software", matchType: "PHRASE" },
            { text: "deck contractor app", matchType: "EXACT" },
            { text: "deck job management", matchType: "PHRASE" },
          ],
          ads: [goodRsa("https://try.opsapp.co/job-management")],
        },
      })
    );
    expect(normalized.target).toBe(`ad_group:${R.core}:deck-builder-software`);
    expect(normalized.structural).toBe(true);
  });

  it("observation", () => {
    const normalized = expectOk(
      run({
        kind: "observation",
        rationale: "",
        evidence: [],
        payload: { text: "Competitor campaign is capped by budget four days of the last seven." },
      })
    );
    expect(normalized.target).toMatch(/^observation:[0-9a-f]{8}$/);
  });
});

describe("validateProposal — one failing fixture per code", () => {
  it("SCHEMA_INVALID on an unknown kind and on a malformed payload", () => {
    expectCode(run({ kind: "create_campaign", payload: {}, evidence: [], rationale: "" }), "SCHEMA_INVALID");
    const bad = expectCode(
      run({ kind: "pause_keyword", payload: { criterion: "nope" }, evidence: [], rationale: "" }),
      "SCHEMA_INVALID"
    );
    expect(bad.issues[0]?.field).toContain("criterion");
  });

  it("UNKNOWN_ENTITY", () => {
    expectCode(
      run({
        kind: "pause_keyword",
        rationale: "",
        evidence: [],
        payload: { criterion: "customers/4454506598/adGroupCriteria/21~999" },
      }),
      "UNKNOWN_ENTITY"
    );
    expectCode(
      run({ ...negatives, payload: { ...negatives.payload, list: "NEG · Nope" } }),
      "UNKNOWN_ENTITY"
    );
  });

  it("LEGACY_ENTITY", () => {
    expectCode(
      run({ kind: "pause_keyword", rationale: "", evidence: [], payload: { criterion: R.kwLegacy } }),
      "LEGACY_ENTITY"
    );
    expectCode(
      run({
        kind: "adjust_budget",
        rationale: "",
        evidence: [],
        payload: { campaign: R.legacy, new_daily_amount: 21, reason: "x" },
      }),
      "LEGACY_ENTITY"
    );
  });

  it("INSUFFICIENT_DATA", () => {
    expectCode(
      run({ kind: "pause_keyword", rationale: "", evidence: [], payload: { criterion: R.kwCrewSchedulingApp } }),
      "INSUFFICIENT_DATA"
    );
  });

  it("TERM_PRODUCED_TRIAL", () => {
    expectCode(
      run({
        ...negatives,
        payload: { ...negatives.payload, terms: [{ text: "job management software", matchType: "PHRASE" }] },
      }),
      "TERM_PRODUCED_TRIAL"
    );
  });

  it("TERM_NOT_IN_REPORT", () => {
    expectCode(
      run({
        ...negatives,
        payload: { ...negatives.payload, terms: [{ text: "plumber salary", matchType: "PHRASE" }] },
      }),
      "TERM_NOT_IN_REPORT"
    );
  });

  it("BROAD_MATCH_REJECTED", () => {
    expectCode(
      run({
        kind: "add_keywords",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.jobManagement, terms: [{ text: "job tracking app", matchType: "BROAD" }] },
      }),
      "BROAD_MATCH_REJECTED"
    );
    expectCode(
      run({
        kind: "add_ad_group",
        rationale: "",
        evidence: [],
        payload: {
          campaign: R.core,
          name: "Deck builder software",
          theme: "deck",
          final_url: "https://try.opsapp.co/job-management",
          keywords: [
            { text: "deck builder software", matchType: "PHRASE" },
            { text: "deck contractor app", matchType: "EXACT" },
            { text: "deck job management", matchType: "BROAD" },
          ],
          ads: [goodRsa("https://try.opsapp.co/job-management")],
        },
      }),
      "BROAD_MATCH_REJECTED"
    );
  });

  it("THEME_MISMATCH", () => {
    expectCode(
      run({
        kind: "add_keywords",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.jobManagement, terms: [{ text: "plumber near me", matchType: "PHRASE" }] },
      }),
      "THEME_MISMATCH"
    );
  });

  it("BUDGET_CAP", () => {
    expectCode(
      run(
        {
          kind: "adjust_budget",
          rationale: "",
          evidence: [],
          payload: { campaign: R.core, new_daily_amount: 36, reason: "x" },
        },
        {
          funnel: { trialStartsLast30: 2, trialStartsPrev30: 1, monthToDateSpend: 1400, daysLeftInMonth: 10 },
        }
      ),
      "BUDGET_CAP"
    );
  });

  it("DAILY_CAP", () => {
    expectCode(
      run(
        {
          kind: "adjust_budget",
          rationale: "",
          evidence: [],
          payload: { campaign: R.core, new_daily_amount: 36, reason: "x" },
        },
        { settings: { ...context().settings, daily_cap: 52 } }
      ),
      "DAILY_CAP"
    );
  });

  it("COOLDOWN", () => {
    expectCode(
      run({
        kind: "adjust_budget",
        rationale: "",
        evidence: [],
        payload: { campaign: R.competitor, new_daily_amount: 16, reason: "x" },
      }),
      "COOLDOWN"
    );
    expectCode(
      run({
        kind: "adjust_cpc_cap",
        rationale: "",
        evidence: [],
        payload: { campaign: R.competitor, new_cpc_cap: 11, reason: "x" },
      }),
      "COOLDOWN"
    );
  });

  it("CHANGE_TOO_LARGE", () => {
    expectCode(
      run({
        kind: "adjust_budget",
        rationale: "",
        evidence: [],
        payload: { campaign: R.core, new_daily_amount: 40, reason: "x" },
      }),
      "CHANGE_TOO_LARGE"
    );
    expectCode(
      run({
        kind: "adjust_cpc_cap",
        rationale: "",
        evidence: [],
        payload: { campaign: R.core, new_cpc_cap: 10, reason: "x" },
      }),
      "CHANGE_TOO_LARGE"
    );
  });

  it("LADDER_NOT_MET", () => {
    expectCode(
      run({
        kind: "set_bidding_strategy",
        rationale: "",
        evidence: [],
        payload: { campaign: R.core, strategy: "MAXIMIZE_CONVERSIONS" },
      }),
      "LADDER_NOT_MET"
    );
    expectCode(
      run(
        {
          kind: "set_bidding_strategy",
          rationale: "",
          evidence: [],
          payload: { campaign: R.core, strategy: "TARGET_CPA", target_cpa: 120 },
        },
        { funnel: { trialStartsLast30: 40, trialStartsPrev30: 35, monthToDateSpend: 400, daysLeftInMonth: 10 } }
      ),
      "LADDER_NOT_MET"
    );
  });

  it("TEST_NOT_CONCLUDED", () => {
    expectCode(
      run({
        kind: "promote_challenger",
        rationale: "",
        evidence: [],
        payload: { test_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" },
      }),
      "TEST_NOT_CONCLUDED"
    );
    expectCode(
      run({
        kind: "create_rsa_challenger",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.jobberAlternative, hypothesis: "x", ...goodRsa("https://try.opsapp.co/compare/jobber") },
      }),
      "TEST_NOT_CONCLUDED"
    );
    expectCode(
      run({ kind: "pause_ad", rationale: "", evidence: [], payload: { ad: R.jaChallenger, reason: "x" } }),
      "TEST_NOT_CONCLUDED"
    );
  });

  it("VERDICT_MISMATCH", () => {
    expectCode(
      run({
        kind: "promote_challenger",
        rationale: "",
        evidence: [],
        payload: { test_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" },
      }),
      "VERDICT_MISMATCH"
    );
  });

  it("NO_CONTROL_AD", () => {
    expectCode(
      run({
        kind: "create_rsa_challenger",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.quotesInvoices, hypothesis: "x", ...goodRsa("https://try.opsapp.co/quotes-invoices") },
      }),
      "NO_CONTROL_AD"
    );
  });

  it("URL_NOT_ALLOWED", () => {
    expectCode(
      run({
        kind: "add_ad_group",
        rationale: "",
        evidence: [],
        payload: {
          campaign: R.core,
          name: "Deck builder software",
          theme: "deck",
          final_url: "https://opsapp.co/plans",
          keywords: [
            { text: "deck builder software", matchType: "PHRASE" },
            { text: "deck contractor app", matchType: "EXACT" },
            { text: "deck job management", matchType: "PHRASE" },
          ],
          ads: [goodRsa("https://opsapp.co/plans")],
        },
      }),
      "URL_NOT_ALLOWED"
    );
    // A challenger must land on its own ad group's page.
    expectCode(
      run({
        kind: "create_rsa_challenger",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.crewScheduling, hypothesis: "x", ...goodRsa("https://try.opsapp.co/job-management") },
      }),
      "URL_NOT_ALLOWED"
    );
  });

  it("STRUCTURAL_LIMIT", () => {
    expectCode(
      run(
        {
          kind: "add_keywords",
          rationale: "",
          evidence: [],
          payload: { ad_group: R.jobManagement, terms: [{ text: "job tracking app", matchType: "PHRASE" }] },
        },
        { structuralAcceptedThisRun: 3 }
      ),
      "STRUCTURAL_LIMIT"
    );
  });

  it("DUPLICATE_PROPOSAL", () => {
    expectCode(
      run(
        { kind: "pause_keyword", rationale: "", evidence: [], payload: { criterion: R.kwJobManagementApp } },
        {
          openProposals: [
            { id: "x", kind: "pause_keyword", target: `keyword:${R.kwJobManagementApp}`, state: "proposed" },
          ],
        }
      ),
      "DUPLICATE_PROPOSAL"
    );
  });

  it("ALREADY_APPLIED", () => {
    expectCode(
      run({ ...negatives, payload: { ...negatives.payload, terms: [{ text: "jobs", matchType: "BROAD" }] } }),
      "ALREADY_APPLIED"
    );
    expectCode(
      run({ kind: "pause_ad", rationale: "", evidence: [], payload: { ad: R.pausedAd, reason: "x" } }),
      "ALREADY_APPLIED"
    );
    expectCode(
      run({
        kind: "add_ad_group",
        rationale: "",
        evidence: [],
        payload: {
          campaign: R.core,
          name: "Job management",
          theme: "job",
          final_url: "https://try.opsapp.co/job-management",
          keywords: [
            { text: "job app", matchType: "PHRASE" },
            { text: "job software", matchType: "EXACT" },
            { text: "job tracker", matchType: "PHRASE" },
          ],
          ads: [goodRsa("https://try.opsapp.co/job-management")],
        },
      }),
      "ALREADY_APPLIED"
    );
  });

  it("COPY_REJECTED carries the copy issues", () => {
    const candidate = goodRsa();
    candidate.headlines[2] = { text: "No training required!" };
    const result = expectCode(
      run({
        kind: "create_rsa_challenger",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.crewScheduling, hypothesis: "x", ...candidate },
      }),
      "COPY_REJECTED"
    );
    expect(result.issues.map((issue) => issue.code)).toContain("EXCLAMATION");
    expect(result.issues[0]?.field).toBe("headlines[2]");
  });

  it("keeps the trademark rule tied to the campaign the ad group belongs to", () => {
    const candidate = goodRsa("https://try.opsapp.co/compare/jobber");
    candidate.headlines[2] = { text: "Switching from Jobber?" };
    const ok = validateProposal(
      {
        kind: "create_rsa_challenger",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.jobberAlternative, hypothesis: "x", ...candidate },
      },
      context({ tests: [] })
    );
    expectOk(ok);
    const core = goodRsa();
    core.headlines[2] = { text: "Switching from Jobber?" };
    const rejected = expectCode(
      run({
        kind: "create_rsa_challenger",
        rationale: "",
        evidence: [],
        payload: { ad_group: R.crewScheduling, hypothesis: "x", ...core },
      }),
      "COPY_REJECTED"
    );
    expect(rejected.issues.map((issue) => issue.code)).toContain("TRADEMARK_CAMPAIGN");
  });

  it("filters terms already pending in an open negatives proposal instead of duplicating them", () => {
    const first = expectOk(run(negatives));
    const second = expectCode(
      run(negatives, {
        openProposals: [{ id: "x", kind: "add_negatives", target: first.target, state: "proposed" }],
      }),
      "DUPLICATE_PROPOSAL"
    );
    expect(second.issues[0]?.message).toMatch(/already waiting/i);
  });

  it("drops negatives that are already in the list and keeps the rest", () => {
    const normalized = expectOk(
      run({
        ...negatives,
        payload: {
          ...negatives.payload,
          terms: [
            { text: "jobs", matchType: "BROAD" },
            { text: "job management course", matchType: "PHRASE" },
          ],
        },
      })
    );
    expect(normalized.payload.terms).toEqual([{ text: "job management course", matchType: "PHRASE" }]);
  });

  it("uses the snapshot, never the payload, for the entities it acts on", () => {
    const tampered = snapshot();
    tampered.campaigns[0].dailyBudget = 100;
    const result = run(
      {
        kind: "adjust_budget",
        rationale: "",
        evidence: [],
        payload: { campaign: R.core, new_daily_amount: 36, reason: "x", currentDailyAmount: 32 },
      },
      { snapshot: tampered }
    );
    expectCode(result, "SCHEMA_INVALID");
  });
});
