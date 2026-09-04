/**
 * Retained only as a fail-closed compatibility boundary for stale imports.
 * Sage traffic must use the exact-business API client through the durable
 * queue or reconciliation routes. This module performs no provider I/O.
 */

interface SageClientData {
  name: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    city?: string;
    region?: string;
    postalCode?: string;
  };
  sageId?: string;
}

interface SageInvoiceData {
  contactId: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  dueDate?: string;
  sageId?: string;
}

interface SageEstimateData {
  contactId: string;
  lineItems: SageInvoiceData["lineItems"];
  expiryDate?: string;
  sageId?: string;
}

interface SagePaymentData {
  contactId: string;
  totalAmount: number;
  paymentDate?: string;
  invoiceId?: string;
  sageId?: string;
}

function retired(): never {
  throw new Error(
    "Legacy Sage sync is retired; use the exact-business queue and reconciliation routes"
  );
}

export const SageSyncService = {
  pushClient: async (
    ..._args: [string, SageClientData]
  ): Promise<{ sageId: string }> => retired(),
  pushInvoice: async (
    ..._args: [string, SageInvoiceData]
  ): Promise<{ sageId: string }> => retired(),
  pushEstimate: async (
    ..._args: [string, SageEstimateData]
  ): Promise<{ sageId: string }> => retired(),
  pushPayment: async (
    ..._args: [string, SagePaymentData]
  ): Promise<{ sageId: string }> => retired(),
  pullClients: async (
    ..._args: [string, string?]
  ): Promise<
    Array<{ sageId: string; name: string; email?: string; phone?: string }>
  > => retired(),
  pullInvoices: async (
    ..._args: [string, string?]
  ): Promise<
    Array<{
      sageId: string;
      contactId: string;
      totalAmount: number;
      dueDate?: string;
      status?: string;
    }>
  > => retired(),
};

export type {
  SageClientData,
  SageInvoiceData,
  SageEstimateData,
  SagePaymentData,
};
