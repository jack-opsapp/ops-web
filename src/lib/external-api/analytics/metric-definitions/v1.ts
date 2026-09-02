import type {
  MetricId,
  metricBasisSchema,
  metricUnitSchema,
} from "../../contracts/metrics";
import type { z } from "zod";

type MetricBasis = z.infer<typeof metricBasisSchema>;
type MetricUnit = z.infer<typeof metricUnitSchema>;

export type MetricDefinition = Readonly<{
  id: MetricId;
  version: "1";
  basis: MetricBasis;
  population: string;
  unit: MetricUnit;
  financial: boolean;
  suppressBelowCohort: number | null;
  replacement: null;
  sunsetAt: null;
}>;

function definition(
  id: MetricId,
  basis: MetricBasis,
  population: string,
  unit: MetricUnit,
  options: { financial?: boolean; derived?: boolean } = {}
): MetricDefinition {
  return Object.freeze({
    id,
    version: "1",
    basis,
    population,
    unit,
    financial: options.financial ?? false,
    suppressBelowCohort: options.derived || options.financial ? 5 : null,
    replacement: null,
    sunsetAt: null,
  });
}

const receivedPopulation =
  "Canonical non-merged leads received in the half-open interval";

export const metricDefinitionsV1 = Object.freeze([
  definition("leads_received", "received_cohort", receivedPopulation, "count"),
  definition(
    "cohort_active_lead_count",
    "current_snapshot",
    "Received cohort still active and neither archived nor terminal",
    "count"
  ),
  definition(
    "cohort_discarded_lead_count",
    "current_snapshot",
    "Received cohort with the discarded disposition",
    "count"
  ),
  definition(
    "cohort_discard_rate",
    "current_snapshot",
    "Discarded received-cohort leads divided by leads received",
    "percent",
    { derived: true }
  ),
  definition(
    "cohort_current_stage_distribution",
    "current_snapshot",
    "Authoritative current stage of the received cohort",
    "count"
  ),
  definition(
    "cohort_outcome_distribution",
    "current_snapshot",
    "Mutually exclusive authoritative outcome of the received cohort",
    "count"
  ),
  definition(
    "cohort_disqualified_count",
    "current_snapshot",
    "Received cohort with the distinct disqualified disposition",
    "count"
  ),
  definition(
    "cohort_disqualified_rate",
    "current_snapshot",
    "Disqualified received-cohort leads divided by leads received",
    "percent",
    { derived: true }
  ),
  definition(
    "project_converted_count",
    "current_snapshot",
    "Received cohort with canonical project-conversion evidence",
    "count"
  ),
  definition(
    "project_converted_rate",
    "current_snapshot",
    "Project-converted received-cohort leads divided by leads received",
    "percent",
    { derived: true }
  ),
  definition(
    "stage_reached_funnel_count",
    "received_cohort",
    "Received-cohort leads with atomic evidence for each reached stage",
    "count"
  ),
  definition(
    "stage_reached_funnel_rate",
    "received_cohort",
    "Evidenced stage reaches divided by leads with known stage evidence",
    "percent",
    { derived: true }
  ),
  definition(
    "cohort_decided_lead_count",
    "current_snapshot",
    "Received-cohort leads won or lost",
    "count"
  ),
  definition(
    "cohort_won_count",
    "current_snapshot",
    "Received-cohort leads with canonical won evidence",
    "count"
  ),
  definition(
    "cohort_lost_count",
    "current_snapshot",
    "Received-cohort leads with canonical lost evidence",
    "count"
  ),
  definition(
    "cohort_decided_win_rate",
    "current_snapshot",
    "Won leads divided by won plus lost leads",
    "percent",
    { derived: true }
  ),
  definition(
    "first_response_coverage",
    "received_cohort",
    "Eligible received-cohort leads with a qualifying first response",
    "percent",
    { derived: true }
  ),
  definition(
    "median_first_response_minutes",
    "received_cohort",
    "Median inquiry-to-qualifying-first-response time",
    "minutes",
    { derived: true }
  ),
  definition(
    "median_time_to_decision",
    "received_cohort",
    "Median inquiry-to-first-won-or-lost time",
    "minutes",
    { derived: true }
  ),
  definition(
    "median_time_to_win",
    "received_cohort",
    "Median inquiry-to-won time",
    "minutes",
    { derived: true }
  ),
  definition(
    "median_time_to_project_conversion",
    "received_cohort",
    "Median inquiry-to-canonical-project-conversion time",
    "minutes",
    { derived: true }
  ),
  definition(
    "intake_submissions_accepted",
    "event_dated",
    "External intake submissions accepted in the interval",
    "count"
  ),
  definition(
    "intake_submissions_rejected",
    "event_dated",
    "External intake submission requests rejected in the interval",
    "count"
  ),
  definition(
    "intake_submissions_replayed",
    "event_dated",
    "Exact external intake submission replays in the interval",
    "count"
  ),
  definition(
    "external_intake_customers_created",
    "event_dated",
    "Accepted external intake submissions that created a customer",
    "count"
  ),
  definition(
    "external_intake_customers_matched",
    "event_dated",
    "Accepted external intake submissions matched to a customer",
    "count"
  ),
  definition(
    "source_attribution_completeness",
    "received_cohort",
    "Received-cohort leads with authenticated or canonical source evidence",
    "percent",
    { derived: true }
  ),
  definition(
    "lifecycle_evidence_completeness",
    "received_cohort",
    "Received-cohort leads with canonical inquiry and lifecycle evidence",
    "percent",
    { derived: true }
  ),
  definition(
    "cohort_open_estimated_value",
    "current_snapshot",
    "Current estimated value for active received-cohort leads",
    "currency",
    { financial: true }
  ),
  definition(
    "cohort_won_value",
    "current_snapshot",
    "Actual value for won received-cohort leads with known actual value",
    "currency",
    { financial: true }
  ),
  definition(
    "cohort_average_won_value",
    "current_snapshot",
    "Average actual value among won cohort leads with known actual value",
    "currency",
    { financial: true }
  ),
  definition(
    "invoiced_event_total",
    "event_dated",
    "Non-draft, non-void, non-deleted invoice total dated in the interval",
    "currency",
    { financial: true }
  ),
  definition(
    "paid_event_total",
    "event_dated",
    "Non-void payment total on eligible invoices dated in the interval",
    "currency",
    { financial: true }
  ),
]) satisfies readonly MetricDefinition[];

export const metricDefinitionV1ById = new Map(
  metricDefinitionsV1.map((item) => [item.id, item])
) as ReadonlyMap<MetricId, MetricDefinition>;

export const financialMetricIdsV1 = new Set(
  metricDefinitionsV1.filter((item) => item.financial).map((item) => item.id)
) as ReadonlySet<MetricId>;
