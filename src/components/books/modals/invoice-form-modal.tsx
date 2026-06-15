"use client";

/**
 * Invoice create/edit modal — ported verbatim from the retired
 * (dashboard)/invoices page for the Books invoices segment (P3.1).
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
  type LineItemRow,
} from "@/components/ops/line-item-editor";
import {
  InvoiceStatus,
  calculateLineTotal,
  PAYMENT_TERMS_OPTIONS,
} from "@/lib/types/pipeline";
import type { Invoice, Product, CreateInvoice, CreateLineItem } from "@/lib/types/pipeline";

/** Radix Select forbids an empty-string item value; this sentinel represents
 *  the optional "no project" choice and maps back to "" on change. */
const PROJECT_NONE = "__none__";

/** Dictionary key for a payment-terms enum value ("Due on Receipt" →
 *  form.paymentTerms.due_on_receipt). Option values stay the stable enum;
 *  only the labels localize. */
function paymentTermKey(term: string): string {
  return `form.paymentTerms.${term.toLowerCase().replace(/\s+/g, "_")}`;
}

/** Local helper — replaces the old models.calculateDueDate import */
function calculateDueDate(issueDate: Date, terms: string): Date {
  const d = new Date(issueDate);
  if (terms === "Due on Receipt") return d;
  const match = terms.match(/Net\s+(\d+)/);
  if (match) d.setDate(d.getDate() + parseInt(match[1]));
  return d;
}

export function InvoiceFormModal({
  open,
  onClose,
  invoice,
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
  invoice: Invoice | null;
  loading?: boolean;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; title: string }>;
  products: Array<Product>;
  companyId: string;
  onCreate: (data: Partial<CreateInvoice> & { companyId: string }, lineItems: Array<Partial<CreateLineItem>>) => void;
  onUpdate: (id: string, data: Partial<CreateInvoice> & { companyId: string }, lineItems: Array<Partial<CreateLineItem>>) => void;
}) {
  const { t } = useDictionary("pipeline");
  const { t: tc } = useDictionary("common");
  const isEditing = !!invoice;

  // State is fully prop-driven through the effect below. Initial values stay
  // blank so we never capture a stale list row that's missing its line items.
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [dueDate, setDueDate] = useState("");
  const [depositAmount, setDepositAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => [createEmptyLineItem()]);

  // Auto-compute due date from terms
  useEffect(() => {
    if (date && paymentTerms) {
      const computed = calculateDueDate(new Date(date), paymentTerms);
      setDueDate(computed.toISOString().slice(0, 10));
    }
  }, [date, paymentTerms]);

  // Reset form when invoice changes. Skips while `loading` so we don't
  // populate from an incomplete list row.
  useEffect(() => {
    if (loading) return;

    if (invoice) {
      setClientId(invoice.clientId ?? "");
      setProjectId(invoice.projectId ?? "");
      setDate(
        invoice.issueDate
          ? new Date(invoice.issueDate).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10)
      );
      setPaymentTerms(invoice.paymentTerms ?? "Net 30");
      setDueDate(
        invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : ""
      );
      setDepositAmount(invoice.depositApplied ?? 0);
      setNotes(invoice.clientMessage ?? "");
      setInternalNotes(invoice.internalNotes ?? "");
      setLineItems(
        invoice.lineItems && invoice.lineItems.length > 0
          ? invoice.lineItems.map((li) => ({
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
      setPaymentTerms("Net 30");
      setDepositAmount(0);
      setNotes("");
      setInternalNotes("");
      setLineItems([createEmptyLineItem()]);
    }
  }, [invoice, loading]);

  const handleSubmit = () => {
    const mappedLineItems = lineItems.map((li, index) => {
      return {
        companyId,
        name: li.name, quantity: li.quantity, unitPrice: li.unitPrice,
        isTaxable: li.isTaxable, discountPercent: li.discountPercent,
        sortOrder: index, productId: li.productId,
        unit: li.unit, isOptional: li.isOptional, isSelected: li.isSelected,
        estimateId: null, invoiceId: null,
        description: null, unitCost: null, taxRateId: null,
        category: null, serviceDate: null,
      };
    });

    const totals = mappedLineItems.reduce(
      (acc, li) => {
        const lineTotal = calculateLineTotal(li.quantity, li.unitPrice, li.discountPercent);
        return { subtotal: acc.subtotal + lineTotal, taxAmount: acc.taxAmount, discountAmount: acc.discountAmount };
      },
      { subtotal: 0, taxAmount: 0, discountAmount: 0 }
    );
    const total = totals.subtotal + totals.taxAmount - totals.discountAmount;

    const formData: Partial<CreateInvoice> & { companyId: string } = {
      companyId,
      clientId: clientId || "",
      projectId: projectId || null,
      issueDate: date ? new Date(date) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      paymentTerms,
      clientMessage: notes || null,
      internalNotes: internalNotes || null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      total,
      status: invoice?.status ?? InvoiceStatus.Draft,
    };

    if (isEditing && invoice) {
      onUpdate(invoice.id, formData, mappedLineItems);
    } else {
      onCreate(formData, mappedLineItems);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-cakemono text-cake-display font-light uppercase">
              {isEditing ? `${t("invoices.modal.edit")} ${invoice?.invoiceNumber ?? ""}` : t("invoices.modal.new")}
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
          <DialogTitle className="font-cakemono text-cake-display font-light uppercase">
            {isEditing ? `${t("invoices.modal.edit")} ${invoice?.invoiceNumber}` : t("invoices.modal.new")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Client + Project */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.client")}</label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="h-9"><SelectValue placeholder={t("form.selectClient")} /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.project")}</label>
              <Select value={projectId || PROJECT_NONE} onValueChange={(v) => setProjectId(v === PROJECT_NONE ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder={t("form.selectProjectOptional")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROJECT_NONE}>{t("form.selectProjectOptional")}</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date + Terms + Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.date")}</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.paymentTerms")}</label>
              <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERMS_OPTIONS.map((term) => <SelectItem key={term} value={term}>{t(paymentTermKey(term))}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.dueDate")}</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Deposit */}
          <div className="max-w-[200px] space-y-0.5">
            <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.deposit")}</label>
            <Input type="number" min={0} step={0.01} value={depositAmount} onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)} />
          </div>

          {/* Line Items */}
          <div className="space-y-0.5">
            <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.lineItems")}</label>
            <LineItemEditor items={lineItems} onChange={setLineItems} products={products} />
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.notes")}</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("form.paymentNotesPlaceholder")} rows={3} />
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">{t("invoices.form.internalNotes")}</label>
              <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder={t("invoices.form.internalNotes")} rows={3} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>{tc("cancel")}</Button>
            <Button onClick={handleSubmit}>{isEditing ? t("invoices.modal.save") : t("invoices.modal.create")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

