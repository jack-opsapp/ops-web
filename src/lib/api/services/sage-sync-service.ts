/**
 * OPS Web - Sage Sync Service
 *
 * Push/pull operations for syncing entities with Sage Business Cloud Accounting API.
 * All methods accept a pre-validated access token.
 */

const SAGE_API_BASE = "https://api.accounting.sage.com/v3.1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sageFetch(
  token: string,
  path: string,
  options?: RequestInit
): Promise<unknown> {
  const url = `${SAGE_API_BASE}${path}`;
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
    throw new Error(`Sage API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SageClientData {
  name: string;
  email?: string;
  phone?: string;
  address?: { line1?: string; city?: string; region?: string; postalCode?: string };
  sageId?: string;
}

interface SageInvoiceData {
  contactId: string; // Sage Contact ID
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
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
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

// ─── Service ──────────────────────────────────────────────────────────────────

export const SageSyncService = {
  // ─── Push ─────────────────────────────────────────────────────────────────

  async pushClient(token: string, data: SageClientData): Promise<{ sageId: string }> {
    const sageBody = {
      contact: {
        name: data.name,
        contact_type_ids: ["CUSTOMER"],
        email: data.email,
        telephone: data.phone,
        ...(data.address && {
          main_address: {
            address_line_1: data.address.line1,
            city: data.address.city,
            region: data.address.region,
            postal_code: data.address.postalCode,
          },
        }),
      },
    };

    if (data.sageId) {
      const result = await sageFetch(token, `/contacts/${data.sageId}`, {
        method: "PUT",
        body: JSON.stringify(sageBody),
      }) as { id: string };
      return { sageId: result.id };
    }

    const result = await sageFetch(token, "/contacts", {
      method: "POST",
      body: JSON.stringify(sageBody),
    }) as { id: string };

    return { sageId: result.id };
  },

  async pushInvoice(token: string, data: SageInvoiceData): Promise<{ sageId: string }> {
    const sageBody = {
      sales_invoice: {
        contact_id: data.contactId,
        date: new Date().toISOString().split("T")[0],
        due_date: data.dueDate,
        invoice_lines: data.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
        })),
      },
    };

    if (data.sageId) {
      const result = await sageFetch(token, `/sales_invoices/${data.sageId}`, {
        method: "PUT",
        body: JSON.stringify(sageBody),
      }) as { id: string };
      return { sageId: result.id };
    }

    const result = await sageFetch(token, "/sales_invoices", {
      method: "POST",
      body: JSON.stringify(sageBody),
    }) as { id: string };

    return { sageId: result.id };
  },

  async pushEstimate(token: string, data: SageEstimateData): Promise<{ sageId: string }> {
    const sageBody = {
      sales_quote: {
        contact_id: data.contactId,
        date: new Date().toISOString().split("T")[0],
        expiry_date: data.expiryDate,
        quote_lines: data.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
        })),
      },
    };

    if (data.sageId) {
      const result = await sageFetch(token, `/sales_quotes/${data.sageId}`, {
        method: "PUT",
        body: JSON.stringify(sageBody),
      }) as { id: string };
      return { sageId: result.id };
    }

    const result = await sageFetch(token, "/sales_quotes", {
      method: "POST",
      body: JSON.stringify(sageBody),
    }) as { id: string };

    return { sageId: result.id };
  },

  async pushPayment(token: string, data: SagePaymentData): Promise<{ sageId: string }> {
    const sageBody = {
      contact_payment: {
        contact_id: data.contactId,
        transaction_type_id: "CUSTOMER_RECEIPT",
        total_amount: data.totalAmount,
        date: data.paymentDate ?? new Date().toISOString().split("T")[0],
        ...(data.invoiceId && {
          allocated_artefacts: [{
            artefact_id: data.invoiceId,
            amount: data.totalAmount,
          }],
        }),
      },
    };

    if (data.sageId) {
      const result = await sageFetch(token, `/contact_payments/${data.sageId}`, {
        method: "PUT",
        body: JSON.stringify(sageBody),
      }) as { id: string };
      return { sageId: result.id };
    }

    const result = await sageFetch(token, "/contact_payments", {
      method: "POST",
      body: JSON.stringify(sageBody),
    }) as { id: string };

    return { sageId: result.id };
  },

  // ─── Pull ─────────────────────────────────────────────────────────────────

  async pullClients(
    token: string,
    since?: string
  ): Promise<Array<{ sageId: string; name: string; email?: string; phone?: string }>> {
    let path = "/contacts?contact_type_id=CUSTOMER&items_per_page=200";
    if (since) {
      path += `&updated_from=${since}`;
    }

    const result = await sageFetch(token, path) as {
      $items: Array<Record<string, unknown>>;
    };

    return (result.$items ?? []).map((c) => ({
      sageId: c.id as string,
      name: c.name as string,
      email: c.email as string | undefined,
      phone: c.telephone as string | undefined,
    }));
  },

  async pullInvoices(
    token: string,
    since?: string
  ): Promise<Array<{ sageId: string; contactId: string; totalAmount: number; dueDate?: string; status?: string }>> {
    let path = "/sales_invoices?items_per_page=200";
    if (since) {
      path += `&updated_from=${since}`;
    }

    const result = await sageFetch(token, path) as {
      $items: Array<Record<string, unknown>>;
    };

    return (result.$items ?? []).map((inv) => ({
      sageId: inv.id as string,
      contactId: (inv.contact as { id: string })?.id ?? "",
      totalAmount: inv.total_amount as number,
      dueDate: inv.due_date as string | undefined,
      status: (inv.outstanding_amount as number) === 0 ? "paid" : "open",
    }));
  },
};

export type { SageClientData, SageInvoiceData, SageEstimateData, SagePaymentData };
