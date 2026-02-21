/**
 * OPS Web - Integration Service
 *
 * Gmail integration via Supabase `gmail_connections` table.
 * Bubble dependency fully removed.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

export const IntegrationService = {
  /**
   * Check if the company has a Gmail connection in Supabase.
   */
  async getGmailConnectionStatus(companyId: string): Promise<boolean> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("gmail_connections")
      .select("id")
      .eq("company_id", companyId)
      .limit(1);

    if (error) return false;
    return (data?.length ?? 0) > 0;
  },

  /**
   * Get the connected Gmail email address for a company.
   * Returns null if not connected.
   */
  async getGmailConnection(
    companyId: string
  ): Promise<{ email: string; autoLogEnabled: boolean } | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("gmail_connections")
      .select("email, gmail_auto_log_enabled")
      .eq("company_id", companyId)
      .limit(1)
      .single();

    if (error || !data) return null;
    return { email: data.email, autoLogEnabled: data.gmail_auto_log_enabled };
  },

  /**
   * Disconnect Gmail by deleting the connection row.
   */
  async disconnectGmail(companyId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("gmail_connections")
      .delete()
      .eq("company_id", companyId);

    if (error) throw new Error(`Failed to disconnect Gmail: ${error.message}`);
  },

  /**
   * Get the deterministic forwarding address for a company.
   */
  getForwardingAddress(companyId: string): string {
    return `leads-${companyId.slice(0, 8)}@inbound.opsapp.co`;
  },
};

export default IntegrationService;
