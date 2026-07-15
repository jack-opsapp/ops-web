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
  limit = 5
): Promise<EmailThread[]> {
  if (!companyId || !clientId) return [];

  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("email_threads")
    .select("*")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .neq("id", excludingThreadId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(mapEmailThreadFromDb);
}
