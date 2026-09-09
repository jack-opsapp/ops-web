/**
 * Engine readiness — the server-side probe and its storage.
 *
 * SERVER ONLY. Runs the same read-only checks as scripts/ads/validate-probe.mjs
 * (a validateOnly budget mutate, the conversion-tracking settings, the
 * service account's role, a validateOnly Data Manager ingest) and stores the
 * result on the existing `ads_sync_status` row `engine-readiness`, in its
 * jsonb `backfill_progress` column — reused rather than adding schema; the
 * column is a free-form progress blob on every other row too.
 *
 * `loadReadinessInputs` pairs the stored probe with live counts for
 * computeReadiness. Nothing here writes to Google.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GoogleAdsApiError,
  getConversionTrackingSetting,
  getServiceAccountAccessRole,
  getServingCustomerIds,
  listConversionActions,
  mutateGoogleAds,
} from "@/lib/analytics/google-ads-client";
import { getServiceAccountCredentials } from "@/lib/google/service-account-credentials";
import { DataManagerApiError, ingestEvents } from "./data-manager-client";
import type { ReadinessInputs, StoredProbe } from "./readiness";

export const READINESS_STATUS_ID = "engine-readiness";

function firstAdsErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; details?: Array<{ errors?: Array<{ errorCode?: Record<string, string> }> }> };
    };
    for (const detail of parsed.error?.details ?? []) {
      for (const err of detail.errors ?? []) {
        const entry = err.errorCode ? Object.entries(err.errorCode)[0] : undefined;
        if (entry) return `${entry[0]}.${entry[1]}`;
      }
    }
    return parsed.error?.status ?? null;
  } catch {
    return null;
  }
}

async function probeWriteAccess(probedAt: string): Promise<{ status: number | null; errorCode: string | null }> {
  try {
    const result = await mutateGoogleAds(
      [
        {
          campaignBudgetOperation: {
            create: { name: `probe ${probedAt}`, amountMicros: "1000000", deliveryMethod: "STANDARD" },
          },
        },
      ],
      { validateOnly: true }
    );
    if (result.failures.length > 0) {
      return { status: 200, errorCode: result.failures[0].code };
    }
    return { status: 200, errorCode: null };
  } catch (error) {
    if (error instanceof GoogleAdsApiError) {
      return { status: error.status, errorCode: firstAdsErrorCode(error.body) };
    }
    return { status: null, errorCode: error instanceof Error ? error.message : String(error) };
  }
}

async function probeDataManager(
  db: SupabaseClient,
  probedAt: string
): Promise<StoredProbe["dataManager"]> {
  try {
    const { servingId, loginId } = await getServingCustomerIds();
    const { data } = await db
      .from("ads_conversion_actions")
      .select("google_id")
      .eq("kind", "trial_started")
      .maybeSingle();
    let destination = (data as { google_id?: string } | null)?.google_id ?? null;
    if (!destination) {
      const live = await listConversionActions();
      destination = live.find((a) => a.status === "ENABLED" && a.id)?.id ?? "0";
    }
    await ingestEvents(
      {
        destinations: [
          {
            operatingAccount: { accountType: "GOOGLE_ADS", accountId: servingId },
            ...(loginId ? { loginAccount: { accountType: "GOOGLE_ADS" as const, accountId: loginId } } : {}),
            productDestinationId: destination,
          },
        ],
        events: [
          {
            transactionId: `probe:${probedAt}`,
            eventTimestamp: probedAt.replace(/\.\d{3}Z$/, "+00:00"),
            eventSource: "WEB",
            userData: {
              userIdentifiers: [
                { emailAddress: createHash("sha256").update("probe@example.invalid").digest("hex") },
              ],
            },
            consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
          },
        ],
        encoding: "HEX",
      },
      { validateOnly: true }
    );
    return { status: 200, errorStatus: null, reason: null };
  } catch (error) {
    if (error instanceof DataManagerApiError) {
      return { status: error.status, errorStatus: error.errorStatus, reason: error.reason };
    }
    return { status: null, errorStatus: "TOKEN_ERROR", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Run every readiness check against Google. Read-only: validateOnly throughout. */
