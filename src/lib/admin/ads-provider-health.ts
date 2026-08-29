import "server-only";
import { GoogleAdsApiError } from "@/lib/analytics/google-ads-client";
import { getOptionalPmfOperatorIdentity } from "@/lib/pmf/recipients";
import type { getAdminSupabase } from "@/lib/supabase/admin-client";

/**
 * Shared degrade contract for the three Google Ads cron workflows
 * (`ads-sync` 08:04, `pmf/google-ads-sync` 10:24, `ads-briefing` Mon 12:34 UTC).
 *
 * Bug 964cf782: an unapproved developer token made every scheduled run
 * hard-500 for four weeks. The status rows were truthful but nothing was
 * watching them, and the 500 storm filed seven duplicate health reports while
 * the PMF dashboard silently lacked spend data. A standing access condition is
 * an operator fact, not a code defect: record it once, say it once, and keep
 * returning 200 so real defects stay distinguishable.
 *
 * Concurrency: the three callers are scheduled hours apart and never run
 * concurrently, so the read-then-write transition detection is race-free in
 * practice; the worst theoretical race is one duplicate notification.
 */

type AdminClient = ReturnType<typeof getAdminSupabase>;

const PROVIDER_ACCESS_STATUS_ID = "provider-access";

/** Markers that mean "the account/token cannot access the API" — a standing
 * operator condition, not a transient or code failure. */
const ACCESS_MARKERS = [
  "DEVELOPER_TOKEN_NOT_APPROVED",
  "DEVELOPER_TOKEN_PROHIBITED",
  "CUSTOMER_NOT_ENABLED",
  "NOT_ADS_USER",
  "OAUTH_TOKEN_REVOKED",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "authorizationError",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "invalid_grant",
] as const;

/** Walk the cause chain; return a one-line reason when the failure is a
 * Google Ads access/authorization condition, else null. */
export function classifyGoogleAdsAccessFailure(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const isAdsError =
      current instanceof GoogleAdsApiError
        ? current.status === 401 || current.status === 403
        : current instanceof Error &&
          /^Google Ads API error \((401|403)\)/.test(current.message);
    if (isAdsError) {
      const message = (current as Error).message;
      const marker =
        ACCESS_MARKERS.find((candidate) => message.includes(candidate)) ??
        "PERMISSION_DENIED";
      return `Google Ads API access blocked (${marker}). Scheduled ads syncs are paused until access is restored.`;
    }
    current =
      current instanceof Error
        ? (current as { cause?: unknown }).cause
        : typeof current === "object" && current !== null
          ? (current as Record<string, unknown>).cause
          : null;
  }
  return null;
}

interface ProviderHealth {
  blocked: boolean;
  reason?: string;
}

/** Persist the shared provider-access state; report whether it transitioned.
 * A missing row counts as healthy, so the first-ever healthy run stays silent. */
async function recordAdsProviderAccess(
  sb: AdminClient,
  next: ProviderHealth
): Promise<{ transitioned: boolean }> {
  const { data: existing, error: readError } = await sb
    .from("ads_sync_status")
    .select("id, status")
    .eq("id", PROVIDER_ACCESS_STATUS_ID)
    .maybeSingle();
  if (readError) {
    console.error("[ads-provider-health] state read failed:", readError);
    return { transitioned: false };
  }
  const wasBlocked = existing?.status === "failed";
  const { error: writeError } = await sb.from("ads_sync_status").upsert(
    {
      id: PROVIDER_ACCESS_STATUS_ID,
      status: next.blocked ? "failed" : "complete",
      error: next.blocked ? next.reason ?? "access blocked" : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (writeError) {
    console.error("[ads-provider-health] state write failed:", writeError);
    return { transitioned: false };
  }
  return { transitioned: existing ? wasBlocked !== next.blocked : next.blocked };
}

async function notifyTransition(
  sb: AdminClient,
  next: ProviderHealth
): Promise<void> {
  const identity = getOptionalPmfOperatorIdentity();
  if (!identity) {
    console.warn("[ads-provider-health] operator identity unset; skipping notification");
    return;
  }
  const { error } = await sb.from("notifications").insert({
    user_id: identity.operatorUserId,
    company_id: identity.operatorCompanyId,
    type: "ads_provider_alert",
    title: next.blocked ? "GOOGLE ADS ACCESS BLOCKED" : "GOOGLE ADS ACCESS RESTORED",
    body: next.blocked
      ? next.reason ?? "Google Ads API access blocked."
      : "Scheduled ads syncs are running again.",
    is_read: false,
    persistent: next.blocked,
    action_url: "/admin/google-ads",
    action_label: "VIEW ADS",
  });
  if (error) {
    console.error("[ads-provider-health] notification insert failed:", error);
  }
}

/** Single entry point for the three ads cron routes. Never throws. */
export async function reportAdsProviderHealth(
  sb: AdminClient,
  next: ProviderHealth
): Promise<void> {
  try {
    const { transitioned } = await recordAdsProviderAccess(sb, next);
    if (transitioned) await notifyTransition(sb, next);
  } catch (error) {
    console.error("[ads-provider-health] reporting failed:", error);
  }
}
