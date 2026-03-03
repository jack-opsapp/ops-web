/**
 * OPS Web - QuickBooks Sync Service
 *
 * Push/pull operations for syncing entities with QuickBooks Online API.
 * All methods accept a pre-validated access token and realmId.
 */

const QB_API_BASE = "https://quickbooks.api.intuit.com/v3/company";

// ISO 8601 timestamp pattern — only allow safe characters for query interpolation
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function sanitizeTimestamp(since: string): string {
  if (!ISO_TIMESTAMP_RE.test(since)) {
    throw new Error(`Invalid timestamp format: ${since}`);
  }
  return since;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function qbFetch(
  token: string,
  realmId: string,
  path: string,
  options?: RequestInit
): Promise<unknown> {
  const url = `${QB_API_BASE}/${realmId}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QuickBooks API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ─── Push Operations ──────────────────────────────────────────────────────────

interface QBClientData {
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: { line1?: string; city?: string; state?: string; postalCode?: string };
  qbId?: string; // If updating existing
}

interface QBInvoiceData {
  customerRef: string; // QB Customer ID
  lineItems: Array<{
    description: string;
    amount: number;
    quantity?: number;
  }>;
  dueDate?: string;
  qbId?: string;
}

interface QBEstimateData {
  customerRef: string;
  lineItems: Array<{
    description: string;
    amount: number;
    quantity?: number;
  }>;
  expirationDate?: string;
  qbId?: string;
}

interface QBPaymentData {
  customerRef: string;
  totalAmount: number;
  paymentDate?: string;
  invoiceRef?: string; // QB Invoice ID to apply payment to
  qbId?: string;
}

export const QuickBooksSyncService = {
  // ─── Push ─────────────────────────────────────────────────────────────────

  async pushClient(token: string, realmId: string, data: QBClientData): Promise<{ qbId: string }> {
    const qbBody: Record<string, unknown> = {
      DisplayName: data.displayName,
      CompanyName: data.companyName,
      PrimaryEmailAddr: data.email ? { Address: data.email } : undefined,
      PrimaryPhone: data.phone ? { FreeFormNumber: data.phone } : undefined,
    };

    if (data.address) {
      qbBody.BillAddr = {
        Line1: data.address.line1,
        City: data.address.city,
        CountrySubDivisionCode: data.address.state,
        PostalCode: data.address.postalCode,
      };
    }

    if (data.qbId) {
      // Update — need to fetch SyncToken first
      const existing = await qbFetch(token, realmId, `/customer/${data.qbId}`) as { Customer: { SyncToken: string } };
      qbBody.Id = data.qbId;
      qbBody.SyncToken = existing.Customer.SyncToken;
    }

    const result = await qbFetch(token, realmId, "/customer", {
      method: "POST",
      body: JSON.stringify(qbBody),
    }) as { Customer: { Id: string } };

    return { qbId: result.Customer.Id };
  },

  async pushInvoice(token: string, realmId: string, data: QBInvoiceData): Promise<{ qbId: string }> {
    const qbBody: Record<string, unknown> = {
      CustomerRef: { value: data.customerRef },
      Line: data.lineItems.map((item) => ({
        DetailType: "SalesItemLineDetail",
        Amount: item.amount,
        Description: item.description,
        SalesItemLineDetail: {
          Qty: item.quantity ?? 1,
          UnitPrice: item.amount / (item.quantity ?? 1),
        },
      })),
      DueDate: data.dueDate,
    };

    if (data.qbId) {
      const existing = await qbFetch(token, realmId, `/invoice/${data.qbId}`) as { Invoice: { SyncToken: string } };
      qbBody.Id = data.qbId;
      qbBody.SyncToken = existing.Invoice.SyncToken;
    }

    const result = await qbFetch(token, realmId, "/invoice", {
      method: "POST",
      body: JSON.stringify(qbBody),
    }) as { Invoice: { Id: string } };

    return { qbId: result.Invoice.Id };
  },

  async pushEstimate(token: string, realmId: string, data: QBEstimateData): Promise<{ qbId: string }> {
    const qbBody: Record<string, unknown> = {
      CustomerRef: { value: data.customerRef },
      Line: data.lineItems.map((item) => ({
        DetailType: "SalesItemLineDetail",
        Amount: item.amount,
        Description: item.description,
        SalesItemLineDetail: {
          Qty: item.quantity ?? 1,
          UnitPrice: item.amount / (item.quantity ?? 1),
        },
      })),
      ExpirationDate: data.expirationDate,
    };

    if (data.qbId) {
      const existing = await qbFetch(token, realmId, `/estimate/${data.qbId}`) as { Estimate: { SyncToken: string } };
      qbBody.Id = data.qbId;
      qbBody.SyncToken = existing.Estimate.SyncToken;
    }

    const result = await qbFetch(token, realmId, "/estimate", {
      method: "POST",
      body: JSON.stringify(qbBody),
    }) as { Estimate: { Id: string } };

    return { qbId: result.Estimate.Id };
  },

  async pushPayment(token: string, realmId: string, data: QBPaymentData): Promise<{ qbId: string }> {
    const qbBody: Record<string, unknown> = {
      CustomerRef: { value: data.customerRef },
      TotalAmt: data.totalAmount,
      TxnDate: data.paymentDate,
    };

    if (data.invoiceRef) {
      qbBody.Line = [{
        Amount: data.totalAmount,
        LinkedTxn: [{ TxnId: data.invoiceRef, TxnType: "Invoice" }],
      }];
    }

    if (data.qbId) {
      const existing = await qbFetch(token, realmId, `/payment/${data.qbId}`) as { Payment: { SyncToken: string } };
      qbBody.Id = data.qbId;
      qbBody.SyncToken = existing.Payment.SyncToken;
    }

    const result = await qbFetch(token, realmId, "/payment", {
      method: "POST",
      body: JSON.stringify(qbBody),
    }) as { Payment: { Id: string } };

    return { qbId: result.Payment.Id };
  },

  // ─── Pull ─────────────────────────────────────────────────────────────────

  async pullClients(
    token: string,
    realmId: string,
    since?: string
  ): Promise<Array<{ qbId: string; displayName: string; email?: string; phone?: string }>> {
    let query = "SELECT * FROM Customer";
    if (since) {
      query += ` WHERE MetaData.LastUpdatedTime > '${sanitizeTimestamp(since)}'`;
    }
    query += " MAXRESULTS 1000";

    const result = await qbFetch(token, realmId, `/query?query=${encodeURIComponent(query)}`) as {
      QueryResponse: { Customer?: Array<Record<string, unknown>> };
    };

    return (result.QueryResponse.Customer ?? []).map((c) => ({
      qbId: c.Id as string,
      displayName: c.DisplayName as string,
      email: (c.PrimaryEmailAddr as { Address?: string })?.Address,
      phone: (c.PrimaryPhone as { FreeFormNumber?: string })?.FreeFormNumber,
    }));
  },

  async pullInvoices(
    token: string,
    realmId: string,
    since?: string
  ): Promise<Array<{ qbId: string; customerRef: string; totalAmount: number; dueDate?: string; status?: string }>> {
    let query = "SELECT * FROM Invoice";
    if (since) {
      query += ` WHERE MetaData.LastUpdatedTime > '${sanitizeTimestamp(since)}'`;
    }
    query += " MAXRESULTS 1000";

    const result = await qbFetch(token, realmId, `/query?query=${encodeURIComponent(query)}`) as {
      QueryResponse: { Invoice?: Array<Record<string, unknown>> };
    };

    return (result.QueryResponse.Invoice ?? []).map((inv) => ({
      qbId: inv.Id as string,
      customerRef: (inv.CustomerRef as { value: string }).value,
      totalAmount: inv.TotalAmt as number,
      dueDate: inv.DueDate as string | undefined,
      status: inv.Balance === 0 ? "paid" : "open",
    }));
  },
};

export type { QBClientData, QBInvoiceData, QBEstimateData, QBPaymentData };
