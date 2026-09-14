import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProductionAnalyticsRequest } from "@/lib/analytics/signup-attribution";

/** The cookie is a bearer lookup, never a browser claim about an arm or trial.
 * Only the service-only database RPCs establish eligibility and attribution.
 */
export const EXPERIMENT_COOKIE = "__ops_experiment";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REJECTION_REASONS = new Set([
  "invalid_token", "expired_assignment", "ineligible_company", "invalid_actor",
  "trial_before_exposure", "outside_conversion_window", "company_already_attributed",
  "assignment_already_attributed", "actor_already_staged",
  "no_exposure",
]);
const PENDING_REASONS = new Set(["no_exposure", "trial_not_ready"]);

export type ExperimentAttributionResult = {
  status: "excluded" | "absent" | "staged" | "already_staged" | "attached" | "already_attached" | "pending" | "rejected";
  reason?: string;
};

export function readExperimentToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const matches = cookieHeader.split(";").map(value => value.trim())
    .filter(value => value.startsWith(`${EXPERIMENT_COOKIE}=`));
  // Ambiguous shadow cookies must not choose different identities by parser.
  if (matches.length !== 1) return null;
  const token = matches[0].slice(EXPERIMENT_COOKIE.length + 1);
  return TOKEN.test(token) ? token : null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseResult(value: unknown, operation: "stage" | "retry"): ExperimentAttributionResult | null {
  if (!object(value)) return null;
  const { status, reason } = value;
  if (status === "rejected" && typeof reason === "string" && REJECTION_REASONS.has(reason))
    return { status, reason };
  if (status === "pending" && typeof reason === "string" && PENDING_REASONS.has(reason))
    return { status, reason };
  if (operation === "stage" && (status === "staged" || status === "already_staged"))
    return { status };
  if (operation === "retry") {
    if (status === "absent" || (status === "rejected" && reason === "no_staged_assignment"))
      return { status: "absent" };
    if ((status === "attached" || status === "already_attached") &&
        [value.assignment_id, value.experiment_id, value.arm_id].every(id => typeof id === "string" && UUID.test(id)) &&
        typeof value.trial_started_at === "string" && Number.isFinite(Date.parse(value.trial_started_at)))
      return { status };
  }
  return null;
}

async function call(
  db: SupabaseClient,
  operation: "stage" | "retry",
  args: Record<string, string>,
): Promise<ExperimentAttributionResult> {
  const failure = (reason: "invalid_response" | "storage_unavailable"): ExperimentAttributionResult => {
    // Never log input, raw database messages, cookies, or tokens. Missing SQL
    // remains observable; it must never turn a successful signup into failure.
    console.error("[tryops/attribution] recovery required", { operation, reason });
    return { status: "pending", reason };
  };
  try {
    const { data, error } = await db.rpc(
      operation === "stage" ? "stage_tryops_experiment_signup" : "retry_tryops_experiment_trial",
      args,
    ).abortSignal(AbortSignal.timeout(1000));
    if (error) return failure("storage_unavailable");
    return parseResult(data, operation) ?? failure("invalid_response");
  } catch {
    return failure("storage_unavailable");
  }
}

function needsRecovery(result: ExperimentAttributionResult): boolean {
  return result.status === "pending" &&
    (result.reason === "storage_unavailable" || result.reason === "invalid_response");
}

async function recoverStaging(db: SupabaseClient, token: string, actorId: string, key: string): Promise<void> {
  // Acknowledged no_exposure is already durable and belongs to the engine's
  // reconciliation worker. Only unacknowledged storage failures need this path.
  for (const delay of [100, 300, 700]) {
    await new Promise(resolve => setTimeout(resolve, delay));
    if (!needsRecovery(await call(db, "stage", { p_token: token, p_actor_id: actorId }))) return;
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let persisted = false;
  try {
    const { data, error } = await db.rpc("report_tryops_collection_failure", {
      p_key: key, p_reason: "signup_staging_failed", p_assignment_id: null,
      p_token_hash: tokenHash, p_actor_id: actorId,
    }).abortSignal(AbortSignal.timeout(1000));
    if (!error && object(data)) {
      if (data.status === "recorded") persisted = true;
      else if (data.status === "rejected" &&
          (data.reason === "invalid_assignment" || data.reason === "invalid_actor")) {
        console.warn("[tryops/attribution] loss excluded", { reason: data.reason, key });
        return;
      }
    }
  } catch { /* A total outage cannot guarantee persistence. Report that explicitly. */ }
  console.error("[tryops/attribution] measurement loss", { reason: "signup_staging_failed", persisted, key });
}

/** Before company creation: persist the assignment ID against the verified OPS
 * user. The engine's service-only staging table retains no raw bearer token.
 * Its reconciliation worker later resolves users.company_id even if the app
 * loses the create response or the user never returns to setup.
 */
export async function stageSignupExperiment(
  db: SupabaseClient, req: Request, actorId: string,
): Promise<ExperimentAttributionResult> {
  if (!isProductionAnalyticsRequest(req) || !UUID.test(actorId)) return { status: "excluded" };
  const token = readExperimentToken(req.headers.get("cookie"));
  if (!token) return { status: "absent" };
  const result = await call(db, "stage", { p_token: token, p_actor_id: actorId });
  if (needsRecovery(result)) {
    // Next keeps the request alive until this callback completes. The bearer
    // stays in server memory only; it never enters setup_progress or logs.
    let recovery: Promise<void> | undefined;
    // This separate digest is a correlation key, not the assignment token hash.
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const key = createHash("sha256").update(`signup-staging:${actorId}:${tokenHash}`).digest("hex");
    try { after(() => recovery ??= recoverStaging(db, token, actorId, key)); }
    catch {
      console.error("[tryops/attribution] measurement loss", { reason: "scheduler_unavailable", persisted: false, key });
    }
  }
  return result;
}

/** Uses only durable, server-validated staging; no client conversion fields.
 * Retries after cookie expiry are decided by original exposure/trial times in
 * the database. This function never inserts a milestone or uploads to Ads.
 */
export async function retrySignupExperiment(
  db: SupabaseClient, req: Request, actorId: string, companyId: string | null,
): Promise<ExperimentAttributionResult> {
  if (!isProductionAnalyticsRequest(req) || !UUID.test(actorId)) return { status: "excluded" };
  if (!companyId || !UUID.test(companyId)) return { status: "absent" };
  return call(db, "retry", { p_actor_id: actorId, p_company_id: companyId });
}
