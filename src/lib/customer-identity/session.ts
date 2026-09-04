import "server-only";

import type { CustomerIdentityDeps } from "./config";
import { sessionDigest } from "./credentials";
import {
  appendIdentityEvent,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from "./rpc";

/**
 * Broker sessions (design I6). The cookie carries the opaque `ops_cs_`
 * credential; the database holds only its SHA-256 digest. Every read
 * resolves the row afresh, so revocation binds on the very next request and
 * nothing is ever trusted from a stale token (design I3).
 */

export const SESSION_COOKIE_NAME = "ops-customer-session" as const;
/**
 * Cookie scope (P1 plan, ruled 2026-09-02): `/`, because browsers only attach
 * a path-scoped cookie to requests under that path and the broker API lives
 * under `/api/customer`. Safe because no staff route or middleware prefix
 * ever consults this cookie (guardrail test in Task 5).
 */
export const SESSION_COOKIE_PATH = "/" as const;
/** 30 days. */
export const SESSION_ABSOLUTE_TTL_SECONDS = 2_592_000 as const;
/** 7 days (slid by the resolve RPC on every request). */
export const SESSION_IDLE_TTL_SECONDS = 604_800 as const;

export interface CustomerSession {
  readonly identityId: string;
  readonly sessionId: string;
}

/** The slice of `NextRequest` (or `cookies()`) the broker reads. */
export interface SessionCookieSource {
  readonly cookies: {
    get(name: string): { readonly value: string } | undefined;
  };
}

/** The slice of `NextResponse` the broker writes. */
export interface SessionCookieSink {
  readonly cookies: {
    set(
      name: string,
      value: string,
      options: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: "lax";
        path: string;
        maxAge: number;
      }
    ): unknown;
  };
}

const COOKIE_ATTRIBUTES = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: SESSION_COOKIE_PATH,
} as const);

export function setSessionCookie(
  response: SessionCookieSink,
  credential: string
): void {
  if (sessionDigest(credential) === null) {
    throw new TypeError("setSessionCookie requires a broker-minted credential");
  }
  response.cookies.set(SESSION_COOKIE_NAME, credential, {
    ...COOKIE_ATTRIBUTES,
    maxAge: SESSION_ABSOLUTE_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: SessionCookieSink): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...COOKIE_ATTRIBUTES,
    maxAge: 0,
  });
}

function presentedDigest(request: SessionCookieSource): string | null {
  const presented = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (typeof presented !== "string" || presented === "") return null;
  return sessionDigest(presented);
}

/**
 * Resolve the presented session. Null for no cookie, a malformed credential,
 * or any non-live status; store failures propagate so a database outage is
 * never mistaken for "signed out".
 */
export async function readSession(
  deps: CustomerIdentityDeps,
  request: SessionCookieSource
): Promise<CustomerSession | null> {
  const digest = presentedDigest(request);
  if (digest === null) return null;
  const row = await resolveSession(deps.rpc, digest);
  if (row.status !== "ok" || row.identity_id === null || row.session_id === null) {
    return null;
  }
  return Object.freeze({ identityId: row.identity_id, sessionId: row.session_id });
}

/**
 * Revoke the presented session. Resolves first so the revocation event can
 * name the identity and session; revokes regardless of live status so an
 * expired row cannot be resurrected. Returns whether a row changed.
 */
export async function signOut(
  deps: CustomerIdentityDeps,
  request: SessionCookieSource,
  context: { readonly networkFingerprint: string | null }
): Promise<boolean> {
  const digest = presentedDigest(request);
  if (digest === null) return false;

  const live = await resolveSession(deps.rpc, digest);
  const revoked = await revokeSession(deps.rpc, {
    sessionHash: digest,
    reason: "user_signout",
  });
  if (revoked) {
    await appendIdentityEvent(deps.rpc, {
      eventType: "session_revoked",
      identityId: live.identity_id,
      companyId: null,
      sessionId: live.session_id,
      networkFingerprint: context.networkFingerprint,
      metadata: { reason: "user_signout" },
    });
  }
  return revoked;
}

export async function signOutEverywhere(
  deps: CustomerIdentityDeps,
  identityId: string,
  context: { readonly reason: string; readonly networkFingerprint: string | null }
): Promise<number> {
  const count = await revokeAllSessions(deps.rpc, {
    identityId,
    reason: context.reason,
  });
  if (count > 0) {
    await appendIdentityEvent(deps.rpc, {
      eventType: "sessions_revoked_all",
      identityId,
      companyId: null,
      sessionId: null,
      networkFingerprint: context.networkFingerprint,
      metadata: { revoked_sessions: count, reason: context.reason },
    });
  }
  return count;
}
