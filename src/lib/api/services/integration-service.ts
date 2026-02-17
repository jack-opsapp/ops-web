/**
 * OPS Web - Integration Service
 *
 * Methods for managing email integrations (Gmail OAuth, forwarding).
 */

import { getBubbleClient } from "../bubble-client";
import { BubbleTypes } from "../../constants/bubble-fields";

export const IntegrationService = {
  /**
   * Check if the company has Gmail tokens connected.
   */
  async getGmailConnectionStatus(companyId: string): Promise<boolean> {
    const client = getBubbleClient();
    const response = await client.get<{
      response: { gmail_connected?: boolean };
    }>(`/obj/${BubbleTypes.company.toLowerCase()}/${companyId}`);

    return response.response.gmail_connected === true;
  },

  /**
   * Disconnect Gmail by clearing tokens.
   */
  async disconnectGmail(companyId: string): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/store_gmail_tokens", {
      company_id: companyId,
      gmail_refresh_token: null,
      gmail_connected: false,
    });
  },

  /**
   * Get the deterministic forwarding address for a company.
   */
  getForwardingAddress(companyId: string): string {
    return `leads-${companyId.slice(0, 8)}@inbound.opsapp.co`;
  },
};

export default IntegrationService;
