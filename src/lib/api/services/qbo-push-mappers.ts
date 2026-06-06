export interface OpsClientForQbo {
  id: string;
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
  address?: string | null;
  qbId?: string | null;
  syncToken?: string | null;
}

export interface OpsContactForQbo {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

export interface OpsLineItemForQbo {
  id: string;
  name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  amount?: number | string | null;
  qbItemId?: string | null;
}

export interface OpsInvoiceForQbo {
  id: string;
  qbId?: string | null;
  syncToken?: string | null;
  docNumber?: string | null;
  total?: number | string | null;
  issueDate?: string | Date | null;
  dueDate?: string | Date | null;
}

export interface OpsEstimateForQbo {
  id: string;
  qbId?: string | null;
  syncToken?: string | null;
  docNumber?: string | null;
  total?: number | string | null;
  issueDate?: string | Date | null;
  expirationDate?: string | Date | null;
}

export interface OpsPaymentForQbo {
  id: string;
  qbId?: string | null;
  syncToken?: string | null;
  amount: number | string;
  paymentDate?: string | Date | null;
  referenceNumber?: string | null;
}

export interface OpsInvoiceLinkForQbo {
  id: string;
  qbId?: string | null;
  balanceDue?: number | string | null;
}

export interface QboFallbackServiceItemRef {
  qbItemId: string;
  name: string;
}

type QboPayload = Record<string, unknown>;

const DEFAULT_SERVICE_ITEM_NAME = "OPS Service";

function cleanString(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanDate(value: string | Date | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Invalid date");
    return value.toISOString().slice(0, 10);
  }
  return cleanString(value);
}

function cleanAmount(
  value: number | string | null | undefined,
  label: string,
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric)) throw new Error(`Invalid ${label}`);
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function cleanQuantity(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 1;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Invalid line item quantity");
  }
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000;
}

function addDefined(
  payload: QboPayload,
  key: string,
  value: unknown | undefined,
): void {
  if (value !== undefined) payload[key] = value;
}

function qboRef(
  value: string | null | undefined,
  label: string,
  name?: string | null,
): { value: string; name?: string } {
  const ref: { value: string; name?: string } = {
    value: assertQboRef(value, label),
  };
  const cleanedName = cleanString(name);
  if (cleanedName) ref.name = cleanedName;
  return ref;
}

function fallbackItemRef(
  fallback: QboFallbackServiceItemRef | null | undefined,
): { value: string; name: string } {
  const name = cleanString(fallback?.name) ?? DEFAULT_SERVICE_ITEM_NAME;
  return {
    value: assertQboRef(
      fallback?.qbItemId,
      "QuickBooks fallback service item link",
    ),
    name,
  };
}

function lineName(line: OpsLineItemForQbo): string {
  return cleanString(line.name) ?? cleanString(line.description) ?? DEFAULT_SERVICE_ITEM_NAME;
}

function mapSalesLine(
  line: OpsLineItemForQbo,
  fallback: QboFallbackServiceItemRef | null | undefined,
): QboPayload {
  const quantity = cleanQuantity(line.quantity);
  const unitPrice =
    line.unitPrice !== null && line.unitPrice !== undefined && line.unitPrice !== ""
      ? cleanAmount(line.unitPrice, "line item unit price")
      : line.amount !== null && line.amount !== undefined && line.amount !== ""
        ? cleanAmount(line.amount, "line item amount") / quantity
        : 0;
  if (!Number.isFinite(unitPrice)) throw new Error("Invalid line item unit price");

  const amount =
    line.amount !== null && line.amount !== undefined && line.amount !== ""
      ? cleanAmount(line.amount, "line item amount")
      : cleanAmount(unitPrice * quantity, "line item amount");
  const name = lineName(line);
  const itemRef = cleanString(line.qbItemId)
    ? qboRef(line.qbItemId, "QuickBooks item link", cleanString(line.name))
    : fallbackItemRef(fallback);

  return {
    DetailType: "SalesItemLineDetail",
    Amount: amount,
    Description: name,
    SalesItemLineDetail: {
      ItemRef: itemRef,
      Qty: quantity,
      UnitPrice: cleanAmount(unitPrice, "line item unit price"),
    },
  };
}

