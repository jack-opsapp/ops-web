/**
 * OPS Email — Suppression list helpers.
 *
 * Single source of truth for "is this address allowed to receive email?".
 * Every send path calls isSuppressed() before dispatching. Webhook-driven
 * suppressions land via the trg_email_events_auto_suppress trigger; manual
 * suppressions land via /api/admin/email/suppressions.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SuppressionReason =
  | "hard_bounce"
  | "soft_bounce"
  | "spam_report"
  | "unsubscribe"
  | "group_unsubscribe"
  | "manual"
  | "invalid_address";

export type SuppressionSource = "webhook" | "manual" | "backfill" | "import";

export interface Suppression {
  id: string;
  email: string;
  list: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  sourceEventId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt: string | null;
}

interface SuppressionRow {
  id: string;
  email: string;
  list: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  source_event_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  expires_at: string | null;
}

function rowToSuppression(row: SuppressionRow): Suppression {
  return {
    id: row.id,
    email: row.email,
    list: row.list,
    reason: row.reason,
    source: row.source,
    sourceEventId: row.source_event_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Returns true if the address is suppressed for the given list (or the
 * global list, which always blocks). Uses lower(email) for case-insensitive
 * matching.
 *
 * `list` defaults to 'global' — pass a specific list slug (e.g. 'field_notes')
 * for per-channel checks. Global suppressions ALWAYS block, regardless of
 * the requested list.
 */
export async function isSuppressed(
  email: string,
  list: string = "global",
  client?: SupabaseClient
): Promise<boolean> {
  const db = client ?? getServiceRoleClient();
  const lower = email.trim().toLowerCase();
  if (!lower) return false;

  const { data, error } = await db
    .from("email_suppressions")
    .select("id, list, expires_at")
    .ilike("email", lower)
    .in("list", list === "global" ? ["global"] : ["global", list])
    .limit(2);

  if (error) {
    // Fail closed — if we can't verify, do not send.
    console.error("[suppressions] isSuppressed query failed:", error.message);
    return true;
  }

  const now = new Date();
  const active = (data ?? []).filter((row) => {
    if (!row.expires_at) return true;
    return new Date(row.expires_at) > now;
  });

  return active.length > 0;
}

/**
 * Bulk variant: returns the subset of `emails` that are suppressed.
 * Use this in campaign dispatchers where you have many recipients.
 */
export async function filterSuppressed(
  emails: string[],
  list: string = "global",
  client?: SupabaseClient
): Promise<Set<string>> {
  const db = client ?? getServiceRoleClient();
  const lowered = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  if (lowered.length === 0) return new Set();

  const { data, error } = await db
    .from("email_suppressions")
    .select("email, list, expires_at")
    .in("email", lowered)
    .in("list", list === "global" ? ["global"] : ["global", list]);

  if (error) {
    console.error("[suppressions] filterSuppressed query failed:", error.message);
    // Fail closed — return all addresses as suppressed.
    return new Set(lowered);
  }

  const now = new Date();
  const suppressed = new Set<string>();
  for (const row of data ?? []) {
    if (row.expires_at && new Date(row.expires_at) <= now) continue;
    suppressed.add(row.email.toLowerCase());
  }
  return suppressed;
}

/**
 * Add a manual suppression. Idempotent — re-adding updates the existing row.
 */
export async function addSuppression(params: {
  email: string;
  list?: string;
  reason: SuppressionReason;
  source?: SuppressionSource;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | null;
  client?: SupabaseClient;
}): Promise<Suppression> {
  const db = params.client ?? getServiceRoleClient();
  const lower = params.email.trim().toLowerCase();
  if (!lower) throw new Error("addSuppression: email is required");

  const { data, error } = await db
    .from("email_suppressions")
    .upsert(
      {
        email: lower,
        list: params.list ?? "global",
        reason: params.reason,
        source: params.source ?? "manual",
        metadata: params.metadata ?? {},
        expires_at: params.expiresAt ? params.expiresAt.toISOString() : null,
      },
      { onConflict: "lower(email),list" }
    )
    .select("*")
    .single();

  if (error) throw new Error(`addSuppression failed: ${error.message}`);
  return rowToSuppression(data as SuppressionRow);
}

/**
 * Remove a suppression. Returns true if a row was deleted.
 */
export async function removeSuppression(
  email: string,
  list: string = "global",
  client?: SupabaseClient
): Promise<boolean> {
  const db = client ?? getServiceRoleClient();
  const lower = email.trim().toLowerCase();
  if (!lower) return false;

  const { data, error } = await db
    .from("email_suppressions")
    .delete()
    .ilike("email", lower)
    .eq("list", list)
    .select("id");

  if (error) throw new Error(`removeSuppression failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * List suppressions, paginated. For the admin UI (PR 5).
 */
export async function listSuppressions(params: {
  list?: string;
  reason?: SuppressionReason;
  emailLike?: string;
  limit?: number;
  offset?: number;
  client?: SupabaseClient;
} = {}): Promise<{ rows: Suppression[]; total: number }> {
  const db = params.client ?? getServiceRoleClient();
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  let q = db
    .from("email_suppressions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.list) q = q.eq("list", params.list);
  if (params.reason) q = q.eq("reason", params.reason);
  if (params.emailLike) q = q.ilike("email", `%${params.emailLike.toLowerCase()}%`);

  const { data, count, error } = await q;
  if (error) throw new Error(`listSuppressions failed: ${error.message}`);

  return {
    rows: (data ?? []).map((r) => rowToSuppression(r as SuppressionRow)),
    total: count ?? 0,
  };
}
