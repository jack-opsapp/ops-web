import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  SALES_TRUTH_PROMPT_SAFETY_DIRECTIVE,
  SALES_TRUTH_WINDOW_DAYS,
  SalesTruthResultSchema,
  type SalesTruthSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/sales-truth";
import {
  analyzeSalesTruthSnapshot,
  createSalesTruthService,
  SalesTruthReadError,
} from "../sales-truth-service";
import {
  createSalesTruthRepository,
  type SalesTruthRpcClient,
} from "../sales-truth-repository";
import {
  SALES_TRUTH_PERMISSIONS,
  salesTruthActorFixture,
  salesTruthAuthority,
  salesTruthSourceFixture,
} from "./fixtures";

const observedAt = "2026-09-01T12:00:00.000Z";

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function minutesAfter(base: string, minutes: number): string {
  return new Date(Date.parse(base) + minutes * 60_000).toISOString();
}

function completeSnapshot(): SalesTruthSourceSnapshot {
  const opportunities: SalesTruthSourceSnapshot["opportunities"] = [];
  const transitions: SalesTruthSourceSnapshot["transitions"] = [];
  const dispositions: SalesTruthSourceSnapshot["dispositions"] = [];
  const activities: SalesTruthSourceSnapshot["activities"] = [];

  for (let index = 1; index <= 35; index += 1) {
    const stage =
      index <= 15
        ? ("won" as const)
        : index <= 25
          ? ("lost" as const)
          : index <= 30
            ? ("negotiation" as const)
            : index <= 33
              ? ("new_lead" as const)
              : ("discarded" as const);
    const source =
      index <= 15
        ? ("referral" as const)
        : index <= 25
          ? ("website" as const)
          : index <= 30
            ? ("email" as const)
            : ("other" as const);
    const opportunityId = uuid(index);
    const createdAt = "2026-08-01T12:00:00.000Z";
    opportunities.push({
      id: opportunityId,
      created_at: createdAt,
      stage,
      source,
      legacy_loss_reason: null,
    });
    activities.push(
      {
        id: uuid(1_000 + index * 2),
        opportunity_id: opportunityId,
        direction: "inbound",
        type: "email",
        occurred_at: minutesAfter(createdAt, 60),
      },
      {
        id: uuid(1_001 + index * 2),
        opportunity_id: opportunityId,
        direction: "outbound",
        type: "email",
        occurred_at: minutesAfter(createdAt, 120),
      }
    );
    if (index <= 30) {
      transitions.push({
        id: uuid(2_000 + index * 2),
        opportunity_id: opportunityId,
        from_stage: "new_lead",
        to_stage: "quoted",
        transitioned_at: minutesAfter(createdAt, 1_440),
        duration_minutes: 1_440,
      });
      transitions.push({
        id: uuid(2_001 + index * 2),
        opportunity_id: opportunityId,
        from_stage: "quoted",
        to_stage: stage,
        transitioned_at: minutesAfter(createdAt, 4_320),
        duration_minutes: 2_880,
      });
    }
    if (index > 15 && index <= 25) {
      dispositions.push({
        id: uuid(3_000 + index),
        opportunity_id: opportunityId,
        reason_code: "Price",
        created_at: minutesAfter(createdAt, 4_321),
      });
    }
  }

  return {
    observed_at: observedAt,
    business_date: "2026-09-01",
    context: {
      timezone: "America/Vancouver",
      currency_code: "CAD",
    },
    window: {
      starts_on: "2026-03-06",
      ends_on: "2026-09-01",
      days: SALES_TRUTH_WINDOW_DAYS,
    },
    source_revisions: { company: 9, sales_truth: 41 },
    source_counts: {
      opportunities: opportunities.length,
      transitions: transitions.length,
      dispositions: dispositions.length,
      activities: activities.length,
    },
    source_bounds: {
      opportunities: false,
      transitions: false,
      dispositions: false,
      activities: false,
    },
    opportunities,
    transitions,
    dispositions,
    activities,
  };
}

