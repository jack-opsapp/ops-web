import "server-only";

import { z } from "zod-v4";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  SALES_TRUTH_METRIC_DEFINITION_REVISION,
  SALES_TRUTH_MIN_SAMPLE_SIZE,
  SALES_TRUTH_POPULATION_RULE,
  SALES_TRUTH_PROMPT_SAFETY_DIRECTIVE,
  SALES_TRUTH_SCHEMA_REVISION,
  AnalyzeSalesTruthInputSchema,
  SalesTruthResultSchema,
  SalesTruthSourceSnapshotSchema,
  type AnalyzeSalesTruthInput,
  type SalesTruthResult,
  type SalesTruthSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/sales-truth";
import {
  AgentErrorSchema,
  CONTRACT_VERSION,
} from "@/lib/agent-control-plane/contracts";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  SALES_TRUTH_CAPABILITY_MANIFEST_REVISION,
  resolveSalesTruthCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  SalesTruthRepositoryUnavailableError,
  isTrustedSalesTruthRepository,
  type SalesTruthRepository,
} from "./sales-truth-repository";

const QUALIFIED_STAGES = new Set([
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
  "won",
  "lost",
]);
const VELOCITY_STAGES = [
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
] as const;
const SOURCE_ORDER = [
  "referral",
  "website",
  "email",
  "phone",
  "walk_in",
  "social_media",
  "repeat_client",
  "voice_log",
  "other",
  "missing",
] as const;
const CAPABILITY_ID = "analyze_sales_truth" as const;
const DEFAULT_MAX_OUTPUT_CHARACTERS = 120_000;
const TRUSTED_SERVICES = new WeakSet<object>();

type Confidence = SalesTruthResult["close_rate"]["confidence"];
type Recommendation = SalesTruthResult["recommendations"][number];
type SupportingRecord = SalesTruthResult["supporting_records"][number];
type SourceRef = Recommendation["supporting_record_refs"][number];
type LossCategory =
  SalesTruthResult["loss_reasons"]["categories"][number]["category"];

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round2((numerator / denominator) * 100);
}

function confidence(sample: number, coverage: number): Confidence {
  if (sample >= 30 && coverage >= 90) return "high";
  if (sample >= 20 && coverage >= 80) return "medium";
  if (sample >= SALES_TRUTH_MIN_SAMPLE_SIZE && coverage >= 70) return "low";
  return "insufficient";
}

function percentile(
  values: readonly number[],
  fraction: number
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(fraction * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, index)]!);
}

function wilson95(won: number, resolved: number) {
  const z = 1.96;
  const proportion = won / resolved;
  const zSquared = z * z;
  const denominator = 1 + zSquared / resolved;
  const center = (proportion + zSquared / (2 * resolved)) / denominator;
  const margin =
    (z *
      Math.sqrt(
        (proportion * (1 - proportion)) / resolved +
          zSquared / (4 * resolved * resolved)
      )) /
    denominator;
  return {
    low: round2(Math.max(0, center - margin) * 100),
    high: round2(Math.min(1, center + margin) * 100),
  };
}

function ref(kind: SupportingRecord["kind"], id: string): SourceRef {
  return `${kind}:${id}` as SourceRef;
}

function supportRecord(
  kind: SupportingRecord["kind"],
  id: string
): SupportingRecord {
  return { source_ref: ref(kind, id), kind };
}

function normalizeLossReason(value: string): LossCategory {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (["price", "pricing", "too_expensive"].includes(normalized)) {
    return "price";
  }
  if (["timing", "budget", "budget_timing", "not_ready"].includes(normalized)) {
    return "timing_or_budget";
  }
  if (["competition", "competitor"].includes(normalized)) {
    return "competition";
  }
  if (["scope", "scope_mismatch", "wrong_fit"].includes(normalized)) {
    return "scope_mismatch";
  }
  if (
    ["no_response", "operator_no_response", "unresponsive"].includes(normalized)
  ) {
    return "no_response";
  }
  if (["customer_declined", "declined"].includes(normalized)) {
    return "customer_declined";
  }
  if (normalized === "other") return "other";
  return "unmapped";
}

function sourceBoundsReached(snapshot: SalesTruthSourceSnapshot): boolean {
  return Object.values(snapshot.source_bounds).some(Boolean);
}

