import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  createSageWriteClient,
  type SageAcceptedWrite,
  type SageWriteClient,
} from "../src/lib/api/services/sage-api-client";
import {
  assertSageWriteAllowed,
  getAllowedSageBusinessIds,
  getSageCredentials,
  SAGE_API_BASE,
} from "../src/lib/api/services/sage-config";
import { sageIdempotencyKey } from "../src/lib/api/services/sage-idempotency";
import { normalizeSageRecord } from "../src/lib/api/services/sage-normalize";
import {
  buildSageContact,
  buildSageContactPayment,
  buildSagePurchaseInvoice,
  buildSageSalesDocument,
} from "../src/lib/api/services/sage-push-mappers";
import {
  discoverEligibleSageBusinesses,
  refreshSageOAuthGrant,
  sageBusinessIdLookup,
} from "../src/lib/api/services/sage-oauth-service";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_RESOURCES = [
  "contacts",
  "sales_estimates",
  "sales_quotes",
  "sales_invoices",
  "contact_payments",
  "purchase_invoices",
] as const;
const OPS_ENTITY_KEYS = [
  "customer",
  "supplier",
  "estimate",
  "quote",
  "invoice",
  "payment",
  "supplierBill",
  "supplierPayment",
  "lineItem",
] as const;

type ProviderResource = (typeof PROVIDER_RESOURCES)[number];
type OpsEntityKey = (typeof OPS_ENTITY_KEYS)[number];
type CleanupStatus = "not_started" | "running" | "complete" | "manual_required";

export interface SageSandboxManifest {
  version: 1;
  runId: string;
  environment: "sandbox";
  businessId: string;
  companyId: string;
  connectionId: string;
  createdAt: string;
  completedAt: string | null;
  status: "running" | "passed" | "failed";
  opsIds: Record<OpsEntityKey, string[]>;
  externalIds: Record<ProviderResource, string[]>;
  accepted: Array<{
    resource: ProviderResource;
    action: "create" | "update" | "delete";
    externalId: string;
    acceptedAt: string;
    requestId?: string;
  }>;
  pullReadback: Array<{
    resource: ProviderResource;
    externalId: string;
    observedAt: string;
  }>;
  cleanup: {
    status: CleanupStatus;
    startedAt: string | null;
    completedAt: string | null;
    opsRemaining: number | null;
    provider: Array<{
      resource: ProviderResource;
      externalId: string;
      terminal: "missing" | "voided" | "manual_required";
    }>;
    errors: string[];
  };
  errors: string[];
}

export interface SageSandboxConfig {
  environment: "sandbox";
  businessId: string;
  allowedBusinessIds: readonly string[];
  companyId: string;
  connectionId: string;
  userId: string;
  expenseCategoryId: string;
  ledgerAccountId: string;
  taxRateId: string;
  bankAccountId: string;
  paymentMethodId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  manifestDirectory: string;
}

export type SageSandboxPreflight =
  | { status: "ready"; config: SageSandboxConfig }
  | { status: "blocked"; reason: string };

function value(environment: NodeJS.ProcessEnv, name: string): string {
  return environment[name]?.trim() ?? "";
}

function blocked(
  reason: string
): Extract<SageSandboxPreflight, { status: "blocked" }> {
  return { status: "blocked", reason: `BLOCKED :: ${reason}` };
}

function exactUuid(valueToCheck: string): boolean {
  return UUID_V4.test(valueToCheck);
}

function validTimestamp(valueToCheck: unknown): valueToCheck is string {
  return (
    typeof valueToCheck === "string" &&
    Number.isFinite(Date.parse(valueToCheck))
  );
}

function recordMap<T extends readonly string[]>(
  keys: T
): Record<T[number], string[]> {
  return Object.fromEntries(keys.map((key) => [key, []])) as unknown as Record<
    T[number],
    string[]
  >;
}

export function createSageSandboxManifest(input: {
  runId: string;
  businessId: string;
  companyId: string;
  connectionId: string;
  createdAt: string;
}): SageSandboxManifest {
  return {
    version: 1,
    runId: input.runId,
    environment: "sandbox",
    businessId: input.businessId,
    companyId: input.companyId,
    connectionId: input.connectionId,
    createdAt: input.createdAt,
    completedAt: null,
    status: "running",
    opsIds: recordMap(OPS_ENTITY_KEYS),
    externalIds: recordMap(PROVIDER_RESOURCES),
    accepted: [],
    pullReadback: [],
    cleanup: {
      status: "not_started",
      startedAt: null,
      completedAt: null,
      opsRemaining: null,
      provider: [],
      errors: [],
    },
    errors: [],
  };
}