function addUpdateFields(
  payload: QboPayload,
  entity: { qbId?: string | null; syncToken?: string | null },
): void {
  const qbId = cleanString(entity.qbId);
  if (!qbId) return;
  payload.Id = assertQboRef(qbId, "QuickBooks entity link");
  const syncToken = cleanString(entity.syncToken);
  if (!syncToken) throw new Error("QuickBooks entity SyncToken required");
  payload.SyncToken = syncToken;
}

export function assertQboRef(
  value: string | null | undefined,
  label: string,
): string {
  const cleaned = cleanString(value);
  if (!cleaned) throw new Error(`${label} required`);
  if (!/^\d+$/.test(cleaned)) throw new Error(`Invalid ${label}`);
  return cleaned;
}

export function mapClientToQboCustomer(input: {
  client: OpsClientForQbo;
  primaryContact?: OpsContactForQbo | null;
}): QboPayload {
  const email =
    cleanString(input.primaryContact?.email) ?? cleanString(input.client.email);
  const phone =
    cleanString(input.primaryContact?.phoneNumber) ??
    cleanString(input.client.phoneNumber);
  const address = cleanString(input.client.address);
  const payload: QboPayload = {
    CompanyName: input.client.name,
    DisplayName: input.client.name,
  };

  addDefined(payload, "PrimaryEmailAddr", email ? { Address: email } : undefined);
  addDefined(
    payload,
    "PrimaryPhone",
    phone ? { FreeFormNumber: phone } : undefined,
  );
  addDefined(payload, "BillAddr", address ? { Line1: address } : undefined);
  addUpdateFields(payload, input.client);

  return payload;
}

export function mapInvoiceToQboInvoice(input: {
  invoice: OpsInvoiceForQbo;
  client: Pick<OpsClientForQbo, "id" | "name" | "qbId">;
  lineItems: OpsLineItemForQbo[];
  fallbackServiceItem?: QboFallbackServiceItemRef | null;
}): QboPayload {
  const payload: QboPayload = {
    CustomerRef: {
      value: assertQboRef(input.client.qbId, "QuickBooks customer link"),
    },
    Line: input.lineItems.map((line) =>
      mapSalesLine(line, input.fallbackServiceItem),
    ),
  };

  addDefined(payload, "DocNumber", cleanString(input.invoice.docNumber));
  addDefined(payload, "TxnDate", cleanDate(input.invoice.issueDate));
  addDefined(payload, "DueDate", cleanDate(input.invoice.dueDate));
  addUpdateFields(payload, input.invoice);

  return payload;
}

export function mapEstimateToQboEstimate(input: {
  estimate: OpsEstimateForQbo;
  client: Pick<OpsClientForQbo, "id" | "name" | "qbId">;
  lineItems: OpsLineItemForQbo[];
  fallbackServiceItem?: QboFallbackServiceItemRef | null;
}): QboPayload {
  const payload: QboPayload = {
    CustomerRef: {
      value: assertQboRef(input.client.qbId, "QuickBooks customer link"),
    },
    Line: input.lineItems.map((line) =>
      mapSalesLine(line, input.fallbackServiceItem),
    ),
  };

  addDefined(payload, "DocNumber", cleanString(input.estimate.docNumber));
  addDefined(payload, "TxnDate", cleanDate(input.estimate.issueDate));
  addDefined(payload, "ExpirationDate", cleanDate(input.estimate.expirationDate));
  addUpdateFields(payload, input.estimate);

  return payload;
}

export function mapPaymentToQboPayment(input: {
  payment: OpsPaymentForQbo;
  client: Pick<OpsClientForQbo, "id" | "qbId">;
  invoice?: OpsInvoiceLinkForQbo | null;
}): QboPayload {
  const amount = cleanAmount(input.payment.amount, "payment amount");
  const payload: QboPayload = {
    CustomerRef: {
      value: assertQboRef(input.client.qbId, "QuickBooks customer link"),
    },
    TotalAmt: amount,
  };

  addDefined(payload, "TxnDate", cleanDate(input.payment.paymentDate));
  addDefined(payload, "PaymentRefNum", cleanString(input.payment.referenceNumber));

  if (input.invoice) {
    payload.Line = [
      {
        Amount: amount,
        LinkedTxn: [
          {
            TxnId: assertQboRef(
              input.invoice.qbId,
              "QuickBooks invoice link",
            ),
            TxnType: "Invoice",
          },
        ],
      },
    ];
  }

  addUpdateFields(payload, input.payment);
  return payload;
}
