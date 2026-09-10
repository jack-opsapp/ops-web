import { describe, expect, it } from "vitest";
import {
  BRAND_FACTS,
  validateRsa,
  type CopyContext,
  type CopyIssueCode,
  type RsaCandidate,
} from "@/lib/ads/copy-rules";

const core: CopyContext = {
  campaignKind: "core",
  allowedFinalUrls: ["https://try.opsapp.co/job-management"],
};
const competitor: CopyContext = {
  campaignKind: "competitor",
  allowedFinalUrls: ["https://try.opsapp.co/compare/jobber"],
};

function good(overrides: Partial<RsaCandidate> = {}): RsaCandidate {
  return {
    headlines: [
      { text: "Job management for trades", pinnedField: "HEADLINE_1" },
      { text: "Your crew opens it and goes", pinnedField: "HEADLINE_1" },
      { text: "No training required" },
      { text: "Built by trades, for trades" },
      { text: "Every feature, every tier" },
      { text: "Free to start" },
      { text: "Works offline in the field" },
      { text: "Schedule the whole crew" },
      { text: "Quotes and invoices in one" },
    ],
    descriptions: [
      { text: "One app your crew will actually use. No manual, no training." },
      { text: "Free to start. No credit card. Every feature on every tier." },
      { text: "Schedule jobs, track the crew and send invoices from the truck." },
    ],
    path1: "trades",
    path2: "jobs",
    finalUrl: "https://try.opsapp.co/job-management",
    ...overrides,
  };
}

function codes(candidate: RsaCandidate, ctx: CopyContext = core): CopyIssueCode[] {
  return validateRsa(candidate, ctx).map((issue) => issue.code);
}

describe("brand facts allowlist", () => {
  it("loads the versioned allowlist with the banned words from the copywriter brief", () => {
    expect(BRAND_FACTS.version).toBe("2026-09-09-v2");
    expect(BRAND_FACTS.bannedWords).toContain("seamless");
    expect(BRAND_FACTS.bannedWords).toContain("robust");
    expect(BRAND_FACTS.competitors.names).toEqual([
      "Jobber",
      "Housecall Pro",
      "ServiceTitan",
    ]);
  });
});

