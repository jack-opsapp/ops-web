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
  Plus,
  FileText,
  Send,
  ArrowRightLeft,
  Trash2,
  Download,
  Loader2,
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
import { cn } from "@/lib/utils/cn";
import { formatEnumLabel } from "@/lib/utils/format";
import { toast } from "sonner";
import { SendEstimateFlow } from "@/components/ops/send-estimate-flow";
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

const STATUS_TONE: Partial<Record<EstimateStatus, string>> = {
  [EstimateStatus.Draft]: "border-border bg-transparent text-text-3",
  [EstimateStatus.Sent]: "border-border bg-[rgba(255,255,255,0.05)] text-text-2",
  [EstimateStatus.Viewed]: "border-border bg-[rgba(255,255,255,0.05)] text-text-2",
  [EstimateStatus.Approved]: "border-olive-line bg-olive-soft text-olive",
  [EstimateStatus.Converted]: "border-olive-line bg-olive-soft text-olive",
  [EstimateStatus.Declined]: "border-rose-line bg-rose-soft text-rose",
  [EstimateStatus.Expired]: "border-tan-line bg-tan-soft text-tan",
};

function StatusTag({ status, label }: { status: EstimateStatus; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-[4px] border px-[6px] py-[2px]",
        "font-mono text-micro font-medium uppercase tracking-[0.12em]",
        STATUS_TONE[status] ?? "border-border bg-[rgba(255,255,255,0.05)] text-text-2",
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
    if (pending) items.push({ label: tb("stat.pending"), value: formatMetricValue(pending), tone: "tan" });
    if (approval) items.push({ label: tb("stat.approval"), value: formatMetricValue(approval) });
    if (convert) items.push({ label: tb("stat.convert"), value: formatMetricValue(convert) });
    if (sentMonth) items.push({ label: tb("stat.sentMonth"), value: formatMetricValue(sentMonth) });
    if (avgEstimate) items.push({ label: tb("stat.avgEstimate"), value: formatMetricValue(avgEstimate) });
    return items;
  }, [estimateMetrics, tb]);

  return (
    <div className="space-y-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {segmentControl}
        <div className="flex items-center gap-1.5">
          <SearchInput
            placeholder={t("estimates.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            wrapperClassName="w-[220px] max-w-full"
          />
          {can("estimates.create") && (
            <button
              type="button"
              onClick={gatedOpenCreate}
              className="inline-flex h-[28px] shrink-0 items-center gap-1 rounded-[5px] border border-ops-accent px-2 font-cakemono text-[12px] font-light uppercase text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              <Plus className="h-[12px] w-[12px]" strokeWidth={1.5} />
              {t("estimates.newEstimate")}
            </button>
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
        <div className="flex flex-col items-start py-8">
          <FileText className="mb-2 h-[32px] w-[32px] text-text-3" />
          <h3 className="font-mohave text-body-lg text-text-2">
            {searchQuery || statusFilter !== "all" ? t("estimates.empty.noMatch") : t("estimates.empty.none")}
          </h3>
          {!searchQuery && statusFilter === "all" && (
            <p className="mt-0.5 font-mono text-caption text-text-3">{t("estimates.empty.helper")}</p>
          )}
          {!searchQuery && statusFilter === "all" && can("estimates.create") && (
            <Button className="mt-3 gap-[6px]" onClick={gatedOpenCreate}>
              <Plus className="h-[16px] w-[16px]" />
              {t("estimates.newEstimate")}
            </Button>
          )}
        </div>
      ) : (
        <div className="glass-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-border">
                  {[
                    t("estimates.table.number"),
                    t("estimates.table.client"),
                    t("estimates.table.project"),
                    t("estimates.table.date"),
                    t("estimates.table.expiry"),
                    t("estimates.table.total"),
                    t("estimates.table.status"),
                    "",
                  ].map((label, i) => (
                    <th
                      key={i}
                      className={cn(
                        "px-2 py-1.5 text-left font-mono text-micro font-normal uppercase tracking-[0.16em] text-text-3",
                        i === 5 && "text-right",
                        i === 6 && "text-center",
                        i === 2 && "hidden md:table-cell",
                        i === 3 && "hidden sm:table-cell",
                        i === 4 && "hidden lg:table-cell",
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((estimate) => (
                  <tr
                    key={estimate.id}
                    className="cursor-pointer border-b border-[rgba(255,255,255,0.05)] transition-colors last:border-b-0 hover:bg-surface-hover"
                    onClick={() => {
                      if (!can("estimates.edit")) return;
                      setEditingEstimate(estimate);
                    }}
                  >
                    <td className="px-2 py-[11px]">
                      <span className="font-mono text-data-sm text-text tabular-nums">
                        {estimate.estimateNumber}
                      </span>
                    </td>
                    <td className="px-2 py-[11px]">
                      <span className="block max-w-[180px] truncate font-mohave text-body-sm text-text">
                        {estimate.clientId ? clientMap.get(estimate.clientId) ?? "—" : "—"}
                      </span>
                    </td>
                    <td className="hidden px-2 py-[11px] md:table-cell">
                      <span className="block max-w-[160px] truncate font-mohave text-caption-sm text-text-3">
                        {estimate.projectId ? projectMap.get(estimate.projectId) ?? "—" : "—"}
                      </span>
                    </td>
                    <td className="hidden px-2 py-[11px] sm:table-cell">
                      <span className="whitespace-nowrap font-mono text-caption-sm text-text-3 tabular-nums">
                        {fmtDate(estimate.issueDate, locale)}
                      </span>
                    </td>
                    <td className="hidden px-2 py-[11px] lg:table-cell">
                      <span className="whitespace-nowrap font-mono text-caption-sm text-text-3 tabular-nums">
                        {fmtDate(estimate.expirationDate, locale)}
                      </span>
                    </td>
                    <td className="px-2 py-[11px] text-right">
                      <span className="font-mono text-data-sm text-text tabular-nums">
                        {formatCurrency(estimate.total)}
                      </span>
                    </td>
                    <td className="px-2 py-[11px] text-center">
                      <StatusTag
                        status={estimate.status}
                        label={t(`estimates.status.${estimate.status}`, formatEnumLabel(estimate.status))}
                      />
                    </td>
                    <td className="px-2 py-[11px] text-right">
                      <div
                        className="flex items-center justify-end gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleDownloadPdf(estimate.id)}
                          disabled={generatingPdfId === estimate.id}
                          className="rounded p-[4px] text-text-3 transition-colors hover:bg-surface-active hover:text-text disabled:opacity-50"
                          title={t("estimates.actions.downloadPdf")}
                          aria-label={t("estimates.actions.downloadPdf")}
                        >
                          {generatingPdfId === estimate.id ? (
                            <Loader2 className="h-[14px] w-[14px] animate-spin motion-reduce:animate-none" />
                          ) : (
                            <Download className="h-[14px] w-[14px]" />
                          )}
                        </button>
                        {estimate.status === EstimateStatus.Draft && can("estimates.send") && (
                          <button
                            onClick={() => setSendingEstimate(estimate)}
                            className="rounded p-[4px] text-text-3 transition-colors hover:bg-surface-active hover:text-text"
                            title={t("estimates.actions.send")}
                          aria-label={t("estimates.actions.send")}
                          >
                            <Send className="h-[14px] w-[14px]" />
                          </button>
                        )}
                        {(estimate.status === EstimateStatus.Approved ||
                          estimate.status === EstimateStatus.Sent) &&
                          can("estimates.convert") && (
                            <button
                              onClick={() => convertToInvoice.mutate({ estimateId: estimate.id })}
                              className="rounded p-[4px] text-text-3 transition-colors hover:bg-olive-soft hover:text-olive"
                              title={t("estimates.actions.convertToInvoice")}
                          aria-label={t("estimates.actions.convertToInvoice")}
                            >
                              <ArrowRightLeft className="h-[14px] w-[14px]" />
                            </button>
                          )}
                        {can("estimates.delete") && (
                          <button
                            onClick={() => deleteEstimate.mutate(estimate.id)}
                            className="rounded p-[4px] text-text-3 transition-colors hover:bg-rose-soft hover:text-rose"
                            title={t("estimates.actions.delete")}
                          aria-label={t("estimates.actions.delete")}
                          >
                            <Trash2 className="h-[14px] w-[14px]" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
