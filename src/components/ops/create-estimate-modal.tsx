"use client";

import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LineItemEditor,
  createEmptyLineItem,
  computeAmount,
  type LineItemRow,
} from "@/components/ops/line-item-editor";
import {
  useCreateEstimate,
  useClients,
  useProjects,
  useProducts,
} from "@/lib/hooks";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { CreateEstimate, CreateLineItem } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { useDictionary } from "@/i18n/client";
import { toast } from "sonner";

// ─── Extracted Form Component ─────────────────────────────────────────────────

interface CreateEstimateFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  /**
   * Link the created estimate to this opportunity (deal-scoped creation from
   * the pipeline lead-detail Overview tab). Writes `opportunity_id` so the
   * estimate surfaces in `useEstimates({ opportunityId })` for that deal.
   */
  opportunityId?: string;
  /** Pre-select this client (e.g. the deal's linked client). */
  clientId?: string;
}

export function CreateEstimateForm({
  onSuccess,
  onCancel,
  opportunityId,
  clientId: defaultClientId,
}: CreateEstimateFormProps) {
  const { t } = useDictionary("pipeline");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const can = usePermissionStore((s) => s.can);

  const { data: clientsData } = useClients();
  const { data: projectsData } = useProjects();
  const { data: products = [] } = useProducts();
  const createEstimate = useCreateEstimate();

  const clients = clientsData?.clients ?? [];
  const projects = projectsData?.projects ?? [];

  // Setup gate
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  // Check setup on mount
  useEffect(() => {
    if (!setupComplete) {
      setShowSetupModal(true);
    }
  }, [setupComplete]);

  // Form state — clientId pre-fills from the deal's client on a scoped open.
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [expirationDate, setExpirationDate] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => [createEmptyLineItem()]);

  const handleSubmit = () => {
    if (!can("estimates.create")) return;

    const mappedLineItems: Partial<CreateLineItem>[] = lineItems.map((li, index) => ({
      name: li.name,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountPercent: li.discountPercent,
      productId: li.productId,
      sortOrder: index,
      estimateId: null,
      invoiceId: null,
      isTaxable: li.isTaxable,
      unit: li.unit,
      isOptional: li.isOptional,
      isSelected: li.isSelected,
      companyId,
    }));

    const totals = lineItems.reduce(
      (acc, li) => {
        const amt = computeAmount(li);
        return {
          subtotal: acc.subtotal + amt.lineTotal,
          taxAmount: acc.taxAmount + amt.tax,
          discountAmount:
            acc.discountAmount +
            (li.discountPercent > 0
              ? (li.quantity * li.unitPrice * li.discountPercent) / 100
              : 0),
        };
      },
      { subtotal: 0, taxAmount: 0, discountAmount: 0 }
    );
    const total = totals.subtotal + totals.taxAmount - totals.discountAmount;

    const formData: Partial<CreateEstimate> & { companyId: string } = {
      companyId,
      // Link to the deal when scoped (Overview tab); null on the bare FAB open.
      opportunityId: opportunityId ?? null,
      clientId: clientId || undefined,
      projectId: projectId || null,
      issueDate: date ? new Date(date) : new Date(),
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      clientMessage: notes || null,
      internalNotes: internalNotes || null,
      terms: termsAndConditions || null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      total,
      status: EstimateStatus.Draft,
    };

    createEstimate.mutate(
      { data: formData, lineItems: mappedLineItems },
      {
        onSuccess: () => {
          toast.success("Estimate created");
          onSuccess?.();
        },
        onError: (err) => {
          toast.error("Failed to create estimate", {
            description: err instanceof Error ? err.message : "Please try again.",
          });
        },
      }
    );
  };

  return (
    <>
      <div className="space-y-2">
        {/* Client + Project */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
              {t("estimates.form.client")}
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
            >
              <option value="">Select client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
              {t("estimates.form.project")}
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
            >
              <option value="">Select project (optional)...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            label={t("estimates.form.date")}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label={t("estimates.form.validUntil")}
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
          />
        </div>

        {/* Line Items */}
        <div className="space-y-0.5">
          <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
            {t("estimates.form.lineItems")}
          </label>
          <LineItemEditor items={lineItems} onChange={setLineItems} products={products} />
        </div>

        {/* Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Textarea
            label={t("estimates.form.notes")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes for the client..."
            rows={3}
          />
          <Textarea
            label={t("estimates.form.internalNotes")}
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder={t("estimates.form.internalNotes")}
            rows={3}
          />
        </div>

        {/* T&C */}
        <Textarea
          label={t("estimates.form.terms")}
          value={termsAndConditions}
          onChange={(e) => setTermsAndConditions(e.target.value)}
          placeholder="Terms and conditions..."
          rows={2}
        />

        {/* Actions */}
        <div className="flex items-center justify-end gap-1 pt-1">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={createEstimate.isPending}>
              Cancel
            </Button>
          )}
          <Button onClick={handleSubmit} loading={createEstimate.isPending} className="gap-[6px]">
            <Save className="w-[16px] h-[16px]" />
            Create Estimate
          </Button>
        </div>
      </div>

      {/* Setup interception modal */}
      <SetupInterceptionModal
        isOpen={showSetupModal}
        onComplete={() => {
          setShowSetupModal(false);
        }}
        onDismiss={() => {
          setShowSetupModal(false);
          onCancel?.();
        }}
        missingSteps={missingSteps}
        triggerAction="estimates"
      />
    </>
  );
}

// ─── Window-metadata defaults ────────────────────────────────────────────────

/**
 * Derive {@link CreateEstimateForm} defaults from a floating-window's metadata
 * bag. Deal-scoped opens (the pipeline lead-detail Overview tab) stash
 * `{ opportunityId, clientId }` on the `create-estimate` window metadata; the
 * FAB opens it bare. Each field is string-guarded so a malformed metadata bag
 * degrades gracefully to an unscoped (general) estimate rather than throwing.
 */
export function createEstimateDefaultsFromMeta(
  metadata?: Record<string, unknown>,
): Pick<CreateEstimateFormProps, "opportunityId" | "clientId"> {
  return {
    opportunityId:
      typeof metadata?.opportunityId === "string"
        ? metadata.opportunityId
        : undefined,
    clientId:
      typeof metadata?.clientId === "string" ? metadata.clientId : undefined,
  };
}

// ─── Modal Component (thin wrapper) ──────────────────────────────────────────

interface CreateEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateEstimateModal({ open, onOpenChange }: CreateEstimateModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            New Estimate
          </DialogTitle>
        </DialogHeader>
        <CreateEstimateForm
          onSuccess={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
