import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

import {
  canonicalizeSupplierBillCapture,
  type CanonicalSupplierBillCapture,
  type SupplierBillCaptureInput,
} from "./contracts";
import {
  removeSupplierBillPdf,
  storeSupplierBillPdf,
  type StoredSupplierBillDocument,
} from "./document-custody";

type CaptureDraft = Omit<
  SupplierBillCaptureInput,
  "actorUserId" | "companyId" | "sourceDocument"
>;

type RpcResult = {
  data: unknown;
  error: { message?: string; code?: string } | null;
};
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

export interface SupplierBillActor {
  actorUserId: string;
  companyId: string;
  idToken: string;
}

export interface SupplierBillServiceDependencies {
  adminClient: RpcClient;
  actorClient: RpcClient;
  storeDocument: typeof storeSupplierBillPdf;
  removeDocument: typeof removeSupplierBillPdf;
}

export class SupplierBillServiceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SupplierBillServiceError";
  }
}

function rpcError(error: { message?: string; code?: string } | null): never {
  throw new SupplierBillServiceError(
    error?.code ?? "supplier_bill_write_failed",
    error?.message ?? "Supplier bill write failed."
  );
}

function defaultDependencies(
  actor: SupplierBillActor
): SupplierBillServiceDependencies {
  return {
    adminClient: getServiceRoleClient() as unknown as RpcClient,
    actorClient: getAccessTokenClient(actor.idToken) as unknown as RpcClient,
    storeDocument: storeSupplierBillPdf,
    removeDocument: removeSupplierBillPdf,
  };
}

function expenseAllocations(command: CanonicalSupplierBillCapture) {
  const amounts = new Map<string, number>();
  for (const line of command.lineItems) {
    for (const allocation of line.allocations) {
      amounts.set(
        allocation.projectId,
        (amounts.get(allocation.projectId) ?? 0) + Number(allocation.amount)
      );
    }
  }
  const entries = [...amounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  let assigned = 0;
  return entries.map(([projectId, amount], index) => {
    const percentage =
      index === entries.length - 1
        ? Number((100 - assigned).toFixed(6))
        : Number(((amount / Number(command.total)) * 100).toFixed(6));
    assigned = Number((assigned + percentage).toFixed(6));
    return { project_id: projectId, percentage, amount: null };
  });
}

export function buildPaidExpenseCommand(command: CanonicalSupplierBillCapture) {
  const paid = command.paidPurchase;
  if (!paid) {
    throw new SupplierBillServiceError(
      "paid_purchase_required",
      "Paid purchase details are required."
    );
  }
  return {
    request_id: command.requestId,
    expense_id: paid.expenseId,
    company_id: command.companyId,
    submitted_by: command.actorUserId,
    expected_status: null,
    expected_updated_at: null,
    category_id: command.categoryId,
    merchant_name: command.supplier.displayName,
    description: `Supplier invoice ${command.invoiceNumber}`,
    amount: Number(command.total),
    tax_amount: Number(command.taxTotal),
    currency: command.currency,
    expense_date: paid.paidDate,
    payment_method: paid.paymentMethod,
    receipt_image_url: command.sourceDocument.publicUrl,
    receipt_thumbnail_url: null,
    receipt_missing_reason: null,
    receipt_missing_note: null,
    project_missing_reason: null,
    project_missing_note: null,
    ocr_raw_data: {
      supplier_invoice_number: command.invoiceNumber,
      supplier_invoice_date: command.invoiceDate,
      supplier_document_sha256: command.sourceDocument.sha256,
    },
    ocr_confidence: null,
    allocations: expenseAllocations(command),
    submit: true,
  };
}

export class SupplierBillAccountingService {
  private readonly dependencies: SupplierBillServiceDependencies;

  constructor(
    private readonly actor: SupplierBillActor,
    dependencies?: Partial<SupplierBillServiceDependencies>
  ) {
    this.dependencies =
      dependencies?.adminClient &&
      dependencies.actorClient &&
      dependencies.storeDocument &&
      dependencies.removeDocument
        ? (dependencies as SupplierBillServiceDependencies)
        : { ...defaultDependencies(actor), ...dependencies };
  }

  async prepareCapture(input: {
    draft: CaptureDraft;
    filename: string;
    bytes: Buffer;
  }): Promise<unknown> {
    let stored: StoredSupplierBillDocument | null = null;
    try {
      stored = await this.dependencies.storeDocument({
        companyId: this.actor.companyId,
        requestId: input.draft.requestId,
        filename: input.filename,
        bytes: input.bytes,
      });
      const command = canonicalizeSupplierBillCapture({
        ...input.draft,
        companyId: this.actor.companyId,
        actorUserId: this.actor.actorUserId,
        sourceDocument: stored.descriptor,
      });
      const result = await this.dependencies.adminClient.rpc(
        "prepare_supplier_bill_write",
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

  async prepareAction(command: Record<string, unknown>): Promise<unknown> {
    if (command.kind !== "record_payment" && command.kind !== "void") {
      throw new SupplierBillServiceError(
        "invalid_action",
        "Supplier bill action is invalid."
      );
    }
    const secured = {
      ...command,
      companyId: this.actor.companyId,
      actorUserId: this.actor.actorUserId,
    };
    const result = await this.dependencies.adminClient.rpc(
      "prepare_supplier_bill_write",
      { p_actor_user_id: this.actor.actorUserId, p_command: secured }
    );
    if (result.error) rpcError(result.error);
    return result.data;
  }

  async commit(input: {
    intentId: string;
    confirmationText: string;
  }): Promise<unknown> {
    const result = await this.dependencies.adminClient.rpc(
      "commit_supplier_bill_write",
      {
        p_actor_user_id: this.actor.actorUserId,
        p_intent_id: input.intentId,
        p_confirmation_text: input.confirmationText,
      }
    );
    if (result.error) rpcError(result.error);

    const intermediate = result.data as Record<string, unknown> | null;
    if (intermediate?.requiresExpenseCommit !== true) return result.data;
    const command = canonicalizeSupplierBillCapture(
      intermediate.command as unknown as SupplierBillCaptureInput
    );
    const expense = await this.dependencies.actorClient.rpc(
      "save_expense_atomic",
      {
        p_command: buildPaidExpenseCommand(command),
      }
    );
    if (expense.error) rpcError(expense.error);
    const finalized = await this.dependencies.adminClient.rpc(
      "finalize_paid_supplier_purchase",
      {
        p_actor_user_id: this.actor.actorUserId,
        p_intent_id: input.intentId,
        p_expense_receipt: expense.data,
      }
    );
    if (finalized.error) rpcError(finalized.error);
    return finalized.data;
  }
}

export function supplierBillHttpStatus(error: unknown): number {
  if (!(error instanceof SupplierBillServiceError)) return 400;
  if (error.code === "42501") return 403;
  if (["23505", "55000", "57014"].includes(error.code)) return 409;
  return 400;
}