export function assertSageSandboxManifest(
  manifest: SageSandboxManifest
): SageSandboxManifest {
  if (manifest.version !== 1) throw new Error("Manifest version is invalid.");
  if (!exactUuid(manifest.runId))
    throw new Error("Manifest run id is invalid.");
  if (manifest.environment !== "sandbox") {
    throw new Error("Manifest environment is not sandbox.");
  }
  if (!manifest.businessId.trim()) {
    throw new Error("Manifest Sage business id is missing.");
  }
  if (!exactUuid(manifest.companyId)) {
    throw new Error("Manifest OPS company id is invalid.");
  }
  if (!exactUuid(manifest.connectionId)) {
    throw new Error("Manifest OPS connection id is invalid.");
  }
  if (!validTimestamp(manifest.createdAt)) {
    throw new Error("Manifest created-at timestamp is invalid.");
  }
  if (manifest.completedAt !== null && !validTimestamp(manifest.completedAt)) {
    throw new Error("Manifest completed-at timestamp is invalid.");
  }
  for (const key of OPS_ENTITY_KEYS) {
    if (!Array.isArray(manifest.opsIds[key])) {
      throw new Error(`Manifest OPS ids are missing for ${key}.`);
    }
    if (!manifest.opsIds[key].every(exactUuid)) {
      throw new Error(`Manifest OPS ids are invalid for ${key}.`);
    }
  }
  for (const resource of PROVIDER_RESOURCES) {
    if (
      !Array.isArray(manifest.externalIds[resource]) ||
      !manifest.externalIds[resource].every(
        (id) => typeof id === "string" && Boolean(id.trim())
      )
    ) {
      throw new Error(`Manifest provider ids are invalid for ${resource}.`);
    }
  }
  if (
    !manifest.accepted.every(
      (event) =>
        PROVIDER_RESOURCES.includes(event.resource) &&
        Boolean(event.externalId.trim()) &&
        validTimestamp(event.acceptedAt)
    )
  ) {
    throw new Error("Manifest accepted-write evidence is invalid.");
  }
  if (
    manifest.cleanup.status === "complete" &&
    (manifest.cleanup.opsRemaining !== 0 ||
      !validTimestamp(manifest.cleanup.startedAt) ||
      !validTimestamp(manifest.cleanup.completedAt))
  ) {
    throw new Error("Manifest cleanup proof is incomplete.");
  }
  return manifest;
}

const SECRET_KEY =
  /(access.?token|refresh.?token|authorization|client.?secret|service.?role|api.?key|password|passphrase|private.?key|provider.?bod(?:y|ies)|raw.?response|payload)/i;

export function redactSageSandboxManifest(valueToRedact: unknown): unknown {
  if (Array.isArray(valueToRedact)) {
    return valueToRedact.map(redactSageSandboxManifest);
  }
  if (!valueToRedact || typeof valueToRedact !== "object") {
    return valueToRedact;
  }
  return Object.fromEntries(
    Object.entries(valueToRedact as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, nested]) => [key, redactSageSandboxManifest(nested)])
  );
}

export function providerCleanupTargets(
  manifest: SageSandboxManifest
): Array<{ resource: ProviderResource; id: string }> {
  const order: ProviderResource[] = [
    "contact_payments",
    "purchase_invoices",
    "sales_invoices",
    "sales_quotes",
    "sales_estimates",
    "contacts",
  ];
  return order.flatMap((resource) =>
    [...manifest.externalIds[resource]]
      .reverse()
      .map((id) => ({ resource, id }))
  );
}