function durationSummary(
  values: readonly number[],
  coverage: number,
  supportingRecords: readonly SupportingRecord[]
): SalesTruthResult["pipeline_velocity"]["qualification_to_close"] {
  const level = confidence(values.length, coverage);
  const supportingRecordRefs = firstRefs(supportingRecords, 5);
  if (level === "insufficient") {
    return {
      sample_count: values.length,
      coverage_pct: coverage,
      median_minutes: null,
      p75_minutes: null,
      confidence: level,
      supporting_record_refs: supportingRecordRefs,
    };
  }
  return {
    sample_count: values.length,
    coverage_pct: coverage,
    median_minutes: percentile(values, 0.5),
    p75_minutes: percentile(values, 0.75),
    confidence: level,
    supporting_record_refs: supportingRecordRefs,
  };
}

function firstRefs(
  records: readonly SupportingRecord[],
  limit = 10
): SourceRef[] {
  return records.slice(0, limit).map((record) => record.source_ref);
}

function boundedResult(
  snapshot: SalesTruthSourceSnapshot,
  population: SalesTruthResult["population"]
): SalesTruthResult {
  return SalesTruthResultSchema.parse({
    schema_revision: SALES_TRUTH_SCHEMA_REVISION,
    metric_definition_revision: SALES_TRUTH_METRIC_DEFINITION_REVISION,
    observed_at: snapshot.observed_at,
    context: {
      timezone: snapshot.context.timezone,
      currency: {
        code: snapshot.context.currency_code,
        applicability: "context_only",
      },
    },
    window: {
      ...snapshot.window,
      population_rule: SALES_TRUTH_POPULATION_RULE,
    },
    population,
    close_rate: {
      state: "insufficient",
      numerator_won: population.won_count,
      denominator_resolved: population.resolved_count,
      rate_pct: null,
      wilson_95_pct: null,
      unresolved_sensitivity_pct: null,
      confidence: "insufficient",
    },
    attribution: {
      population_count: population.cohort_count,
      attributed_count: 0,
      missing_count: 0,
      coverage_pct: 0,
      segments: [],
    },
    loss_reasons: {
      lost_count: population.lost_count,
      observed_count: 0,
      structured_count: 0,
      legacy_count: 0,
      missing_count: 0,
      unmapped_count: 0,
      coverage_pct: 0,
      confidence: "insufficient",
      categories: [],
    },
    first_response: {
      cohort_count: population.cohort_count,
      linked_lead_count: 0,
      inbound_observed_count: 0,
      responded_count: 0,
      unresponded_count: 0,
      linkage_coverage_pct: 0,
      response_coverage_pct: 0,
      median_minutes: null,
      p75_minutes: null,
      confidence: "insufficient",
    },
    pipeline_velocity: {
      qualified_count: population.qualified_count,
      history_observed_count: 0,
      history_coverage_pct: 0,
      qualification_to_close: {
        sample_count: 0,
        coverage_pct: 0,
        median_minutes: null,
        p75_minutes: null,
        confidence: "insufficient",
        supporting_record_refs: [],
      },
      stages: [],
    },
    completeness: {
      state: "insufficient",
      reasons: ["source_bound_reached"],
      source_counts: snapshot.source_counts,
      source_bounds: snapshot.source_bounds,
    },
    recommendations: [
      {
        rank: 1,
        code: "repair_source_coverage",
        action:
          "Restore complete lead-history coverage before acting on this analysis.",
        confidence: "insufficient",
        basis: {
          metric: "bounded_source_count",
          observed_value: Object.values(snapshot.source_bounds).filter(Boolean)
            .length,
          threshold: 0,
          unit: "count",
        },
        supporting_record_refs: [],
        causal_claim: false,
      },
    ],
    supporting_records: [],
    source_revisions: snapshot.source_revisions,
    prompt_safety: {
      content_kind: "untrusted_business_data",
      directive: SALES_TRUTH_PROMPT_SAFETY_DIRECTIVE,
    },
  });
}

