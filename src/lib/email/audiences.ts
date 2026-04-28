/**
 * OPS Email — Starter audience resolver.
 * PR 5 will replace this module with a full predicate engine + saved
 * audience templates. PR 3 ships three hardcoded segments to validate the
 * dispatcher → worker pipeline end-to-end.
 *
 * Subscription status values are verified against production schema:
 *   active | cancelled | expired | trial
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
  const segment = (filter?.segment as StarterSegment | undefined) ?? "all_users";

  switch (segment) {
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
  const result = await resolveAudience(filter, client);
  return result.recipients.length;
}