describe("sales-truth analysis", () => {
  it("calculates the versioned golden-task metrics and ranks evidence-backed repairs", () => {
    const result = analyzeSalesTruthSnapshot(completeSnapshot());

    expect(SalesTruthResultSchema.parse(result)).toEqual(result);
    expect(result.population).toEqual({
      cohort_count: 35,
      qualified_count: 30,
      resolved_count: 25,
      won_count: 15,
      lost_count: 10,
      open_qualified_count: 5,
      new_lead_count: 3,
      discarded_count: 2,
    });
    expect(result.close_rate).toMatchObject({
      state: "usable",
      numerator_won: 15,
      denominator_resolved: 25,
      rate_pct: 60,
      unresolved_sensitivity_pct: { low: 50, high: 66.67 },
      confidence: "medium",
    });
    expect(result.close_rate.wilson_95_pct).toEqual({
      low: 40.74,
      high: 76.6,
    });
    expect(
      result.attribution.segments.find(
        (segment) => segment.source === "website"
      )
    ).toMatchObject({
      cohort_count: 10,
      lost_count: 10,
      resolved_close_rate_pct: 0,
      confidence: "low",
    });
    expect(result.loss_reasons).toMatchObject({
      lost_count: 10,
      observed_count: 10,
      structured_count: 10,
      coverage_pct: 100,
      confidence: "low",
      categories: [{ category: "price", count: 10, share_pct: 100 }],
    });
    expect(result.first_response).toMatchObject({
      cohort_count: 35,
      linked_lead_count: 35,
      inbound_observed_count: 35,
      responded_count: 35,
      response_coverage_pct: 100,
      median_minutes: 60,
      p75_minutes: 60,
      confidence: "high",
    });
    expect(result.pipeline_velocity).toMatchObject({
      qualified_count: 30,
      history_observed_count: 30,
      history_coverage_pct: 100,
      qualification_to_close: {
        sample_count: 25,
        median_minutes: 2_880,
        p75_minutes: 2_880,
        confidence: "medium",
      },
    });
    expect(result.recommendations.map((item) => item.code)).toEqual([
      "review_top_loss_reason",
      "review_underperforming_source",
      "clear_stage_bottleneck",
    ]);
    expect(result.recommendations.every((item) => !item.causal_claim)).toBe(
      true
    );
    expect(result.prompt_safety.directive).toBe(
      SALES_TRUTH_PROMPT_SAFETY_DIRECTIVE
    );
  });

  it("fails bounded source populations closed before reporting performance", () => {
    const snapshot = completeSnapshot();
    const bounded = {
      ...snapshot,
      source_counts: { ...snapshot.source_counts, activities: 20_001 },
      source_bounds: { ...snapshot.source_bounds, activities: true },
      activities: snapshot.activities.concat(
        Array.from(
          { length: 20_000 - snapshot.activities.length },
          (_, index) => ({
            id: uuid(10_000 + index),
            opportunity_id: snapshot.opportunities[0]!.id,
            direction: "inbound" as const,
            type: "email" as const,
            occurred_at: "2026-08-02T12:00:00.000Z",
          })
        )
      ),
    };

    const result = analyzeSalesTruthSnapshot(bounded);

    expect(result.completeness.state).toBe("insufficient");
    expect(result.completeness.reasons).toContain("source_bound_reached");
    expect(result.close_rate.state).toBe("insufficient");
    expect(
      result.attribution.segments.every(
        (segment) =>
          segment.confidence === "insufficient" &&
          segment.resolved_close_rate_pct === null
      )
    ).toBe(true);
    expect(result.loss_reasons.confidence).toBe("insufficient");
    expect(result.first_response).toMatchObject({
      median_minutes: null,
      p75_minutes: null,
      confidence: "insufficient",
    });
    expect(result.pipeline_velocity.qualification_to_close).toMatchObject({
      median_minutes: null,
      p75_minutes: null,
      confidence: "insufficient",
      supporting_record_refs: [],
    });
    expect(
      result.pipeline_velocity.stages.every(
        (stage) =>
          stage.confidence === "insufficient" &&
          stage.median_minutes === null &&
          stage.p75_minutes === null &&
          stage.supporting_record_refs.length === 0
      )
    ).toBe(true);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      rank: 1,
      code: "repair_source_coverage",
      causal_claim: false,
    });
  });

  it("prioritizes missing outcome detail and history instead of inventing a cause", () => {
    const snapshot = completeSnapshot();
    const sparse = {
      ...snapshot,
      dispositions: [],
      transitions: snapshot.transitions.slice(0, 4),
      activities: [],
      source_counts: {
        ...snapshot.source_counts,
        dispositions: 0,
        transitions: 4,
        activities: 0,
      },
    };

    const result = analyzeSalesTruthSnapshot(sparse);

    expect(result.completeness.state).toBe("partial");
    expect(result.loss_reasons).toMatchObject({
      observed_count: 0,
      missing_count: 10,
      coverage_pct: 0,
      confidence: "insufficient",
    });
    expect(result.pipeline_velocity.history_coverage_pct).toBe(6.67);
    expect(result.recommendations.map((item) => item.code)).toEqual([
      "capture_loss_reasons",
      "repair_stage_history",
      "repair_correspondence_linkage",
    ]);
  });

  it("returns insufficient duration metrics when ten samples have low coverage", () => {
    const snapshot = completeSnapshot();
    const transitions = snapshot.transitions.slice(0, 20);

    const result = analyzeSalesTruthSnapshot({
      ...snapshot,
      transitions,
      source_counts: { ...snapshot.source_counts, transitions: 20 },
    });

    expect(result.pipeline_velocity.history_coverage_pct).toBe(33.33);
    expect(result.pipeline_velocity.qualification_to_close).toMatchObject({
      sample_count: 10,
      coverage_pct: 40,
      median_minutes: null,
      p75_minutes: null,
      confidence: "insufficient",
    });
    expect(
      result.pipeline_velocity.stages.every(
        (stage) => stage.confidence === "insufficient"
      )
    ).toBe(true);
  });

  it("keeps every open-stage bottleneck reference in the evidence registry", () => {
    const snapshot = completeSnapshot();
    const intermediate = snapshot.opportunities
      .slice(0, 10)
      .map((item, index) => ({
        id: uuid(8_000 + index),
        opportunity_id: item.id,
        from_stage: "follow_up" as const,
        to_stage: "negotiation" as const,
        transitioned_at: minutesAfter(item.created_at, 2_880),
        duration_minutes: 10_000,
      }));
    const transitions = [...snapshot.transitions, ...intermediate];

    const result = analyzeSalesTruthSnapshot({
      ...snapshot,
      transitions,
      source_counts: {
        ...snapshot.source_counts,
        transitions: transitions.length,
      },
    });

    const bottleneck = result.recommendations.find(
      (item) => item.code === "clear_stage_bottleneck"
    );
    expect(bottleneck?.basis.metric).toBe("median_stage_minutes_follow_up");
    expect(bottleneck?.supporting_record_refs.length).toBeGreaterThan(0);
    const evidence = new Set(
      result.supporting_records.map((item) => item.source_ref)
    );
    expect(
      bottleneck?.supporting_record_refs.every((reference) =>
        evidence.has(reference)
      )
    ).toBe(true);
  });

  it("cites only the observations that contribute to each recommended metric", () => {
    const snapshot = completeSnapshot();
    const nonLeadingDisposition = {
      ...snapshot.dispositions[0]!,
      reason_code: "Timing",
    };
    const dispositions = [
      nonLeadingDisposition,
      ...snapshot.dispositions.slice(1),
    ];
    const unresolvedWebsiteLead = {
      ...snapshot.opportunities[25]!,
      source: "website" as const,
    };
    const opportunities = [
      unresolvedWebsiteLead,
      ...snapshot.opportunities.filter(
        (opportunity) => opportunity.id !== unresolvedWebsiteLead.id
      ),
    ];
    const nullDurationStageExit = {
      id: uuid(9_000),
      opportunity_id: snapshot.opportunities[0]!.id,
      from_stage: "quoted" as const,
      to_stage: "negotiation" as const,
      transitioned_at: minutesAfter(
        snapshot.opportunities[0]!.created_at,
        2_000
      ),
      duration_minutes: null,
    };

    const result = analyzeSalesTruthSnapshot({
      ...snapshot,
      opportunities,
      dispositions,
      transitions: [nullDurationStageExit, ...snapshot.transitions],
      source_counts: {
        ...snapshot.source_counts,
        transitions: snapshot.transitions.length + 1,
      },
    });

    const topLoss = result.recommendations.find(
      (item) => item.code === "review_top_loss_reason"
    );
    const weakSource = result.recommendations.find(
      (item) => item.code === "review_underperforming_source"
    );
    const bottleneck = result.recommendations.find(
      (item) => item.code === "clear_stage_bottleneck"
    );

    expect(topLoss?.supporting_record_refs).not.toContain(
      `opportunity_disposition:${nonLeadingDisposition.id}`
    );
    expect(weakSource?.supporting_record_refs).not.toContain(
      `opportunity:${unresolvedWebsiteLead.id}`
    );
    expect(bottleneck?.supporting_record_refs).not.toContain(
      `stage_transition:${nullDurationStageExit.id}`
    );
  });

  it("does not prescribe coverage repair when only sample size is small", () => {
    const snapshot = completeSnapshot();
    const retainedIds = new Set([
      ...snapshot.opportunities.slice(0, 4).map((item) => item.id),
      snapshot.opportunities[15]!.id,
    ]);
    const opportunities = snapshot.opportunities.filter((item) =>
      retainedIds.has(item.id)
    );
    const transitions = snapshot.transitions.filter((item) =>
      retainedIds.has(item.opportunity_id)
    );
    const dispositions = snapshot.dispositions.filter((item) =>
      retainedIds.has(item.opportunity_id)
    );
    const activities = snapshot.activities.filter((item) =>
      retainedIds.has(item.opportunity_id)
    );

    const result = analyzeSalesTruthSnapshot({
      ...snapshot,
      opportunities,
      transitions,
      dispositions,
      activities,
      source_counts: {
        opportunities: opportunities.length,
        transitions: transitions.length,
        dispositions: dispositions.length,
        activities: activities.length,
      },
    });

    expect(result.loss_reasons.coverage_pct).toBe(100);
    expect(result.first_response.linkage_coverage_pct).toBe(100);
    expect(result.first_response.response_coverage_pct).toBe(100);
    expect(result.recommendations.map((item) => item.code)).not.toContain(
      "capture_loss_reasons"
    );
    expect(result.recommendations.map((item) => item.code)).not.toContain(
      "repair_correspondence_linkage"
    );
  });

  it("uses observed loss reasons as the leading-reason denominator", () => {
    const snapshot = completeSnapshot();
    const reasons = [
      "Price",
      "Price",
      "Price",
      "Price",
      "Timing",
      "Timing",
      "Timing",
      "Other",
      "Other",
      "Other",
    ];
    const opportunities = snapshot.opportunities.map((item, index) =>
      index < 10 ? { ...item, stage: "lost" as const } : item
    );
    const dispositions = snapshot.dispositions.map((item, index) => ({
      ...item,
      reason_code: reasons[index]!,
    }));

    const result = analyzeSalesTruthSnapshot({
      ...snapshot,
      opportunities,
      dispositions,
      source_counts: {
        ...snapshot.source_counts,
        dispositions: dispositions.length,
      },
    });

    expect(result.loss_reasons.coverage_pct).toBe(50);
    expect(result.recommendations.map((item) => item.code)).toContain(
      "review_top_loss_reason"
    );
    expect(
      result.recommendations.find(
        (item) => item.code === "review_top_loss_reason"
      )?.basis.observed_value
    ).toBe(40);
  });

  it("names response coverage when linkage is healthy but replies are missing", () => {
    const snapshot = completeSnapshot();
    const activities = snapshot.activities.filter(
      (item, index) => item.direction === "inbound" || index < 30
    );

    const result = analyzeSalesTruthSnapshot({
      ...snapshot,
      activities,
      source_counts: {
        ...snapshot.source_counts,
        activities: activities.length,
      },
    });

    expect(result.first_response.linkage_coverage_pct).toBe(100);
    expect(result.first_response.response_coverage_pct).toBeLessThan(70);
    expect(
      result.recommendations.find(
        (item) => item.code === "repair_correspondence_linkage"
      )?.basis.metric
    ).toBe("response_coverage_pct");
  });
});