export function preflightSageSandboxWarGame(
  environment: NodeJS.ProcessEnv = process.env
): SageSandboxPreflight {
  if (value(environment, "SAGE_ACTIVE_PROFILE") !== "sandbox") {
    return blocked("SAGE_ACTIVE_PROFILE must be explicitly set to sandbox.");
  }
  if (value(environment, "ACCOUNTING_WRITE_ENABLED").toLowerCase() !== "true") {
    return blocked("ACCOUNTING_WRITE_ENABLED must be true.");
  }
  if (value(environment, "SAGE_WRITE_ENABLED").toLowerCase() !== "true") {
    return blocked("SAGE_WRITE_ENABLED must be true.");
  }
  const encryptionKey = value(environment, "QB_TOKEN_ENC_KEY");
  if (!encryptionKey || Buffer.from(encryptionKey, "base64").length !== 32) {
    return blocked("QB_TOKEN_ENC_KEY must decode to exactly 32 bytes.");
  }

  const requiredNames = [
    "SAGE_SANDBOX_CLIENT_ID",
    "SAGE_SANDBOX_CLIENT_SECRET",
    "SAGE_SANDBOX_REDIRECT_URI",
    "SAGE_SANDBOX_REFRESH_TOKEN",
    "SAGE_SANDBOX_BUSINESS_ID",
    "SAGE_SANDBOX_BUSINESS_IDS",
    "SAGE_SANDBOX_OPS_COMPANY_ID",
    "SAGE_SANDBOX_OPS_CONNECTION_ID",
    "SAGE_SANDBOX_OPS_USER_ID",
    "SAGE_SANDBOX_OPS_EXPENSE_CATEGORY_ID",
    "SAGE_SANDBOX_LEDGER_ACCOUNT_ID",
    "SAGE_SANDBOX_TAX_RATE_ID",
    "SAGE_SANDBOX_BANK_ACCOUNT_ID",
    "SAGE_SANDBOX_PAYMENT_METHOD_ID",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const missing = requiredNames.filter((name) => !value(environment, name));
  if (missing.length > 0) {
    return blocked(
      `dedicated sandbox configuration missing: ${missing.join(", ")}.`
    );
  }

  const clientId = value(environment, "SAGE_SANDBOX_CLIENT_ID");
  const clientSecret = value(environment, "SAGE_SANDBOX_CLIENT_SECRET");
  if (
    clientId === value(environment, "SAGE_CLIENT_ID") ||
    clientSecret === value(environment, "SAGE_CLIENT_SECRET")
  ) {
    return blocked(
      "Sage sandbox credentials must be dedicated and distinct from production."
    );
  }
  const businessId = value(environment, "SAGE_SANDBOX_BUSINESS_ID");
  const allowedBusinessIds = value(environment, "SAGE_SANDBOX_BUSINESS_IDS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!allowedBusinessIds.includes(businessId)) {
    return blocked("selected Sage business is not an exact allow-list match.");
  }
  const exactOpsIds = [
    ["company", value(environment, "SAGE_SANDBOX_OPS_COMPANY_ID")],
    ["connection", value(environment, "SAGE_SANDBOX_OPS_CONNECTION_ID")],
    ["user", value(environment, "SAGE_SANDBOX_OPS_USER_ID")],
    [
      "expense category",
      value(environment, "SAGE_SANDBOX_OPS_EXPENSE_CATEGORY_ID"),
    ],
  ] as const;
  const invalidOpsId = exactOpsIds.find(([, id]) => !exactUuid(id));
  if (invalidOpsId) {
    return blocked(`exact OPS ${invalidOpsId[0]} id must be a UUID v4.`);
  }
  try {
    const redirect = new URL(value(environment, "SAGE_SANDBOX_REDIRECT_URI"));
    if (
      redirect.protocol !== "https:" &&
      !(redirect.protocol === "http:" && redirect.hostname === "localhost")
    ) {
      return blocked("Sage sandbox redirect URI must use HTTPS or localhost.");
    }
    const supabase = new URL(value(environment, "NEXT_PUBLIC_SUPABASE_URL"));
    if (supabase.protocol !== "https:") {
      return blocked("Supabase URL must use HTTPS.");
    }
  } catch {
    return blocked("sandbox URLs are invalid.");
  }

  return {
    status: "ready",
    config: {
      environment: "sandbox",
      businessId,
      allowedBusinessIds: Object.freeze([...new Set(allowedBusinessIds)]),
      companyId: value(environment, "SAGE_SANDBOX_OPS_COMPANY_ID"),
      connectionId: value(environment, "SAGE_SANDBOX_OPS_CONNECTION_ID"),
      userId: value(environment, "SAGE_SANDBOX_OPS_USER_ID"),
      expenseCategoryId: value(
        environment,
        "SAGE_SANDBOX_OPS_EXPENSE_CATEGORY_ID"
      ),
      ledgerAccountId: value(environment, "SAGE_SANDBOX_LEDGER_ACCOUNT_ID"),
      taxRateId: value(environment, "SAGE_SANDBOX_TAX_RATE_ID"),
      bankAccountId: value(environment, "SAGE_SANDBOX_BANK_ACCOUNT_ID"),
      paymentMethodId: value(environment, "SAGE_SANDBOX_PAYMENT_METHOD_ID"),
      clientId,
      clientSecret,
      redirectUri: value(environment, "SAGE_SANDBOX_REDIRECT_URI"),
      refreshToken: value(environment, "SAGE_SANDBOX_REFRESH_TOKEN"),
      supabaseUrl: value(environment, "NEXT_PUBLIC_SUPABASE_URL"),
      supabaseServiceRoleKey: value(environment, "SUPABASE_SERVICE_ROLE_KEY"),
      manifestDirectory:
        value(environment, "SAGE_SANDBOX_MANIFEST_DIR") ||
        "/private/tmp/ops-sage-sandbox-war-game",
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 500)
    : "Unknown Sage sandbox acceptance failure";
}

function providerId(accepted: SageAcceptedWrite): string {
  const data = accepted.data as { id?: unknown };
  const id = typeof data?.id === "string" ? data.id.trim() : "";
  if (!id) throw new Error("Sage accepted a write without returning an id.");
  return id;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uniqueIds(count: number): string[] {
  return Array.from({ length: count }, () => randomUUID());
}

function allOpsEntityIds(manifest: SageSandboxManifest): string[] {
  return OPS_ENTITY_KEYS.flatMap((key) => manifest.opsIds[key]);
}

// The runner intentionally uses a narrow ungenerated database boundary because
// its migrations must already exist before a real acceptance run can begin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AcceptanceDb = SupabaseClient<any, "public", any>;

async function expectOne(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: PromiseLike<{ data: any; error: any }>,
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message ?? String(error)}`);
  if (!data) throw new Error(`${label}: exact row is unavailable.`);
  return data;
}

async function validateOpsSandbox(
  db: AcceptanceDb,
  config: SageSandboxConfig
): Promise<{ syncEnabled: boolean }> {
  const connection = await expectOne(
    db
      .from("accounting_connections")
      .select(
        "id, company_id, provider, provider_environment, is_connected, sync_enabled, sage_business_id_lookup"
      )
      .eq("id", config.connectionId)
      .eq("company_id", config.companyId)
      .eq("provider", "sage")
      .eq("provider_environment", "sandbox")
      .maybeSingle(),
    "Sage sandbox connection preflight"
  );
  if (
    connection.is_connected !== true ||
    connection.sync_enabled !== true ||
    connection.sage_business_id_lookup !==
      sageBusinessIdLookup(config.businessId)
  ) {
    throw new Error(
      "Sage sandbox connection is not active, sync-enabled, or bound to the allow-listed business."
    );
  }
  await expectOne(
    db
      .from("users")
      .select("id")
      .eq("id", config.userId)
      .eq("company_id", config.companyId)
      .maybeSingle(),
    "Sage sandbox operator preflight"
  );
  await expectOne(
    db
      .from("expense_categories")
      .select("id")
      .eq("id", config.expenseCategoryId)
      .eq("company_id", config.companyId)
      .maybeSingle(),
    "Sage sandbox expense category preflight"
  );
  await expectOne(
    db
      .from("sage_payment_method_mappings")
      .select("id")
      .eq("company_id", config.companyId)
      .eq("connection_id", config.connectionId)
      .eq("sage_bank_account_id", config.bankAccountId)
      .eq("sage_payment_method_id", config.paymentMethodId)
      .maybeSingle(),
    "Sage sandbox customer payment mapping preflight"
  );
  await expectOne(
    db
      .from("supplier_bill_payment_account_mappings")
      .select("id")
      .eq("company_id", config.companyId)
      .eq("connection_id", config.connectionId)
      .eq("provider", "sage")
      .eq("external_account_id", config.bankAccountId)
      .eq("external_payment_method_id", config.paymentMethodId)
      .maybeSingle(),
    "Sage sandbox supplier payment mapping preflight"
  );
  return { syncEnabled: connection.sync_enabled === true };
}

async function setSyncEnabled(
  db: AcceptanceDb,
  config: SageSandboxConfig,
  enabled: boolean
): Promise<void> {
  await expectOne(
    db
      .from("accounting_connections")
      .update({ sync_enabled: enabled })
      .eq("id", config.connectionId)
      .eq("company_id", config.companyId)
      .eq("provider", "sage")
      .eq("provider_environment", "sandbox")
      .select("id")
      .maybeSingle(),
    `Set Sage sandbox sync_enabled=${enabled}`
  );
}

async function insertExact(
  db: AcceptanceDb,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`Insert ${table}: ${error.message}`);
}

function localLines(input: {
  companyId: string;
  documentId: string;
  documentColumn: "estimate_id" | "invoice_id";
  ids: string[];
  tag: string;
}): Record<string, unknown>[] {
  return input.ids.map((id, index) => ({
    id,
    company_id: input.companyId,
    [input.documentColumn]: input.documentId,
    name: `${input.tag} ${index + 1}`,
    description: `${input.tag} ${index + 1}`,
    type: "service",
    quantity: index + 1,
    unit_price: index === 0 ? 40 : 60,
    line_total: index === 0 ? 40 : 120,
    sort_order: index,
    is_taxable: true,
  }));
}

async function seedOpsGraph(
  db: AcceptanceDb,
  config: SageSandboxConfig,
  manifest: SageSandboxManifest,
  external: {
    customer: string;
    supplier: string;
    estimate: string;
    quote: string;
    invoiceA: string;
    invoiceB: string;
    payment: string;
    supplierBill: string;
    supplierPayment: string;
  },
  tag: string,
  date: string,
  dueDate: string
): Promise<void> {
  const [customerId, supplierId, estimateId, quoteId, invoiceAId, invoiceBId] =
    uniqueIds(6);
  const [paymentId, supplierBillId, supplierPaymentId] = uniqueIds(3);
  const lineIds = uniqueIds(10);
  manifest.opsIds.customer.push(customerId);
  manifest.opsIds.supplier.push(supplierId);
  manifest.opsIds.estimate.push(estimateId);
  manifest.opsIds.quote.push(quoteId);
  manifest.opsIds.invoice.push(invoiceAId, invoiceBId);
  manifest.opsIds.payment.push(paymentId);
  manifest.opsIds.supplierBill.push(supplierBillId);
  manifest.opsIds.supplierPayment.push(supplierPaymentId);
  manifest.opsIds.lineItem.push(...lineIds);

  await insertExact(db, "clients", [
    {
      id: customerId,
      company_id: config.companyId,
      name: `${tag} CUSTOMER STALE`,
      email: `sage-${manifest.runId}@example.invalid`,
      sage_id: external.customer,
    },
  ]);
  await insertExact(db, "suppliers", [
    {
      id: supplierId,
      company_id: config.companyId,
      created_by: config.userId,
      display_name: `${tag} SUPPLIER`,
      normalized_name: `${tag} supplier`.toLowerCase(),
    },
  ]);
  await insertExact(db, "estimates", [
    {
      id: estimateId,
      company_id: config.companyId,
      client_id: customerId,
      estimate_number: `${tag}-EST`,
      issue_date: date,
      expiration_date: dueDate,
      status: "draft",
      subtotal: 160,
      total: 160,
      sage_id: external.estimate,
      sage_document_kind: "sales_estimate",
    },
    {
      id: quoteId,
      company_id: config.companyId,
      client_id: customerId,
      estimate_number: `${tag}-QUO`,
      issue_date: date,
      expiration_date: dueDate,
      status: "draft",
      subtotal: 160,
      total: 160,
      sage_id: external.quote,
      sage_document_kind: "sales_quote",
    },
  ]);
  await insertExact(db, "invoices", [
    {
      id: invoiceAId,
      company_id: config.companyId,
      client_id: customerId,
      invoice_number: `${tag}-INV-A`,
      issue_date: date,
      due_date: dueDate,
      status: "awaiting_payment",
      subtotal: 160,
      total: 160,
      balance_due: 160,
      sage_id: external.invoiceA,
    },
    {
      id: invoiceBId,
      company_id: config.companyId,
      client_id: customerId,
      invoice_number: `${tag}-INV-B`,
      issue_date: date,
      due_date: dueDate,
      status: "awaiting_payment",
      subtotal: 160,
      total: 160,
      balance_due: 160,
      sage_id: external.invoiceB,
    },
  ]);
  await insertExact(db, "line_items", [
    ...localLines({
      companyId: config.companyId,
      documentId: estimateId,
      documentColumn: "estimate_id",
      ids: lineIds.slice(0, 2),
      tag: `${tag} ESTIMATE`,
    }),
    ...localLines({
      companyId: config.companyId,
      documentId: quoteId,
      documentColumn: "estimate_id",
      ids: lineIds.slice(2, 4),
      tag: `${tag} QUOTE`,
    }),
    ...localLines({
      companyId: config.companyId,
      documentId: invoiceAId,
      documentColumn: "invoice_id",
      ids: lineIds.slice(4, 6),
      tag: `${tag} INVOICE A`,
    }),
    ...localLines({
      companyId: config.companyId,
      documentId: invoiceBId,
      documentColumn: "invoice_id",
      ids: lineIds.slice(6, 8),
      tag: `${tag} INVOICE B`,
    }),
  ]);
  await insertExact(db, "payments", [
    {
      id: paymentId,
      company_id: config.companyId,
      client_id: customerId,
      invoice_id: invoiceAId,
      amount: 40,
      payment_date: date,
      payment_method: "eft",
      reference_number: `${tag}-PAY-STALE`,
      sage_id: external.payment,
    },
  ]);
  await insertExact(db, "supplier_bills", [
    {
      id: supplierBillId,
      company_id: config.companyId,
      supplier_id: supplierId,
      category_id: config.expenseCategoryId,
      created_by: config.userId,
      confirmed_by: config.userId,
      confirmed_at: new Date().toISOString(),
      currency: "CAD",
      invoice_date: date,
      due_date: dueDate,
      invoice_number: `${tag}-BILL`,
      normalized_invoice_number: `${tag}-BILL`,
      status: "open",
      subtotal: 160,
      tax_total: 0,
      total: 160,
      balance: 160,
    },
  ]);
  await insertExact(db, "supplier_bill_line_items", [
    {
      id: lineIds[8],
      company_id: config.companyId,
      bill_id: supplierBillId,
      category_id: config.expenseCategoryId,
      description: `${tag} MATERIALS`,
      quantity: 1,
      unit_price: 40,
      subtotal: 40,
      tax_amount: 0,
      total: 40,
      position: 0,
    },
    {
      id: lineIds[9],
      company_id: config.companyId,
      bill_id: supplierBillId,
      category_id: config.expenseCategoryId,
      description: `${tag} LABOUR`,
      quantity: 2,
      unit_price: 60,
      subtotal: 120,
      tax_amount: 0,
      total: 120,
      position: 1,
    },
  ]);
  await insertExact(db, "supplier_bill_payments", [
    {
      id: supplierPaymentId,
      company_id: config.companyId,
      bill_id: supplierBillId,
      payment_date: date,
      amount: 40,
      payment_method: "eft",
      recorded_by: config.userId,
      confirmed_at: new Date().toISOString(),
      reference: `${tag}-SUP-PAY`,
    },
  ]);
  await insertExact(db, "supplier_bill_provider_links", [
    {
      company_id: config.companyId,
      connection_id: config.connectionId,
      provider: "sage",
      entity_type: "supplier",
      entity_id: supplierId,
      external_id: external.supplier,
    },
    {
      company_id: config.companyId,
      connection_id: config.connectionId,
      provider: "sage",
      entity_type: "supplier_bill",
      entity_id: supplierBillId,
      external_id: external.supplierBill,
    },
    {
      company_id: config.companyId,
      connection_id: config.connectionId,
      provider: "sage",
      entity_type: "supplier_bill_payment",
      entity_id: supplierPaymentId,
      external_id: external.supplierPayment,
    },
  ]);
}

async function applyPull(
  db: AcceptanceDb,
  config: SageSandboxConfig,
  manifest: SageSandboxManifest,
  client: SageWriteClient,
  input: {
    entityType:
      | "customer"
      | "invoice"
      | "estimate"
      | "payment"
      | "supplier"
      | "supplier_bill"
      | "supplier_bill_payment";
    opsKey: OpsEntityKey;
    opsIndex?: number;
    resource: ProviderResource;
    externalId: string;
  }
): Promise<void> {
  const raw = await client.get<Record<string, unknown>>(
    input.resource,
    input.externalId
  );
  if (!raw) throw new Error(`Sage pull readback lost ${input.resource}.`);
  const normalized = normalizeSageRecord(input.entityType, input.resource, raw);
  const entityId = manifest.opsIds[input.opsKey][input.opsIndex ?? 0];
  const sourceTable: Record<OpsEntityKey, string> = {
    customer: "clients",
    supplier: "suppliers",
    estimate: "estimates",
    quote: "estimates",
    invoice: "invoices",
    payment: "payments",
    supplierBill: "supplier_bills",
    supplierPayment: "supplier_bill_payments",
    lineItem: "line_items",
  };
  const row = await expectOne(
    db
      .from(sourceTable[input.opsKey])
      .select("updated_at")
      .eq("id", entityId)
      .eq("company_id", config.companyId)
      .maybeSingle(),
    `Sage pull OPS ${input.entityType}`
  );
  const { error } = await db.rpc("apply_sage_reconcile_entity", {
    p_company_id: config.companyId,
    p_connection_id: config.connectionId,
    p_entity_type: input.entityType,
    p_entity_id: entityId,
    p_external_id: input.externalId,
    p_expected_ops_updated_at: row.updated_at,
    p_provider_updated_at: normalized.updatedAt,
    p_deleted_at: normalized.deletedAt,
    p_payload: normalized.payload,
  });
  if (error) {
    throw new Error(`Sage pull reconciliation failed: ${error.message}`);
  }
  manifest.pullReadback.push({
    resource: input.resource,
    externalId: input.externalId,
    observedAt: new Date().toISOString(),
  });
}

async function deleteExactOpsRows(
  db: AcceptanceDb,
  config: SageSandboxConfig,
  manifest: SageSandboxManifest
): Promise<number> {
  const entityIds = allOpsEntityIds(manifest);
  if (entityIds.length > 0) {
    for (const table of ["accounting_sync_events", "accounting_sync_queue"]) {
      const { error } = await db
        .from(table)
        .delete()
        .eq("company_id", config.companyId)
        .in("entity_id", entityIds);
      if (error) throw new Error(`Delete ${table}: ${error.message}`);
    }
  }
  const targets: Array<[string, OpsEntityKey]> = [
    ["supplier_bill_provider_links", "supplierPayment"],
    ["supplier_bill_provider_links", "supplierBill"],
    ["supplier_bill_provider_links", "supplier"],
    ["supplier_bill_payments", "supplierPayment"],
    ["supplier_bill_line_items", "lineItem"],
    ["supplier_bills", "supplierBill"],
    ["payments", "payment"],
    ["line_items", "lineItem"],
    ["invoices", "invoice"],
    ["estimates", "quote"],
    ["estimates", "estimate"],
    ["suppliers", "supplier"],
    ["clients", "customer"],
  ];
  for (const [table, key] of targets) {
    const ids = manifest.opsIds[key];
    if (ids.length === 0) continue;
    let query = db.from(table).delete().eq("company_id", config.companyId);
    query =
      table === "supplier_bill_provider_links"
        ? query.in("entity_id", ids)
        : query.in("id", ids);
    const { error } = await query;
    if (error) throw new Error(`Delete ${table}: ${error.message}`);
  }

  let remaining = 0;
  const checks: Array<[string, OpsEntityKey]> = [
    ["clients", "customer"],
    ["suppliers", "supplier"],
    ["estimates", "estimate"],
    ["estimates", "quote"],
    ["invoices", "invoice"],
    ["payments", "payment"],
    ["supplier_bills", "supplierBill"],
    ["supplier_bill_payments", "supplierPayment"],
    ["line_items", "lineItem"],
    ["supplier_bill_line_items", "lineItem"],
  ];
  for (const [table, key] of checks) {
    const ids = manifest.opsIds[key];
    if (ids.length === 0) continue;
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", config.companyId)
      .in("id", ids);
    if (error) throw new Error(`Verify ${table}: ${error.message}`);
    remaining += count ?? 0;
  }
  return remaining;
}

function terminalState(raw: Record<string, unknown> | undefined) {
  if (!raw) return "missing" as const;
  const status = raw.status;
  const statusText =
    status && typeof status === "object"
      ? String((status as { id?: unknown }).id ?? "")
      : String(status ?? "");
  return raw.deleted_at || /void|delete|inactive/i.test(statusText)
    ? ("voided" as const)
    : ("manual_required" as const);
}

async function cleanupProvider(
  client: SageWriteClient,
  manifest: SageSandboxManifest
): Promise<void> {
  for (const target of providerCleanupTargets(manifest)) {
    try {
      const accepted = await client.voidOrDelete(target.resource, target.id);
      manifest.accepted.push({
        resource: target.resource,
        action: "delete",
        externalId: target.id,
        acceptedAt: accepted.evidence.acceptedAt,
        ...(accepted.evidence.requestId
          ? { requestId: accepted.evidence.requestId }
          : {}),
      });
    } catch (error) {
      manifest.cleanup.errors.push(
        `${target.resource}:${target.id}: ${errorText(error)}`
      );
    }
    try {
      const raw = await client.get<Record<string, unknown>>(
        target.resource,
        target.id
      );
      manifest.cleanup.provider.push({
        resource: target.resource,
        externalId: target.id,
        terminal: terminalState(raw),
      });
    } catch (error) {
      manifest.cleanup.errors.push(
        `${target.resource}:${target.id}: readback failed: ${errorText(error)}`
      );
      manifest.cleanup.provider.push({
        resource: target.resource,
        externalId: target.id,
        terminal: "manual_required",
      });
    }
  }
}

async function writeAccepted(
  client: SageWriteClient,
  manifest: SageSandboxManifest,
  input: {
    queueId: string;
    resource: ProviderResource;
    payload: Record<string, unknown>;
    id?: string;
  }
): Promise<string> {
  const key = sageIdempotencyKey(input.queueId, input.resource);
  const accepted = input.id
    ? await client.update(input.resource, input.id, input.payload, key)
    : await client.create(input.resource, input.payload, key);
  const id = providerId(accepted);
  if (!input.id) manifest.externalIds[input.resource].push(id);
  manifest.accepted.push({
    resource: input.resource,
    action: input.id ? "update" : "create",
    externalId: id,
    acceptedAt: accepted.evidence.acceptedAt,
    ...(accepted.evidence.requestId
      ? { requestId: accepted.evidence.requestId }
      : {}),
  });
  return id;
}

export async function runSageSandboxWarGame(
  environment: NodeJS.ProcessEnv = process.env
): Promise<
  | { status: "blocked"; reason: string }
  | { status: "finished"; manifest: SageSandboxManifest; artifactPath: string }
> {
  const preflight = preflightSageSandboxWarGame(environment);
  if (preflight.status === "blocked") return preflight;
  const config = preflight.config;
  assertSageWriteAllowed({
    environment: config.environment,
    businessId: config.businessId,
  });

  const db = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as AcceptanceDb;
  let originalConnection: { syncEnabled: boolean };
  try {
    originalConnection = await validateOpsSandbox(db, config);
  } catch (error) {
    return blocked(`OPS sandbox data preflight failed: ${errorText(error)}`);
  }
  const manifest = createSageSandboxManifest({
    runId: randomUUID(),
    businessId: config.businessId,
    companyId: config.companyId,
    connectionId: config.connectionId,
    createdAt: new Date().toISOString(),
  });
  const tag = `OPS-SAGE-${manifest.runId.slice(0, 8).toUpperCase()}`;
  const date = new Date().toISOString().slice(0, 10);
  const dueDate = addDays(date, 30);
  let refreshToken = config.refreshToken;
  let accessToken = "";
  let client: SageWriteClient | null = null;
  let connectionDisabled = false;

  try {
    const refresh = async (): Promise<string> => {
      const grant = await refreshSageOAuthGrant({
        refreshToken,
        credentials: getSageCredentials("sandbox"),
      });
      refreshToken = grant.refreshToken;
      accessToken = grant.accessToken;
      return accessToken;
    };
    await refresh();
    const businesses = await discoverEligibleSageBusinesses({
      accessToken,
      environment: "sandbox",
      allowedSandboxBusinessIds: getAllowedSageBusinessIds("sandbox"),
    });
    if (!businesses.some((business) => business.id === config.businessId)) {
      throw new Error(
        "Allow-listed Sage sandbox business was not returned by the refreshed grant."
      );
    }
    // The first business-bound request intentionally receives a disposable
    // invalid access token. A 401 must rotate the refresh grant and replay the
    // same idempotent request without changing its provider identity.
    accessToken = `expired-acceptance-${manifest.runId}`;
    client = createSageWriteClient({
      businessId: config.businessId,
      baseUrl: SAGE_API_BASE,
      getAccessToken: async () => accessToken,
      refreshAccessToken: refresh,
      onDisconnect: async () => {
        throw new Error("Sage sandbox grant was revoked during acceptance.");
      },
    });
    if (originalConnection.syncEnabled) {
      await setSyncEnabled(db, config, false);
      connectionDisabled = true;
    }

    const lines = [
      {
        description: `${tag} MATERIALS`,
        quantity: "1",
        unitPrice: "40.00",
        subtotal: "40.00",
        ledgerAccountId: config.ledgerAccountId,
        taxRateId: config.taxRateId,
      },
      {
        description: `${tag} LABOUR`,
        quantity: "2",
        unitPrice: "60.00",
        subtotal: "120.00",
        ledgerAccountId: config.ledgerAccountId,
        taxRateId: config.taxRateId,
      },
    ];
    const customer = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "contacts",
      payload: buildSageContact({
        name: `${tag} CUSTOMER`,
        kind: "customer",
        email: `sage-${manifest.runId}@example.invalid`,
      }),
    });
    const supplier = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "contacts",
      payload: buildSageContact({ name: `${tag} SUPPLIER`, kind: "supplier" }),
    });
    const salesBase = {
      contactId: customer,
      date,
      dueOrExpiryDate: dueDate,
      lines,
    };
    const estimate = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "sales_estimates",
      payload: buildSageSalesDocument("sales_estimates", {
        ...salesBase,
        reference: `${tag}-EST`,
      }),
    });
    const quote = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "sales_quotes",
      payload: buildSageSalesDocument("sales_quotes", {
        ...salesBase,
        reference: `${tag}-QUO`,
      }),
    });
    const invoiceA = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "sales_invoices",
      payload: buildSageSalesDocument("sales_invoices", {
        ...salesBase,
        reference: `${tag}-INV-A`,
      }),
    });
    const invoiceB = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "sales_invoices",
      payload: buildSageSalesDocument("sales_invoices", {
        ...salesBase,
        reference: `${tag}-INV-B`,
      }),
    });
    const initialPayment = buildSageContactPayment({
      transactionType: "CUSTOMER_RECEIPT",
      contactId: customer,
      bankAccountId: config.bankAccountId,
      paymentMethodId: config.paymentMethodId,
      date,
      amount: "40.00",
      allocations: [{ artefactId: invoiceA, amount: "40.00" }],
      reference: `${tag}-PAY`,
    });
    const payment = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "contact_payments",
      payload: initialPayment,
    });
    const supplierBill = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "purchase_invoices",
      payload: buildSagePurchaseInvoice({
        contactId: supplier,
        date,
        dueDate,
        reference: `${tag}-BILL`,
        lines,
      }),
    });
    const supplierPayment = await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "contact_payments",
      payload: buildSageContactPayment({
        transactionType: "VENDOR_PAYMENT",
        contactId: supplier,
        bankAccountId: config.bankAccountId,
        paymentMethodId: config.paymentMethodId,
        date,
        amount: "40.00",
        allocations: [{ artefactId: supplierBill, amount: "40.00" }],
        reference: `${tag}-SUP-PAY`,
      }),
    });

    await writeAccepted(client, manifest, {
      queueId: randomUUID(),
      resource: "contacts",
      id: customer,
      payload: buildSageContact({
        name: `${tag} CUSTOMER UPDATED`,
        kind: "customer",
        email: `sage-${manifest.runId}@example.invalid`,
      }),
    });
    const reallocationPayload = buildSageContactPayment({
      transactionType: "CUSTOMER_RECEIPT",
      contactId: customer,
      bankAccountId: config.bankAccountId,
      paymentMethodId: config.paymentMethodId,
      date,
      amount: "40.00",
      allocations: [{ artefactId: invoiceB, amount: "40.00" }],
      reference: `${tag}-PAY-MOVED`,
    });
    const replayQueueId = randomUUID();
    const movedId = await writeAccepted(client, manifest, {
      queueId: replayQueueId,
      resource: "contact_payments",
      id: payment,
      payload: reallocationPayload,
    });
    const replayedId = await writeAccepted(client, manifest, {
      queueId: replayQueueId,
      resource: "contact_payments",
      id: payment,
      payload: reallocationPayload,
    });
    if (movedId !== payment || replayedId !== payment) {
      throw new Error(
        "Sage duplicate update replay changed provider identity."
      );
    }

    await seedOpsGraph(
      db,
      config,
      manifest,
      {
        customer,
        supplier,
        estimate,
        quote,
        invoiceA,
        invoiceB,
        payment,
        supplierBill,
        supplierPayment,
      },
      tag,
      date,
      dueDate
    );
    await setSyncEnabled(db, config, true);
    connectionDisabled = false;
    await applyPull(db, config, manifest, client, {
      entityType: "customer",
      opsKey: "customer",
      resource: "contacts",
      externalId: customer,
    });
    await applyPull(db, config, manifest, client, {
      entityType: "payment",
      opsKey: "payment",
      resource: "contact_payments",
      externalId: payment,
    });

    for (const resource of PROVIDER_RESOURCES) {
      for (const externalId of manifest.externalIds[resource]) {
        const raw = await client.get(resource, externalId);
        if (!raw)
          throw new Error(`Sage readback lost ${resource}:${externalId}.`);
        manifest.pullReadback.push({
          resource,
          externalId,
          observedAt: new Date().toISOString(),
        });
      }
    }
    manifest.status = "passed";
  } catch (error) {
    manifest.status = "failed";
    manifest.errors.push(errorText(error));
  } finally {
    manifest.cleanup.status = "running";
    manifest.cleanup.startedAt = new Date().toISOString();
    if (client) await cleanupProvider(client, manifest);
    try {
      if (!connectionDisabled) {
        await setSyncEnabled(db, config, false);
        connectionDisabled = true;
      }
      manifest.cleanup.opsRemaining = await deleteExactOpsRows(
        db,
        config,
        manifest
      );
    } catch (error) {
      manifest.cleanup.errors.push(errorText(error));
    }
    if (connectionDisabled && originalConnection.syncEnabled) {
      try {
        await setSyncEnabled(db, config, true);
        connectionDisabled = false;
      } catch (error) {
        manifest.cleanup.errors.push(
          `Restore sync setting: ${errorText(error)}`
        );
      }
    }
    manifest.cleanup.completedAt = new Date().toISOString();
    const providerComplete = manifest.cleanup.provider.every(
      (item) => item.terminal === "missing" || item.terminal === "voided"
    );
    manifest.cleanup.status =
      manifest.cleanup.errors.length === 0 &&
      manifest.cleanup.opsRemaining === 0 &&
      providerComplete
        ? "complete"
        : "manual_required";
    if (manifest.cleanup.status !== "complete") manifest.status = "failed";
    manifest.completedAt = new Date().toISOString();
  }

  assertSageSandboxManifest(manifest);
  await mkdir(config.manifestDirectory, { recursive: true, mode: 0o700 });
  const artifactPath = resolve(
    config.manifestDirectory,
    `${manifest.runId}.manifest.json`
  );
  await writeFile(
    artifactPath,
    `${JSON.stringify(redactSageSandboxManifest(manifest), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return { status: "finished", manifest, artifactPath };
}

async function main(): Promise<void> {
  const result = await runSageSandboxWarGame();
  if (result.status === "blocked") {
    process.stdout.write(`${result.reason}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.manifest.status,
        runId: result.manifest.runId,
        cleanup: result.manifest.cleanup.status,
        artifactPath: result.artifactPath,
      },
      null,
      2
    )}\n`
  );
  process.exitCode = result.manifest.status === "passed" ? 0 : 1;
}

if (process.argv[1]?.endsWith("sage-sandbox-war-game.ts")) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 1;
  });
}