export function analyzeSalesTruthSnapshot(
  rawSnapshot: SalesTruthSourceSnapshot
): SalesTruthResult {
  const snapshot = SalesTruthSourceSnapshotSchema.parse(rawSnapshot);
  const opportunities = snapshot.opportunities;
  const qualified = opportunities.filter((opportunity) =>
    QUALIFIED_STAGES.has(opportunity.stage)
  );
  const won = qualified.filter((opportunity) => opportunity.stage === "won");
  const lost = qualified.filter((opportunity) => opportunity.stage === "lost");
  const openQualified = qualified.filter(
    (opportunity) => !["won", "lost"].includes(opportunity.stage)
  );
  const resolvedCount = won.length + lost.length;
  const population: SalesTruthResult["population"] = {
    cohort_count: opportunities.length,
    qualified_count: qualified.length,
    resolved_count: resolvedCount,
    won_count: won.length,
    lost_count: lost.length,
    open_qualified_count: openQualified.length,
    new_lead_count: opportunities.filter(
      (opportunity) => opportunity.stage === "new_lead"
    ).length,
    discarded_count: opportunities.filter(
      (opportunity) => opportunity.stage === "discarded"
    ).length,
  };

  if (sourceBoundsReached(snapshot)) {
    return boundedResult(snapshot, population);
  }

  const attributionSegments = SOURCE_ORDER.flatMap((source) => {
    const sourceOpportunities = opportunities.filter(
      (opportunity) => (opportunity.source ?? "missing") === source
    );
    if (sourceOpportunities.length === 0) return [];
    const sourceQualified = sourceOpportunities.filter((opportunity) =>
      QUALIFIED_STAGES.has(opportunity.stage)
    );
    const sourceWon = sourceQualified.filter(
      (opportunity) => opportunity.stage === "won"
    ).length;
    const sourceLost = sourceQualified.filter(
      (opportunity) => opportunity.stage === "lost"
    ).length;
    const sourceResolved = sourceWon + sourceLost;
    const sourceConfidence = confidence(sourceResolved, 100);
    return [
      {
        source,
        cohort_count: sourceOpportunities.length,
        qualified_count: sourceQualified.length,
        won_count: sourceWon,
        lost_count: sourceLost,
        open_qualified_count: sourceQualified.length - sourceResolved,
        resolved_close_rate_pct:
          sourceConfidence === "insufficient"
            ? null
            : percentage(sourceWon, sourceResolved),
        confidence: sourceConfidence,
      },
    ];
  });
  const attributedCount = opportunities.filter(
    (opportunity) => opportunity.source !== null
  ).length;
  const attribution: SalesTruthResult["attribution"] = {
    population_count: opportunities.length,
    attributed_count: attributedCount,
    missing_count: opportunities.length - attributedCount,
    coverage_pct: percentage(attributedCount, opportunities.length),
    segments: attributionSegments,
  };

  const dispositionByOpportunity = new Map(
    [...snapshot.dispositions]
      .sort((left, right) =>
        `${left.created_at}:${left.id}`.localeCompare(
          `${right.created_at}:${right.id}`
        )
      )
      .map((disposition) => [disposition.opportunity_id, disposition] as const)
  );
  const lossCategoryCounts = new Map<LossCategory, number>();
  let structuredReasonCount = 0;
  let legacyReasonCount = 0;
  let missingReasonCount = 0;
  let unmappedReasonCount = 0;
  const lossSupport: SupportingRecord[] = [];
  const lossSupportByCategory = new Map<LossCategory, SupportingRecord[]>();
  for (const opportunity of lost) {
    const disposition = dispositionByOpportunity.get(opportunity.id);
    const structured = disposition?.reason_code?.trim() || null;
    const legacy = opportunity.legacy_loss_reason?.trim() || null;
    let category: LossCategory;
    if (structured !== null) {
      structuredReasonCount += 1;
      category = normalizeLossReason(structured);
      lossSupport.push(
        supportRecord("opportunity_disposition", disposition!.id)
      );
    } else if (legacy !== null) {
      legacyReasonCount += 1;
      category = normalizeLossReason(legacy);
      lossSupport.push(supportRecord("opportunity", opportunity.id));
    } else {
      missingReasonCount += 1;
      category = "missing";
      lossSupport.push(supportRecord("opportunity", opportunity.id));
    }
    const categorySupport = lossSupportByCategory.get(category) ?? [];
    categorySupport.push(lossSupport.at(-1)!);
    lossSupportByCategory.set(category, categorySupport);
    if (category === "unmapped") unmappedReasonCount += 1;
    lossCategoryCounts.set(
      category,
      (lossCategoryCounts.get(category) ?? 0) + 1
    );
  }
  const observedReasonCount = structuredReasonCount + legacyReasonCount;
  const lossCoverage = percentage(observedReasonCount, lost.length);
  const lossConfidence = confidence(observedReasonCount, lossCoverage);
  const lossReasons: SalesTruthResult["loss_reasons"] = {
    lost_count: lost.length,
    observed_count: observedReasonCount,
    structured_count: structuredReasonCount,
    legacy_count: legacyReasonCount,
    missing_count: missingReasonCount,
    unmapped_count: unmappedReasonCount,
    coverage_pct: lossCoverage,
    confidence: lossConfidence,
    categories: [...lossCategoryCounts.entries()]
      .map(([category, count]) => ({
        category,
        count,
        share_pct: percentage(count, lost.length),
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.category.localeCompare(right.category)
      ),
  };

  const activitiesByOpportunity = new Map<
    string,
    SalesTruthSourceSnapshot["activities"]
  >();
  for (const activity of snapshot.activities) {
    const existing = activitiesByOpportunity.get(activity.opportunity_id) ?? [];
    activitiesByOpportunity.set(activity.opportunity_id, [
      ...existing,
      activity,
    ]);
  }
  const responseDurations: number[] = [];
  const responseSupport: SupportingRecord[] = [];
  let linkedLeadCount = 0;
  let inboundObservedCount = 0;
  let respondedCount = 0;
  for (const opportunity of opportunities) {
    const linked = [
      ...(activitiesByOpportunity.get(opportunity.id) ?? []),
    ].sort((left, right) =>
      `${left.occurred_at}:${left.id}`.localeCompare(
        `${right.occurred_at}:${right.id}`
      )
    );
    if (linked.length > 0) linkedLeadCount += 1;
    const firstInbound = linked.find(
      (activity) =>
        activity.direction === "inbound" &&
        activity.occurred_at >= opportunity.created_at
    );
    if (!firstInbound) continue;
    inboundObservedCount += 1;
    const firstOutbound = linked.find(
      (activity) =>
        activity.direction === "outbound" &&
        activity.occurred_at > firstInbound.occurred_at
    );
    responseSupport.push(supportRecord("activity", firstInbound.id));
    if (!firstOutbound) continue;
    respondedCount += 1;
    responseSupport.push(supportRecord("activity", firstOutbound.id));
    responseDurations.push(
      Math.round(
        (Date.parse(firstOutbound.occurred_at) -
          Date.parse(firstInbound.occurred_at)) /
          60_000
      )
    );
  }
  const linkageCoverage = percentage(linkedLeadCount, opportunities.length);
  const responseCoverage = percentage(respondedCount, inboundObservedCount);
  const responseConfidence = confidence(
    responseDurations.length,
    Math.min(linkageCoverage, responseCoverage)
  );
  const firstResponse: SalesTruthResult["first_response"] = {
    cohort_count: opportunities.length,
    linked_lead_count: linkedLeadCount,
    inbound_observed_count: inboundObservedCount,
    responded_count: respondedCount,
    unresponded_count: inboundObservedCount - respondedCount,
    linkage_coverage_pct: linkageCoverage,
    response_coverage_pct: responseCoverage,
    median_minutes:
      responseConfidence === "insufficient"
        ? null
        : percentile(responseDurations, 0.5),
    p75_minutes:
      responseConfidence === "insufficient"
        ? null
        : percentile(responseDurations, 0.75),
    confidence: responseConfidence,
  };

  const transitionsByOpportunity = new Map<
    string,
    SalesTruthSourceSnapshot["transitions"]
  >();
  for (const transition of snapshot.transitions) {
    const existing =
      transitionsByOpportunity.get(transition.opportunity_id) ?? [];
    transitionsByOpportunity.set(transition.opportunity_id, [
      ...existing,
      transition,
    ]);
  }
  const historyObserved = qualified.filter(
    (opportunity) =>
      (transitionsByOpportunity.get(opportunity.id)?.length ?? 0) > 0
  );
  const historyCoverage = percentage(historyObserved.length, qualified.length);
  const qualificationToCloseDurations: number[] = [];
  const velocitySupport: SupportingRecord[] = [];
  for (const opportunity of [...won, ...lost]) {
    const history = [
      ...(transitionsByOpportunity.get(opportunity.id) ?? []),
    ].sort((left, right) =>
      `${left.transitioned_at}:${left.id}`.localeCompare(
        `${right.transitioned_at}:${right.id}`
      )
    );
    const firstQualified = history.find((transition) =>
      QUALIFIED_STAGES.has(transition.to_stage)
    );
    const terminal = firstQualified
      ? history.find(
          (transition) =>
            transition.transitioned_at > firstQualified.transitioned_at &&
            ["won", "lost"].includes(transition.to_stage)
        )
      : undefined;
    if (!firstQualified || !terminal) continue;
    qualificationToCloseDurations.push(
      Math.round(
        (Date.parse(terminal.transitioned_at) -
          Date.parse(firstQualified.transitioned_at)) /
          60_000
      )
    );
    velocitySupport.push(
      supportRecord("stage_transition", firstQualified.id),
      supportRecord("stage_transition", terminal.id)
    );
  }
  const transitionSupport = snapshot.transitions.map((transition) =>
    supportRecord("stage_transition", transition.id)
  );
  const stageSummaries = VELOCITY_STAGES.flatMap((stage) => {
    const stageTransitions = snapshot.transitions.filter(
      (transition) => transition.from_stage === stage
    );
    if (stageTransitions.length === 0) return [];
    const observedDurations = stageTransitions.filter(
      (transition) => transition.duration_minutes !== null
    );
    const stageCoverage = Math.min(
      historyCoverage,
      percentage(observedDurations.length, stageTransitions.length)
    );
    const summary = durationSummary(
      observedDurations.map((transition) => transition.duration_minutes!),
      stageCoverage,
      observedDurations.map((transition) =>
        supportRecord("stage_transition", transition.id)
      )
    );
    return [{ stage, ...summary }];
  });
  const pipelineVelocity: SalesTruthResult["pipeline_velocity"] = {
    qualified_count: qualified.length,
    history_observed_count: historyObserved.length,
    history_coverage_pct: historyCoverage,
    qualification_to_close: durationSummary(
      qualificationToCloseDurations,
      percentage(qualificationToCloseDurations.length, resolvedCount),
      velocitySupport
    ),
    stages: stageSummaries,
  };

  const closeConfidence = confidence(resolvedCount, 100);
  const closeRate: SalesTruthResult["close_rate"] =
    closeConfidence === "insufficient"
      ? {
          state: "insufficient",
          numerator_won: won.length,
          denominator_resolved: resolvedCount,
          rate_pct: null,
          wilson_95_pct: null,
          unresolved_sensitivity_pct: null,
          confidence: "insufficient",
        }
      : {
          state: "usable",
          numerator_won: won.length,
          denominator_resolved: resolvedCount,
          rate_pct: percentage(won.length, resolvedCount),
          wilson_95_pct: wilson95(won.length, resolvedCount),
          unresolved_sensitivity_pct: {
            low: percentage(won.length, qualified.length),
            high: percentage(
              won.length + openQualified.length,
              qualified.length
            ),
          },
          confidence: closeConfidence,
        };

  const reasons: SalesTruthResult["completeness"]["reasons"] = [];
  if (closeConfidence === "insufficient") {
    reasons.push("close_rate_sample_insufficient");
  }
  if (attribution.coverage_pct < 100) reasons.push("attribution_missing");
  if (lossCoverage < 70) reasons.push("loss_reason_coverage_incomplete");
  if (lossConfidence === "insufficient") {
    reasons.push("loss_reason_sample_insufficient");
  }
  if (linkageCoverage < 70) reasons.push("correspondence_linkage_incomplete");
  if (responseCoverage < 70) reasons.push("response_coverage_incomplete");
  if (responseConfidence === "insufficient") {
    reasons.push("response_sample_insufficient");
  }
  if (historyCoverage < 70) reasons.push("stage_history_incomplete");
  if (pipelineVelocity.qualification_to_close.confidence === "insufficient") {
    reasons.push("velocity_sample_insufficient");
  }

  const recommendationCandidates: Array<Omit<Recommendation, "rank">> = [];
  const opportunitySupport = opportunities.map((opportunity) =>
    supportRecord("opportunity", opportunity.id)
  );
  if (closeConfidence === "insufficient") {
    recommendationCandidates.push({
      code: "capture_outcomes",
      action:
        "Close won and lost leads consistently before changing the sales process.",
      confidence: "insufficient",
      basis: {
        metric: "resolved_lead_count",
        observed_value: resolvedCount,
        threshold: SALES_TRUTH_MIN_SAMPLE_SIZE,
        unit: "count",
      },
      supporting_record_refs: firstRefs(opportunitySupport),
      causal_claim: false,
    });
  }
  if (lossCoverage < 70) {
    recommendationCandidates.push({
      code: "capture_loss_reasons",
      action: "Capture a loss reason every time a lead is closed lost.",
      confidence: lossConfidence,
      basis: {
        metric: "loss_reason_coverage_pct",
        observed_value: lossCoverage,
        threshold: 70,
        unit: "percent",
      },
      supporting_record_refs: firstRefs(lossSupport),
      causal_claim: false,
    });
  }
  if (historyCoverage < 70) {
    recommendationCandidates.push({
      code: "repair_stage_history",
      action: "Restore complete stage history before changing pipeline timing.",
      confidence: "insufficient",
      basis: {
        metric: "stage_history_coverage_pct",
        observed_value: historyCoverage,
        threshold: 70,
        unit: "percent",
      },
      supporting_record_refs: firstRefs(opportunitySupport),
      causal_claim: false,
    });
  }
  if (linkageCoverage < 70 || responseCoverage < 70) {
    const failingLinkage = linkageCoverage < 70;
    recommendationCandidates.push({
      code: "repair_correspondence_linkage",
      action:
        "Link inbound and outbound lead messages before judging response speed.",
      confidence: responseConfidence,
      basis: {
        metric: failingLinkage
          ? "correspondence_linkage_coverage_pct"
          : "response_coverage_pct",
        observed_value: failingLinkage ? linkageCoverage : responseCoverage,
        threshold: 70,
        unit: "percent",
      },
      supporting_record_refs: firstRefs(responseSupport),
      causal_claim: false,
    });
  }
  if (
    responseConfidence !== "insufficient" &&
    ((firstResponse.median_minutes ?? 0) > 1_440 ||
      (firstResponse.p75_minutes ?? 0) > 2_880)
  ) {
    recommendationCandidates.push({
      code: "reduce_first_response_time",
      action: "Respond to new lead messages within one day.",
      confidence: responseConfidence,
      basis: {
        metric: "median_first_response_minutes",
        observed_value: firstResponse.median_minutes ?? 0,
        threshold: 1_440,
        unit: "minutes",
      },
      supporting_record_refs: firstRefs(responseSupport),
      causal_claim: false,
    });
  }
  const leadingReason = lossReasons.categories.find(
    (category) =>
      category.category !== "missing" && category.category !== "unmapped"
  );
  const leadingReasonObservedShare = leadingReason
    ? percentage(leadingReason.count, observedReasonCount)
    : 0;
  if (
    leadingReason &&
    observedReasonCount >= SALES_TRUTH_MIN_SAMPLE_SIZE &&
    leadingReasonObservedShare >= 30
  ) {
    recommendationCandidates.push({
      code: "review_top_loss_reason",
      action: "Review the sales steps behind the leading recorded loss reason.",
      confidence: lossConfidence,
      basis: {
        metric: `loss_reason_share_${leadingReason.category}`,
        observed_value: leadingReasonObservedShare,
        threshold: 30,
        unit: "percent",
      },
      supporting_record_refs: firstRefs(
        lossSupportByCategory.get(leadingReason.category) ?? []
      ),
      causal_claim: false,
    });
  }
  if (closeRate.rate_pct !== null) {
    const underperforming = attribution.segments
      .filter(
        (segment) =>
          segment.resolved_close_rate_pct !== null &&
          segment.won_count + segment.lost_count >=
            SALES_TRUTH_MIN_SAMPLE_SIZE &&
          closeRate.rate_pct! - segment.resolved_close_rate_pct >= 15
      )
      .sort(
        (left, right) =>
          left.resolved_close_rate_pct! - right.resolved_close_rate_pct! ||
          left.source.localeCompare(right.source)
      )[0];
    if (underperforming) {
      const sourceSupport = opportunities
        .filter(
          (opportunity) =>
            (opportunity.source ?? "missing") === underperforming.source &&
            ["won", "lost"].includes(opportunity.stage)
        )
        .map((opportunity) => supportRecord("opportunity", opportunity.id));
      recommendationCandidates.push({
        code: "review_underperforming_source",
        action:
          "Review qualification and follow-up for the weakest measured lead source.",
        confidence: underperforming.confidence,
        basis: {
          metric: `close_rate_gap_${underperforming.source}`,
          observed_value: round2(
            closeRate.rate_pct - underperforming.resolved_close_rate_pct!
          ),
          threshold: 15,
          unit: "percent",
        },
        supporting_record_refs: firstRefs(sourceSupport),
        causal_claim: false,
      });
    }
  }
  const slowestStage = [...pipelineVelocity.stages]
    .filter((stage) => stage.confidence !== "insufficient")
    .sort(
      (left, right) =>
        (right.median_minutes ?? 0) - (left.median_minutes ?? 0) ||
        left.stage.localeCompare(right.stage)
    )[0];
  if (slowestStage) {
    recommendationCandidates.push({
      code: "clear_stage_bottleneck",
      action:
        "Review the slowest measured pipeline stage for stalled next steps.",
      confidence: slowestStage.confidence,
      basis: {
        metric: `median_stage_minutes_${slowestStage.stage}`,
        observed_value: slowestStage.median_minutes ?? 0,
        threshold: 0,
        unit: "minutes",
      },
      supporting_record_refs: slowestStage.supporting_record_refs,
      causal_claim: false,
    });
  }
  if (recommendationCandidates.length === 0) {
    recommendationCandidates.push({
      code: "preserve_current_process",
      action:
        "Preserve the current process until a material measured signal appears.",
      confidence: closeConfidence,
      basis: {
        metric: "material_repair_signal_count",
        observed_value: 0,
        threshold: 1,
        unit: "count",
      },
      supporting_record_refs: firstRefs(opportunitySupport),
      causal_claim: false,
    });
  }
  const recommendations = recommendationCandidates
    .slice(0, 3)
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
  const referenced = new Set([
    ...recommendations.flatMap(
      (recommendation) => recommendation.supporting_record_refs
    ),
    ...pipelineVelocity.qualification_to_close.supporting_record_refs,
    ...pipelineVelocity.stages.flatMap((stage) => stage.supporting_record_refs),
  ]);
  const allSupport = [
    ...opportunitySupport,
    ...lossSupport,
    ...responseSupport,
    ...velocitySupport,
    ...transitionSupport,
  ];
  const supportingRecords = [...referenced]
    .map((reference) =>
      allSupport.find((record) => record.source_ref === reference)
    )
    .filter((record): record is SupportingRecord => record !== undefined)
    .slice(0, 100);

  return SalesTruthResultSchema.parse({
    schema_revision: SALES_TRUTH_SCHEMA_REVISION,
    metric_definition_revision: SALES_TRUTH_METRIC_DEFINITION_REVISION,
    observed_at: snapshot.observed_at,
    context: {
      timezone: snapshot.context.timezone,
      currency: {
        code: snapshot.context.currency_code,
        applicability: "context_only",
      },
    },
    window: {
      ...snapshot.window,
      population_rule: SALES_TRUTH_POPULATION_RULE,
    },
    population,
    close_rate: closeRate,
    attribution,
    loss_reasons: lossReasons,
    first_response: firstResponse,
    pipeline_velocity: pipelineVelocity,
    completeness: {
      state: reasons.length === 0 ? "complete" : "partial",
      reasons,
      source_counts: snapshot.source_counts,
      source_bounds: snapshot.source_bounds,
    },
    recommendations,
    supporting_records: supportingRecords,
    source_revisions: snapshot.source_revisions,
    prompt_safety: {
      content_kind: "untrusted_business_data",
      directive: SALES_TRUTH_PROMPT_SAFETY_DIRECTIVE,
    },
  });
}

export class SalesTruthReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_ARGUMENT"
    | "RESULT_TOO_LARGE"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: SalesTruthReadError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      INTERNAL: "The sales analysis could not be completed.",
      INVALID_ARGUMENT: "The sales analysis does not accept custom inputs.",
      RESULT_TOO_LARGE: "The sales analysis is too large to return.",
      TEMPORARILY_UNAVAILABLE:
        "The sales analysis is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "SalesTruthReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.code === "TEMPORARILY_UNAVAILABLE";
  }

  toAgentError() {
    if (this.code === "INVALID_ARGUMENT") {
      return AgentErrorSchema.parse({
        contract_version: CONTRACT_VERSION,
        code: "INVALID_ARGUMENT",
        request_id: this.requestId,
        message: this.message,
        retryable: false,
        details: {
          field_issues: [
            {
              path: [],
              code: "SALES_TRUTH_INPUT_NOT_EMPTY",
              message: this.message,
            },
          ],
        },
      });
    }
    return toP2ReadAgentError({
      code: this.code,
      requestId: this.requestId,
      message: this.message,
      retryable: this.retryable,
    });
  }
}

