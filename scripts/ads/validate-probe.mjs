#!/usr/bin/env node
/**
 * Google Ads engine — write-access readiness probe.
 *
 * Standalone (no `@/` imports). Reads `.env.local` from the current working
 * directory, mints a service-account access token, and performs READ-ONLY
 * checks against the OPS Google Ads account:
 *
 *   1. `campaignBudgets:mutate` with `validateOnly: true` on the serving
 *      customer — proves whether the service account may write. Nothing is
 *      created: validateOnly never persists.
 *   2. `customer.conversion_tracking_setting` on the serving customer —
 *      Customer data terms + Enhanced conversions for leads.
 *   3. `customer_user_access` on the manager (and the client) — the service
 *      account's role.
 *   4. Data Manager `events:ingest` with `validateOnly: true` — proves the API
 *      is enabled on the Cloud project and the account accepts uploads.
 *   5. The live conversion-action list — what Task 3's planner will reconcile.
 *
 * Usage:  node scripts/ads/validate-probe.mjs [--out docs/artifacts/ads-engine/p1]
 * Output: `<out>/probe-<ISO timestamp>.json`, also printed to stdout.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { GoogleAuth } from "google-auth-library";

const ADS_API_VERSION = "v25";
const ADS_BASE_URL = `https://googleads.googleapis.com/${ADS_API_VERSION}`;
const DATA_MANAGER_URL = "https://datamanager.googleapis.com/v1/events:ingest";
const MANAGER_ID = "5448339076";
const SERVING_ID = "4454506598";

// ─── .env.local loader (never prints values) ─────────────────────────────────

function loadEnvLocal(path = ".env.local") {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ─── Private key normalisation — mirrors src/lib/firebase/parse-private-key.ts ─

function parsePrivateKey(raw) {
  if (!raw) return undefined;
  let key = raw.replace(/^["']|["']$/g, "");
  key = key.replace(/\\n/g, "\n");
  if (key.includes("-----BEGIN")) return key;
  const base64 = key.replace(/\s/g, "");
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function buildCredentials() {
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountJson) return JSON.parse(serviceAccountJson);
  const privateKey = parsePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail =
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL ??
    `firebase-adminsdk-fbsvc@${projectId}.iam.gserviceaccount.com`;
  if (!privateKey || !projectId) {
    throw new Error("Missing FIREBASE_ADMIN_PRIVATE_KEY or NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  }
  return { client_email: clientEmail, private_key: privateKey };
}

async function accessTokenFor(credentials, scope) {
  const auth = new GoogleAuth({ credentials, scopes: [scope] });
  const client = await auth.getClient();
  const res = await client.getAccessToken();
  const token = typeof res === "string" ? res : res?.token;
  if (!token) throw new Error(`No access token for scope ${scope}`);
  return token;
}

// ─── Google Ads REST helpers ─────────────────────────────────────────────────

function adsHeaders(accessToken, loginCustomerId) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    "Content-Type": "application/json",
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}

/** First `errorCode` in a Google Ads error body as `<enum>.<value>`, or null. */
function firstAdsErrorCode(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const details = parsed?.error?.details ?? [];
    for (const detail of details) {
      for (const err of detail?.errors ?? []) {
        const code = err?.errorCode;
        if (code && typeof code === "object") {
          const [k, v] = Object.entries(code)[0] ?? [];
          if (k) return `${k}.${v}`;
        }
      }
    }
    return parsed?.error?.status ?? null;
  } catch {
    return null;
  }
}

