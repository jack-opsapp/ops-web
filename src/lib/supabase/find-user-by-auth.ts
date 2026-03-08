/**
 * OPS Web - User Lookup by Auth Credentials
 *
 * Finds a user via fallback chain: auth_id → firebase_uid → email.
 * Needed because auth_id was historically UUID type (preventing Firebase UID storage),
 * so many users have neither auth_id nor firebase_uid populated.
 *
 * NEVER import this from client-side code.
 */

import { getServiceRoleClient } from "./server-client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Find a user by auth credentials with fallback chain:
 * auth_id → firebase_uid → email
 *
 * @param uid - The auth UID (Firebase UID or Supabase auth UUID)
 * @param email - Optional email for fallback lookup
 * @param select - Columns to select (default: "id, company_id")
 */
export async function findUserByAuth(
  uid: string,
  email?: string,
  select = "id, company_id"
): Promise<Record<string, unknown> | null> {
  const db = getServiceRoleClient();

  const { data: byAuthId } = await db
    .from("users")
    .select(select)
    .eq("auth_id", uid)
    .is("deleted_at", null)
    .maybeSingle();
  if (byAuthId) return byAuthId as any;

  const { data: byFirebaseUid } = await db
    .from("users")
    .select(select)
    .eq("firebase_uid", uid)
    .is("deleted_at", null)
    .maybeSingle();
  if (byFirebaseUid) return byFirebaseUid as any;

  if (email) {
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
