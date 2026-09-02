/**
 * OPS Web - Hosted Customer Surface: broker API client
 *
 * Thin, typed wrappers over the customer broker routes (`/api/customer/…`,
 * P1 plan Task 4). Every wrapper resolves to a discriminated outcome — it
 * never throws — so the UI maps outcomes to copy and nothing else.
 *
 * Privacy (design invariant I5): no outcome here carries or infers whether
 * an account exists. A rejected code is a rejected code; an unknown email
 * looks exactly like a known one.
 */

export interface StartSuccess {
  ok: true;
  challengeId: string;
  retryAfterSeconds: number;
}
export type StartFailureKind =
  | "rate_limited"
  | "unknown_handle"
  | "unavailable"
  | "offline"
  | "failed";
export interface StartFailure {
  ok: false;
  kind: StartFailureKind;
  /** Seconds until the broker will accept another send, when it said so. */
  retryAfterSeconds: number | null;
}
export type StartOutcome = StartSuccess | StartFailure;

export type VerifyFailureKind =
  | "invalid"
  | "expired"
  | "exhausted"
  | "unknown_handle"
  | "unavailable"
  | "offline"
  | "failed";
export type VerifyOutcome =
  | { ok: true; next: unknown }
  | {
      ok: false;
      kind: VerifyFailureKind;
      /** Broker-reported attempts left on this challenge (invalid_code only). */
      attemptsRemaining: number | null;
    };

export interface CustomerMe {
  displayName: string | null;
  maskedEmail: string;
  membership: { state: string | null };
}
export type MeOutcome =
  | { ok: true; me: CustomerMe }
  | { ok: false; kind: "unauthenticated" | "unknown_handle" | "offline" | "failed" };

export type SignOutOutcome = { ok: true } | { ok: false; kind: "offline" | "failed" };

/** The three realities the home placeholder renders (design §3, I2). */
export type MembershipView = "full" | "forward_only" | "none";

export function membershipView(state: string | null | undefined): MembershipView {
  switch (state) {
    case "active_full":
      return "full";
    case "active_forward_only":
      return "forward_only";
    default:
      return "none";
  }
}

/** Default resend window when the broker omits one (design I8: 1 send / 60s). */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

type FetchLike = typeof fetch;

interface JsonResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown> | null;
}

async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit
): Promise<JsonResponse | { offline: true }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { offline: true };
  }

  let body: Record<string, unknown> | null = null;
  try {
    const text = await response.text();
    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    body = null;
  }

  return { status: response.status, headers: response.headers, body };
}

