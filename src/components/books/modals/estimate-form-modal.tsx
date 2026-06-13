"use client";

/**
 * Estimate create/edit modal — ported verbatim from the retired
 * (dashboard)/estimates page for the Books estimates segment (P3.1).
 */

import { useState, useEffect } from "react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineItemEditor,
  createEmptyLineItem,
  computeAmount,
  type LineItemRow,
} from "@/components/ops/line-item-editor";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { Estimate, Product, CreateEstimate, CreateLineItem } from "@/lib/types/pipeline";
import { formatDateOnly } from "@/lib/utils/format";

/** Radix Select forbids an empty-string item value; this sentinel represents
 *  the optional "no project" choice and maps back to "" on change. */
const PROJECT_NONE = "__none__";

export function EstimateFormModal({
  open,
  onClose,
  estimate,
  loading = false,
  clients,
  projects,
  products,
  companyId,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  estimate: Estimate | null;
  loading?: boolean;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; title: string }>;
  products: Array<Product>;
  companyId: string;
  onCreate: (data: Partial<CreateEstimate> & { companyId: string }, lineItems: Array<Partial<CreateLineItem>>) => void;
  onUpdate: (id: string, data: Partial<CreateEstimate> & { companyId: string }, lineItems: Array<Partial<CreateLineItem>>) => void;
}) {
  const { t } = useDictionary("pipeline");
  const { t: tc } = useDictionary("common");
  const isEditing = !!estimate;

  // State is fully driven by props through the effect below. Initializers are
  // intentionally blank so the initial render never captures a partial list
  // row (no line items) as the source of truth.
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expirationDate, setExpirationDate] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => [createEmptyLineItem()]);

  // Reset form when estimate changes. Waits for `loading` to clear so we
  // never populate from an incomplete list-row estimate that's missing its
  // line items — otherwise the form would flash $0 and be overwritten on
  // the next render.
  useEffect(() => {
    if (loading) return;

    if (estimate) {
      setClientId(estimate.clientId ?? "");
      setProjectId(estimate.projectId ?? estimate.opportunityId ?? "");
      setDate(
        estimate.issueDate
          ? formatDateOnly(estimate.issueDate)
          : formatDateOnly(new Date())
      );
      setExpirationDate(
        estimate.expirationDate ? formatDateOnly(estimate.expirationDate) : ""
      );
      setNotes(estimate.clientMessage ?? "");
      setInternalNotes(estimate.internalNotes ?? "");
      setTermsAndConditions(estimate.terms ?? "");
      setLineItems(
        estimate.lineItems && estimate.lineItems.length > 0
          ? estimate.lineItems.map((li) => ({
              id: li.id,
              name: li.name,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              isTaxable: li.isTaxable,
              discountPercent: li.discountPercent,
              productId: li.productId,
              unit: li.unit,
              isOptional: li.isOptional,
              isSelected: li.isSelected,
            }))
          : [createEmptyLineItem()]
      );
    } else {
      setClientId("");
      setProjectId("");
      setDate(new Date().toISOString().slice(0, 10));
      setExpirationDate("");
      setNotes("");
      setInternalNotes("");
      setTermsAndConditions("");
      setLineItems([createEmptyLineItem()]);
    }
  }, [estimate, loading]);

  const handleSubmit = () => {
    const mappedLineItems: Partial<CreateLineItem>[] = lineItems.map((li, index) => {
      return {
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
      };
    });

    const totals = lineItems.reduce(
      (acc, li) => {
        const amt = computeAmount(li);
        return {
          subtotal: acc.subtotal + amt.lineTotal,
          taxAmount: acc.taxAmount + amt.tax,
          discountAmount: acc.discountAmount + (li.discountPercent > 0 ? (li.quantity * li.unitPrice * li.discountPercent / 100) : 0),
        };
      },
      { subtotal: 0, taxAmount: 0, discountAmount: 0 }
    );
    const total = totals.subtotal + totals.taxAmount - totals.discountAmount;

    const formData: Partial<CreateEstimate> & { companyId: string } = {
      companyId,
      clientId: clientId ?? undefined,
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
      status: estimate?.status ?? EstimateStatus.Draft,
    };

    if (isEditing && estimate) {
      onUpdate(estimate.id, formData, mappedLineItems);
    } else {
      onCreate(formData, mappedLineItems);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-cakemono text-[22px] font-light uppercase">
              {isEditing ? `${t("estimates.modal.edit")} ${estimate?.estimateNumber ?? ""}` : t("estimates.modal.new")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {[48, 48, 48, 120, 80, 80].map((h, i) => (
              <div
                key={i}
                className="w-full rounded bg-fill-neutral-dim/40 animate-pulse motion-reduce:animate-none"
                style={{ height: h }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-[22px] font-light uppercase">
            {isEditing ? `${t("estimates.modal.edit")} ${estimate?.estimateNumber}` : t("estimates.modal.new")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Client + Project */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
                {t("estimates.form.client")}
              </label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("form.selectClient")} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
                {t("estimates.form.project")}
              </label>
              <Select value={projectId || PROJECT_NONE} onValueChange={(v) => setProjectId(v === PROJECT_NONE ? "" : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("form.selectProjectOptional")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROJECT_NONE}>{t("form.selectProjectOptional")}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
                {t("estimates.form.date")}
              </label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
                {t("estimates.form.validUntil")}
              </label>
              <Input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-0.5">
            <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
              {t("estimates.form.lineItems")}
            </label>
            <LineItemEditor
              items={lineItems}
              onChange={setLineItems}
              products={products}
            />
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
                {t("estimates.form.notes")}
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("form.clientNotesPlaceholder")}
                rows={3}
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
                {t("estimates.form.internalNotes")}
              </label>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder={t("estimates.form.internalNotes")}
                rows={3}
              />
            </div>
          </div>

          {/* T&C */}
          <div className="space-y-0.5">
            <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
              {t("estimates.form.terms")}
            </label>
            <Textarea
              value={termsAndConditions}
              onChange={(e) => setTermsAndConditions(e.target.value)}
              placeholder={t("form.termsPlaceholder")}
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSubmit}>
              {isEditing ? t("estimates.modal.save") : t("estimates.modal.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
