/**
 * OPS Web - Accounting Service
 *
 * Manages accounting provider connections (QuickBooks, Sage) and sync operations.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleFinancialTypes,
  BubbleAccountingConnectionFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type AccountingConnectionDTO,
  type BubbleListResponse,
  accountingConnectionDtoToModel,
} from "../../types/dto";
import type { AccountingConnection, AccountingProvider } from "../../types/models";

export const AccountingService = {
  async getConnections(companyId: string): Promise<AccountingConnection[]> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleAccountingConnectionFields.company,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
    ];

    const response = await client.get<BubbleListResponse<AccountingConnectionDTO>>(
      `/obj/${BubbleFinancialTypes.accountingConnection.toLowerCase()}`,
      {
        params: {
          constraints: JSON.stringify(constraints),
          limit: 10,
          cursor: 0,
        },
      }
    );

    return response.response.results.map(accountingConnectionDtoToModel);
  },

  async initiateOAuth(
    companyId: string,
    provider: AccountingProvider
  ): Promise<{ authUrl: string }> {
    const response = await fetch(`/api/integrations/${provider}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to initiate ${provider} OAuth`);
    }

    return response.json();
  },

  async disconnectProvider(
    companyId: string,
    provider: AccountingProvider
  ): Promise<void> {
    await fetch(`/api/integrations/${provider}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
  },

  async triggerSync(
    companyId: string,
    provider: AccountingProvider
  ): Promise<void> {
    await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, provider }),
    });
  },

  async getSyncHistory(
    companyId: string
  ): Promise<Array<{ id: string; provider: string; status: string; timestamp: Date; details: string | null }>> {
    const response = await fetch(`/api/sync?companyId=${companyId}`);
    if (!response.ok) return [];
    return response.json();
  },
};
