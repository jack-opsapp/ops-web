/**
 * OPS Web - Integration Service
 *
 * Methods for managing email integrations (Gmail OAuth, forwarding).
 * All data stored in Supabase gmail_connections table.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

export const IntegrationService = {
  /**
   * Check if the company has Gmail tokens connected.
   */
  async getGmailConnectionStatus(companyId: string): Promise<boolean> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("gmail_connections")
      .select("id")
      .eq("company_id", companyId)
      .limit(1);

    if (error) {
      console.error("[IntegrationService] Failed to check Gmail status:", error.message);
      return false;
    }

    return (data?.length ?? 0) > 0;
  },

  /**
   * Disconnect Gmail by removing the connection record.
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
