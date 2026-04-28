/**
 * OPS Email — audience resolver.
 *
 * Two paths:
 *   1. Starter segments (PR 3): { segment: 'all_users' | 'trial_users' | 'active_subscribers' }
 *   2. Full predicate (PR 5+): JSONB AND/OR tree resolved by email_audience_filter RPC
 *
 * The presence of a `segment` key dispatches to the legacy resolvers.
 * Anything else falls through to the RPC, which validates the filter shape
 * server-side via the field/op allowlist (SECURITY DEFINER, service-role only).
 *
 * Subscription status values for starter segments are verified against
 * production schema: active | cancelled | expired | trial
 * (NOT 'trialing' — common Stripe convention but OPS persists 'trial').
 */
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StarterSegment = "all_users" | "trial_users" | "active_subscribers";

export interface AudienceResult {
  recipients: Array<{ email: string; userId: string }>;
}

export async function resolveAudience(
  filter: Record<string, unknown>,
  client?: SupabaseClient
): Promise<AudienceResult> {
  const db = client ?? getServiceRoleClient();

  // Starter segments path
  if (filter && typeof filter === "object" && "segment" in filter) {
    return resolveStarterSegment(
      filter.segment as StarterSegment,
      db
    );
  }

  // Full-predicate path (PR 5+) — RPC enforces field/op allowlist
  const { data, error } = await db.rpc("email_audience_filter", {
    p_filter: filter ?? {},
  });
  if (error) {
    throw new Error(`resolveAudience RPC: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ user_id: string; email: string }>;
  return {
    recipients: rows
      .filter((r) => !!r.email)
      .map((r) => ({ email: r.email, userId: r.user_id })),
  };
}

async function resolveStarterSegment(
  segment: StarterSegment | undefined,
  db: SupabaseClient
): Promise<AudienceResult> {
  switch (segment ?? "all_users") {
    case "all_users":
      return resolveAllUsers(db);
    case "trial_users":
      return resolveTrialUsers(db);
    case "active_subscribers":
      return resolveActiveSubscribers(db);
    default:
      throw new Error(`resolveAudience: unknown segment "${segment}"`);
  }
}

async function resolveAllUsers(db: SupabaseClient): Promise<AudienceResult> {
  const { data, error } = await db.from("users")
    .select("id, email")
    .eq("is_active", true)
    .or("removed_from_email_list.is.null,removed_from_email_list.eq.false")
    .not("email", "is", null);
  if (error) throw new Error(`resolveAllUsers: ${error.message}`);
  return {
    recipients: (data ?? [])
      .filter((u) => !!u.email)
      .map((u) => ({ email: u.email as string, userId: u.id as string })),
  };
}

async function resolveTrialUsers(db: SupabaseClient): Promise<AudienceResult> {
  const { data, error } = await db.from("users")
    .select("id, email, companies!inner(subscription_status, trial_end_date)")
    .eq("is_active", true)
    .or("removed_from_email_list.is.null,removed_from_email_list.eq.false")
    .eq("companies.subscription_status", "trial")
    .not("email", "is", null);
  if (error) throw new Error(`resolveTrialUsers: ${error.message}`);
  return {
    recipients: (data ?? [])
      .filter((u) => !!u.email)
      .map((u) => ({ email: u.email as string, userId: u.id as string })),
  };
}

async function resolveActiveSubscribers(db: SupabaseClient): Promise<AudienceResult> {
  const { data, error } = await db.from("users")
    .select("id, email, companies!inner(subscription_status)")
    .eq("is_active", true)
    .or("removed_from_email_list.is.null,removed_from_email_list.eq.false")
    .in("companies.subscription_status", ["active", "grace"])
    .not("email", "is", null);
  if (error) throw new Error(`resolveActiveSubscribers: ${error.message}`);
  return {
    recipients: (data ?? [])
      .filter((u) => !!u.email)
      .map((u) => ({ email: u.email as string, userId: u.id as string })),
  };
}

export async function estimateAudience(
  filter: Record<string, unknown>,
  client?: SupabaseClient
): Promise<number> {
  const db = client ?? getServiceRoleClient();
  // Starter segments — count via the resolver (no count RPC for them).
  if (filter && typeof filter === "object" && "segment" in filter) {
    const result = await resolveAudience(filter, db);
    return result.recipients.length;
  }
  // Full predicate — use the dedicated count RPC (cheaper than fetching rows).
  const { data, error } = await db.rpc("email_audience_count", {
    p_filter: filter ?? {},
  });
  if (error) throw new Error(`estimateAudience RPC: ${error.message}`);
  return (data as number) ?? 0;
}
