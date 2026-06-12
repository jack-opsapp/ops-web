"use client";

/**
 * Books — INVOICES segment (P3.1). Full parity port of the retired
 * (dashboard)/invoices page (capability inventory I1–I13) restyled to the
 * approved direction-A pixels, plus the A/R aging view (A1–A4) at
 * ?segment=invoices&view=aging.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { Plus, Receipt, Send, DollarSign, Ban, Trash2, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  useInvoices,
  useCreateInvoice,
  useUpdateInvoice,
  useDeleteInvoice,
  useSendInvoice,
  useVoidInvoice,
  useRecordPayment,
  useInvoice,
  useClients,
  useProjects,
  useProducts,
  useInvoiceMetrics,
} from "@/lib/hooks";
import { InvoiceStatus, formatCurrency } from "@/lib/types/pipeline";
import type { Invoice } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { cn } from "@/lib/utils/cn";
import { formatEnumLabel } from "@/lib/utils/format";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { InvoiceFormModal } from "../modals/invoice-form-modal";
import { RecordPaymentModal } from "../modals/record-payment-modal";
import {
  FilterChips,
  DrillChip,
  SegmentStatLine,
  formatMetricValue,
  type StatLineItem,
} from "../segment-toolbar";
import { ArAgingView } from "./ar-aging-view";

/** "overdue" is the date-based virtual filter used by the A/R tile drill. */
type FilterStatus = "all" | "overdue" | InvoiceStatus;
export type InvoicesView = "list" | "aging";

// ─── Display helpers ──────────────────────────────────────────────────────────

const STATUS_TONE: Record<InvoiceStatus, string> = {
  [InvoiceStatus.Draft]: "border-border bg-transparent text-text-3",
  [InvoiceStatus.Sent]: "border-border bg-[rgba(255,255,255,0.05)] text-text-2",
  [InvoiceStatus.AwaitingPayment]: "border-border bg-[rgba(255,255,255,0.05)] text-text-2",
  [InvoiceStatus.PartiallyPaid]: "border-tan-line bg-tan-soft text-tan",
  [InvoiceStatus.Paid]: "border-olive-line bg-olive-soft text-olive",
  [InvoiceStatus.PastDue]: "border-rose-line bg-rose-soft text-rose",
  [InvoiceStatus.Void]: "border-border bg-transparent text-text-3",
  [InvoiceStatus.WrittenOff]: "border-border bg-transparent text-text-3",
};

function StatusTag({ status, label }: { status: InvoiceStatus; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-[4px] border px-[6px] py-[2px]",
        "font-mono text-micro font-medium uppercase tracking-[0.12em]",
        STATUS_TONE[status] ?? STATUS_TONE[InvoiceStatus.Sent],
      )}
    >
      {label}
    </span>
  );
}

function fmtDate(date: Date | null, locale: Locale): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(getDateLocale(locale), {
    month: "short",
    day: "numeric",
  });
}

