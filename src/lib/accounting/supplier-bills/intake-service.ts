import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import {
  evaluateCanproRate,
  evaluateQuantityVariance,
  findDuplicateCandidates,
} from "./canpro-reconciliation";
import {
  type CanonicalSupplierBillIntakeDraft,
  type SupplierBillCheckKey,
  type SupplierBillIntakeDraft,
  type SupplierBillIntakeStage,
  canonicalizeSupplierBillIntakeDraft,
  requiredChecksForDocument,
} from "./intake-contracts";
import {
  SupplierBillIntakeRepository,
  type SupplierBillIntakeRepositoryContract,
} from "./intake-repository";
import {
  removeSupplierBillPdf,
  storeSupplierBillPdf,
  type StoredSupplierBillDocument,
} from "./document-custody";
import {
  extractPdfText,
  parseDeksMartInvoiceText,
  type DeksMartInvoiceExtraction,
  type ExtractedPdfText,
} from "./pdf-extraction";

type RpcResult = {
  data: unknown;
  error: { message?: string; code?: string } | null;
};
type RpcFunction = (
  name: string,
  args: Record<string, unknown>
) => PromiseLike<RpcResult>;

export interface SupplierBillIntakeActor {
  actorUserId: string;
  companyId: string;
  idToken: string;
}

export interface SupplierBillIntakeCaptureMetadata {
  requestId: string;
  idempotencyKey: string;
  documentKind: "material" | "subcontractor" | "employee";
  categoryId?: string | null;
  paymentOwnerId?: string | null;
  plannedPaymentDate?: string | null;
  facts?: SupplierBillIntakeDraft;
}

export interface SupplierBillIntakeServiceDependencies {
  repository: SupplierBillIntakeRepositoryContract;
  rpc: RpcFunction;
  storeDocument: typeof storeSupplierBillPdf;
  removeDocument: typeof removeSupplierBillPdf;
  extractDocument: typeof extractPdfText;
  parseDocument: typeof parseDeksMartInvoiceText;
}

export class SupplierBillIntakeServiceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SupplierBillIntakeServiceError";
  }
}

function defaultDependencies(): SupplierBillIntakeServiceDependencies {
  const client = getServiceRoleClient();
  return {
    repository: new SupplierBillIntakeRepository(
      client as unknown as ConstructorParameters<
        typeof SupplierBillIntakeRepository
      >[0]
    ),
    rpc: client.rpc.bind(client) as unknown as RpcFunction,
    storeDocument: storeSupplierBillPdf,
    removeDocument: removeSupplierBillPdf,
    extractDocument: extractPdfText,
    parseDocument: parseDeksMartInvoiceText,
  };
}

function rpcError(error: { message?: string; code?: string } | null): never {
  throw new SupplierBillIntakeServiceError(
    error?.code ?? "supplier_bill_intake_write_failed",
    error?.message ?? "Supplier bill intake write failed."
  );
}

function moneyCents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole.replace(/,/g, "")) * BigInt(100) +
    BigInt((fraction + "00").slice(0, 2))
  );
}

