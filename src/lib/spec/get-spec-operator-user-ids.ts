/**
 * OPS Web — SPEC operator user-id resolver (server-only)
 *
 * Mirrors `private.is_spec_operator()` (bible 02_DATA_MODEL.md § Operator gate)
 * in TypeScript so server routes can fan out operator notifications. Reads
 * the same `role_permissions` + `user_permission_overrides` rows the SQL
 * function consults. Customer-company admin status is intentionally NOT a
 * trigger — only explicit `spec.admin` grants.
 *
 * NEVER import from client-side code.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";

let _cache: { ids: string[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function getSpecOperatorUserIds(): Promise<string[]> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.ids;

  const db = getServiceRoleClient();

  const { data: roleRows } = await db
    .from("role_permissions")
    .select("role_id")
    .eq("permission", "spec.admin")
    .eq("scope", "all");

  const roleIds = (roleRows ?? [])
    .map((r) => (r as { role_id?: string }).role_id)
    .filter((v): v is string => Boolean(v));

  const ids = new Set<string>();

  if (roleIds.length > 0) {
    const { data: userRoleRows } = await db
      .from("user_roles")
      .select("user_id")
      .in("role_id", roleIds);

    for (const row of userRoleRows ?? []) {
      const uid = (row as { user_id?: string }).user_id;
      if (uid) ids.add(uid);
    }
  }

  const { data: overrideRows } = await db
    .from("user_permission_overrides")
    .select("user_id")
    .eq("permission", "spec.admin")
    .eq("granted", true);

  for (const row of overrideRows ?? []) {
    const uid = (row as { user_id?: string }).user_id;
    if (uid) ids.add(uid);
  }

  const out = [...ids];
  _cache = { ids: out, expiresAt: Date.now() + CACHE_TTL_MS };
  return out;
}