function overdueDays(invoice: Invoice): number {
  if (!invoice.dueDate) return 0;
  const diff = Date.now() - new Date(invoice.dueDate).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function isOverdueRow(invoice: Invoice): boolean {
  return (
    invoice.status === InvoiceStatus.PastDue ||
    (overdueDays(invoice) > 0 &&
      invoice.balanceDue > 0 &&
      invoice.status !== InvoiceStatus.Paid &&
      invoice.status !== InvoiceStatus.Void)
  );
}

// ─── Segment ──────────────────────────────────────────────────────────────────

export interface InvoicesSegmentProps {
  /** The Books segment control, rendered inside this segment's workbar row. */
  segmentControl: React.ReactNode;
  /** False for accounting.view-only users: A/R aging only, no document list. */
  listAllowed: boolean;
  view: InvoicesView;
  onViewChange: (view: InvoicesView) => void;
  /** Status filter lifted to the URL (?status=…). */
  statusFilter: FilterStatus;
  onStatusFilterChange: (status: FilterStatus) => void;
  /** True when the active status filter was applied by a ledger-strip drill. */
  drilled: boolean;
  onClearDrill: () => void;
  /** ?action=new — open the create modal (through the setup gate). */
  openCreate: boolean;
  onCreateHandled: () => void;
}

export function InvoicesSegment({
  segmentControl,
  listAllowed,
  view,
  onViewChange,
  statusFilter,
  onStatusFilterChange,
  drilled,
  onClearDrill,
  openCreate,
  onCreateHandled,
}: InvoicesSegmentProps) {
  const { t } = useDictionary("pipeline");
  const { t: tb } = useDictionary("books");
  const { locale } = useLocale();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const can = usePermissionStore((s) => s.can);
  const canAging = can("accounting.view");

  const statusOptions = useMemo(
    () => [
      { value: "all" as FilterStatus, label: t("invoices.filter.all") },
      { value: InvoiceStatus.Draft as FilterStatus, label: t("invoices.filter.draft") },
      { value: InvoiceStatus.Sent as FilterStatus, label: t("invoices.filter.sent") },
      { value: InvoiceStatus.PartiallyPaid as FilterStatus, label: t("invoices.filter.partial") },
      { value: InvoiceStatus.Paid as FilterStatus, label: t("invoices.filter.paid") },
      { value: InvoiceStatus.PastDue as FilterStatus, label: t("invoices.filter.pastDue") },
    ],
    [t],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  const { data: invoices = [], isLoading } = useInvoices();
  const { data: invoiceDetail, isLoading: isEditingDetailLoading } = useInvoice(editingInvoice?.id);
  const isEditingLoading = !!editingInvoice && (isEditingDetailLoading || !invoiceDetail);
  const { data: clientsData } = useClients();
  const { data: projectsData } = useProjects();
  const { data: products = [] } = useProducts();
  const { data: invoiceMetrics = [] } = useInvoiceMetrics();

  const clients = useMemo(() => clientsData?.clients ?? [], [clientsData]);
  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);

  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const recordPayment = useRecordPayment();

  // ── Setup gate ──────────────────────────────────────────────────────
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  const gatedOpenCreate = useCallback(() => {
    if (!can("invoices.create")) return;
    if (!setupComplete) {
      setShowSetupModal(true);
      return;
    }
    setShowCreateModal(true);
  }, [can, setupComplete]);

  // ?action=new (FAB / redirect deep link)
  useEffect(() => {
    if (openCreate) {
      gatedOpenCreate();
      onCreateHandled();
    }
  }, [openCreate, gatedOpenCreate, onCreateHandled]);

  async function handleDownloadPdf(invoiceId: string) {
    setGeneratingPdfId(invoiceId);
    try {
      const res = await fetch("/api/documents/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: invoiceId, documentType: "invoice" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("pdf.generationFailed"));
      }
      const { pdfUrl } = await res.json();
      window.open(pdfUrl, "_blank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pdf.generationFailed"));
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
    if (statusFilter === "overdue") {
      list = list.filter(isOverdueRow);
    } else if (statusFilter !== "all") {
      list = list.filter((i) => i.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(q) ||
          (i.clientId && clientMap.get(i.clientId)?.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [invoices, statusFilter, searchQuery, clientMap]);

  // ── Segment stat line (D5 — metric parity for the retired MetricsHeader) ──
  const statItems = useMemo<StatLineItem[]>(() => {
    const find = (needle: string) =>
      invoiceMetrics.find((m) => m.label.toLowerCase().includes(needle));
    const items: StatLineItem[] = [];
    const collected = find("revenue") ?? find("collected");
    const receivables = find("receivable");
    const pastDue = find("past");
    const collection = find("collection");
    const avgDays = find("days");
    if (collected) items.push({ label: tb("stat.collected"), value: formatMetricValue(collected), tone: "olive" });
    if (receivables) items.push({ label: tb("ledger.ar"), value: formatMetricValue(receivables) });
    if (pastDue) items.push({ label: tb("ledger.overdue"), value: formatMetricValue(pastDue), tone: "rose" });
    if (collection) items.push({ label: tb("stat.collectionRate"), value: formatMetricValue(collection) });
    if (avgDays) items.push({ label: tb("stat.avgDays"), value: formatMetricValue(avgDays) });
    return items;
  }, [invoiceMetrics, tb]);

  const workbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {segmentControl}
      {listAllowed && (
        <div className="flex items-center gap-1.5">
          <SearchInput
            placeholder={t("invoices.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            wrapperClassName="w-[220px] max-w-full"
          />
          {can("invoices.create") && (
            <button
              type="button"
              onClick={gatedOpenCreate}
              className="inline-flex h-[28px] shrink-0 items-center gap-1 rounded-[5px] border border-ops-accent px-2 font-cakemono text-[12px] font-light uppercase text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              <Plus className="h-[12px] w-[12px]" strokeWidth={1.5} />
              {t("invoices.newInvoice")}
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ── A/R aging view (forced for accounting.view-only users) ──────────
  if ((view === "aging" || !listAllowed) && canAging) {
    return (
      <div className="space-y-[14px]">
        {workbar}
        <ArAgingView
          invoices={invoices}
          clientMap={clientMap}
          onBackToList={listAllowed ? () => onViewChange("list") : undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-[14px]">
      {workbar}
      <div className="flex flex-wrap items-center gap-[12px]">
        <FilterChips options={statusOptions} value={statusFilter} onChange={onStatusFilterChange} />
        {drilled && statusFilter !== "all" && (
          <DrillChip
            label={
              statusFilter === "overdue"
                ? tb("ledger.overdue")
                : statusOptions.find((o) => o.value === statusFilter)?.label ??
                  formatEnumLabel(statusFilter)
            }
            onClear={onClearDrill}
          />
        )}
        <span className="font-mono text-micro text-text-3 tabular-nums">
          {statusFilter === "all" && !searchQuery
            ? tb("count.all", { n: invoices.length })
            : tb("count.invoices", { n: filtered.length, total: invoices.length })}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <SegmentStatLine items={statItems} />
          {canAging && (
            <FilterChips
              options={[
                { value: "list", label: tb("view.list") },
                { value: "aging", label: tb("view.aging") },
              ]}
              value={view}
              onChange={(v) => onViewChange(v as InvoicesView)}
            />
          )}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="animate-pulse space-y-[2px] motion-reduce:animate-none">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-surface h-[48px]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-start py-8">
          <Receipt className="mb-2 h-[32px] w-[32px] text-text-3" />
          <h3 className="font-mohave text-body-lg text-text-2">
            {searchQuery || statusFilter !== "all" ? t("invoices.empty.noMatch") : t("invoices.empty.none")}
          </h3>
          {!searchQuery && statusFilter === "all" && (
            <p className="mt-0.5 font-mono text-caption text-text-3">{t("invoices.empty.helper")}</p>
          )}
          {!searchQuery && statusFilter === "all" && can("invoices.create") && (
            <Button className="mt-3 gap-[6px]" onClick={gatedOpenCreate}>
              <Plus className="h-[16px] w-[16px]" />
              {t("invoices.newInvoice")}
            </Button>
          )}
        </div>
      ) : (
        <div className="glass-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-border">
                  {[
                    t("invoices.table.number"),
                    t("invoices.table.client"),
                    t("invoices.table.project"),
                    t("invoices.table.date"),
                    t("invoices.table.due"),
                    t("invoices.table.total"),
                    t("invoices.table.paid"),
                    t("invoices.table.balance"),
                    t("invoices.table.status"),
                    "",
                  ].map((label, i) => (
                    <th
                      key={i}
                      className={cn(
                        "px-2 py-1.5 text-left font-mono text-micro font-normal uppercase tracking-[0.16em] text-text-3",
                        i >= 5 && i <= 7 && "text-right",
                        i === 8 && "text-center",
                        i === 2 && "hidden md:table-cell",
                        i === 3 && "hidden sm:table-cell",
                        i === 6 && "hidden sm:table-cell",
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((invoice) => {
                  const over = isOverdueRow(invoice);
                  const days = overdueDays(invoice);
                  return (
                    <tr
                      key={invoice.id}
                      className="cursor-pointer border-b border-[rgba(255,255,255,0.05)] transition-colors last:border-b-0 hover:bg-surface-hover"
                      onClick={() => {
                        if (!can("invoices.edit")) return;
                        setEditingInvoice(invoice);
                      }}
                    >
                      <td className="px-2 py-[11px]">
                        <span className="font-mono text-data-sm text-text tabular-nums">
                          {invoice.invoiceNumber}
                        </span>
                      </td>
                      <td className="px-2 py-[11px]">
                        <span className="block max-w-[180px] truncate font-mohave text-body-sm text-text">
                          {invoice.clientId ? clientMap.get(invoice.clientId) ?? "—" : "—"}
                        </span>
                      </td>
                      <td className="hidden px-2 py-[11px] md:table-cell">
                        <span className="block max-w-[160px] truncate font-mohave text-caption-sm text-text-3">
                          {invoice.projectId ? projectMap.get(invoice.projectId) ?? "—" : "—"}
                        </span>
                      </td>
                      <td className="hidden px-2 py-[11px] sm:table-cell">
                        <span className="whitespace-nowrap font-mono text-caption-sm text-text-3 tabular-nums">
                          {fmtDate(invoice.issueDate, locale)}
                        </span>
                      </td>
                      <td className="px-2 py-[11px]">
                        <span
                          className={cn(
                            "whitespace-nowrap font-mono text-caption-sm tabular-nums",
                            over ? "text-rose" : "text-text-3",
                          )}
                        >
                          {fmtDate(invoice.dueDate, locale)}
                          {over && days > 0 && ` · ${days}D`}
                        </span>
                      </td>
                      <td className="px-2 py-[11px] text-right">
                        <span className="font-mono text-data-sm text-text tabular-nums">
                          {formatCurrency(invoice.total)}
                        </span>
                      </td>
                      <td className="hidden px-2 py-[11px] text-right sm:table-cell">
                        <span
                          className={cn(
                            "font-mono text-data-sm tabular-nums",
                            invoice.amountPaid > 0 ? "text-olive" : "text-text-3",
                          )}
                        >
                          {invoice.amountPaid > 0 ? formatCurrency(invoice.amountPaid) : "—"}
                        </span>
                      </td>
                      <td className="px-2 py-[11px] text-right">
                        <span
                          className={cn(
                            "font-mono text-data-sm tabular-nums",
                            invoice.balanceDue > 0 ? "text-text" : "text-text-3",
                          )}
                        >
                          {invoice.balanceDue > 0 ? formatCurrency(invoice.balanceDue) : "—"}
                        </span>
                      </td>
                      <td className="px-2 py-[11px] text-center">
                        <StatusTag
                          status={invoice.status}
                          label={t(`invoices.status.${invoice.status}`, formatEnumLabel(invoice.status))}
                        />
                      </td>
                      {/* Rows are data; verbs live in one labelled overflow
                          (DESIGN.md §11 — icons are metadata, not actions). */}
                      <td className="px-2 py-[11px] text-right">
                        <div
                          className="inline-flex"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-[24px] items-center gap-[4px] rounded-[4px] border border-border px-1 font-mono text-micro font-medium uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                              >
                                {generatingPdfId === invoice.id && (
                                  <Loader2 className="h-[12px] w-[12px] animate-spin motion-reduce:animate-none" />
                                )}
                                {t("actions.menu")}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={generatingPdfId === invoice.id}
                                onClick={() => handleDownloadPdf(invoice.id)}
                              >
                                <Download className="h-[14px] w-[14px] text-text-3" />
                                {t("invoices.actions.downloadPdf")}
                              </DropdownMenuItem>
                              {invoice.status === InvoiceStatus.Draft && can("invoices.send") && (
                                <DropdownMenuItem onClick={() => sendInvoice.mutate(invoice.id)}>
                                  <Send className="h-[14px] w-[14px] text-text-3" />
                                  {t("invoices.actions.send")}
                                </DropdownMenuItem>
                              )}
                              {invoice.status !== InvoiceStatus.Paid &&
                                invoice.status !== InvoiceStatus.Void &&
                                can("invoices.record_payment") && (
                                  <DropdownMenuItem onClick={() => setPaymentInvoice(invoice)}>
                                    <DollarSign className="h-[14px] w-[14px] text-text-3" />
                                    {t("invoices.actions.recordPayment")}
                                  </DropdownMenuItem>
                                )}
                              {invoice.status !== InvoiceStatus.Void &&
                                invoice.status !== InvoiceStatus.Paid &&
                                can("invoices.void") && (
                                  <DropdownMenuItem
                                    className="text-rose focus:bg-rose-soft focus:text-rose"
                                    onClick={() => voidInvoice.mutate(invoice.id)}
                                  >
                                    <Ban className="h-[14px] w-[14px] text-rose" />
                                    {t("invoices.actions.void")}
                                  </DropdownMenuItem>
                                )}
                              {can("invoices.delete") && (
                                <DropdownMenuItem
                                  className="text-rose focus:bg-rose-soft focus:text-rose"
                                  onClick={() => deleteInvoice.mutate(invoice.id)}
                                >
                                  <Trash2 className="h-[14px] w-[14px] text-rose" />
                                  {t("invoices.actions.delete")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit Invoice Modal */}
      <InvoiceFormModal
        open={showCreateModal || !!editingInvoice}
        onClose={() => {
          setShowCreateModal(false);
          setEditingInvoice(null);
        }}
        invoice={invoiceDetail ?? editingInvoice}
        loading={isEditingLoading}
        clients={clients}
        projects={projects}
        products={products}
        companyId={companyId}
        onCreate={(data, lineItems) => {
          if (!can("invoices.create")) return;
          createInvoice.mutate({ data, lineItems }, { onSuccess: () => setShowCreateModal(false) });
        }}
        onUpdate={(id, data, lineItems) => {
          if (!can("invoices.edit")) return;
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
        onDismiss={() => setShowSetupModal(false)}
        missingSteps={missingSteps}
        triggerAction="invoices"
      />
    </div>
  );
}
