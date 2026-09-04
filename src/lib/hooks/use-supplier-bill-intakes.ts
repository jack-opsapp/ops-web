import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  SupplierBillCheckDisposition,
  SupplierBillCheckKey,
  SupplierBillCheckOutcome,
  SupplierBillIntakeStage,
  SupplierDocumentKind,
} from "@/lib/accounting/supplier-bills/intake-contracts";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { authedFetch } from "@/lib/utils/authed-fetch";

export interface SupplierBillIntakeSummary {
  id: string;
  company_id: string;
  document_kind: SupplierDocumentKind;
  review_stage: SupplierBillIntakeStage;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  total: string;
  payment_owner_id: string | null;
  planned_payment_date: string | null;
  hold_reason: string | null;
  next_action: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  promoted_bill_id: string | null;
}

export interface SupplierBillIntakeLine {
  id: string;
  position: number;
  sku: string | null;
  description: string;
  ordered_quantity: string | null;
  invoiced_quantity: string;
  unit_of_measure: string | null;
  unit_price: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  category_id: string | null;
  job_hint: string | null;
  match_basis: "address" | "purchase_order" | "manual" | null;
  match_status: "unmatched" | "suggested" | "confirmed";
  matched_project_id: string | null;
  supplier_bill_intake_allocations: Array<{
    project_id: string;
    amount: string;
    allocation_basis:
      | "suggested_proportional"
      | "confirmed_suggestion"
      | "manual";
    confirmed_by: string | null;
  }>;
}

export interface SupplierBillIntakeCheck {
  id: string;
  check_key: SupplierBillCheckKey;
  outcome: SupplierBillCheckOutcome;
  disposition: SupplierBillCheckDisposition;
  observed_value: string | null;
  policy_limit: string | null;
  evidence: Record<string, unknown>;
  note: string | null;
}

export interface SupplierBillIntakeDetail {
  intake: SupplierBillIntakeSummary & {
    subtotal: string;
    tax_total: string;
    purchase_order: string | null;
    shipping_reference: string | null;
    category_id: string | null;
    approved_at: string | null;
    paid_at: string | null;
    supplier_bills: {
      balance: string;
      status: "open" | "partial" | "paid";
    } | null;
  };
  lines: SupplierBillIntakeLine[];
  checks: SupplierBillIntakeCheck[];
  document: {
    public_url: string;
    original_filename: string;
    size_bytes: number;
  } | null;
  events: Array<{
    id: string;
    action: string;
    actor_user_id: string;
    created_at: string;
  }>;
}

export interface SupplierBillPreparedWrite {
  intentId: string;
  confirmationText: string;
  expiresAt: string;
  status: "prepared" | "committed";
  preview?: Record<string, unknown>;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error ?? "Supplier bills unavailable.");
  }
  if (!body) throw new Error("Supplier bills unavailable.");
  return body;
}

async function fetchSupplierBillIntakes(): Promise<
  SupplierBillIntakeSummary[]
> {
  const response = await authedFetch(
    "/api/internal/accounting/supplier-bills/intakes"
  );
  const body = await jsonResponse<{ items: SupplierBillIntakeSummary[] }>(
    response
  );
  return body.items;
}

async function fetchSupplierBillIntake(
  intakeId: string
): Promise<SupplierBillIntakeDetail> {
  return jsonResponse<SupplierBillIntakeDetail>(
    await authedFetch(
      `/api/internal/accounting/supplier-bills/intakes/${intakeId}`
    )
  );
}

async function prepareSupplierBillCapture(input: {
  file: File;
  documentKind: SupplierDocumentKind;
}): Promise<SupplierBillPreparedWrite> {
  const requestId = crypto.randomUUID();
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      requestId,
      idempotencyKey: `capture:${requestId}`,
      documentKind: input.documentKind,
    })
  );
  form.set("document", input.file);
  return jsonResponse<SupplierBillPreparedWrite>(
    await authedFetch("/api/internal/accounting/supplier-bills/intakes", {
      method: "POST",
      body: form,
    })
  );
}

async function prepareSupplierBillAction(input: {
  intakeId: string;
  command: Record<string, unknown>;
}): Promise<SupplierBillPreparedWrite> {
  return jsonResponse<SupplierBillPreparedWrite>(
    await authedFetch(
      `/api/internal/accounting/supplier-bills/intakes/${input.intakeId}/prepare`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.command),
      }
    )
  );
}

async function commitSupplierBillWrite(input: {
  intakeId: string;
  prepared: Pick<SupplierBillPreparedWrite, "intentId" | "confirmationText">;
}): Promise<SupplierBillIntakeDetail> {
  return jsonResponse<SupplierBillIntakeDetail>(
    await authedFetch(
      `/api/internal/accounting/supplier-bills/intakes/${input.intakeId}/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentId: input.prepared.intentId,
          confirmationText: input.prepared.confirmationText,
        }),
      }
    )
  );
}

export function useSupplierBillIntakes() {
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  const canView = usePermissionStore((state) => state.can("accounting.view"));
  return useQuery({
    queryKey: queryKeys.accounting.supplierBillIntakes(companyId),
    queryFn: fetchSupplierBillIntakes,
    enabled: Boolean(companyId && canView),
    staleTime: 30_000,
  });
}

export function useSupplierBillIntake(intakeId: string | null) {
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  const canView = usePermissionStore((state) => state.can("accounting.view"));
  return useQuery({
    queryKey: queryKeys.accounting.supplierBillIntake(
      companyId,
      intakeId ?? ""
    ),
    queryFn: () => fetchSupplierBillIntake(intakeId!),
    enabled: Boolean(companyId && intakeId && canView),
  });
}

export interface SupplierBillExpenseCategory {
  id: string;
  name: string;
}

export function useSupplierBillExpenseCategories() {
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  const canCapture = usePermissionStore((state) =>
    state.can("accounting.bills.capture")
  );
  return useQuery({
    queryKey: ["expense-categories", companyId, "supplier-bills"],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("expense_categories")
        .select("id,name")
        .eq("company_id", companyId)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as SupplierBillExpenseCategory[];
    },
    enabled: Boolean(companyId && canCapture),
  });
}

export function useCaptureSupplierBillIntake() {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  return useMutation({
    mutationFn: async (input: {
      file: File;
      documentKind: SupplierDocumentKind;
    }) => {
      const prepared = await prepareSupplierBillCapture(input);
      return commitSupplierBillWrite({
        intakeId: prepared.preview?.requestId as string,
        prepared,
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.supplierBillIntakes(companyId),
      }),
  });
}

export function usePrepareSupplierBillAction() {
  return useMutation({ mutationFn: prepareSupplierBillAction });
}

export function useCommitSupplierBillWrite() {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  return useMutation({
    mutationFn: commitSupplierBillWrite,
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.supplierBillIntakes(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.supplierBillIntake(
          companyId,
          input.intakeId
        ),
      });
    },
  });
}
