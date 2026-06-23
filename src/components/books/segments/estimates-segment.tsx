"use client";

/**
 * Books — ESTIMATES segment (P3.1). Full parity port of the retired
 * (dashboard)/estimates page (capability inventory E1–E14) restyled to the
 * approved direction-A pixels. The FAB's create-estimate floating window
 * remains an independent, untouched entry point (R1).
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import {
  Send,
  ArrowRightLeft,
  Trash2,
  Download,
  Loader2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  useEstimates,
  useEstimate,
  useCreateEstimate,
  useUpdateEstimate,
  useDeleteEstimate,
  useConvertEstimateToInvoice,
  useClients,
  useProjects,
  useProducts,
  useEstimateMetrics,
} from "@/lib/hooks";
import { EstimateStatus, formatCurrency } from "@/lib/types/pipeline";
import type { Estimate } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { formatEnumLabel } from "@/lib/utils/format";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { SendEstimateFlow } from "@/components/ops/send-estimate-flow";
import { Tag, type TagProps } from "@/components/ui/tag";
import {
  RegisterTable,
  RegisterEmpty,
  TableNumber,
  TablePrimary,
  TableMeta,
  TableMono,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import { EstimateFormModal } from "../modals/estimate-form-modal";
import {
  FilterChips,
  DrillChip,
  SegmentStatLine,
  formatMetricValue,
  type StatLineItem,
} from "../segment-toolbar";

type FilterStatus = "all" | EstimateStatus;

// ─── Display helpers ──────────────────────────────────────────────────────────

const STATUS_VARIANT: Partial<Record<EstimateStatus, TagProps["variant"]>> = {
  [EstimateStatus.Draft]: "dim",
  [EstimateStatus.Sent]: "neutral",
  [EstimateStatus.Viewed]: "neutral",
  [EstimateStatus.Approved]: "olive",
  [EstimateStatus.Converted]: "olive",
  [EstimateStatus.Declined]: "rose",
  [EstimateStatus.Expired]: "tan",
};

function StatusTag({ status, label }: { status: EstimateStatus; label: string }) {
  return <Tag variant={STATUS_VARIANT[status] ?? "neutral"}>{label}</Tag>;
}

function fmtDate(date: Date | null, locale: Locale): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(getDateLocale(locale), {
    month: "short",
    day: "numeric",
  });
}

// ─── Segment ──────────────────────────────────────────────────────────────────

export interface EstimatesSegmentProps {
  segmentControl: React.ReactNode;
  statusFilter: FilterStatus;
  onStatusFilterChange: (status: FilterStatus) => void;
  drilled: boolean;
  onClearDrill: () => void;
  openCreate: boolean;
  onCreateHandled: () => void;
}

export function EstimatesSegment({
  segmentControl,
  statusFilter,
  onStatusFilterChange,
  drilled,
  onClearDrill,
  openCreate,
  onCreateHandled,
}: EstimatesSegmentProps) {
  const { t } = useDictionary("pipeline");
  const { t: tb } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const can = usePermissionStore((s) => s.can);

  const statusOptions = useMemo(
    () => [
      { value: "all" as FilterStatus, label: t("estimates.filter.all") },
      { value: EstimateStatus.Draft as FilterStatus, label: t("estimates.filter.draft") },
      { value: EstimateStatus.Sent as FilterStatus, label: t("estimates.filter.sent") },
      { value: EstimateStatus.Approved as FilterStatus, label: t("estimates.filter.approved") },
      { value: EstimateStatus.Declined as FilterStatus, label: t("estimates.filter.declined") },
    ],
    [t],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
  const [sendingEstimate, setSendingEstimate] = useState<Estimate | null>(null);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  const { data: estimates = [], isLoading } = useEstimates();
  const { data: estimateDetail, isLoading: isEditingDetailLoading } = useEstimate(
    editingEstimate?.id,
  );
  const isEditingLoading = !!editingEstimate && (isEditingDetailLoading || !estimateDetail);
  const { data: clientsData } = useClients();
  const { data: projectsData } = useProjects();
  const { data: products = [] } = useProducts();
  const { data: estimateMetrics = [] } = useEstimateMetrics();

  const clients = useMemo(() => clientsData?.clients ?? [], [clientsData]);
  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);

  const createEstimate = useCreateEstimate();
  const updateEstimate = useUpdateEstimate();
  const deleteEstimate = useDeleteEstimate();
  const convertToInvoice = useConvertEstimateToInvoice();

  // ── Setup gate ──────────────────────────────────────────────────────
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  const gatedOpenCreate = useCallback(() => {
    if (!can("estimates.create")) return;
    if (!setupComplete) {
      setShowSetupModal(true);
      return;
    }
    setShowCreateModal(true);
  }, [can, setupComplete]);

  useEffect(() => {
    if (openCreate) {
      gatedOpenCreate();
      onCreateHandled();
    }
  }, [openCreate, gatedOpenCreate, onCreateHandled]);

  async function handleDownloadPdf(estimateId: string) {
    setGeneratingPdfId(estimateId);
    try {
      const res = await fetch("/api/documents/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: estimateId, documentType: "estimate" }),
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
    let list = [...estimates];
    if (statusFilter !== "all") {
      list = list.filter((e) => e.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.estimateNumber.toLowerCase().includes(q) ||
          (e.clientId && clientMap.get(e.clientId)?.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [estimates, statusFilter, searchQuery, clientMap]);

  // ── Segment stat line (D5) ──────────────────────────────────────────
  const statItems = useMemo<StatLineItem[]>(() => {
    const find = (needle: string) =>
      estimateMetrics.find((m) => m.label.toLowerCase().includes(needle));
    const items: StatLineItem[] = [];
    const pending = find("pending");
    const approval = find("approval");
    const convert = find("conver");
    const sentMonth = find("sent");
    const avgEstimate = find("avg");
    if (pending) items.push({ label: tb("stat.pending"), value: formatMetricValue(pending, numLocale), tone: "tan" });
    if (approval) items.push({ label: tb("stat.approval"), value: formatMetricValue(approval, numLocale) });
    if (convert) items.push({ label: tb("stat.convert"), value: formatMetricValue(convert, numLocale) });
    if (sentMonth) items.push({ label: tb("stat.sentMonth"), value: formatMetricValue(sentMonth, numLocale) });
    if (avgEstimate) items.push({ label: tb("stat.avgEstimate"), value: formatMetricValue(avgEstimate, numLocale) });
    return items;
  }, [estimateMetrics, tb, numLocale]);

  // Rows are data; verbs live in one labelled overflow (DESIGN.md §11 — icons
  // are metadata, not actions). Stop propagation so opening the menu never also
  // opens the document.
  const renderActions = (estimate: Estimate) => (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-[24px] items-center gap-[4px] rounded-chip border border-border px-1 font-mono text-micro font-medium uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            {generatingPdfId === estimate.id && (
              <Loader2 className="h-[12px] w-[12px] animate-spin motion-reduce:animate-none" />
            )}
            {t("actions.menu")}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={generatingPdfId === estimate.id}
            onClick={() => handleDownloadPdf(estimate.id)}
          >
            <Download className="h-[14px] w-[14px] text-text-3" />
            {t("estimates.actions.downloadPdf")}
          </DropdownMenuItem>
          {estimate.status === EstimateStatus.Draft && can("estimates.send") && (
            <DropdownMenuItem onClick={() => setSendingEstimate(estimate)}>
              <Send className="h-[14px] w-[14px] text-text-3" />
              {t("estimates.actions.send")}
            </DropdownMenuItem>
          )}
          {(estimate.status === EstimateStatus.Approved ||
            estimate.status === EstimateStatus.Sent) &&
            can("estimates.convert") && (
              <DropdownMenuItem
                onClick={() => convertToInvoice.mutate({ estimateId: estimate.id })}
              >
                <ArrowRightLeft className="h-[14px] w-[14px] text-text-3" />
                {t("estimates.actions.convertToInvoice")}
              </DropdownMenuItem>
            )}
          {can("estimates.delete") && (
            <DropdownMenuItem
              className="text-rose focus:bg-rose-soft focus:text-rose"
              onClick={() => deleteEstimate.mutate(estimate.id)}
            >
              <Trash2 className="h-[14px] w-[14px] text-rose" />
              {t("estimates.actions.delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const columns: RegisterTableColumn<Estimate>[] = [
    {
      id: "number",
      header: t("estimates.table.number"),
      cell: (est) => <TableNumber>{est.estimateNumber}</TableNumber>,
    },
    {
      id: "client",
      header: t("estimates.table.client"),
      cell: (est) => (
        <TablePrimary>{est.clientId ? clientMap.get(est.clientId) ?? "—" : "—"}</TablePrimary>
      ),
    },
    {
      id: "project",
      header: t("estimates.table.project"),
      className: "hidden md:table-cell",
      cell: (est) => (
        <TableMeta>{est.projectId ? projectMap.get(est.projectId) ?? "—" : "—"}</TableMeta>
      ),
    },
    {
      id: "date",
      header: t("estimates.table.date"),
      className: "hidden sm:table-cell",
      cell: (est) => <TableMono>{fmtDate(est.issueDate, locale)}</TableMono>,
    },
    {
      id: "expiry",
      header: t("estimates.table.expiry"),
      className: "hidden lg:table-cell",
      cell: (est) => <TableMono>{fmtDate(est.expirationDate, locale)}</TableMono>,
    },
    {
      id: "total",
      header: t("estimates.table.total"),
      align: "right",
      cell: (est) => <TableMono tone="default">{formatCurrency(est.total)}</TableMono>,
    },
    {
      id: "status",
      header: t("estimates.table.status"),
      cell: (est) => (
        <StatusTag
          status={est.status}
          label={t(`estimates.status.${est.status}`, formatEnumLabel(est.status))}
        />
      ),
    },
    { id: "actions", header: "", align: "right", cell: renderActions },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {segmentControl}
        <div className="flex items-center gap-1.5">
          <SearchInput
            placeholder={t("estimates.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            wrapperClassName="w-[220px] max-w-full"
          />
          {/* One inline create CTA per register (Jackson 2026-06-13) — single
              accent action; the FAB stays the global shortcut. */}
          {can("estimates.create") && (
            <Button variant="primary" size="sm" type="button" onClick={gatedOpenCreate}>
              <Plus className="h-[14px] w-[14px]" strokeWidth={1.5} aria-hidden />
              {t("estimates.newEstimate")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[12px]">
        <FilterChips options={statusOptions} value={statusFilter} onChange={onStatusFilterChange} />
        {drilled && statusFilter !== "all" && (
          <DrillChip
            label={
              statusOptions.find((o) => o.value === statusFilter)?.label ??
              formatEnumLabel(statusFilter)
            }
            onClear={onClearDrill}
          />
        )}
        <span className="font-mono text-micro text-text-3 tabular-nums">
          {statusFilter === "all" && !searchQuery
            ? tb("count.all", { n: estimates.length })
            : tb("count.invoices", { n: filtered.length, total: estimates.length })}
        </span>
        <span className="ml-auto">
          <SegmentStatLine items={statItems} />
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
        /* Empty state — DESIGN.md §2: state the fact only, no coach-mark, no button.
           The FAB owns creation (fab-actions.ts). */
        <RegisterEmpty
          noun={
            searchQuery || statusFilter !== "all"
              ? t("estimates.empty.matches")
              : t("estimates.empty.noun")
          }
        />
      ) : (
        <RegisterTable<Estimate>
          columns={columns}
          rows={filtered}
          getRowId={(est) => est.id}
          onRowClick={(est) => setEditingEstimate(est)}
          isRowInteractive={() => can("estimates.edit")}
          minWidth={700}
          ariaLabel={tb("segment.estimates")}
        />
      )}

      {/* Send Estimate Flow */}
      {sendingEstimate && (
        <SendEstimateFlow
          estimate={sendingEstimate}
          opportunityId={sendingEstimate.opportunityId}
          open={!!sendingEstimate}
          onOpenChange={(open) => {
            if (!open) setSendingEstimate(null);
          }}
          onSent={() => setSendingEstimate(null)}
        />
      )}

      {/* Create/Edit Modal */}
      <EstimateFormModal
        open={showCreateModal || !!editingEstimate}
        onClose={() => {
          setShowCreateModal(false);
          setEditingEstimate(null);
        }}
        estimate={estimateDetail ?? editingEstimate}
        loading={isEditingLoading}
        clients={clients}
        projects={projects}
        products={products}
        companyId={companyId}
        onCreate={(data, lineItems) => {
          if (!can("estimates.create")) return;
          createEstimate.mutate(
            { data, lineItems },
            { onSuccess: () => setShowCreateModal(false) },
          );
        }}
        onUpdate={(id, data, lineItems) => {
          if (!can("estimates.edit")) return;
          updateEstimate.mutate(
            { id, data, lineItems },
            { onSuccess: () => setEditingEstimate(null) },
          );
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
        triggerAction="estimates"
      />
    </div>
  );
}
