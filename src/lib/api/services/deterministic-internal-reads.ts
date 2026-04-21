/**
 * OPS Web — DB reads for the deterministic-internal-rule.
 *
 * Split from the rule itself so the pure rule stays testable without
 * loading Supabase/Firebase. Consumers (currently: email-thread-service's
 * classifyAndUpdate) import from both: types from deterministic-internal-rule,
 * reads from here.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type { CompanyUser } from "./deterministic-internal-rule";

/**
 * One-shot query for every user in the company plus their display name.
 * Called by EmailThreadService.classifyAndUpdate for each classification;
 * the fetch is small (~1KB per company) and parallelizes with the other
 * Promise.all reads already happening there.
 */
export async function loadCompanyUsers(
  companyId: string
): Promise<Map<string, CompanyUser>> {
  const supabase = requireSupabase();
  const { data: rows, error } = await supabase
    .from("users")
    .select("email, first_name, last_name")
    .eq("company_id", companyId);

  if (error) {
    console.error(
      "[deterministic-internal-reads] loadCompanyUsers failed:",
      error.message
    );
    return new Map();
  }

  const users = new Map<string, CompanyUser>();
  for (const row of rows ?? []) {
    const email = (row.email as string | null)?.toLowerCase().trim();
    if (!email) continue;
    const first = (row.first_name as string | null)?.trim() ?? "";
    const last = (row.last_name as string | null)?.trim() ?? "";
    const displayName =
      [first, last].filter(Boolean).join(" ") || email.split("@")[0] || email;
    users.set(email, { email, displayName });
  }
  return users;
}

/**
 * Team forwarders live inside email_connections.sync_filters (jsonb), which
 * is written by the pipeline import wizard. We look up the thread's owning
 * connection to read them.
 */
export async function loadTeamForwarders(
  connectionId: string
): Promise<string[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("email_connections")
    .select("sync_filters")
    .eq("id", connectionId)
    .maybeSingle();

  if (error || !data) return [];

  const filters = data.sync_filters as { teamForwarders?: string[] } | null;
  if (!filters || !Array.isArray(filters.teamForwarders)) return [];
  return filters.teamForwarders.filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
}