describe("validateRsa", () => {
  it("accepts a candidate that follows every rule", () => {
    expect(validateRsa(good(), core)).toEqual([]);
  });

  it("HEADLINE_TOO_LONG", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "This headline is far longer than thirty chars" };
    expect(codes(candidate)).toContain("HEADLINE_TOO_LONG");
  });

  it("DESCRIPTION_TOO_LONG", () => {
    const candidate = good();
    candidate.descriptions[0] = {
      text:
        "This description keeps going well past the ninety character limit that Google allows for a line.",
    };
    expect(codes(candidate)).toContain("DESCRIPTION_TOO_LONG");
  });

  it("TOO_FEW_HEADLINES and TOO_MANY_HEADLINES", () => {
    expect(codes(good({ headlines: good().headlines.slice(0, 7) }))).toContain(
      "TOO_FEW_HEADLINES"
    );
    const many = good().headlines.concat(
      ["Track every job", "Crew scheduling done", "Invoices out same day", "Runs on bad signal"].map(
        (text) => ({ text })
      )
    );
    expect(codes(good({ headlines: many }))).toContain("TOO_MANY_HEADLINES");
  });

  it("TOO_FEW_DESCRIPTIONS and TOO_MANY_DESCRIPTIONS", () => {
    expect(
      codes(good({ descriptions: good().descriptions.slice(0, 2) }))
    ).toContain("TOO_FEW_DESCRIPTIONS");
    const many = good().descriptions.concat([
      { text: "Photos, notes and tasks on every job." },
      { text: "Runs on the phone already in your pocket." },
    ]);
    expect(codes(good({ descriptions: many }))).toContain("TOO_MANY_DESCRIPTIONS");
  });

  it("DUPLICATE_ASSET catches exact and near duplicates after lowercasing", () => {
    const candidate = good();
    candidate.headlines[3] = { text: "no training required" };
    expect(codes(candidate)).toContain("DUPLICATE_ASSET");
    const near = good();
    near.headlines[3] = { text: "No training requird" };
    expect(codes(near)).toContain("DUPLICATE_ASSET");
  });

  it("EXCLAMATION", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "No training required!" };
    expect(codes(candidate)).toContain("EXCLAMATION");
  });

  it("EMOJI", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "No training required 🔧" };
    expect(codes(candidate)).toContain("EMOJI");
  });

  it("REPEATED_PUNCTUATION", () => {
    const candidate = good();
    candidate.descriptions[2] = { text: "Schedule jobs... track the crew... send invoices." };
    expect(codes(candidate)).toContain("REPEATED_PUNCTUATION");
  });

  it("ALL_CAPS lets OPS through and rejects other shouting", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "OPS runs the crew" };
    expect(codes(candidate)).not.toContain("ALL_CAPS");
    candidate.headlines[2] = { text: "STOP paying for nothing" };
    expect(codes(candidate)).toContain("ALL_CAPS");
  });

  it("BANNED_WORD matches whole words only", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "A seamless job app" };
    expect(codes(candidate)).toContain("BANNED_WORD");
    const clean = good();
    clean.headlines[2] = { text: "Platforms of trucks" };
    expect(codes(clean)).not.toContain("BANNED_WORD");
  });

  it("CONTRACTOR", () => {
    const candidate = good();
    candidate.descriptions[1] = { text: "Contractors run their week from one app." };
    expect(codes(candidate)).toContain("CONTRACTOR");
  });

  it("LEADS_WITH_AI", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "AI schedules your crew" };
    expect(codes(candidate)).toContain("LEADS_WITH_AI");
    const fine = good();
    fine.headlines[2] = { text: "Built for the trades, not AI" };
    expect(codes(fine)).not.toContain("LEADS_WITH_AI");
  });

  it("UNSUPPORTED_NUMBER rejects any figure outside the allowlist", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "Save 12 hours a week" };
    expect(codes(candidate)).toContain("UNSUPPORTED_NUMBER");
    const fine = good();
    fine.headlines[2] = { text: "From $90 a month" };
    expect(codes(fine)).not.toContain("UNSUPPORTED_NUMBER");
  });

  it("TRADEMARK_CAMPAIGN keeps competitor names out of core and brand", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "Jobber alternative" };
    expect(codes(candidate, core)).toContain("TRADEMARK_CAMPAIGN");
  });

  it("TRADEMARK_FORM allows only the sanctioned forms in the competitor campaign", () => {
    const candidate = good({
      finalUrl: "https://try.opsapp.co/compare/jobber",
    });
    candidate.headlines[2] = { text: "Jobber alternative" };
    candidate.headlines[3] = { text: "Switching from Jobber?" };
    expect(codes(candidate, competitor)).not.toContain("TRADEMARK_FORM");
    expect(codes(candidate, competitor)).not.toContain("TRADEMARK_CAMPAIGN");
    candidate.headlines[4] = { text: "Better than Jobber" };
    expect(codes(candidate, competitor)).toContain("TRADEMARK_FORM");
  });

  it("URL_NOT_ALLOWED", () => {
    expect(codes(good({ finalUrl: "https://opsapp.co/plans" }))).toContain(
      "URL_NOT_ALLOWED"
    );
  });

  it("PATH_TOO_LONG", () => {
    expect(codes(good({ path1: "sixteencharacters" }))).toContain("PATH_TOO_LONG");
  });

  it("PIN_PLAN requires two or three headlines on position one and nothing else pinned", () => {
    const one = good();
    one.headlines[1] = { text: one.headlines[1].text };
    expect(codes(one)).toContain("PIN_PLAN");
    const four = good();
    four.headlines[2] = { ...four.headlines[2], pinnedField: "HEADLINE_1" };
    four.headlines[3] = { ...four.headlines[3], pinnedField: "HEADLINE_1" };
    expect(codes(four)).toContain("PIN_PLAN");
    const elsewhere = good();
    elsewhere.headlines[2] = { ...elsewhere.headlines[2], pinnedField: "HEADLINE_2" };
    expect(codes(elsewhere)).toContain("PIN_PLAN");
    const description = good();
    description.descriptions[0] = {
      ...description.descriptions[0],
      pinnedField: "DESCRIPTION_1",
    };
    expect(codes(description)).toContain("PIN_PLAN");
  });

  it("names the field every issue belongs to", () => {
    const candidate = good();
    candidate.headlines[2] = { text: "Save 12 hours a week!" };
    const issues = validateRsa(candidate, core);
    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["headlines[2]"])
    );
    for (const issue of issues) expect(issue.message.length).toBeGreaterThan(8);
  });
});
