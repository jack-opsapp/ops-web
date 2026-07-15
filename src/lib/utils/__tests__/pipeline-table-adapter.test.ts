/**
 * Tests for the opportunity → pipeline-table-row adapter.
 *
 * All time-dependent assertions use a FIXED clock (`NOW`) — never `Date.now()`
 * — so age/aging/overdue derivations are deterministic regardless of when the
 * suite runs.
 */

import { describe, it, expect } from "vitest";

import {
  OpportunityStage,
  OpportunitySource,
  OpportunityPriority,
  PIPELINE_STAGES_DEFAULT,
  type Opportunity,
  type PipelineStageConfig,
} from "@/lib/types/pipeline";

import {
  weightedValue,
  ageInStageDays,
  resolveWinProbability,
  isRotting,
  isSevereRotting,
  isFollowUpOverdue,
  isCloseOverdue,
  canConvertOpportunity,
  mapOpportunityToTableRow,
} from "@/lib/utils/pipeline-table-adapter";

// ─── Fixed clock ──────────────────────────────────────────────────────────────

/** Fixed "now". Every time-dependent test derives offsets from this. */
const NOW = new Date("2026-05-31T12:00:00.000Z");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A Date `days` whole days before NOW (preserves the 12:00:00Z wall time). */
function daysBeforeNow(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

/** A Date `days` whole days after NOW. */
function daysAfterNow(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Build a fully-populated `Opportunity` with sensible defaults that individual
 * tests override. Keeps each test focused on the field(s) under exercise.
 */
function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    companyId: "co-1",
    clientId: "client-1",
    title: "Re-roof — 42 Maple St",
    description: null,
    contactName: "Dana Reyes",
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoting,
    source: OpportunitySource.Referral,
    assignedTo: "user-1",
    priority: OpportunityPriority.High,
    estimatedValue: 50000,
    actualValue: null,
    winProbability: 40,
    expectedCloseDate: null,
    actualCloseDate: null,
    stageEnteredAt: daysBeforeNow(10),
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: null,
    latitude: null,
    longitude: null,
    sourceEmailId: null,
    correspondenceCount: 7,
    outboundCount: 4,
    inboundCount: 3,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastMessageDirection: null,
    aiSummary: null,
    aiStageConfidence: null,
    aiStageSignals: null,
    detectedValue: null,
    lastActivityAt: daysBeforeNow(2),
    nextFollowUpAt: null,
    tags: [],
    images: [],
    createdAt: daysBeforeNow(30),
    updatedAt: daysBeforeNow(1),
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Build a `PipelineStageConfig` for a given slug with overridable
 * `defaultWinProbability` / `staleThresholdDays`.
 */
function makeStageConfig(
  overrides: Partial<PipelineStageConfig> & { slug: string },
): PipelineStageConfig {
  return {
    id: `cfg-${overrides.slug}`,
    companyId: "co-1",
    name: overrides.slug,
    color: "#C4A868",
    icon: null,
    sortOrder: 0,
    isDefault: true,
    isWonStage: false,
    isLostStage: false,
    defaultWinProbability: 20,
    autoFollowUpDays: null,
    autoFollowUpType: null,
    staleThresholdDays: 7,
    createdAt: null,
    deletedAt: null,
    ...overrides,
  };
}

// ─── weightedValue ────────────────────────────────────────────────────────────

describe("weightedValue", () => {
  it("computes value × probability / 100", () => {
    expect(weightedValue(50000, 50)).toBe(25000);
  });

  it("returns null when estimatedValue is null", () => {
    expect(weightedValue(null, 50)).toBeNull();
  });

  it("returns 0 at 0% probability", () => {
    expect(weightedValue(50000, 0)).toBe(0);
  });

  it("treats a null probability as 0%", () => {
    expect(weightedValue(50000, null)).toBe(0);
  });

  it("returns null when estimatedValue is null even with null probability", () => {
    expect(weightedValue(null, null)).toBeNull();
  });
});

// ─── resolveWinProbability ────────────────────────────────────────────────────

describe("resolveWinProbability", () => {
  it("uses the deal-level probability when set, overriding the stage default", () => {
    const opp = makeOpportunity({
      stage: OpportunityStage.Quoting,
      winProbability: 80,
    });
    const cfg = makeStageConfig({ slug: "quoting", defaultWinProbability: 20 });

    expect(resolveWinProbability(opp, cfg)).toEqual({
      value: 80,
      isFallback: false,
    });
  });

  it("falls back to the stage default when the deal probability is 0", () => {
    const opp = makeOpportunity({
      stage: OpportunityStage.Quoting,
      winProbability: 0,
    });
    const cfg = makeStageConfig({ slug: "quoting", defaultWinProbability: 35 });

    expect(resolveWinProbability(opp, cfg)).toEqual({
      value: 35,
      isFallback: true,
    });
  });

  it("falls back to PIPELINE_STAGES_DEFAULT when no stage config is provided", () => {
    const opp = makeOpportunity({
      stage: OpportunityStage.Quoting,
      winProbability: 0,
    });
    const fallback = PIPELINE_STAGES_DEFAULT.find(
      (s) => s.slug === "quoting",
    )!.winProbability;

    expect(resolveWinProbability(opp, undefined)).toEqual({
      value: fallback,
      isFallback: true,
    });
    // Sanity: the constant for "quoting" is 40 at time of writing.
    expect(fallback).toBe(40);
  });

  it("resolves to 0 (fallback) when neither deal, stage config, nor a default exists for the slug", () => {
    // Force an unknown slug by casting; the adapter must not throw.
    const opp = makeOpportunity({
      stage: "totally_unknown_stage" as OpportunityStage,
      winProbability: 0,
    });

    expect(resolveWinProbability(opp, undefined)).toEqual({
      value: 0,
      isFallback: true,
    });
  });
});

// ─── ageInStageDays ───────────────────────────────────────────────────────────

describe("ageInStageDays", () => {
  it("floors the whole-day difference since stageEnteredAt", () => {
    expect(ageInStageDays(daysBeforeNow(10), NOW)).toBe(10);
  });

  it("returns 0 when entered the same instant", () => {
    expect(ageInStageDays(NOW, NOW)).toBe(0);
  });

  it("floors a partial day down (10.5 days → 10)", () => {
    const tenAndHalf = new Date(NOW.getTime() - 10.5 * MS_PER_DAY);
    expect(ageInStageDays(tenAndHalf, NOW)).toBe(10);
  });

  it("accepts an ISO string for stageEnteredAt", () => {
    expect(ageInStageDays(daysBeforeNow(3).toISOString(), NOW)).toBe(3);
  });

  it("returns null when there is no stageEnteredAt", () => {
    expect(ageInStageDays(null, NOW)).toBeNull();
  });
});

// ─── isRotting ────────────────────────────────────────────────────────────────

describe("isRotting", () => {
  it("is true exactly at the threshold", () => {
    expect(isRotting(7, 7)).toBe(true);
  });

  it("is true past the threshold", () => {
    expect(isRotting(9, 7)).toBe(true);
  });

  it("is false one day below the threshold", () => {
    expect(isRotting(6, 7)).toBe(false);
  });

  it("is false when age is null", () => {
    expect(isRotting(null, 7)).toBe(false);
  });

  it("is false when threshold is null", () => {
    expect(isRotting(9, null)).toBe(false);
  });
});

// ─── isSevereRotting ──────────────────────────────────────────────────────────

describe("isSevereRotting", () => {
  it("is true exactly at 2× the threshold", () => {
    expect(isSevereRotting(14, 7)).toBe(true);
  });

  it("is true past 2× the threshold", () => {
    expect(isSevereRotting(20, 7)).toBe(true);
  });

  it("is false just under 2× the threshold", () => {
    expect(isSevereRotting(13, 7)).toBe(false);
  });

  it("is false when age is null", () => {
    expect(isSevereRotting(null, 7)).toBe(false);
  });

  it("is false when threshold is null", () => {
    expect(isSevereRotting(20, null)).toBe(false);
  });
});

// ─── isFollowUpOverdue ────────────────────────────────────────────────────────

describe("isFollowUpOverdue", () => {
  it("is true for a past follow-up on an active stage", () => {
    expect(
      isFollowUpOverdue(daysBeforeNow(1), OpportunityStage.Quoting, NOW),
    ).toBe(true);
  });

  it("is false for a future follow-up", () => {
    expect(
      isFollowUpOverdue(daysAfterNow(1), OpportunityStage.Quoting, NOW),
    ).toBe(false);
  });

  it("is false on a Won stage even when the date is past", () => {
    expect(
      isFollowUpOverdue(daysBeforeNow(5), OpportunityStage.Won, NOW),
    ).toBe(false);
  });

  it("is false on a Lost stage even when the date is past", () => {
    expect(
      isFollowUpOverdue(daysBeforeNow(5), OpportunityStage.Lost, NOW),
    ).toBe(false);
  });

  it("is false on a Discarded stage even when the date is past", () => {
    expect(
      isFollowUpOverdue(daysBeforeNow(5), OpportunityStage.Discarded, NOW),
    ).toBe(false);
  });

  it("is false when there is no follow-up date", () => {
    expect(isFollowUpOverdue(null, OpportunityStage.Quoting, NOW)).toBe(false);
  });

  it("accepts an ISO string for the date", () => {
    expect(
      isFollowUpOverdue(
        daysBeforeNow(2).toISOString(),
        OpportunityStage.Negotiation,
        NOW,
      ),
    ).toBe(true);
  });
});

// ─── isCloseOverdue ───────────────────────────────────────────────────────────

describe("isCloseOverdue", () => {
  it("is true for a past expected-close on an active stage", () => {
    expect(
      isCloseOverdue(daysBeforeNow(1), OpportunityStage.Quoting, NOW),
    ).toBe(true);
  });

  it("is false for a future expected-close", () => {
    expect(
      isCloseOverdue(daysAfterNow(3), OpportunityStage.Quoting, NOW),
    ).toBe(false);
  });

  it("is false on a Won stage even when the date is past", () => {
    expect(
      isCloseOverdue(daysBeforeNow(5), OpportunityStage.Won, NOW),
    ).toBe(false);
  });

  it("is false on a Lost stage even when the date is past", () => {
    expect(
      isCloseOverdue(daysBeforeNow(5), OpportunityStage.Lost, NOW),
    ).toBe(false);
  });

  it("is false on a Discarded stage even when the date is past", () => {
    expect(
      isCloseOverdue(daysBeforeNow(5), OpportunityStage.Discarded, NOW),
    ).toBe(false);
  });

  it("is false when there is no expected-close date", () => {
    expect(isCloseOverdue(null, OpportunityStage.Quoting, NOW)).toBe(false);
  });
});

// ─── mapOpportunityToTableRow ─────────────────────────────────────────────────

describe("mapOpportunityToTableRow", () => {
  it("maps a representative opportunity into a full table row", () => {
    const stageEnteredAt = daysBeforeNow(10);
    const lastActivityAt = daysBeforeNow(2);
    const nextFollowUpAt = daysBeforeNow(1);
    const expectedCloseDate = daysAfterNow(14);
    const updatedAt = daysBeforeNow(1);

    const opp = makeOpportunity({
      id: "opp-42",
      companyId: "co-9",
      title: "Re-roof — 42 Maple St",
      stage: OpportunityStage.Quoting,
      clientId: "client-7",
      estimatedValue: 50000,
      winProbability: 0, // forces stage-config fallback
      assignedTo: "user-3",
      source: OpportunitySource.Referral,
      priority: OpportunityPriority.High,
      correspondenceCount: 7,
      stageEnteredAt,
      lastActivityAt,
      nextFollowUpAt,
      expectedCloseDate,
      projectId: "proj-2",
      updatedAt,
    });

    const stageConfigBySlug = new Map<string, PipelineStageConfig>([
      ["quoting", makeStageConfig({ slug: "quoting", defaultWinProbability: 35, staleThresholdDays: 5 })],
    ]);
    const clientNameMap = new Map<string, string>([["client-7", "Maple Holdings"]]);
    const assigneeNameMap = new Map<string, string>([["user-3", "Sam Okafor"]]);

    const row = mapOpportunityToTableRow(opp, {
      clientNameMap,
      assigneeNameMap,
      stageConfigBySlug,
      now: NOW,
    });

    // Identity / passthrough
    expect(row.id).toBe("opp-42");
    expect(row.companyId).toBe("co-9");
    expect(row.title).toBe("Re-roof — 42 Maple St");
    expect(row.stage).toBe(OpportunityStage.Quoting);
    expect(row.clientId).toBe("client-7");
    expect(row.assignedTo).toBe("user-3");
    expect(row.projectId).toBe("proj-2");
    expect(row.correspondenceCount).toBe(7);

    // Joined names
    expect(row.clientName).toBe("Maple Holdings");
    expect(row.assigneeName).toBe("Sam Okafor");

    // Enum string values
    expect(row.source).toBe("referral");
    expect(row.priority).toBe("high");

    // Win probability resolution (deal=0 → stage default 35, fallback)
    expect(row.winProbability).toBe(35);
    expect(row.winProbabilityIsFallback).toBe(true);

    // Forecast: 50000 × 35% = 17500
    expect(row.weightedValue).toBe(17500);
    expect(row.estimatedValue).toBe(50000);

    // Aging
    expect(row.ageInStageDays).toBe(10);
    expect(row.staleThresholdDays).toBe(5);

    // Dates → ISO strings
    expect(row.stageEnteredAt).toBe(stageEnteredAt.toISOString());
    expect(row.lastActivityAt).toBe(lastActivityAt.toISOString());
    expect(row.nextFollowUpAt).toBe(nextFollowUpAt.toISOString());
    expect(row.expectedCloseDate).toBe(expectedCloseDate.toISOString());
    expect(row.updatedAt).toBe(updatedAt.toISOString());
  });

  it("uses the deal-level probability when present (no fallback)", () => {
    const opp = makeOpportunity({
      stage: OpportunityStage.Negotiation,
      estimatedValue: 20000,
      winProbability: 75,
    });
    const stageConfigBySlug = new Map<string, PipelineStageConfig>([
      ["negotiation", makeStageConfig({ slug: "negotiation", defaultWinProbability: 50 })],
    ]);

    const row = mapOpportunityToTableRow(opp, {
      clientNameMap: new Map(),
      assigneeNameMap: new Map(),
      stageConfigBySlug,
      now: NOW,
    });

    expect(row.winProbability).toBe(75);
    expect(row.winProbabilityIsFallback).toBe(false);
    // 20000 × 75% = 15000
    expect(row.weightedValue).toBe(15000);
  });

  it("null-safely handles missing dates, names, stage config, value, source, and priority", () => {
    const opp = makeOpportunity({
      clientId: null,
      assignedTo: null,
      estimatedValue: null,
      source: null,
      priority: null,
      winProbability: 0,
      stage: OpportunityStage.NewLead,
      lastActivityAt: null,
      nextFollowUpAt: null,
      expectedCloseDate: null,
    });

    const row = mapOpportunityToTableRow(opp, {
      clientNameMap: new Map(),
      assigneeNameMap: new Map(),
      stageConfigBySlug: new Map(), // no config for new_lead
      now: NOW,
    });

    expect(row.clientId).toBeNull();
    expect(row.clientName).toBeNull();
    expect(row.assignedTo).toBeNull();
    expect(row.assigneeName).toBeNull();
    expect(row.estimatedValue).toBeNull();
    expect(row.weightedValue).toBeNull(); // null value → null weighted
    expect(row.source).toBeNull();
    expect(row.priority).toBeNull();
    expect(row.lastActivityAt).toBeNull();
    expect(row.nextFollowUpAt).toBeNull();
    expect(row.expectedCloseDate).toBeNull();

    // No stage config → staleThresholdDays null, win prob falls back to the
    // PIPELINE_STAGES_DEFAULT constant for new_lead (10), flagged as fallback.
    expect(row.staleThresholdDays).toBeNull();
    expect(row.winProbability).toBe(10);
    expect(row.winProbabilityIsFallback).toBe(true);

    // stageEnteredAt is always present on the model.
    expect(row.stageEnteredAt).toBe(opp.stageEnteredAt.toISOString());
  });
});

describe("canConvertOpportunity", () => {
  it("is true for a won deal that has not been converted", () => {
    expect(
      canConvertOpportunity({ stage: OpportunityStage.Won, projectId: null }),
    ).toBe(true);
  });

  it("is false for a won deal that already has a project (already converted)", () => {
    expect(
      canConvertOpportunity({
        stage: OpportunityStage.Won,
        projectId: "project-123",
      }),
    ).toBe(false);
  });

  it("is false for every non-won stage, even without a project", () => {
    const nonWonStages = [
      OpportunityStage.NewLead,
      OpportunityStage.Qualifying,
      OpportunityStage.Quoting,
      OpportunityStage.Quoted,
      OpportunityStage.FollowUp,
      OpportunityStage.Negotiation,
      OpportunityStage.Lost,
      OpportunityStage.Discarded,
    ];
    for (const stage of nonWonStages) {
      expect(canConvertOpportunity({ stage, projectId: null })).toBe(false);
    }
  });

  it("treats only a strictly-null projectId as not-yet-converted", () => {
    // An empty-string id still means a project exists — never offer convert.
    expect(
      canConvertOpportunity({ stage: OpportunityStage.Won, projectId: "" }),
    ).toBe(false);
  });
});
