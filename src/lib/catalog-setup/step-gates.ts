// Compound per-step permission gates for the catalog-setup wizard (plan Task
// 6.4 / spec §12, §16 "Role / permission matrix").
//
// Every module the wizard can run has a precise set of granular permissions it
// requires. We NEVER role-filter (CLAUDE.md: no `role IN (...)`); the predicates
// take the granular `can(permission, scope)` from usePermissionStore so they are
// trivially testable and the wizard hides a step the operator can't complete
// rather than leading them to a dead "build it".
//
//   • account-holder / company-admin / office with catalog.products.manage → full run
//   • operator / crew without the bit → the step (or the whole wizard) is hidden
//
// PURE: no store import, no I/O — the caller injects `can`.

/** The wizard's modules, in canvas order. REVIEW is the commit gate, not a write. */
export type WizardModule = "SELL" | "STOCK" | "TYPES" | "REVIEW";

/**
 * A `can`-style predicate: granted when the permission holds at the given scope.
 * The scope is the literal "all" (a valid PermissionScope) so the real store
 * `can(permission, PermissionScope)` is assignable here without this pure module
 * importing the permissions types.
 */
export type CanFn = (permission: string, scope?: "all") => boolean;

/**
 * Each module's required permissions. Trade & task types are catalog setup, not
 * a separate domain, so TYPES rides catalog.products.manage (aligned with the
 * registered catalog permission bits in src/lib/types/permissions.ts).
 * catalog.run_setup is the wizard-entry bit every module shares.
 */
export const STEP_REQUIRED_PERMISSIONS: Record<WizardModule, readonly string[]> = {
  SELL: ["catalog.run_setup", "catalog.products.manage"],
  STOCK: ["catalog.run_setup", "catalog.manage"],
  TYPES: ["catalog.run_setup", "catalog.products.manage"],
  REVIEW: ["catalog.run_setup"],
};

/** A module is accessible only when EVERY required permission holds (scope "all"). */
export function isStepAccessible(step: WizardModule, can: CanFn): boolean {
  return STEP_REQUIRED_PERMISSIONS[step].every((p) => can(p, "all"));
}

/**
 * Filter a module plan to what the operator can actually do. REVIEW is dropped
 * when it is the only survivor — a wizard with nothing to build is not shown a
 * lone REVIEW step.
 */
export function visibleModulePlan(plan: WizardModule[], can: CanFn): WizardModule[] {
  const visible = plan.filter((m) => isStepAccessible(m, can));
  const buildable = visible.filter((m) => m !== "REVIEW");
  return buildable.length === 0 ? [] : visible;
}

/**
 * Wizard-level entry gate: hidden-vs-shown at the takeover / CTA. An operator or
 * crew member without catalog.run_setup never sees the first-run takeover.
 */
export function entryAllowed(can: CanFn): boolean {
  return can("catalog.run_setup", "all");
}
