/**
 * OPS conversion actions on the Google Ads account — planner + idempotent apply.
 *
 * SERVER ONLY. Three UPLOAD_CLICKS actions carry the funnel to Google:
 *
 *   trial_started    → "OPS · Trial started"     SIGNUP          primary
 *   trial_activated  → "OPS · Trial activated"   QUALIFIED_LEAD  secondary
 *   paid             → "OPS · Paid subscription" SUBSCRIBE_PAID  secondary, valued
 *
 * The planner is pure: given the live (non-REMOVED) actions it returns the
 * mutate operations that move the account to the target state and nothing
 * else — creates for missing OPS actions, minimal-mask updates for drifted
 * ones, demotions (primary → secondary) for the three enabled Firebase iOS
 * actions that pollute the Conversions column (login counted as a
 * conversion), and removals for the
 * three Bubble-era page actions whose pages 301 to /plans. Run twice, the
 * second plan is empty.
 *
 * `ensureConversionActions` applies a plan with the house rule built in:
 * every write is validated with `validateOnly: true` first and re-sent for
 * real only on a clean pass.
 */
import {
  listConversionActions,
  mutateConversionActions,
  type MutateOperation,
  type MutateResult,
} from "@/lib/analytics/google-ads-client";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export type ConversionEventKind = "trial_started" | "trial_activated" | "paid";

export interface ConversionActionTarget {
  kind: ConversionEventKind;
  name: string;
  type: "UPLOAD_CLICKS";
  category: "SIGNUP" | "QUALIFIED_LEAD" | "SUBSCRIBE_PAID";
  status: "ENABLED";
  primaryForGoal: boolean;
  includeInConversionsMetric: boolean;
  countingType: "ONE_PER_CLICK";
  clickThroughLookbackWindowDays: number;
}

export const OPS_CONVERSION_ACTION_TARGETS: readonly ConversionActionTarget[] = [
  {
    kind: "trial_started",
    name: "OPS · Trial started",
    type: "UPLOAD_CLICKS",
    category: "SIGNUP",
    status: "ENABLED",
    primaryForGoal: true,
    includeInConversionsMetric: true,
    countingType: "ONE_PER_CLICK",
    clickThroughLookbackWindowDays: 30,
  },
  {
    kind: "trial_activated",
    name: "OPS · Trial activated",
    type: "UPLOAD_CLICKS",
    category: "QUALIFIED_LEAD",
    status: "ENABLED",
    primaryForGoal: false,
    includeInConversionsMetric: false,
    countingType: "ONE_PER_CLICK",
    clickThroughLookbackWindowDays: 30,
  },
  {
    kind: "paid",
    name: "OPS · Paid subscription",
    type: "UPLOAD_CLICKS",
    category: "SUBSCRIBE_PAID",
    status: "ENABLED",
    primaryForGoal: false,
    includeInConversionsMetric: false,
    countingType: "ONE_PER_CLICK",
    clickThroughLookbackWindowDays: 90,
  },
];

/** Bubble-era page actions; the pages 301 to /plans and never converted a customer. */
const REMOVE_BY_NAME = new Set(["Join Ops SIgnup", "Homepage Signup", "Quiz Signup v2"]);

/** Firebase iOS actions that stay for App campaigns but must not steer bidding. */
function isDemotionCandidate(action: ExistingConversionAction): boolean {
  if (action.status !== "ENABLED") return false;
  const name = action.name;
  return name.endsWith("sign_up") || name.endsWith("login") || name === "OPS APP First open";
}

export interface ExistingConversionAction {
  resourceName: string;
  id: string;
  name: string;
  type: string;
  category: string;
  status: string;
  primaryForGoal: boolean;
  includeInConversionsMetric: boolean;
  countingType: string;
  clickThroughLookbackWindowDays: number;
}

export interface ConversionActionOperation extends MutateOperation {
  conversionActionOperation: {
    create?: Record<string, unknown> & { name: string };
    update?: Record<string, unknown> & { resourceName: string };
    updateMask?: string;
    remove?: string;
  };
}