export async function runReadinessProbe(db: SupabaseClient): Promise<StoredProbe> {
  const probedAt = new Date().toISOString();
  const serviceAccountEmail = getServiceAccountCredentials().client_email;
  const [write, tracking, access, dataManager] = await Promise.all([
    probeWriteAccess(probedAt),
    getConversionTrackingSetting(),
    getServiceAccountAccessRole(serviceAccountEmail),
    probeDataManager(db, probedAt),
  ]);
  return {
    probedAt,
    mutateStatus: write.status,
    mutateErrorCode: write.errorCode,
    serviceAccountRole: access.role,
    acceptedCustomerDataTerms: tracking.acceptedCustomerDataTerms,
    enhancedConversionsForLeadsEnabled: tracking.enhancedConversionsForLeadsEnabled,
    dataManager,
  };
}

export async function storeReadinessProbe(db: SupabaseClient, probe: StoredProbe): Promise<void> {
  const { error } = await db.from("ads_sync_status").upsert(
    {
      id: READINESS_STATUS_ID,
      status: "complete",
      error: null,
      backfill_progress: probe,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`readiness probe store failed: ${error.message}`);
}

function isStoredProbe(value: unknown): value is StoredProbe {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredProbe).probedAt === "string" &&
    typeof (value as StoredProbe).dataManager === "object"
  );
}

export async function loadReadinessProbe(db: SupabaseClient): Promise<StoredProbe | null> {
  const { data, error } = await db
    .from("ads_sync_status")
    .select("backfill_progress")
    .eq("id", READINESS_STATUS_ID)
    .maybeSingle();
  if (error) throw new Error(`readiness probe read failed: ${error.message}`);
  const stored = (data as { backfill_progress?: unknown } | null)?.backfill_progress;
  return isStoredProbe(stored) ? stored : null;
}

/** Probe + store. Never throws on a Google failure — the probe records it. */
export async function refreshReadinessProbe(db: SupabaseClient): Promise<StoredProbe> {
  const probe = await runReadinessProbe(db);
  await storeReadinessProbe(db, probe);
  return probe;
}

export interface ReadinessCounts {
  conversionActions: number;
  clickIdCompanies30d: number;
  eventStates: ReadinessInputs["eventStates"];
}

export async function loadReadinessCounts(db: SupabaseClient): Promise<ReadinessCounts> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [actions, clicks, events] = await Promise.all([
    db.from("ads_conversion_actions").select("kind", { count: "exact", head: true }),
    db
      .from("trial_attributions")
      .select("company_id", { count: "exact", head: true })
      .or("gclid.not.is.null,gbraid.not.is.null,wbraid.not.is.null")
      .gte("updated_at", since),
    db.from("ads_conversion_events").select("state"),
  ]);
  if (actions.error) throw new Error(`readiness counts failed: ${actions.error.message}`);
  if (clicks.error) throw new Error(`readiness counts failed: ${clicks.error.message}`);
  if (events.error) throw new Error(`readiness counts failed: ${events.error.message}`);
  const eventStates: ReadinessInputs["eventStates"] = {};
  for (const row of (events.data ?? []) as Array<{ state: string }>) {
    const key = row.state as keyof ReadinessInputs["eventStates"];
    eventStates[key] = (eventStates[key] ?? 0) + 1;
  }
  return {
    conversionActions: actions.count ?? 0,
    clickIdCompanies30d: clicks.count ?? 0,
    eventStates,
  };
}

export async function loadReadinessInputs(db: SupabaseClient): Promise<ReadinessInputs> {
  const [probe, counts] = await Promise.all([loadReadinessProbe(db), loadReadinessCounts(db)]);
  return {
    probe,
    conversionActionCount: counts.conversionActions,
    clickIdCompanies30d: counts.clickIdCompanies30d,
    eventStates: counts.eventStates,
  };
}
