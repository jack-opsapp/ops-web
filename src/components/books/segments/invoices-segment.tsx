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
import { Send, DollarSign, Ban, Trash2, Download, Loader2, Plus } from "lucide-react";
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
} from "@/lib/hooks";
import { InvoiceStatus, formatCurrency } from "@/lib/types/pipeline";
import type { Invoice } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { formatEnumLabel } from "@/lib/utils/format";
import { toast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tag, type TagProps } from "@/components/ui/tag";
import { SegmentControl } from "@/components/ui/segment-control";
import { TableShell, Workbar, WorkbarButton, WorkbarCount } from "@/components/ui/table-shell";
import {
  RegisterTable,
  RegisterEmpty,
  TableNumber,
  TablePrimary,
  TableMeta,
  TableMono,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import { InvoiceFormModal } from "../modals/invoice-form-modal";
import { RecordPaymentModal } from "../modals/record-payment-modal";
import { FilterChips, DrillChip } from "../segment-toolbar";
import { ArAgingView } from "./ar-aging-view";

/** "overdue" is the date-based virtual filter used by the A/R tile drill. */
type FilterStatus = "all" | "overdue" | InvoiceStatus;
export type InvoicesView = "list" | "aging";

// ─── Display helpers ──────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<InvoiceStatus, TagProps["variant"]> = {
  [InvoiceStatus.Draft]: "dim",
  [InvoiceStatus.Sent]: "neutral",
  [InvoiceStatus.AwaitingPayment]: "neutral",
  [InvoiceStatus.PartiallyPaid]: "tan",
  [InvoiceStatus.Paid]: "olive",
  [InvoiceStatus.PastDue]: "rose",
  [InvoiceStatus.Void]: "dim",
  [InvoiceStatus.WrittenOff]: "dim",
};

function StatusTag({ status, label }: { status: InvoiceStatus; label: string }) {
  return <Tag variant={STATUS_VARIANT[status] ?? "neutral"}>{label}</Tag>;
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
  /** The shared LedgerStrip node, pinned in this segment's TableShell metrics slot. */
  metrics: React.ReactNode;
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
  /** ?client=<id> — preselect this client in the create form (client window
   *  → NEW INVOICE). Captured into local state on open so a URL cleanup can't
   *  clobber the seed; left editable. */
  createClientId?: string | null;
  onCreateHandled: () => void;
}

