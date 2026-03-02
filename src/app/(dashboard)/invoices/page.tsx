"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import {
  Plus,
  Search,
  Receipt,
  Send,
  DollarSign,
  Ban,
  Trash2,
  AlertTriangle,
  Download,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { MetricCard } from "@/components/ops/metric-card";
import {
  LineItemEditor,
  createEmptyLineItem,
  computeAmount,
  type LineItemRow,
} from "@/components/ops/line-item-editor";
import {
  useInvoices,
  useCreateInvoice,
  useUpdateInvoice,
  useDeleteInvoice,
  useSendInvoice,
  useVoidInvoice,
  useRecordPayment,
  useClients,
  useProjects,
  useProducts,
} from "@/lib/hooks";
import {
  InvoiceStatus,
  INVOICE_STATUS_COLORS,
  formatCurrency,
  calculateLineTotal,
  PAYMENT_TERMS_OPTIONS,
  PaymentMethod,
} from "@/lib/types/pipeline";
import type { Invoice, Product, CreateInvoice, CreateLineItem, CreatePayment } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";

/** Local helper — replaces the old models.calculateDueDate import */
function calculateDueDate(issueDate: Date, terms: string): Date {
  const d = new Date(issueDate);
  if (terms === "Due on Receipt") return d;
  const match = terms.match(/Net\s+(\d+)/);
  if (match) d.setDate(d.getDate() + parseInt(match[1]));
  return d;
}

type FilterStatus = "all" | InvoiceStatus;

function StatusBadgeInvoice({ status }: { status: InvoiceStatus }) {
  const color = INVOICE_STATUS_COLORS[status] ?? "#9CA3AF";
  return (
    <span
      className="inline-flex items-center gap-[4px] px-[6px] py-[2px] rounded font-kosugi text-[10px] uppercase tracking-wider"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: color }} />
      {status}
    </span>
  );
}

function formatDate(date: Date | null, locale: Locale): string {
  if (!date) return "--";
  return new Date(date).toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric", year: "numeric" });
}

const paymentMethodLabels: Record<PaymentMethod, string> = {
  [PaymentMethod.Cash]: "Cash",
  [PaymentMethod.Check]: "Check",
  [PaymentMethod.CreditCard]: "Credit Card",
  [PaymentMethod.DebitCard]: "Debit Card",
  [PaymentMethod.Ach]: "ACH",
  [PaymentMethod.BankTransfer]: "Bank Transfer",
  [PaymentMethod.Stripe]: "Stripe",
  [PaymentMethod.Other]: "Other",
};

