/**
 * OPS Web - Invoice Service
 *
 * CRUD operations for Invoices including line items and payment management.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleFinancialTypes,
  BubbleInvoiceFields,
  BubblePaymentFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type InvoiceDTO,
  type PaymentDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  invoiceDtoToModel,
  invoiceModelToDto,
  paymentDtoToModel,
  paymentModelToDto,
  lineItemModelToDto,
} from "../../types/dto";
import type { Invoice, InvoiceStatus, LineItem, Payment } from "../../types/models";

export interface FetchInvoicesOptions {
  status?: InvoiceStatus;
  clientId?: string;
  projectId?: string;
  overdueOnly?: boolean;
  limit?: number;
  cursor?: number;
}

export const InvoiceService = {
  async fetchInvoices(
    companyId: string,
    options: FetchInvoicesOptions = {}
  ): Promise<{ invoices: Invoice[]; remaining: number; count: number }> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleInvoiceFields.company,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleInvoiceFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (options.status) {
      constraints.push({
        key: BubbleInvoiceFields.status,
        constraint_type: BubbleConstraintType.equals,
        value: options.status,
      });
    }

    if (options.clientId) {
      constraints.push({
        key: BubbleInvoiceFields.client,
        constraint_type: BubbleConstraintType.equals,
        value: options.clientId,
      });
    }

    if (options.projectId) {
      constraints.push({
        key: BubbleInvoiceFields.project,
        constraint_type: BubbleConstraintType.equals,
        value: options.projectId,
      });
    }

    const params: Record<string, string | number> = {
      constraints: JSON.stringify(constraints),
      limit: Math.min(options.limit ?? 100, 100),
      cursor: options.cursor ?? 0,
      sort_field: BubbleInvoiceFields.date,
      descending: "true",
    };

    const response = await client.get<BubbleListResponse<InvoiceDTO>>(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}`,
      { params }
    );

    return {
      invoices: response.response.results.map(invoiceDtoToModel),
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  async fetchAllInvoices(
    companyId: string,
    options: Omit<FetchInvoicesOptions, "limit" | "cursor"> = {}
  ): Promise<Invoice[]> {
    const all: Invoice[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await InvoiceService.fetchInvoices(companyId, {
        ...options,
        limit: 100,
        cursor,
      });
      all.push(...result.invoices);
      remaining = result.remaining;
      cursor += result.invoices.length;
    }

    return all;
  },

  async fetchProjectInvoices(projectId: string, companyId: string): Promise<Invoice[]> {
    return InvoiceService.fetchAllInvoices(companyId, { projectId });
  },

  async fetchInvoice(id: string): Promise<Invoice> {
    const client = getBubbleClient();
    const response = await client.get<BubbleObjectResponse<InvoiceDTO>>(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}/${id}`
    );
    return invoiceDtoToModel(response.response);
  },

  async createInvoice(
    data: Partial<Invoice> & { companyId: string },
    lineItems: Partial<LineItem>[]
  ): Promise<string> {
    const client = getBubbleClient();
    const dto = invoiceModelToDto(data);
    dto.lineItems = lineItems.map(lineItemModelToDto);

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}`,
      dto
    );
    return response.id;
  },

  async updateInvoice(
    id: string,
    data: Partial<Invoice>,
    lineItems?: Partial<LineItem>[]
  ): Promise<void> {
    const client = getBubbleClient();
    const dto = invoiceModelToDto(data);
    if (lineItems) {
      dto.lineItems = lineItems.map(lineItemModelToDto);
    }
    await client.patch(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}/${id}`,
      dto
    );
  },

  async deleteInvoice(id: string): Promise<void> {
    const client = getBubbleClient();
    await client.patch(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}/${id}`,
      { [BubbleInvoiceFields.deletedAt]: new Date().toISOString() }
    );
  },

  async sendInvoice(id: string): Promise<void> {
    const client = getBubbleClient();
    await client.patch(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}/${id}`,
      {
        [BubbleInvoiceFields.status]: "Sent",
        [BubbleInvoiceFields.sentAt]: new Date().toISOString(),
      }
    );
  },

  async voidInvoice(id: string): Promise<void> {
    const client = getBubbleClient();
    await client.patch(
      `/obj/${BubbleFinancialTypes.invoice.toLowerCase()}/${id}`,
      { [BubbleInvoiceFields.status]: "Void" }
    );
  },

  // ─── Payment operations ────────────────────────────────────────────────────

  async recordPayment(
    data: Partial<Payment> & { invoiceId: string; companyId: string; amount: number }
  ): Promise<string> {
    const client = getBubbleClient();
    const dto = paymentModelToDto(data);

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleFinancialTypes.payment.toLowerCase()}`,
      dto
    );

    return response.id;
  },

  async fetchInvoicePayments(invoiceId: string): Promise<Payment[]> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubblePaymentFields.invoice,
        constraint_type: BubbleConstraintType.equals,
        value: invoiceId,
      },
      {
        key: BubblePaymentFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    const response = await client.get<BubbleListResponse<PaymentDTO>>(
      `/obj/${BubbleFinancialTypes.payment.toLowerCase()}`,
      {
        params: {
          constraints: JSON.stringify(constraints),
          limit: 100,
          cursor: 0,
        },
      }
    );

    return response.response.results.map(paymentDtoToModel);
  },

  async deletePayment(id: string): Promise<void> {
    const client = getBubbleClient();
    await client.patch(
      `/obj/${BubbleFinancialTypes.payment.toLowerCase()}/${id}`,
      { [BubblePaymentFields.deletedAt]: new Date().toISOString() }
    );
  },
};
