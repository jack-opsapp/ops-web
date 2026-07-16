import "server-only";

import {
  buildEmailThreadListAuthorizationFilter,
  type AllowedEmailInboxListAccess,
} from "@/lib/email/email-opportunity-access";
import { requireSupabase } from "@/lib/supabase/helpers";
import {
  mapEmailThreadFromDb,
  type EmailThread,
} from "@/lib/types/email-thread";

/**
 * List the other active email threads linked to the same client.
 *
 * This query intentionally lives outside EmailThreadService so browser hooks
 * can use it without pulling the server-only classification and Phase C
 * orchestration graph into the client bundle.
 */
export async function listEmailThreadSiblings(
  companyId: string,
  clientId: string,
  excludingThreadId: string,
  authorization: AllowedEmailInboxListAccess,
  limit = 5
): Promise<EmailThread[]> {
  if (!companyId || !clientId) return [];

  const authorizationFilter =
    buildEmailThreadListAuthorizationFilter(authorization);
  if (authorizationFilter.empty) return [];

  const supabase = requireSupabase();
  let query = supabase
    .from("email_threads")
    .select("*")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .neq("id", excludingThreadId)
    .is("archived_at", null);

  if (authorizationFilter.connectionIds) {
    query = query.in("connection_id", authorizationFilter.connectionIds);
  }
  if (authorizationFilter.unlinkedOnly) {
    query = query.is("opportunity_id", null);
  }
  if (authorizationFilter.or) {
    query = query.or(authorizationFilter.or);
  }

  const { data, error } = await query
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(mapEmailThreadFromDb);
}
