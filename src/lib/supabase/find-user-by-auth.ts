/**
 * OPS Web - User Lookup by Auth Credentials
 *
 * Finds a user via fallback chain: auth_id → firebase_uid → email.
 * Needed because auth_id was historically UUID type (preventing Firebase UID storage),
 * so many users have neither auth_id nor firebase_uid populated.
 *
 * CRIT-3 Phase A — opportunistic backfill. The RLS identity helpers are being
 * re-keyed off the cryptographic token sub (auth_id / firebase_uid) instead of
 * the spoofable email claim. To make that re-key safe, every active row must be
 * sub-linked first. This resolver runs on ~every authenticated request, so when
 * a row is matched by a CRYPTOGRAPHIC path (firebase_uid == verified sub) and
 * its provider-agnostic auth_id is still NULL, it stamps auth_id = sub here —
 * trending the unlinked population toward zero on normal traffic, not just on
 * login (sync-user already backfills on the login path). An email match is NOT
 * proof of possession, so identity is NEVER written on the email branch.
 *
 * NEVER import this from client-side code.
 */

import { getServiceRoleClient } from "./server-client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Ensure a comma-separated PostgREST select list contains `column`. */
function withColumn(select: string, column: string): string {
  const cols = select.split(",").map((c) => c.trim());
  if (cols.includes("*") || cols.includes(column)) return select;
  return `${select}, ${column}`;
}

/**
 * Find a user by auth credentials with fallback chain:
 * auth_id → firebase_uid → email
 *
 * @param uid - The verified token sub (Firebase UID or Supabase auth UUID)
 * @param email - Optional verified-token email for the legacy-link fallback
 * @param select - Columns to select (default: "id, company_id")
 */
export async function findUserByAuth(
  uid: string,
  email?: string,
  select = "id, company_id"
): Promise<Record<string, unknown> | null> {
  const db = getServiceRoleClient();

  // 1. auth_id == sub — provider-agnostic cryptographic match; already linked.
  const { data: byAuthId } = await db
    .from("users")
    .select(select)
    .eq("auth_id", uid)
    .is("deleted_at", null)
    .maybeSingle();
  if (byAuthId) return byAuthId as any;

  // 2. firebase_uid == sub — cryptographic match. `uid` is a proven Firebase
  //    UID here (the column only ever holds Firebase UIDs). Opportunistic
  //    backfill: if auth_id is still NULL, stamp it = uid so the row is also
  //    resolvable by the provider-agnostic auth_id predicate the re-keyed RLS
  //    helpers use. NULL-guarded (`.is("auth_id", null)`) so it is idempotent,
  //    race-safe, and can never overwrite an existing identity. Mirrors
  //    sync-user's ungated auth_id backfill (route.ts).
  const { data: byFirebaseUid } = await db
    .from("users")
    .select(withColumn(withColumn(select, "id"), "auth_id"))
    .eq("firebase_uid", uid)
    .is("deleted_at", null)
    .maybeSingle();
  if (byFirebaseUid) {
    const row = byFirebaseUid as unknown as Record<string, unknown>;
    if (row.auth_id == null && row.id != null) {
      await db
        .from("users")
        .update({ auth_id: uid })
        .eq("id", row.id as string)
        .is("auth_id", null);
      row.auth_id = uid;
    }
    return row as any;
  }

  // 3. email fallback (verified-token email) — the legacy-link path for the
  //    not-yet-sub-linked cohort. An email match is NOT cryptographic proof of
  //    possession (CRIT-3), so identity is NEVER backfilled here.
  //    Phase D: once the RLS helpers are re-keyed to the sub (Phase C) and the
  //    active base is fully linked, CRIT3_SUB_IDENTITY=true drops this branch
  //    so ALL resolution is cryptographic. Default off keeps legacy login
  //    working until the re-key is live.
  const dropEmailFallback = process.env.CRIT3_SUB_IDENTITY === "true";
  if (email && !dropEmailFallback) {
    const { data: byEmail } = await db
      .from("users")
      .select(select)
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();
    if (byEmail) return byEmail as any;
  }

  return null;
}