async function adsSearch(accessToken, customerId, gaql, loginCustomerId) {
  const res = await fetch(`${ADS_BASE_URL}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: adsHeaders(accessToken, loginCustomerId),
    body: JSON.stringify({ query: gaql }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, errorCode: firstAdsErrorCode(text), results: [] };
  }
  const data = JSON.parse(text);
  return { ok: true, status: res.status, errorCode: null, results: data.results ?? [], requestId: data.requestId ?? null };
}

async function probeMutateValidateOnly(accessToken, probedAt) {
  const res = await fetch(`${ADS_BASE_URL}/customers/${SERVING_ID}/campaignBudgets:mutate`, {
    method: "POST",
    headers: adsHeaders(accessToken, MANAGER_ID),
    body: JSON.stringify({
      operations: [
        { create: { name: `probe ${probedAt}`, amountMicros: "1000000", deliveryMethod: "STANDARD" } },
      ],
      validateOnly: true,
    }),
  });
  const text = await res.text();
  return {
    status: res.status,
    errorCode: res.ok ? null : firstAdsErrorCode(text),
    requestId: res.headers.get("request-id") ?? null,
  };
}

async function probeConversionTracking(accessToken) {
  const r = await adsSearch(
    accessToken,
    SERVING_ID,
    `SELECT customer.conversion_tracking_setting.accepted_customer_data_terms,
            customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled,
            customer.conversion_tracking_setting.conversion_tracking_status
     FROM customer`,
    MANAGER_ID
  );
  const setting = r.results[0]?.customer?.conversionTrackingSetting ?? {};
  return {
    status: r.status,
    errorCode: r.errorCode,
    acceptedCustomerDataTerms: setting.acceptedCustomerDataTerms === true,
    enhancedConversionsForLeadsEnabled: setting.enhancedConversionsForLeadsEnabled === true,
    conversionTrackingStatus: setting.conversionTrackingStatus ?? null,
  };
}

async function probeUserAccess(accessToken, customerId, serviceAccountEmail) {
  const r = await adsSearch(
    accessToken,
    customerId,
    `SELECT customer_user_access.user_id, customer_user_access.email_address,
            customer_user_access.access_role
     FROM customer_user_access`,
    MANAGER_ID
  );
  const rows = r.results.map((row) => row.customerUserAccess ?? {});
  const self = rows.find(
    (row) => String(row.emailAddress ?? "").toLowerCase() === serviceAccountEmail.toLowerCase()
  );
  return {
    status: r.status,
    errorCode: r.errorCode,
    role: self?.accessRole ?? null,
    present: !!self,
    userCount: rows.length,
  };
}

async function probeConversionActions(accessToken) {
  const r = await adsSearch(
    accessToken,
    SERVING_ID,
    `SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name,
            conversion_action.type, conversion_action.category, conversion_action.status,
            conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric,
            conversion_action.counting_type, conversion_action.click_through_lookback_window_days
     FROM conversion_action
     WHERE conversion_action.status != 'REMOVED'`,
    MANAGER_ID
  );
  return {
    status: r.status,
    errorCode: r.errorCode,
    actions: r.results.map((row) => row.conversionAction ?? {}),
  };
}

// ─── Data Manager validateOnly ───────────────────────────────────────────────

function rfc3339WithOffset(date) {
  // Google wants an explicit offset; UTC written as +00:00 is accepted.
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

async function probeDataManagerValidateOnly(accessToken, productDestinationId, probedAt) {
  const dummyEmail = createHash("sha256").update("probe@example.invalid").digest("hex");
  const body = {
    destinations: [
      {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: SERVING_ID },
        loginAccount: { accountType: "GOOGLE_ADS", accountId: MANAGER_ID },
        productDestinationId: String(productDestinationId ?? "0"),
      },
    ],
    events: [
      {
        transactionId: `probe:${probedAt}`,
        eventTimestamp: rfc3339WithOffset(new Date(probedAt)),
        eventSource: "WEB",
        userData: { userIdentifiers: [{ emailAddress: dummyEmail }] },
        consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
      },
    ],
    validateOnly: true,
    encoding: "HEX",
  };
  const res = await fetch(DATA_MANAGER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON body */ }
  const errorStatus = parsed?.error?.status ?? null;
  const reason = parsed?.error?.details?.find((d) => d?.reason)?.reason ?? null;
  return {
    status: res.status,
    errorStatus,
    reason,
    message: res.ok ? null : (parsed?.error?.message ?? text.slice(0, 300)),
    requestId: parsed?.requestId ?? null,
    fieldWarnings: parsed?.fieldWarnings ?? [],
    destinationUsed: String(productDestinationId ?? "0"),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  loadEnvLocal();
  const outDir = (() => {
    const i = process.argv.indexOf("--out");
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "docs/artifacts/ads-engine/p1";
  })();

  const credentials = buildCredentials();
  const serviceAccountEmail = credentials.client_email;
  const probedAt = new Date().toISOString();

  const adsToken = await accessTokenFor(credentials, "https://www.googleapis.com/auth/adwords");

  const [mutateValidateOnly, tracking, managerAccess, clientAccess, conversionActions] =
    await Promise.all([
      probeMutateValidateOnly(adsToken, probedAt),
      probeConversionTracking(adsToken),
      probeUserAccess(adsToken, MANAGER_ID, serviceAccountEmail),
      probeUserAccess(adsToken, SERVING_ID, serviceAccountEmail),
      probeConversionActions(adsToken),
    ]);

  // Data Manager: validate against an existing enabled action id when one
  // exists (validateOnly never persists); a 4xx other than
  // PERMISSION_DENIED / SERVICE_DISABLED still proves the API is reachable.
  let dataManagerValidateOnly;
  try {
    const dmToken = await accessTokenFor(credentials, "https://www.googleapis.com/auth/datamanager");
    const enabled = conversionActions.actions.find((a) => a.status === "ENABLED" && a.id);
    dataManagerValidateOnly = await probeDataManagerValidateOnly(dmToken, enabled?.id, probedAt);
  } catch (err) {
    dataManagerValidateOnly = {
      status: 0,
      errorStatus: "TOKEN_ERROR",
      reason: null,
      message: err instanceof Error ? err.message : String(err),
      requestId: null,
      fieldWarnings: [],
      destinationUsed: null,
    };
  }

  const dataManagerReachable =
    dataManagerValidateOnly.status === 200 ||
    (dataManagerValidateOnly.status >= 400 &&
      dataManagerValidateOnly.status < 500 &&
      dataManagerValidateOnly.errorStatus !== "PERMISSION_DENIED" &&
      dataManagerValidateOnly.reason !== "SERVICE_DISABLED");

  const result = {
    probedAt,
    apiVersion: ADS_API_VERSION,
    serviceAccount: serviceAccountEmail,
    managerId: MANAGER_ID,
    servingId: SERVING_ID,
    mutateValidateOnly,
    acceptedCustomerDataTerms: tracking.acceptedCustomerDataTerms,
    enhancedConversionsForLeadsEnabled: tracking.enhancedConversionsForLeadsEnabled,
    conversionTrackingStatus: tracking.conversionTrackingStatus,
    serviceAccountRole: managerAccess.role,
    serviceAccountAccess: {
      manager: { role: managerAccess.role, present: managerAccess.present, status: managerAccess.status, errorCode: managerAccess.errorCode },
      client: { role: clientAccess.role, present: clientAccess.present, status: clientAccess.status, errorCode: clientAccess.errorCode },
    },
    dataManagerValidateOnly,
    dataManagerReachable,
    conversionActions: conversionActions.actions,
    gate: {
      writeAccess: mutateValidateOnly.status === 200,
      customerDataTerms: tracking.acceptedCustomerDataTerms,
      enhancedConversionsForLeads: tracking.enhancedConversionsForLeadsEnabled,
      dataManagerApi: dataManagerReachable,
      green:
        mutateValidateOnly.status === 200 &&
        tracking.acceptedCustomerDataTerms &&
        tracking.enhancedConversionsForLeadsEnabled &&
        dataManagerReachable,
    },
  };

  mkdirSync(outDir, { recursive: true });
  const fileName = `probe-${probedAt.replace(/[:.]/g, "-")}.json`;
  const outPath = join(outDir, fileName);
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  console.error(`\nwrote ${outPath}`);
  process.exit(result.gate.green ? 0 : 2);
}

main().catch((err) => {
  console.error("probe failed:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