/**
 * Fields compared for drift on an OPS action, in mask order.
 * `includeInConversionsMetric` is deliberately absent: Google marks it
 * read-only (a validateOnly mutate on 2026-09-09 answered IMMUTABLE_FIELD for
 * every operation carrying it, request GhT3wJ45mMH3_pUEC-vqOw). It follows
 * `primaryForGoal` under the account's default conversion goals, so demoting
 * an action to secondary is what removes it from the Conversions column.
 */
const DRIFT_FIELDS = [
  "type",
  "category",
  "primaryForGoal",
  "countingType",
  "clickThroughLookbackWindowDays",
  "status",
] as const;

export function planConversionActionOperations(
  existing: ExistingConversionAction[]
): ConversionActionOperation[] {
  const creates: ConversionActionOperation[] = [];
  const updates: ConversionActionOperation[] = [];
  const removes: ConversionActionOperation[] = [];
  const byName = new Map<string, ExistingConversionAction>();
  for (const action of existing) {
    // Prefer an ENABLED row when a name has been reused.
    const prior = byName.get(action.name);
    if (!prior || (action.status === "ENABLED" && prior.status !== "ENABLED")) {
      byName.set(action.name, action);
    }
  }

  for (const target of OPS_CONVERSION_ACTION_TARGETS) {
    const live = byName.get(target.name);
    if (!live) {
      creates.push({
        conversionActionOperation: {
          create: {
            name: target.name,
            type: target.type,
            category: target.category,
            status: target.status,
            primaryForGoal: target.primaryForGoal,
            countingType: target.countingType,
            clickThroughLookbackWindowDays: target.clickThroughLookbackWindowDays,
          },
        },
      });
      continue;
    }
    const update: Record<string, unknown> & { resourceName: string } = {
      resourceName: live.resourceName,
    };
    const mask: string[] = [];
    for (const field of DRIFT_FIELDS) {
      // `type` is immutable after creation; a wrong type is reported, not patched.
      if (field === "type") continue;
      if (live[field] !== target[field]) {
        update[field] = target[field];
        mask.push(field);
      }
    }
    if (mask.length > 0) {
      updates.push({ conversionActionOperation: { update, updateMask: mask.join(",") } });
    }
  }

  const opsNames = new Set(OPS_CONVERSION_ACTION_TARGETS.map((t) => t.name));
  for (const action of existing) {
    if (opsNames.has(action.name)) continue;
    if (REMOVE_BY_NAME.has(action.name) && action.status !== "REMOVED") {
      removes.push({ conversionActionOperation: { remove: action.resourceName } });
      continue;
    }
    if (isDemotionCandidate(action) && action.primaryForGoal) {
      updates.push({
        conversionActionOperation: {
          update: {
            resourceName: action.resourceName,
            primaryForGoal: false,
          },
          updateMask: "primaryForGoal",
        },
      });
    }
  }

  return [...creates, ...updates, ...removes];
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export interface RecordedConversionAction {
  kind: ConversionEventKind;
  resourceName: string;
  googleId: string;
  name: string;
}

export interface EnsureConversionActionsDeps {
  listExisting: () => Promise<ExistingConversionAction[]>;
  mutate: (
    operations: MutateOperation[],
    options: { validateOnly: boolean }
  ) => Promise<MutateResult>;
  recordActions: (rows: RecordedConversionAction[]) => Promise<void>;
}

export interface EnsureConversionActionsResult {
  operations: ConversionActionOperation[];
  /** The last mutate result: the validation when it failed, the apply otherwise. */
  result: MutateResult;
  /** True when the validateOnly pass returned no failures. */
  validated: boolean;
  recorded: RecordedConversionAction[];
  /** OPS kinds that could not be resolved by name after the apply. */
  unresolved: ConversionEventKind[];
}

const EMPTY_RESULT: MutateResult = { results: [], failures: [] };

async function recordConversionActionsInDatabase(rows: RecordedConversionAction[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getAdminSupabase();
  const { error } = await db.from("ads_conversion_actions").upsert(
    rows.map((row) => ({
      kind: row.kind,
      resource_name: row.resourceName,
      google_id: row.googleId,
      name: row.name,
      synced_at: new Date().toISOString(),
    })),
    { onConflict: "kind" }
  );
  if (error) throw new Error(`ads_conversion_actions upsert failed: ${error.message}`);
}

const defaultDeps: EnsureConversionActionsDeps = {
  listExisting: listConversionActions,
  // ConversionActionService, not the bulk mutate — see mutateConversionActions.
  mutate: (operations, options) =>
    mutateConversionActions(
      operations.map((op) => (op as ConversionActionOperation).conversionActionOperation),
      options
    ),
  recordActions: recordConversionActionsInDatabase,
};

/** Resolve the three OPS kinds to their live resource names by exact name. */
export function resolveRecordedActions(
  live: ExistingConversionAction[]
): { recorded: RecordedConversionAction[]; unresolved: ConversionEventKind[] } {
  const recorded: RecordedConversionAction[] = [];
  const unresolved: ConversionEventKind[] = [];
  for (const target of OPS_CONVERSION_ACTION_TARGETS) {
    const match = live.find((a) => a.name === target.name && a.status !== "REMOVED");
    if (match) {
      recorded.push({
        kind: target.kind,
        resourceName: match.resourceName,
        googleId: match.id,
        name: match.name,
      });
    } else {
      unresolved.push(target.kind);
    }
  }
  return { recorded, unresolved };
}

/**
 * Plan and apply. With `validateOnly: true` this is a dry run against Google
 * (nothing written anywhere). With `validateOnly: false` it validates first,
 * applies only on a clean pass, then re-reads the account and records the
 * three OPS actions' resource names in `ads_conversion_actions`.
 */
export async function ensureConversionActions(
  opts: { validateOnly: boolean },
  deps: EnsureConversionActionsDeps = defaultDeps
): Promise<EnsureConversionActionsResult> {
  const existing = await deps.listExisting();
  const operations = planConversionActionOperations(existing);

  if (operations.length === 0) {
    const { recorded, unresolved } = resolveRecordedActions(existing);
    if (!opts.validateOnly && recorded.length > 0) await deps.recordActions(recorded);
    return {
      operations,
      result: EMPTY_RESULT,
      validated: true,
      recorded: opts.validateOnly ? [] : recorded,
      unresolved,
    };
  }

  const validation = await deps.mutate(operations, { validateOnly: true });
  const validated = validation.failures.length === 0;
  if (opts.validateOnly || !validated) {
    return { operations, result: validation, validated, recorded: [], unresolved: [] };
  }

  const applied = await applyInPhases(operations, deps);
  const after = await deps.listExisting();
  const { recorded, unresolved } = resolveRecordedActions(after);
  if (recorded.length > 0) await deps.recordActions(recorded);
  return { operations, result: applied, validated, recorded, unresolved };
}

type OperationPhase = "create" | "update" | "remove";

function phaseOf(op: ConversionActionOperation): OperationPhase {
  if (op.conversionActionOperation.create) return "create";
  if (op.conversionActionOperation.update) return "update";
  return "remove";
}

/**
 * Apply creates, then updates, then removes as separate requests so one
 * broken phase never voids the others, and so a failure report names the
 * phase. Failures are re-indexed to the caller's operation positions; the
 * request id kept is the last phase's (each phase logs its own).
 */
async function applyInPhases(
  operations: ConversionActionOperation[],
  deps: EnsureConversionActionsDeps
): Promise<MutateResult> {
  const results: Array<Record<string, unknown>> = operations.map(() => ({}));
  const failures: MutateResult["failures"] = [];
  let requestId: string | undefined;
  for (const phase of ["create", "update", "remove"] as const) {
    const positions = operations
      .map((op, index) => ({ op, index }))
      .filter(({ op }) => phaseOf(op) === phase);
    if (positions.length === 0) continue;
    const outcome = await deps.mutate(
      positions.map(({ op }) => op),
      { validateOnly: false }
    );
    outcome.results.forEach((result, i) => {
      const position = positions[i];
      if (position) results[position.index] = result;
    });
    for (const failure of outcome.failures) {
      const original = failure.index === null ? null : positions[failure.index]?.index ?? null;
      failures.push({ ...failure, index: original });
    }
    if (outcome.requestId) requestId = outcome.requestId;
  }
  return requestId ? { results, failures, requestId } : { results, failures };
}
