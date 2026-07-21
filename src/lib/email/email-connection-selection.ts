import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

interface ResolveNewConversationConnectionInput {
  supabase: SupabaseClient;
  companyId: string;
  actorUserId?: string | null;
}

async function selectConnection(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    type: "company" | "individual";
    actorUserId?: string;
  }
): Promise<string | null> {
  let query = supabase
    .from("email_connections")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("type", input.type)
    .eq("status", "active")
    .eq("sync_enabled", true);

  if (input.type === "individual") {
    if (!input.actorUserId) return null;
    query = query.eq("user_id", input.actorUserId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`email connection selection failed: ${error.message}`);
  }

  return data?.id ? String(data.id) : null;
}

/** Select the deterministic shared mailbox used by approval-queue proposals. */
export async function resolveCompanyEmailConversationConnectionId({
  supabase,
  companyId,
}: Omit<ResolveNewConversationConnectionInput, "actorUserId">): Promise<
  string | null
> {
  const normalizedCompanyId = companyId.trim();
  if (!normalizedCompanyId) return null;
  return selectConnection(supabase, {
    companyId: normalizedCompanyId,
    type: "company",
  });
}

/**
 * Select transport for a brand-new conversation.
 *
 * The actor's own personal mailbox is preferred. The only fallback is a
 * company mailbox. Another user's personal mailbox can never be selected,
 * and a legacy `user_id` on a company row is deliberately ignored.
 */
export async function resolveNewEmailConversationConnectionId({
  supabase,
  companyId,
  actorUserId,
}: ResolveNewConversationConnectionInput): Promise<string | null> {
  const normalizedCompanyId = companyId.trim();
  const normalizedActorUserId = actorUserId?.trim() ?? "";
  if (!normalizedCompanyId) return null;

  if (normalizedActorUserId) {
    const personal = await selectConnection(supabase, {
      companyId: normalizedCompanyId,
      type: "individual",
      actorUserId: normalizedActorUserId,
    });
    if (personal) return personal;
  }

  return selectConnection(supabase, {
    companyId: normalizedCompanyId,
    type: "company",
  });
}
