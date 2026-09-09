/**
 * Google Data Manager API — conversion event ingestion.
 *
 * SERVER ONLY. The Ads API's UploadClickConversions is closed to developer
 * tokens without prior usage (since 2026-06-15), so every OPS conversion goes
 * through `POST https://datamanager.googleapis.com/v1/events:ingest`. Same
 * service account as the Ads client, different OAuth scope.
 *
 * This module is a faithful transport: it posts what it is given and returns
 * `{ requestId, fieldWarnings }`. Batching, identifier resolution, and the
 * retry ledger live in conversion-outbox.ts.
 */
import { GoogleAuth } from "google-auth-library";
import { getServiceAccountCredentials } from "@/lib/google/service-account-credentials";

export const DATA_MANAGER_INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";
export const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";

export interface DataManagerAccount {
  accountType: "GOOGLE_ADS";
  accountId: string;
}

export interface DataManagerDestination {
  operatingAccount: DataManagerAccount;
  loginAccount?: DataManagerAccount;
  /** The conversion action id the events are attributed to. */
  productDestinationId: string;
}

export interface DataManagerConsent {
  adUserData: "CONSENT_GRANTED" | "CONSENT_DENIED" | "CONSENT_UNSPECIFIED";
  adPersonalization: "CONSENT_GRANTED" | "CONSENT_DENIED" | "CONSENT_UNSPECIFIED";
}

export interface DataManagerEvent {
  transactionId: string;
  /** RFC 3339 with an explicit UTC offset. */
  eventTimestamp: string;
  eventSource: "WEB" | "APP" | "IN_STORE" | "PHONE" | "OTHER";
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  userData?: { userIdentifiers: Array<{ emailAddress: string }> };
  consent?: DataManagerConsent;
  conversionValue?: number;
  currency?: string;
}

export interface IngestEventsRequest {
  destinations: DataManagerDestination[];
  events: DataManagerEvent[];
  consent?: DataManagerConsent;
  encoding: "HEX" | "BASE64";
}

export interface IngestEventsResponse {
  requestId?: string;
  fieldWarnings: unknown[];
}

export class DataManagerApiError extends Error {
  readonly status: number;
  readonly body: string;
  /** google.rpc.Status.status when the body carried one (PERMISSION_DENIED, …). */
  readonly errorStatus: string | null;
  /** ErrorInfo.reason when present (SERVICE_DISABLED, …). */
  readonly reason: string | null;
  constructor(status: number, body: string) {
    super(`Data Manager API error (${status}): ${body}`);
    this.name = "DataManagerApiError";
    this.status = status;
    this.body = body;
    let errorStatus: string | null = null;
    let reason: string | null = null;
    try {
      const parsed = JSON.parse(body) as {
        error?: { status?: string; details?: Array<{ reason?: string }> };
      };
      errorStatus = parsed.error?.status ?? null;
      reason = parsed.error?.details?.find((d) => d?.reason)?.reason ?? null;
    } catch {
      // non-JSON body
    }
    this.errorStatus = errorStatus;
    this.reason = reason;
  }
}

let _auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (_auth) return _auth;
  _auth = new GoogleAuth({
    credentials: getServiceAccountCredentials(),
    scopes: [DATA_MANAGER_SCOPE],
  });
  return _auth;
}

async function getAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) throw new Error("Failed to obtain access token for the Data Manager API");
  return token;
}

/**
 * Ingest a batch of conversion events. `validateOnly` asks Google to check the
 * request without recording anything — used in tests, in the readiness probe,
 * and in the first live rehearsal.
 */
export async function ingestEvents(
  request: IngestEventsRequest,
  options: { validateOnly?: boolean } = {}
): Promise<IngestEventsResponse> {
  const accessToken = await getAccessToken();
  const response = await fetch(DATA_MANAGER_INGEST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...request, validateOnly: options.validateOnly ?? false }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new DataManagerApiError(response.status, body);
  }

  const body = (await response.json()) as { requestId?: string; fieldWarnings?: unknown[] } | null;
  return {
    requestId: body?.requestId,
    fieldWarnings: Array.isArray(body?.fieldWarnings) ? body.fieldWarnings : [],
  };
}
