import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

interface MailboxConnectionScopeRow {
  id: string;
  type: "company" | "individual";
  user_id: string | null;
}

interface CanAccessEmailMailboxInput {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  connectionId: string;
  canViewCompany: boolean;
}

/**
 * Resolves access to one exact mailbox before service-role data is exposed.
 * Company mailboxes are shared; individual mailboxes require ownership unless
 * the caller also has the explicit company-wide inbox permission.
 */
export async function canAccessEmailMailbox({
  supabase,
  companyId,
  userId,
  connectionId,
  canViewCompany,
}: CanAccessEmailMailboxInput): Promise<boolean> {
  if (!companyId.trim() || !userId.trim() || !connectionId.trim()) {
    return false;
  }

  const { data, error } = await supabase
    .from("email_connections")
    .select("id, type, user_id")
    .eq("id", connectionId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(`mailbox access lookup failed: ${error.message}`);
  }

  const connection = data as MailboxConnectionScopeRow | null;
  if (!connection) {
    return false;
  }

  if (canViewCompany || connection.type === "company") {
    return true;
  }

  return connection.type === "individual" && connection.user_id === userId;
}