function moneyString(value: bigint): string {
  return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}`;
}

function allocateTax(
  extraction: DeksMartInvoiceExtraction
): SupplierBillIntakeDraft["lines"] {
  const taxTotal = moneyCents(extraction.taxTotal ?? "0.00");
  const subtotals = extraction.lines.map((line) => moneyCents(line.subtotal));
  const subtotalTotal = subtotals.reduce(
    (sum, value) => sum + value,
    BigInt(0)
  );
  if (subtotalTotal === BigInt(0)) return extraction.lines;
  const rows = subtotals.map((subtotal, index) => {
    const numerator = taxTotal * subtotal;
    return {
      index,
      tax: numerator / subtotalTotal,
      remainder: numerator % subtotalTotal,
    };
  });
  let remaining =
    taxTotal - rows.reduce((sum, row) => sum + row.tax, BigInt(0));
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1
  )) {
    if (remaining === BigInt(0)) break;
    rows[row.index].tax += BigInt(1);
    remaining -= BigInt(1);
  }
  return extraction.lines.map((line, index) => ({
    ...line,
    taxAmount: moneyString(rows[index].tax),
    total: moneyString(moneyCents(line.subtotal) + rows[index].tax),
  }));
}

function extractionDraft(
  metadata: SupplierBillIntakeCaptureMetadata,
  extraction: DeksMartInvoiceExtraction
): SupplierBillIntakeDraft {
  if (metadata.facts) return metadata.facts;
  if (
    !extraction.invoiceNumber ||
    !extraction.invoiceDate ||
    !extraction.subtotal ||
    !extraction.taxTotal ||
    !extraction.total ||
    extraction.lines.length === 0
  ) {
    throw new SupplierBillIntakeServiceError(
      "extraction_incomplete",
      "Confirm the supplier, invoice totals, and line items before capture."
    );
  }
  return {
    documentKind: metadata.documentKind,
    supplierName: extraction.supplierName,
    invoiceNumber: extraction.invoiceNumber,
    invoiceDate: extraction.invoiceDate,
    dueDate: extraction.dueDate,
    plannedPaymentDate: metadata.plannedPaymentDate ?? null,
    purchaseOrder: extraction.purchaseOrder,
    shippingReference: extraction.shippingReference,
    currency: extraction.currency,
    subtotal: extraction.subtotal,
    taxTotal: extraction.taxTotal,
    total: extraction.total,
    lines: allocateTax(extraction),
  };
}

function aggregateOutcome(
  outcomes: readonly ("pending" | "clear" | "exception")[]
): "pending" | "clear" | "exception" {
  if (outcomes.includes("exception")) return "exception";
  if (outcomes.includes("pending")) return "pending";
  return "clear";
}

function buildChecks(
  draft: CanonicalSupplierBillIntakeDraft,
  duplicateCount: number
) {
  const result: Array<{
    key: SupplierBillCheckKey;
    outcome: "pending" | "clear" | "exception";
    disposition: "unresolved";
    observedValue: string | null;
    policyLimit: string | null;
    evidence: Record<string, unknown>;
    note: null;
  }> = [];
  for (const key of requiredChecksForDocument(draft.documentKind)) {
    if (key === "duplicate_billing") {
      result.push({
        key,
        outcome: duplicateCount > 0 ? "exception" : "clear",
        disposition: "unresolved",
        observedValue:
          duplicateCount > 0 ? `${duplicateCount} candidate` : "No candidate",
        policyLimit: null,
        evidence: { candidateCount: duplicateCount },
        note: null,
      });
      continue;
    }
    if (key === "rate_compliance") {
      const findings = draft.lines.map((line) =>
        evaluateCanproRate({
          documentKind: draft.documentKind,
          description: line.description,
          unitOfMeasure: line.unitOfMeasure ?? "—",
          unitPrice: line.unitPrice,
        })
      );
      const outcome = aggregateOutcome(
        findings.map((finding) => finding.outcome)
      );
      result.push({
        key,
        outcome,
        disposition: "unresolved",
        observedValue:
          findings.find((finding) => finding.outcome === "exception")
            ?.observedValue ?? null,
        policyLimit:
          findings.find((finding) => finding.outcome === "exception")
            ?.policyLimit ?? null,
        evidence: { findings },
        note: null,
      });
      continue;
    }
    if (key === "quantity_scope") {
      const findings = draft.lines.map((line) =>
        evaluateQuantityVariance(line.orderedQuantity, line.invoicedQuantity)
      );
      result.push({
        key,
        outcome: aggregateOutcome(findings.map((finding) => finding.outcome)),
        disposition: "unresolved",
        observedValue: null,
        policyLimit: null,
        evidence: { findings },
        note: null,
      });
      continue;
    }
    result.push({
      key,
      outcome: "pending",
      disposition: "unresolved",
      observedValue: null,
      policyLimit: null,
      evidence: {},
      note: null,
    });
  }
  return result;
}

export class SupplierBillIntakeService {
  private readonly dependencies: SupplierBillIntakeServiceDependencies;

  constructor(
    private readonly actor: SupplierBillIntakeActor,
    dependencies?: SupplierBillIntakeServiceDependencies
  ) {
    this.dependencies = dependencies ?? defaultDependencies();
  }

  list(stage?: SupplierBillIntakeStage) {
    return this.dependencies.repository.list(this.actor.companyId, stage);
  }

  detail(intakeId: string) {
    return this.dependencies.repository.detail(this.actor.companyId, intakeId);
  }

  async prepareCapture(input: {
    metadata: SupplierBillIntakeCaptureMetadata;
    filename: string;
    bytes: Buffer;
  }): Promise<unknown> {
    let stored: StoredSupplierBillDocument | null = null;
    try {
      stored = await this.dependencies.storeDocument({
        companyId: this.actor.companyId,
        requestId: input.metadata.requestId,
        filename: input.filename,
        bytes: input.bytes,
      });
      const extracted: ExtractedPdfText =
        await this.dependencies.extractDocument(input.bytes);
      const parsed = this.dependencies.parseDocument(extracted.text);
      const draft = canonicalizeSupplierBillIntakeDraft(
        extractionDraft(input.metadata, parsed)
      );
      const candidates = await this.dependencies.repository.duplicateCandidates(
        this.actor.companyId,
        draft.normalizedSupplierName,
        draft.normalizedInvoiceNumber
      );
      const duplicates = findDuplicateCandidates(
        {
          normalizedSupplierName: draft.normalizedSupplierName,
          normalizedInvoiceNumber: draft.normalizedInvoiceNumber,
          sourceSha256: stored.descriptor.sha256,
        },
        candidates
      );
      const command = {
        kind: "capture",
        requestId: input.metadata.requestId,
        idempotencyKey: input.metadata.idempotencyKey,
        companyId: this.actor.companyId,
        actorUserId: this.actor.actorUserId,
        ...draft,
        categoryId: input.metadata.categoryId ?? null,
        paymentOwnerId: input.metadata.paymentOwnerId ?? null,
        sourceDocument: stored.descriptor,
        extraction: {
          provider: "pdfjs",
          parser: "deksmart-v1",
          confidence: parsed.confidence,
          pageCount: extracted.pages.length,
          provenance: parsed.provenance,
        },
        lines: draft.lines.map((line) => ({ ...line, allocations: [] })),
        checks: buildChecks(draft, duplicates.length),
      };
      const result = await this.dependencies.rpc(
        "prepare_supplier_bill_intake_write",
        { p_actor_user_id: this.actor.actorUserId, p_command: command }
      );
      if (result.error) rpcError(result.error);
      return result.data;
    } catch (error) {
      if (stored) {
        await this.dependencies.removeDocument(stored).catch(() => undefined);
      }
      throw error;
    }
  }

  async prepareAction(
    intakeId: string,
    command: Record<string, unknown>
  ): Promise<unknown> {
    const secured = {
      ...command,
      intakeId,
      companyId: this.actor.companyId,
      actorUserId: this.actor.actorUserId,
    };
    const result = await this.dependencies.rpc(
      "prepare_supplier_bill_intake_write",
      { p_actor_user_id: this.actor.actorUserId, p_command: secured }
    );
    if (result.error) rpcError(result.error);
    return result.data;
  }

  async commit(input: {
    intentId: string;
    confirmationText: string;
  }): Promise<unknown> {
    const result = await this.dependencies.rpc(
      "commit_supplier_bill_intake_write",
      {
        p_actor_user_id: this.actor.actorUserId,
        p_intent_id: input.intentId,
        p_confirmation_text: input.confirmationText,
      }
    );
    if (result.error) rpcError(result.error);
    return result.data;
  }
}

export function supplierBillIntakeHttpStatus(error: unknown): number {
  if (!(error instanceof SupplierBillIntakeServiceError)) return 400;
  if (error.code === "42501") return 403;
  if (error.code === "P0002") return 404;
  if (["23505", "40001", "55000", "57014"].includes(error.code)) return 409;
  return 400;
}
