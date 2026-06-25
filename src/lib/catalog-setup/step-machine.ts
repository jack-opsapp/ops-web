// Pure step/module progression for the wizard rail (SELL → STOCK → TYPES →
// REVIEW). STOCK is conditional on `inventoryTracked` (spec §6, §9); any step
// the operator lacks permission for is skipped entirely (spec §16 compound
// gate, so nobody ever stalls on a step they can't act on). Mirrors iOS
// `BusinessProfile.setupModules` ordering for parity (spec §3).
//
// REVIEW is always present and always last — there is always a place to land
// and commit, even for an operator with no module permissions.

export type WizardStep = "sell" | "stock" | "types" | "review";

export interface StepContext {
  /** company_inventory_settings.inventory_mode === 'tracked' */
  inventoryTracked: boolean;
  /** catalog.products.manage — the SELL module */
  canSell: boolean;
  /** catalog.manage — the STOCK module */
  canStock: boolean;
  /** task/calendar type perms — the TYPES module */
  canTypes: boolean;
}

/**
 * Resolve the ordered list of visible steps for this operator + company.
 * STOCK appears only when inventory is tracked AND the operator can manage it.
 */
export function buildStepPlan(ctx: StepContext): WizardStep[] {
  const plan: WizardStep[] = [];
  if (ctx.canSell) plan.push("sell");
  if (ctx.canStock && ctx.inventoryTracked) plan.push("stock");
  if (ctx.canTypes) plan.push("types");
  plan.push("review"); // always present, always last
  return plan;
}

/** Advance one step along the plan; clamps at REVIEW. Skips omitted steps. */
export function nextStep(current: WizardStep, ctx: StepContext): WizardStep {
  const plan = buildStepPlan(ctx);
  const i = plan.indexOf(current);
  if (i === -1) return plan[0];
  return plan[Math.min(i + 1, plan.length - 1)];
}

/** Retreat one step along the plan; clamps at the first step. Skips omitted steps. */
export function prevStep(current: WizardStep, ctx: StepContext): WizardStep {
  const plan = buildStepPlan(ctx);
  const i = plan.indexOf(current);
  if (i <= 0) return plan[0];
  return plan[i - 1];
}
