// Prerequisite predicates for catalog-setup wizard entry (plan Task 6.2 / spec
// §16 "Prerequisites"). PURE — the route loader / prerequisite-gate component
// supply the booleans (from live reads); this only decides the highest-priority
// blocker, or null when the wizard may run.

export type BlockingPrerequisite =
  | "no_company"
  | "baseline_not_seeded"
  | "catalog_surface_absent"
  | "subscription_locked";

export interface PrereqInput {
  /** The operator belongs to a company. */
  companyExists: boolean;
  /** initialize_company_defaults ran (task_types + units present → read-merge). */
  baselineSeeded: boolean;
  /** The /catalog (P3-2) surface is deployed. */
  catalogSurfaceDeployed: boolean;
  /** Company is in an expired-subscription lockout. */
  subscriptionLocked: boolean;
}

/**
 * Highest-priority blocker, or null when the wizard may run. Ordering: a missing
 * company outranks all; a paying-state lockout outranks data-shape gates; then
 * the surface; then the baseline seed.
 */
export function deriveBlockingPrerequisite(i: PrereqInput): BlockingPrerequisite | null {
  if (!i.companyExists) return "no_company";
  if (i.subscriptionLocked) return "subscription_locked";
  if (!i.catalogSurfaceDeployed) return "catalog_surface_absent";
  if (!i.baselineSeeded) return "baseline_not_seeded";
  return null;
}

/**
 * Read-merge signal: the baseline is present when both seeded primitives exist.
 * The wizard operates on higher layers and must never re-seed task types/units.
 */
export function baselineSeeded(taskTypeCount: number, unitCount: number): boolean {
  return taskTypeCount > 0 && unitCount > 0;
}
