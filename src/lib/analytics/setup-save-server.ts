import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isAnalyticsUuid,
  sanitizeAnalyticsProperties,
} from "./event-sanitizer";
import { isProductionAnalyticsRequest } from "./signup-attribution";
import { ANALYTICS_SCHEMA_VERSION } from "./event-contract";

export interface SetupSaveContext {
  attemptId: string;
  sessionId: string;
  userId: string;
  companyId: string | null;
  step: "identity" | "company";
}

export type SetupSaveStage =
  | "identity_write"
  | "company_write"
  | "company_create"
  | "attribution"
  | "checkpoint";

export function setupSaveContext(
  req: Request,
  analytics: unknown,
  userId: string,
  companyId: unknown,
  step: "identity" | "company"
): SetupSaveContext | null {
  if (!isProductionAnalyticsRequest(req) || !isAnalyticsUuid(userId))
    return null;
  if (!analytics || typeof analytics !== "object" || Array.isArray(analytics))
    return null;
  const { attemptId, sessionId } = analytics as Record<string, unknown>;
  if (!isAnalyticsUuid(attemptId) || !isAnalyticsUuid(sessionId)) return null;
  return {
    attemptId,
    sessionId,
    userId,
    companyId: isAnalyticsUuid(companyId) ? companyId : null,
    step,
  };
}

/** Bounded, best-effort diagnostics. Never change a successful product save
 * into a failure because the analytics ledger is unavailable.
 */
export async function recordSetupSaveResult(
  db: SupabaseClient,
  context: SetupSaveContext,
  stage: SetupSaveStage,
  statusCode: number
): Promise<void> {
  try {
    const hash = createHash("sha256")
      .update(`setup-save:${context.userId}:${context.attemptId}`)
      .digest("hex");
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const succeeded = statusCode === 200;
    const { error } = await db
      .from("analytics_events")
      .upsert(
        {
          id,
          user_id: context.userId,
          company_id: context.companyId,
          session_id: context.sessionId,
          platform: "web",
          environment: "production",
          schema_version: ANALYTICS_SCHEMA_VERSION,
          event_type: succeeded ? "action" : "error",
          event_name: "setup_save_server_result",
          properties: sanitizeAnalyticsProperties({
            step: context.step,
            outcome: succeeded ? "succeeded" : "failed",
            stage,
            status_code: statusCode,
            attempt_key: context.attemptId.replaceAll("-", ""),
          }),
        },
        { onConflict: "id", ignoreDuplicates: true }
      )
      .abortSignal(AbortSignal.timeout(2000));
    if (error)
      console.error("[setup/analytics] Outcome write failed", {
        code: error.code,
      });
  } catch {
    console.error("[setup/analytics] Outcome write unavailable");
  }
}
