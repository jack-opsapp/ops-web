import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH_SIZE = 20;
type FailureReason = "recipient_unconfigured" | "invalid_recipient" | "migration_unavailable" | "storage_unavailable" | "invalid_response";
export type TryopsHealthDelivery =
  | { status: "drained"; delivered: number; pending: number; failed: number }
  | { status: "unavailable"; reason: FailureReason };

/** Runs only inside the existing authenticated, lease-controlled health cron.
 * SQL validates the configured operator, locks due outbox rows, inserts the
 * rail receipt, and acknowledges it in one transaction. No push or email.
 */
export async function drainTryopsHealthNotifications({
  client, environment = {
    OPS_PLATFORM_ALERT_USER_ID: process.env.OPS_PLATFORM_ALERT_USER_ID,
    OPS_PLATFORM_ALERT_COMPANY_ID: process.env.OPS_PLATFORM_ALERT_COMPANY_ID,
  },
}: {
  client: SupabaseClient;
  environment?: { OPS_PLATFORM_ALERT_USER_ID?: string; OPS_PLATFORM_ALERT_COMPANY_ID?: string };
}): Promise<TryopsHealthDelivery> {
  const unavailable = (reason: FailureReason): TryopsHealthDelivery => {
    console.error("[tryops/health] delivery unavailable", { reason });
    return { status: "unavailable", reason };
  };
  const userId = environment.OPS_PLATFORM_ALERT_USER_ID?.trim() ?? "";
  const companyId = environment.OPS_PLATFORM_ALERT_COMPANY_ID?.trim() ?? "";
  if (!UUID.test(userId) || !UUID.test(companyId)) return unavailable("recipient_unconfigured");
  try {
    const { data, error } = await client.rpc("drain_tryops_health_notifications", {
      p_user_id: userId, p_company_id: companyId, p_limit: BATCH_SIZE,
    }).abortSignal(AbortSignal.timeout(5000));
    if (error) return unavailable(error.code === "PGRST202" || error.code === "42883"
      ? "migration_unavailable" : "storage_unavailable");
    if (!data || typeof data !== "object" || Array.isArray(data)) return unavailable("invalid_response");
    if (data.status === "rejected" && data.reason === "invalid_recipient") return unavailable("invalid_recipient");
    const { delivered, pending, failed } = data;
    if (data.status !== "drained" || ![delivered, pending, failed].every(value =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
      delivered + failed > BATCH_SIZE) return unavailable("invalid_response");
    const result: TryopsHealthDelivery = { status: "drained", delivered, pending, failed };
    if (failed > 0) console.error("[tryops/health] delivery pending", result);
    else if (pending > 0) console.warn("[tryops/health] delivery pending", result);
    return result;
  } catch { return unavailable("storage_unavailable"); }
}