export default function InvoicesPage() {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const statusFilters = useMemo<{ value: FilterStatus; label: string }[]>(() => [
    { value: "all", label: t("invoices.filter.all") },
    { value: InvoiceStatus.Draft, label: t("invoices.filter.draft") },
    { value: InvoiceStatus.Sent, label: t("invoices.filter.sent") },
    { value: InvoiceStatus.PartiallyPaid, label: t("invoices.filter.partial") },
    { value: InvoiceStatus.Paid, label: t("invoices.filter.paid") },
    { value: InvoiceStatus.PastDue, label: t("invoices.filter.pastDue") },
  ], [t]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  const { data: invoices = [], isLoading } = useInvoices();
  const { data: clientsData } = useClients();
  const { data: projectsData } = useProjects();
  const { data: products = [] } = useProducts();

  const clients = clientsData?.clients ?? [];
  const projects = projectsData?.projects ?? [];

  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const recordPayment = useRecordPayment();

  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  // ── Setup gate ──────────────────────────────────────────────────────
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  const gatedOpenCreate = useCallback(() => {
    if (!setupComplete) {
      setShowSetupModal(true);
      return;
    }
    setShowCreateModal(true);
  }, [setupComplete]);

  const setActions = usePageActionsStore((s) => s.setActions);
  const clearActions = usePageActionsStore((s) => s.clearActions);
  useEffect(() => {
    setActions([
      { label: t("invoices.newInvoice"), icon: Plus, onClick: gatedOpenCreate },
    ]);
    return () => clearActions();
  }, [setActions, clearActions, t, gatedOpenCreate]);

  async function handleDownloadPdf(invoiceId: string) {
    setGeneratingPdfId(invoiceId);
    try {
      const res = await fetch("/api/documents/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: invoiceId, documentType: "invoice" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "PDF generation failed" }));
        throw new Error(err.error || "PDF generation failed");
      }
      const { pdfUrl } = await res.json();
      window.open(pdfUrl, "_blank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setGeneratingPdfId(null);
    }
  }

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [clients]);

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => map.set(p.id, p.title));
    return map;
  }, [projects]);

  const filtered = useMemo(() => {
    let list = [...invoices];
    if (filterStatus !== "all") {
      list = list.filter((i) => i.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(q) ||
          (i.clientId && clientMap.get(i.clientId)?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [invoices, filterStatus, searchQuery, clientMap]);

  const metrics = useMemo(() => {
    const outstanding = invoices
      .filter((i) => i.status !== InvoiceStatus.Paid && i.status !== InvoiceStatus.Void)
      .reduce((sum, i) => sum + i.balanceDue, 0);
    const overdue = invoices
      .filter((i) => i.status === InvoiceStatus.PastDue)
      .reduce((sum, i) => sum + i.balanceDue, 0);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidThisMonth = invoices
      .filter((i) => i.status === InvoiceStatus.Paid && i.paidAt && new Date(i.paidAt) >= monthStart)
      .reduce((sum, i) => sum + i.total, 0);
    const draftCount = invoices.filter((i) => i.status === InvoiceStatus.Draft).length;
    return { outstanding, overdue, paidThisMonth, draftCount };
  }, [invoices]);

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <MetricCard
          label={t("invoices.outstanding")}
          value={formatCurrency(metrics.outstanding)}
          icon={<Receipt className="w-[16px] h-[16px]" />}
        />
        <MetricCard
          label={t("invoices.overdue")}
          value={formatCurrency(metrics.overdue)}
          icon={metrics.overdue > 0 ? <AlertTriangle className="w-[16px] h-[16px] text-ops-error" /> : undefined}
        />
        <MetricCard label={t("invoices.paidThisMonth")} value={formatCurrency(metrics.paidThisMonth)} />
        <MetricCard label={t("invoices.drafts")} value={String(metrics.draftCount)} />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-kosugi text-caption-sm text-text-tertiary">
          {filtered.length} invoice{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 max-w-[400px]">
          <Input
            placeholder={t("invoices.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            prefixIcon={<Search className="w-[16px] h-[16px]" />}
          />
        </div>
        <SegmentedPicker
          options={statusFilters.map((o) => ({ value: o.value, label: o.label }))}
          value={filterStatus}
          onChange={setFilterStatus}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-[2px] animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[48px] bg-background-card border border-border rounded" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8">
          <Receipt className="w-[48px] h-[48px] text-text-disabled mb-2" />
          <h3 className="font-mohave text-heading text-text-primary">
            {searchQuery || filterStatus !== "all" ? t("invoices.empty.noMatch") : t("invoices.empty.none")}
          </h3>
          <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
            {searchQuery || filterStatus !== "all"
              ? t("invoices.empty.noMatch")
              : t("invoices.empty.helper")}
          </p>
          {!searchQuery && filterStatus === "all" && (
            <Button className="mt-3 gap-[6px]" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-[16px] h-[16px]" />
              {t("invoices.newInvoice")}
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-background-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.table.number")}</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.table.client")}</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">{t("invoices.table.project")}</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">{t("invoices.table.date")}</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden lg:table-cell">{t("invoices.table.due")}</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.table.total")}</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">{t("invoices.table.paid")}</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.table.balance")}</th>
                <th className="px-1.5 py-1 text-center font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.table.status")}</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="border-b border-border-subtle hover:bg-background-elevated cursor-pointer transition-colors"
                  onClick={() => setEditingInvoice(invoice)}
                >
                  <td className="px-1.5 py-1">
                    <span className="font-mono text-data text-ops-accent">{invoice.invoiceNumber}</span>
                  </td>
                  <td className="px-1.5 py-1">
                    <span className="font-mohave text-body text-text-primary truncate block max-w-[160px]">
                      {invoice.clientId ? clientMap.get(invoice.clientId) ?? "--" : "--"}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 hidden md:table-cell">
                    <span className="font-mohave text-body-sm text-text-tertiary truncate block max-w-[160px]">
                      {invoice.projectId ? projectMap.get(invoice.projectId) ?? "--" : "--"}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 hidden sm:table-cell">
                    <span className="font-mono text-data-sm text-text-tertiary">{formatDate(invoice.issueDate, locale)}</span>
                  </td>
                  <td className="px-1.5 py-1 hidden lg:table-cell">
                    <span className={cn(
                      "font-mono text-data-sm",
                      invoice.status === InvoiceStatus.PastDue ? "text-ops-error" : "text-text-tertiary"
                    )}>
                      {formatDate(invoice.dueDate, locale)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <span className="font-mono text-data text-text-primary">{formatCurrency(invoice.total)}</span>
                  </td>
                  <td className="px-1.5 py-1 text-right hidden sm:table-cell">
                    <span className="font-mono text-data-sm text-status-success">
                      {invoice.amountPaid > 0 ? formatCurrency(invoice.amountPaid) : "--"}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <span className={cn(
                      "font-mono text-data",
                      invoice.balanceDue > 0 ? "text-text-primary" : "text-status-success"
                    )}>
                      {formatCurrency(invoice.balanceDue)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    <StatusBadgeInvoice status={invoice.status} />
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDownloadPdf(invoice.id)}
                        disabled={generatingPdfId === invoice.id}
                        className="p-[4px] rounded text-text-tertiary hover:text-ops-accent hover:bg-ops-accent-muted transition-colors disabled:opacity-50"
                        title={t("invoices.actions.downloadPdf")}
                      >
                        {generatingPdfId === invoice.id ? (
                          <Loader2 className="w-[14px] h-[14px] animate-spin" />
                        ) : (
                          <Download className="w-[14px] h-[14px]" />
                        )}
                      </button>
                      {invoice.status === InvoiceStatus.Draft && (
                        <button
                          onClick={() => sendInvoice.mutate(invoice.id)}
                          className="p-[4px] rounded text-text-tertiary hover:text-ops-accent hover:bg-ops-accent-muted transition-colors"
                          title={t("invoices.actions.send")}
                        >
                          <Send className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      {invoice.status !== InvoiceStatus.Paid && invoice.status !== InvoiceStatus.Void && (
                        <button
                          onClick={() => setPaymentInvoice(invoice)}
                          className="p-[4px] rounded text-text-tertiary hover:text-status-success hover:bg-status-success/10 transition-colors"
                          title={t("invoices.actions.recordPayment")}
                        >
                          <DollarSign className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      {invoice.status !== InvoiceStatus.Void && invoice.status !== InvoiceStatus.Paid && (
                        <button
                          onClick={() => voidInvoice.mutate(invoice.id)}
                          className="p-[4px] rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                          title={t("invoices.actions.void")}
                        >
                          <Ban className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteInvoice.mutate(invoice.id)}
                        className="p-[4px] rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                        title={t("invoices.actions.delete")}
                      >
                        <Trash2 className="w-[14px] h-[14px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Invoice Modal */}
      <InvoiceFormModal
        open={showCreateModal || !!editingInvoice}
        onClose={() => { setShowCreateModal(false); setEditingInvoice(null); }}
        invoice={editingInvoice}
        clients={clients}
        projects={projects}
        products={products}
        companyId={companyId}
        onCreate={(data, lineItems) => {
          createInvoice.mutate({ data, lineItems }, { onSuccess: () => setShowCreateModal(false) });
        }}
        onUpdate={(id, data, lineItems) => {
          updateInvoice.mutate({ id, data, lineItems }, { onSuccess: () => setEditingInvoice(null) });
        }}
      />

      {/* Record Payment Modal */}
      <RecordPaymentModal
        open={!!paymentInvoice}
        onClose={() => setPaymentInvoice(null)}
        invoice={paymentInvoice}
        companyId={companyId}
        onSubmit={(data) => {
          recordPayment.mutate(data, { onSuccess: () => setPaymentInvoice(null) });
        }}
      />

      {/* Setup interception modal */}
      <SetupInterceptionModal
        isOpen={showSetupModal}
        onComplete={() => {
          setShowSetupModal(false);
          setShowCreateModal(true);
        }}
        onDismiss={() => {
          setShowSetupModal(false);
        }}
        missingSteps={missingSteps}
        triggerAction="invoices"
      />
    </div>
  );
}

// ─── Invoice Form Modal ───────────────────────────────────────────────────────

function InvoiceFormModal({
  open,
  onClose,
  invoice,
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
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; title: string }>;
  products: Array<Product>;
  companyId: string;
  onCreate: (data: Partial<CreateInvoice> & { companyId: string }, lineItems: Array<Partial<CreateLineItem>>) => void;
  onUpdate: (id: string, data: Partial<CreateInvoice> & { companyId: string }, lineItems: Array<Partial<CreateLineItem>>) => void;
}) {
  const { t } = useDictionary("pipeline");
  const isEditing = !!invoice;

  const [clientId, setClientId] = useState(invoice?.clientId ?? "");
  const [projectId, setProjectId] = useState(invoice?.projectId ?? "");
  const [date, setDate] = useState(
    invoice?.issueDate ? new Date(invoice.issueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [paymentTerms, setPaymentTerms] = useState(invoice?.paymentTerms ?? "Net 30");
  const [dueDate, setDueDate] = useState(
    invoice?.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : ""
  );
  const [depositAmount, setDepositAmount] = useState(invoice?.depositApplied ?? 0);
  const [notes, setNotes] = useState(invoice?.clientMessage ?? "");
  const [internalNotes, setInternalNotes] = useState(invoice?.internalNotes ?? "");
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => {
    if (invoice?.lineItems && invoice.lineItems.length > 0) {
      return invoice.lineItems.map((li) => ({
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
      }));
    }
    return [createEmptyLineItem()];
  });

  // Auto-compute due date from terms
  useEffect(() => {
    if (date && paymentTerms) {
      const computed = calculateDueDate(new Date(date), paymentTerms);
      setDueDate(computed.toISOString().slice(0, 10));
    }
  }, [date, paymentTerms]);

  useEffect(() => {
    if (invoice) {
      setClientId(invoice.clientId ?? "");
      setProjectId(invoice.projectId ?? "");
      setDate(invoice.issueDate ? new Date(invoice.issueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      setPaymentTerms(invoice.paymentTerms ?? "Net 30");
      setDueDate(invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : "");
      setDepositAmount(invoice.depositApplied ?? 0);
      setNotes(invoice.clientMessage ?? "");
      setInternalNotes(invoice.internalNotes ?? "");
      if (invoice.lineItems && invoice.lineItems.length > 0) {
        setLineItems(invoice.lineItems.map((li) => ({
          id: li.id, name: li.name, quantity: li.quantity,
          unitPrice: li.unitPrice, isTaxable: li.isTaxable, discountPercent: li.discountPercent,
          productId: li.productId, unit: li.unit, isOptional: li.isOptional, isSelected: li.isSelected,
        })));
      }
    } else {
      setClientId(""); setProjectId(""); setDate(new Date().toISOString().slice(0, 10));
      setPaymentTerms("Net 30"); setDepositAmount(0); setNotes(""); setInternalNotes("");
      setLineItems([createEmptyLineItem()]);
    }
  }, [invoice]);

  const handleSubmit = () => {
    const mappedLineItems = lineItems.map((li, index) => {
      const amt = computeAmount(li);
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            {isEditing ? `${t("invoices.modal.edit")} ${invoice?.invoiceNumber}` : t("invoices.modal.new")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Client + Project */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.client")}</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.project")}</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                <option value="">Select project (optional)...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          </div>

          {/* Date + Terms + Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.date")}</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.paymentTerms")}</label>
              <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                {PAYMENT_TERMS_OPTIONS.map((term) => <option key={term} value={term}>{term}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.dueDate")}</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Deposit */}
          <div className="max-w-[200px] space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.deposit")}</label>
            <Input type="number" min={0} step={0.01} value={depositAmount} onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)} />
          </div>

          {/* Line Items */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.lineItems")}</label>
            <LineItemEditor items={lineItems} onChange={setLineItems} products={products} />
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.notes")}</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment instructions, thank you note..." rows={3} />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.form.internalNotes")}</label>
              <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder={t("invoices.form.internalNotes")} rows={3} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit}>{isEditing ? t("invoices.modal.edit") : t("invoices.modal.new")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({
  open,
  onClose,
  invoice,
  companyId,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  companyId: string;
  onSubmit: (data: CreatePayment) => void;
}) {
  const { t } = useDictionary("pipeline");
  const [amount, setAmount] = useState(invoice?.balanceDue ?? 0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.Other);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (invoice) {
      setAmount(invoice.balanceDue);
      setDate(new Date().toISOString().slice(0, 10));
      setMethod(PaymentMethod.Other);
      setReferenceNumber("");
      setNotes("");
    }
  }, [invoice]);

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            {t("invoices.payment.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          <div className="bg-background-elevated rounded p-1.5 space-y-0.5">
            <div className="flex justify-between">
              <span className="font-kosugi text-caption text-text-tertiary">{t("invoices.payment.invoice")}</span>
              <span className="font-mono text-data text-ops-accent">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-kosugi text-caption text-text-tertiary">{t("invoices.payment.total")}</span>
              <span className="font-mono text-data text-text-primary">{formatCurrency(invoice.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-kosugi text-caption text-text-tertiary">{t("invoices.payment.balanceDue")}</span>
              <span className="font-mono text-data text-ops-error">{formatCurrency(invoice.balanceDue)}</span>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.payment.amount")}</label>
            <div className="flex gap-1">
              <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} className="flex-1" />
              <Button variant="secondary" size="sm" onClick={() => setAmount(invoice.balanceDue)}>{t("invoices.payment.payInFull")}</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.payment.date")}</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.payment.method")}</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                {Object.entries(paymentMethodLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.payment.reference")}</label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Check #, transaction ID..." />
          </div>

          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("invoices.payment.notes")}</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("invoices.payment.notes")} rows={2} />
          </div>

          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                onSubmit({
                  invoiceId: invoice.id,
                  companyId,
                  clientId: invoice.clientId,
                  amount,
                  paymentDate: new Date(date),
                  paymentMethod: method,
                  referenceNumber: referenceNumber || null,
                  notes: notes || null,
                  stripePaymentIntent: null,
                  createdBy: null,
                });
              }}
              disabled={amount <= 0}
            >
              {t("invoices.payment.title")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