function postJson(fetchImpl: FetchLike, url: string, payload: unknown) {
  return requestJson(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
}

function readNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.ceil(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function retryAfterFrom(res: JsonResponse): number | null {
  return (
    readNonNegativeInt(res.body?.retryAfterSeconds) ??
    readNonNegativeInt(res.headers.get("Retry-After"))
  );
}

function errorCodeOf(body: Record<string, unknown> | null): string {
  const raw = body?.error ?? body?.code;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

function isUnavailable(res: JsonResponse): boolean {
  return res.status === 503 || errorCodeOf(res.body).includes("unavailable");
}

// ─── Start (email → code sent) ───────────────────────────────────────────────

export async function startCustomerAuth(
  handle: string,
  email: string,
  fetchImpl: FetchLike = fetch
): Promise<StartOutcome> {
  const res = await postJson(fetchImpl, "/api/customer/auth/start", { handle, email });
  if ("offline" in res) return { ok: false, kind: "offline", retryAfterSeconds: null };

  if (res.status === 429) {
    return { ok: false, kind: "rate_limited", retryAfterSeconds: retryAfterFrom(res) };
  }
  if (res.status === 404) {
    return { ok: false, kind: "unknown_handle", retryAfterSeconds: null };
  }
  if (isUnavailable(res)) {
    return { ok: false, kind: "unavailable", retryAfterSeconds: null };
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, kind: "failed", retryAfterSeconds: null };
  }

  const challengeId = res.body?.challengeId;
  if (typeof challengeId !== "string" || challengeId.length === 0) {
    return { ok: false, kind: "failed", retryAfterSeconds: null };
  }
  return {
    ok: true,
    challengeId,
    retryAfterSeconds:
      readNonNegativeInt(res.body?.retryAfterSeconds) ?? DEFAULT_RETRY_AFTER_SECONDS,
  };
}

// ─── Verify (code → session cookie) ──────────────────────────────────────────

/**
 * Broker contract (src/app/api/customer/auth/verify/route.ts): 400 with
 * error ∈ invalid_code {attemptsRemaining} | challenge_exhausted |
 * challenge_closed (consumed or expired); 404 unknown handle; 503
 * unavailable. Anything else is a generic failure.
 */
export function classifyVerifyFailure(status: number, code: string): VerifyFailureKind {
  if (status === 503 || code.includes("unavailable")) return "unavailable";
  if (status === 404) return "unknown_handle";
  if (code.includes("expired") || code.includes("closed")) return "expired";
  if (code.includes("exhaust") || code.includes("attempt") || status === 429) return "exhausted";
  if (code.includes("invalid") || code.includes("mismatch") || code.includes("code")) {
    return "invalid";
  }
  if (status >= 400 && status < 500) return "invalid";
  return "failed";
}

export async function verifyCustomerAuth(
  handle: string,
  challengeId: string,
  code: string,
  email: string,
  fetchImpl: FetchLike = fetch
): Promise<VerifyOutcome> {
  // The code is bound to the email at the provider and the broker holds only
  // a keyed digest, so the email travels with the code.
  const res = await postJson(fetchImpl, "/api/customer/auth/verify", {
    handle,
    challengeId,
    code,
    email,
  });
  if ("offline" in res) return { ok: false, kind: "offline", attemptsRemaining: null };

  if (res.status >= 200 && res.status < 300 && res.body?.ok === true) {
    return { ok: true, next: res.body.next };
  }
  const kind = classifyVerifyFailure(res.status, errorCodeOf(res.body));
  return {
    ok: false,
    kind,
    attemptsRemaining: kind === "invalid" ? readNonNegativeInt(res.body?.attemptsRemaining) : null,
  };
}

// ─── Me (who am I, for this company) ─────────────────────────────────────────

export async function fetchCustomerMe(
  handle: string,
  fetchImpl: FetchLike = fetch
): Promise<MeOutcome> {
  const url = `/api/customer/me?handle=${encodeURIComponent(handle)}`;
  const res = await requestJson(fetchImpl, url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if ("offline" in res) return { ok: false, kind: "offline" };

  if (res.status === 401 || res.status === 403) return { ok: false, kind: "unauthenticated" };
  if (res.status === 404) return { ok: false, kind: "unknown_handle" };
  if (res.status < 200 || res.status >= 300 || !res.body) return { ok: false, kind: "failed" };

  const maskedEmail = res.body.maskedEmail;
  const membership = res.body.membership;
  const state =
    membership && typeof membership === "object"
      ? (membership as Record<string, unknown>).state
      : null;

  return {
    ok: true,
    me: {
      displayName:
        typeof res.body.displayName === "string" && res.body.displayName.trim().length > 0
          ? res.body.displayName.trim()
          : null,
      maskedEmail: typeof maskedEmail === "string" ? maskedEmail : "",
      membership: { state: typeof state === "string" ? state : null },
    },
  };
}

// ─── Sign out ────────────────────────────────────────────────────────────────

export async function signOutCustomer(
  handle: string,
  fetchImpl: FetchLike = fetch
): Promise<SignOutOutcome> {
  const res = await postJson(fetchImpl, "/api/customer/auth/signout", { handle });
  if ("offline" in res) return { ok: false, kind: "offline" };
  // 401 means there was no session to end — the visitor is signed out either way.
  if ((res.status >= 200 && res.status < 300) || res.status === 401) return { ok: true };
  return { ok: false, kind: "failed" };
}
