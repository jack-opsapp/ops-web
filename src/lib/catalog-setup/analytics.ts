// wizard_analytics event builder + dispatcher for the catalog-setup wizard
// (plan Task 6.8 / spec §16 "Analytics on every step"). Reuses the existing
// multi-platform `wizard_analytics` table (iOS shares it) — the builder maps a
// clean camelCase input to the snake_case Insert shape and stamps platform:"web";
// the dispatcher is fire-and-forget (never throws into the UI — analytics must
// never break the wizard). `company_id` scopes every row to the tenant.

import { requireSupabase } from "@/lib/supabase/helpers";

/** Stable wizard id for every catalog-setup analytics row. */
export const WIZARD_ID = "catalog_setup";

/** The lifecycle events the wizard emits (spec §16). */
export type WizardAnalyticsEvent =
  | "shown"
  | "started"
  | "step_completed"
  | "skipped"
  | "abandoned"
  | "completed";

const VALID_EVENTS: ReadonlySet<string> = new Set<WizardAnalyticsEvent>([
  "shown",
  "started",
  "step_completed",
  "skipped",
  "abandoned",
  "completed",
]);

export interface AnalyticsInput {
  companyId: string;
  userId: string;
  sessionId: string;
  totalSteps: number;
  event: WizardAnalyticsEvent;
  userRole?: string;
  stepId?: string;
  stepIndex?: number;
  durationMs?: number;
  stepsSkipped?: number;
  isRestart?: boolean;
  triggerType?: string;
  triggerContext?: string;
}

/** The snake_case `wizard_analytics` Insert row. */
export interface WizardAnalyticsRow {
  wizard_id: string;
  platform: "web";
  company_id: string;
  user_id: string;
  user_role: string | null;
  session_id: string;
  event: WizardAnalyticsEvent;
  total_steps: number | null;
  step_id: string | null;
  step_index: number | null;
  duration_ms: number | null;
  steps_skipped: number | null;
  is_restart: boolean | null;
  trigger_type: string | null;
  trigger_context: string | null;
}

/**
 * Map a camelCase analytics input to the `wizard_analytics` Insert row. Throws on
 * an unknown event (a runtime guard backing the compile-time union) so a typo
 * can never write a meaningless event.
 */
export function buildAnalyticsEvent(input: AnalyticsInput): WizardAnalyticsRow {
  if (!VALID_EVENTS.has(input.event)) {
    throw new Error(`Unknown wizard analytics event: ${String(input.event)}`);
  }
  return {
    wizard_id: WIZARD_ID,
    platform: "web",
    company_id: input.companyId,
    user_id: input.userId,
    user_role: input.userRole ?? null,
    session_id: input.sessionId,
    event: input.event,
    total_steps: input.totalSteps ?? null,
    step_id: input.stepId ?? null,
    step_index: input.stepIndex ?? null,
    duration_ms: input.durationMs ?? null,
    steps_skipped: input.stepsSkipped ?? null,
    is_restart: input.isRestart ?? null,
    trigger_type: input.triggerType ?? null,
    trigger_context: input.triggerContext ?? null,
  };
}

/**
 * Insert one wizard event. Fire-and-forget: every failure path (build throw,
 * insert error, transport throw) is swallowed with a console.warn so analytics
 * can never break the wizard (spec §16).
 */
export async function dispatchWizardEvent(input: AnalyticsInput): Promise<void> {
  try {
    const row = buildAnalyticsEvent(input);
    const { error } = await requireSupabase().from("wizard_analytics").insert(row);
    if (error) {
      console.warn("[catalog-setup analytics] insert failed:", error);
    }
  } catch (err) {
    console.warn("[catalog-setup analytics] dispatch error:", err);
  }
}
