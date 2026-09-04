import "server-only";

import { createHash, randomBytes } from "node:crypto";
import {
  SAGE_API_BASE,
  SAGE_TOKEN_URL,
  type SageCredentials,
  type SageProviderEnvironment,
} from "./sage-config";

export interface SageOAuthGrant {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface SageBusinessChoice {
  id: string;
  name: string;
}

export class SageOAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "SageOAuthError";
  }
}

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

function requestId(response: Response): string | undefined {
  const raw = response.headers.get("x-request-id")?.trim();
  return raw ? raw.slice(0, 128) : undefined;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveExpiry(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), 86_400)
    : 300;
}

async function parseGrant(
  response: Response,
  operation: "exchange" | "refresh"
): Promise<SageOAuthGrant> {
  if (!response.ok) {
    let providerCode: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown };
      providerCode = nonEmpty(body?.error) ?? undefined;
    } catch {
      // Provider bodies are intentionally discarded and never surfaced.
    }
    throw new SageOAuthError(
      `Sage token ${operation} failed (HTTP ${response.status})`,
      providerCode === "invalid_grant" ? "invalid_grant" : "token_http_error",
      response.status,
      requestId(response)
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new SageOAuthError(
      `Sage token ${operation} returned invalid JSON`,
      "invalid_response",
      response.status,
      requestId(response)
    );
  }

  const accessToken = nonEmpty(body.access_token);
  const refreshToken = nonEmpty(body.refresh_token);
  if (!accessToken || !refreshToken) {
    const code =
      operation === "refresh" && accessToken && !refreshToken
        ? "missing_rotated_refresh_token"
        : "invalid_response";
    throw new SageOAuthError(
      `Sage token ${operation} returned an incomplete grant`,
      code,
      response.status,
      requestId(response)
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: positiveExpiry(body.expires_in),
  };
}

export function createSageOAuthSecrets(): {
  state: string;
  verifier: string;
  challenge: string;
} {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  return { state, verifier, challenge };
}

export function digestSageOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function sageBusinessIdLookup(businessId: string): string {
  return createHash("sha256").update(businessId, "utf8").digest("hex");
}

export async function exchangeSageAuthorizationCode(
  input: {
    code: string;
    verifier: string;
    credentials: SageCredentials;
  },
  fetchFn: FetchFn = fetch
): Promise<SageOAuthGrant> {
  const response = await fetchFn(SAGE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.credentials.redirectUri,
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      code_verifier: input.verifier,
    }),
  });
  return parseGrant(response, "exchange");
}

export async function refreshSageOAuthGrant(
  input: { refreshToken: string; credentials: SageCredentials },
  fetchFn: FetchFn = fetch
): Promise<SageOAuthGrant> {
  const response = await fetchFn(SAGE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
    }),
  });
  return parseGrant(response, "refresh");
}

function isActiveBusiness(value: Record<string, unknown>): boolean {
  if (value.active === true) return true;
  const subscription =
    value.subscription && typeof value.subscription === "object"
      ? (value.subscription as Record<string, unknown>)
      : undefined;
  const status =
    nonEmpty(value.subscription_status) ??
    nonEmpty(value.business_status) ??
    nonEmpty(subscription?.status) ??
    nonEmpty(value.status);
  return status?.toUpperCase() === "ACTIVE";
}

export async function discoverEligibleSageBusinesses(
  input: {
    accessToken: string;
    environment: SageProviderEnvironment;
    allowedSandboxBusinessIds: readonly string[];
  },
  fetchFn: FetchFn = fetch
): Promise<SageBusinessChoice[]> {
  const allowList = new Set(
    input.allowedSandboxBusinessIds.map((value) => value.trim()).filter(Boolean)
  );
  if (input.environment === "sandbox" && allowList.size === 0) {
    throw new SageOAuthError(
      "Sage sandbox business allow-list is missing",
      "sandbox_allow_list_missing"
    );
  }

  const response = await fetchFn(`${SAGE_API_BASE}/businesses`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
  });
  if (!response.ok) {
    throw new SageOAuthError(
      `Sage business discovery failed (HTTP ${response.status})`,
      "business_discovery_failed",
      response.status,
      requestId(response)
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SageOAuthError(
      "Sage business discovery returned invalid JSON",
      "invalid_response",
      response.status,
      requestId(response)
    );
  }
  const items =
    body &&
    typeof body === "object" &&
    Array.isArray((body as { $items?: unknown }).$items)
      ? (body as { $items: unknown[] }).$items
      : Array.isArray(body)
        ? body
        : null;
  if (!items) {
    throw new SageOAuthError(
      "Sage business discovery returned an invalid payload",
      "invalid_response",
      response.status,
      requestId(response)
    );
  }

  const byId = new Map<string, SageBusinessChoice>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = nonEmpty(record.id);
    const name = nonEmpty(record.name);
    if (!id || !name || !isActiveBusiness(record)) continue;
    if (input.environment === "sandbox" && !allowList.has(id)) continue;
    byId.set(id, { id, name });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