describe("sales-truth service", () => {
  it("reauthorizes immediately before one bounded read", async () => {
    const { actor, authorityClient } = await salesTruthActorFixture();
    const source = salesTruthSourceFixture();
    const rpc = vi.fn<SalesTruthRpcClient["rpc"]>(() =>
      Promise.resolve({ data: source, error: null })
    );
    const signal = new AbortController().signal;
    const service = createSalesTruthService({
      repository: createSalesTruthRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    const lookupsBefore = authorityClient.actorLookups.length;

    const result = await service.analyzeSalesTruth(actor, {}, { signal });

    expect(result.observed_at).toBe(source.observed_at);
    expect(authorityClient.actorLookups).toHaveLength(lookupsBefore + 1);
    expect(authorityClient.actorSignals.at(-1)).toBe(signal);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails before source access when current pipeline authority is gone", async () => {
    const { actor, authorityClient } = await salesTruthActorFixture();
    authorityClient.mcpResult = salesTruthAuthority(
      SALES_TRUTH_PERMISSIONS.filter(
        (permission) => permission !== "pipeline.view"
      )
    );
    const rpc = vi.fn<SalesTruthRpcClient["rpc"]>(() =>
      Promise.resolve({ data: salesTruthSourceFixture(), error: null })
    );
    const service = createSalesTruthService({
      repository: createSalesTruthRepository({ rpc }),
      authorityRepository: authorityClient.repository,
    });

    await expect(service.analyzeSalesTruth(actor, {})).rejects.toBeInstanceOf(
      ActorAccessError
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps invalid input, storage failures, and output overflow to safe errors", async () => {
    const { actor, authorityClient } = await salesTruthActorFixture();
    const source = salesTruthSourceFixture();
    const validRepository = createSalesTruthRepository({
      rpc: () => Promise.resolve({ data: source, error: null }),
    });
    const service = createSalesTruthService({
      repository: validRepository,
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    await expect(
      service.analyzeSalesTruth(actor, { window_days: 30 } as never)
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });

    const unavailable = createSalesTruthService({
      repository: createSalesTruthRepository({
        rpc: () => Promise.resolve({ data: null, error: { code: "XX000" } }),
      }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    await expect(
      unavailable.analyzeSalesTruth(actor, {})
    ).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });

    const overflow = createSalesTruthService({
      repository: validRepository,
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
      maxOutputCharacters: 10,
    });
    await expect(overflow.analyzeSalesTruth(actor, {})).rejects.toBeInstanceOf(
      SalesTruthReadError
    );
    await expect(overflow.analyzeSalesTruth(actor, {})).rejects.toMatchObject({
      code: "RESULT_TOO_LARGE",
    });
  });
});