export function InvoicesSegment({
  metrics,
  segmentControl,
  listAllowed,
  view,
  onViewChange,
  statusFilter,
  onStatusFilterChange,
  drilled,
  onClearDrill,
  openCreate,
  createClientId,
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
  // Client seed for the create modal, captured at open-time so the URL cleanup
  // (onCreateHandled strips ?client) can't wipe the preselection.
  const [seedClientId, setSeedClientId] = useState<string | undefined>(undefined);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  const { data: invoices = [], isLoading } = useInvoices();
  const { data: invoiceDetail, isLoading: isEditingDetailLoading } = useInvoice(editingInvoice?.id);
  const isEditingLoading = !!editingInvoice && (isEditingDetailLoading || !invoiceDetail);
  const { data: clientsData } = useClients();
  const { data: projectsData } = useProjects();
  const { data: products = [] } = useProducts();

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

  const gatedOpenCreate = useCallback(
    (seed?: string) => {
      if (!can("invoices.create")) return;
      setSeedClientId(seed);
      if (!setupComplete) {
        setShowSetupModal(true);
        return;
      }
      setShowCreateModal(true);
    },
    [can, setupComplete],
  );

  // ?action=new (FAB / redirect deep link). ?client=<id> seeds the client
  // field; captured into local state here so the ensuing URL cleanup is safe.
  useEffect(() => {
    if (openCreate) {
      gatedOpenCreate(createClientId ?? undefined);
      onCreateHandled();
    }
  }, [openCreate, gatedOpenCreate, onCreateHandled, createClientId]);

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

  // The collection-health stats (collected / collection rate / avg days to pay)
  // that this statline used to carry folded UP into the ledger strip's A/R cell
  // sub (REWORK 7 — `books-page` passes them as `arExtra` on the invoices tab);
  // A/R and OVERDUE were already duplicated by that same cell. The workbar is a
  // single clean band now — filters + count in `meta`.

  // Rows are data; verbs live in one labelled overflow (DESIGN.md §11 — icons
  // are metadata, not actions). Stop propagation so opening the menu never also
  // opens the document.
  const renderActions = (invoice: Invoice) => (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-[24px] items-center gap-[4px] rounded-chip border border-border px-1 font-mono text-micro font-medium uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
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
  );

  const columns: RegisterTableColumn<Invoice>[] = [
    {
      id: "number",
      header: t("invoices.table.number"),
      cell: (i) => <TableNumber>{i.invoiceNumber}</TableNumber>,
    },
    {
      id: "client",
      header: t("invoices.table.client"),
      cell: (i) => <TablePrimary>{i.clientId ? clientMap.get(i.clientId) ?? "—" : "—"}</TablePrimary>,
    },
    {
      id: "project",
      header: t("invoices.table.project"),
      className: "hidden md:table-cell",
      cell: (i) => <TableMeta>{i.projectId ? projectMap.get(i.projectId) ?? "—" : "—"}</TableMeta>,
    },
    {
      id: "date",
      header: t("invoices.table.date"),
      className: "hidden sm:table-cell",
      cell: (i) => <TableMono>{fmtDate(i.issueDate, locale)}</TableMono>,
    },
    {
      id: "due",
      header: t("invoices.table.due"),
      cell: (i) => {
        const over = isOverdueRow(i);
        const days = overdueDays(i);
        return (
          <TableMono tone={over ? "rose" : "muted"}>
            {fmtDate(i.dueDate, locale)}
            {over && days > 0 && ` · ${days}D`}
          </TableMono>
        );
      },
    },
    {
      id: "total",
      header: t("invoices.table.total"),
      align: "right",
      cell: (i) => <TableMono tone="default">{formatCurrency(i.total)}</TableMono>,
    },
    {
      id: "paid",
      header: t("invoices.table.paid"),
      align: "right",
      className: "hidden sm:table-cell",
      cell: (i) => (
        <TableMono tone={i.amountPaid > 0 ? "olive" : "muted"}>
          {i.amountPaid > 0 ? formatCurrency(i.amountPaid) : "—"}
        </TableMono>
      ),
    },
    {
      id: "balance",
      header: t("invoices.table.balance"),
      align: "right",
      cell: (i) => (
        <TableMono tone={i.balanceDue > 0 ? "default" : "muted"}>
          {i.balanceDue > 0 ? formatCurrency(i.balanceDue) : "—"}
        </TableMono>
      ),
    },
    {
      id: "status",
      header: t("invoices.table.status"),
      cell: (i) => (
        <StatusTag
          status={i.status}
          label={t(`invoices.status.${i.status}`, formatEnumLabel(i.status))}
        />
      ),
    },
    { id: "actions", header: "", align: "right", cell: renderActions },
  ];

  // The LIST | AGING switch is a view-mode toggle, not a filter — it lives in
  // the stable workbar (rendered in both branches) pinned to the right, so it
  // holds one fixed slot whether search is present (list) or absent (aging).
  // State-aware: shown only when the user can reach BOTH views.
  const showViewToggle = listAllowed && canAging;
  const showSearch = listAllowed && view === "list";
  const canCreate = can("invoices.create");

  // Canonical Workbar slots (one inline create CTA per register — Jackson
  // 2026-06-13 — the single accent action; the FAB stays the global shortcut).
  // The INVOICES/ESTIMATES/EXPENSES/SYNC segment is the row-2 tab strip.
  const searchSlot = showSearch ? (
    <SearchInput
      placeholder={t("invoices.search")}
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      wrapperClassName="w-[240px] max-w-full"
    />
  ) : undefined;
  const createSlot = canCreate ? (
    <WorkbarButton onClick={() => gatedOpenCreate()}>
      <Plus className="h-[11px] w-[11px] shrink-0" strokeWidth={1.5} aria-hidden />
      {t("invoices.newInvoice")}
    </WorkbarButton>
  ) : null;
  const viewToggleSlot = showViewToggle ? (
    <SegmentControl<InvoicesView>
      options={[
        { value: "list", label: tb("view.list") },
        { value: "aging", label: tb("view.aging") },
      ]}
      value={view}
      onChange={onViewChange}
    />
  ) : null;

  // Portaled overlays — rendered alongside the shell in every branch, never as
  // body content (they own their own z-layer).
  const modals = (
    <>
      {/* Create/Edit Invoice Modal */}
      <InvoiceFormModal
        open={showCreateModal || !!editingInvoice}
        onClose={() => {
          setShowCreateModal(false);
          setEditingInvoice(null);
          setSeedClientId(undefined);
        }}
        invoice={invoiceDetail ?? editingInvoice}
        loading={isEditingLoading}
        defaultClientId={seedClientId}
        clients={clients}
        projects={projects}
        products={products}
        companyId={companyId}
        onCreate={(data, lineItems) => {
          if (!can("invoices.create")) return;
          createInvoice.mutate(
            { data, lineItems },
            {
              onSuccess: () => {
                setShowCreateModal(false);
                setSeedClientId(undefined);
              },
            },
          );
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
    </>
  );

  // ── A/R aging view (forced for accounting.view-only users) ──────────
  // The aging report scrolls inside the shell body under the pinned metrics +
  // workbar; only the segment-control row pins (no document filters apply here).
  if ((view === "aging" || !listAllowed) && canAging) {
    return (
      <>
        <TableShell
          metrics={metrics}
          toolbar={
            <Workbar
              search={searchSlot}
              tools={viewToggleSlot}
              create={createSlot}
              tabStrip={segmentControl}
            />
          }
          bottomFade={false}
        >
          <div className="p-3">
            <ArAgingView invoices={invoices} clientMap={clientMap} />
          </div>
        </TableShell>

        {/* Modals live outside the shell — portaled overlays, not body content. */}
        {modals}
      </>
    );
  }

  const isEmpty = !isLoading && filtered.length === 0;

  return (
    <>
      <TableShell
        metrics={metrics}
        toolbar={
          <Workbar
            search={searchSlot}
            filters={
              <>
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
              </>
            }
            meta={
              <WorkbarCount>
                {statusFilter === "all" && !searchQuery
                  ? tb("count.all", { n: invoices.length })
                  : tb("count.invoices", { n: filtered.length, total: invoices.length })}
              </WorkbarCount>
            }
            tools={viewToggleSlot}
            create={createSlot}
            tabStrip={segmentControl}
          />
        }
        isEmpty={isLoading || isEmpty}
        emptyState={
          isLoading ? (
            <div className="animate-pulse space-y-[2px] p-3 motion-reduce:animate-none">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-surface h-[48px]" />
              ))}
            </div>
          ) : (
            /* Empty state — DESIGN.md §2: state the fact only, no coach-mark, no button.
               The FAB owns creation (fab-actions.ts). */
            <RegisterEmpty
              noun={
                searchQuery || statusFilter !== "all"
                  ? t("invoices.empty.matches")
                  : t("invoices.empty.noun")
              }
            />
          )
        }
      >
        <RegisterTable<Invoice>
          columns={columns}
          rows={filtered}
          getRowId={(i) => i.id}
          onRowClick={(i) => setEditingInvoice(i)}
          isRowInteractive={() => can("invoices.edit")}
          ariaLabel={tb("segment.invoices")}
          inShell
        />
      </TableShell>

      {modals}
    </>
  );
}