export interface SalesTruthService {
  analyzeSalesTruth(
    actorContext: ActorContext,
    input: AnalyzeSalesTruthInput,
    options?: { signal?: AbortSignal }
  ): Promise<SalesTruthResult>;
}

export function createSalesTruthService(input: {
  repository: SalesTruthRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
  maxOutputCharacters?: number;
}): SalesTruthService {
  if (!isTrustedSalesTruthRepository(input.repository)) {
    throw new TypeError("A trusted sales-truth repository is required");
  }
  if (!input.authorityRepository) {
    throw new TypeError("A sales-truth authority repository is required");
  }
  const now = input.now ?? (() => new Date());
  const maxOutputCharacters =
    input.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS;
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(maxOutputCharacters) ||
    maxOutputCharacters <= 0 ||
    maxOutputCharacters > DEFAULT_MAX_OUTPUT_CHARACTERS
  ) {
    throw new TypeError("Sales-truth service options are invalid");
  }

  const service: SalesTruthService = {
    async analyzeSalesTruth(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "sales_truth_actor_context_untrusted"
        );
      }
      let parsedInput: z.infer<typeof AnalyzeSalesTruthInputSchema>;
      try {
        parsedInput = AnalyzeSalesTruthInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new SalesTruthReadError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw error;
      }
      const initial = resolveSalesTruthCapabilityAuthorization(
        CAPABILITY_ID,
        parsedInput
      );
      if (initial.variants.length !== 1) {
        throw authorizationInternal(
          actorContext.requestId,
          "sales_truth_authorization_variant_invalid"
        );
      }
      authorizeCapability({
        actorContext,
        policy: initial.variants[0]!.policy,
      });
      const currentActor = await reauthorizeResolvedMcpActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        capabilityManifestRevision: SALES_TRUTH_CAPABILITY_MANIFEST_REVISION,
        signal: options?.signal,
      });
      const current = resolveSalesTruthCapabilityAuthorization(
        CAPABILITY_ID,
        parsedInput
      );
      if (current.variants.length !== 1) {
        throw authorizationInternal(
          currentActor.requestId,
          "sales_truth_authorization_variant_invalid"
        );
      }
      authorizeCapability({
        actorContext: currentActor,
        policy: current.variants[0]!.policy,
      });

      try {
        const snapshot = await input.repository.readSourceSnapshot({
          actorContext: currentActor,
          observedAt: now().toISOString(),
          signal: options?.signal,
        });
        const result = analyzeSalesTruthSnapshot(snapshot);
        if (JSON.stringify(result).length > maxOutputCharacters) {
          throw new SalesTruthReadError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
          });
        }
        return result;
      } catch (error) {
        if (error instanceof SalesTruthReadError) throw error;
        if (error instanceof SalesTruthRepositoryUnavailableError) {
          throw new SalesTruthReadError({
            code: "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new SalesTruthReadError({
          code: "INTERNAL",
          requestId: actorContext.requestId,
          cause: error,
        });
      }
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedSalesTruthService(
  value: unknown
): value is SalesTruthService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
