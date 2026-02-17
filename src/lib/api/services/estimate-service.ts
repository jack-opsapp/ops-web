/**
 * OPS Web - Estimate Service
 *
 * CRUD operations for Estimates including line items management.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleFinancialTypes,
  BubbleEstimateFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type EstimateDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  estimateDtoToModel,
  estimateModelToDto,
  lineItemModelToDto,
} from "../../types/dto";
import type { Estimate, EstimateStatus, LineItem } from "../../types/models";

export interface FetchEstimatesOptions {
  status?: EstimateStatus;
  clientId?: string;
  projectId?: string;
  limit?: number;
  cursor?: number;
}

export const EstimateService = {
  async fetchEstimates(
    companyId: string,
    options: FetchEstimatesOptions = {}
  ): Promise<{ estimates: Estimate[]; remaining: number; count: number }> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleEstimateFields.company,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleEstimateFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (options.status) {
      constraints.push({
        key: BubbleEstimateFields.status,
        constraint_type: BubbleConstraintType.equals,
        value: options.status,
      });
    }

    if (options.clientId) {
      constraints.push({
        key: BubbleEstimateFields.client,
        constraint_type: BubbleConstraintType.equals,
        value: options.clientId,
      });
    }

    if (options.projectId) {
      constraints.push({
        key: BubbleEstimateFields.project,
        constraint_type: BubbleConstraintType.equals,
        value: options.projectId,
      });
    }

    const params: Record<string, string | number> = {
      constraints: JSON.stringify(constraints),
      limit: Math.min(options.limit ?? 100, 100),
      cursor: options.cursor ?? 0,
      sort_field: BubbleEstimateFields.date,
      descending: "true",
    };

    const response = await client.get<BubbleListResponse<EstimateDTO>>(
      `/obj/${BubbleFinancialTypes.estimate.toLowerCase()}`,
      { params }
    );

    return {
      estimates: response.response.results.map(estimateDtoToModel),
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  async fetchAllEstimates(
    companyId: string,
    options: Omit<FetchEstimatesOptions, "limit" | "cursor"> = {}
  ): Promise<Estimate[]> {
    const all: Estimate[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await EstimateService.fetchEstimates(companyId, {
        ...options,
        limit: 100,
        cursor,
      });
      all.push(...result.estimates);
      remaining = result.remaining;
      cursor += result.estimates.length;
    }

    return all;
  },

  async fetchProjectEstimates(projectId: string, companyId: string): Promise<Estimate[]> {
    return EstimateService.fetchAllEstimates(companyId, { projectId });
  },

  async fetchEstimate(id: string): Promise<Estimate> {
    const client = getBubbleClient();
    const response = await client.get<BubbleObjectResponse<EstimateDTO>>(
      `/obj/${BubbleFinancialTypes.estimate.toLowerCase()}/${id}`
    );
    return estimateDtoToModel(response.response);
  },

  async createEstimate(
    data: Partial<Estimate> & { companyId: string },
    lineItems: Partial<LineItem>[]
  ): Promise<string> {
    const client = getBubbleClient();
    const dto = estimateModelToDto(data);
    dto.lineItems = lineItems.map(lineItemModelToDto);

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleFinancialTypes.estimate.toLowerCase()}`,
      dto
    );
    return response.id;
  },

  async updateEstimate(
    id: string,
    data: Partial<Estimate>,
    lineItems?: Partial<LineItem>[]
  ): Promise<void> {
    const client = getBubbleClient();
    const dto = estimateModelToDto(data);
    if (lineItems) {
      dto.lineItems = lineItems.map(lineItemModelToDto);
    }
    await client.patch(
      `/obj/${BubbleFinancialTypes.estimate.toLowerCase()}/${id}`,
      dto
    );
  },

  async deleteEstimate(id: string): Promise<void> {
    const client = getBubbleClient();
    await client.patch(
      `/obj/${BubbleFinancialTypes.estimate.toLowerCase()}/${id}`,
      { [BubbleEstimateFields.deletedAt]: new Date().toISOString() }
    );
  },

  async sendEstimate(id: string): Promise<void> {
    const client = getBubbleClient();
    await client.patch(
      `/obj/${BubbleFinancialTypes.estimate.toLowerCase()}/${id}`,
      {
        [BubbleEstimateFields.status]: "Sent",
        [BubbleEstimateFields.sentAt]: new Date().toISOString(),
      }
    );
  },

  async convertToInvoice(id: string): Promise<string> {
    const client = getBubbleClient();

    // Fetch the estimate with line items
    const estimate = await EstimateService.fetchEstimate(id);

    // Create invoice from estimate data
    const invoiceDto: Record<string, unknown> = {
      company: estimate.companyId,
      project: estimate.projectId,
      client: estimate.clientId,
      estimate: id,
      status: "Draft",
      date: new Date().toISOString(),
      subtotal: estimate.subtotal,
      taxTotal: estimate.taxTotal,
      discountTotal: estimate.discountTotal,
      total: estimate.total,
      balance: estimate.total,
      notes: estimate.notes,
      paymentTerms: "Net 30",
      lineItems: estimate.lineItems?.map((item) => lineItemModelToDto(item)) ?? [],
    };

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}`,
      invoiceDto
    );

    // Mark estimate as converted
    await client.patch(
      `/obj/${BubbleFinancialTypes.estimate.toLowerCase()}/${id}`,
      { [BubbleEstimateFields.status]: "Converted" }
    );

    return response.id;
  },
};
