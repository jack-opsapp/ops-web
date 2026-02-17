"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Plus,
  Search,
  FileText,
  Send,
  ArrowRightLeft,
  Copy,
  Trash2,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  useEstimates,
  useCreateEstimate,
  useUpdateEstimate,
  useDeleteEstimate,
  useSendEstimate,
  useConvertEstimateToInvoice,
  useClients,
  useProjects,
  useProducts,
} from "@/lib/hooks";
import {
  EstimateStatus,
  ESTIMATE_STATUS_COLORS,
  formatCurrency,
  LineItemType,
  SyncStatus,
} from "@/lib/types/models";
import type { Estimate } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { cn } from "@/lib/utils/cn";

type FilterStatus = "all" | EstimateStatus;

const statusFilters: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: EstimateStatus.Draft, label: "Draft" },
  { value: EstimateStatus.Sent, label: "Sent" },
  { value: EstimateStatus.Accepted, label: "Accepted" },
  { value: EstimateStatus.Rejected, label: "Rejected" },
];

function StatusBadgeEstimate({ status }: { status: EstimateStatus }) {
  const color = ESTIMATE_STATUS_COLORS[status] ?? "#9CA3AF";
  return (
    <span
      className="inline-flex items-center gap-[4px] px-[6px] py-[2px] rounded font-kosugi text-[10px] uppercase tracking-wider"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span
        className="w-[6px] h-[6px] rounded-full"
        style={{ backgroundColor: color }}
      />
      {status}
    </span>
  );
}

function formatDate(date: Date | null): string {
  if (!date) return "--";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function EstimatesPage() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);

  // Data
  const { data: estimates = [], isLoading } = useEstimates();
  const { data: clientsData } = useClients();
  const { data: projectsData } = useProjects();
  const { data: products = [] } = useProducts();

  const clients = clientsData?.clients ?? [];
  const projects = projectsData?.projects ?? [];

  // Mutations
  const createEstimate = useCreateEstimate();
  const updateEstimate = useUpdateEstimate();
  const deleteEstimate = useDeleteEstimate();
  const sendEstimate = useSendEstimate();
  const convertToInvoice = useConvertEstimateToInvoice();

  // Page actions
  const setActions = usePageActionsStore((s) => s.setActions);
  const clearActions = usePageActionsStore((s) => s.clearActions);
  useEffect(() => {
    setActions([
      { label: "New Estimate", icon: Plus, onClick: () => setShowCreateModal(true) },
    ]);
    return () => clearActions();
  }, [setActions, clearActions]);

  // Client name lookup
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

  // Filtering
  const filtered = useMemo(() => {
    let list = [...estimates];
    if (filterStatus !== "all") {
      list = list.filter((e) => e.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.estimateNumber.toLowerCase().includes(q) ||
          (e.clientId && clientMap.get(e.clientId)?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [estimates, filterStatus, searchQuery, clientMap]);

  // Summary metrics
  const metrics = useMemo(() => {
    const draft = estimates.filter((e) => e.status === EstimateStatus.Draft).length;
    const sent = estimates.filter((e) => e.status === EstimateStatus.Sent).length;
    const accepted = estimates.filter((e) => e.status === EstimateStatus.Accepted);
    const acceptedTotal = accepted.reduce((sum, e) => sum + e.total, 0);
    const total = estimates.reduce((sum, e) => sum + e.total, 0);
    return { draft, sent, acceptedCount: accepted.length, acceptedTotal, total };
  }, [estimates]);

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <MetricCard
          label="Total Value"
          value={formatCurrency(metrics.total)}
          icon={<FileText className="w-[16px] h-[16px]" />}
        />
        <MetricCard label="Accepted" value={formatCurrency(metrics.acceptedTotal)} />
        <MetricCard label="Drafts" value={String(metrics.draft)} />
        <MetricCard label="Sent" value={String(metrics.sent)} />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-kosugi text-caption-sm text-text-tertiary">
          {filtered.length} estimate{filtered.length !== 1 ? "s" : ""}
        </span>
        <Button className="gap-[6px]" onClick={() => setShowCreateModal(true)}>
          <Plus className="w-[16px] h-[16px]" />
          New Estimate
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 max-w-[400px]">
          <Input
            placeholder="Search estimates..."
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
          <FileText className="w-[48px] h-[48px] text-text-disabled mb-2" />
          <h3 className="font-mohave text-heading text-text-primary">
            {searchQuery || filterStatus !== "all" ? "No matching estimates" : "No estimates yet"}
          </h3>
          <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
            {searchQuery || filterStatus !== "all"
              ? "Try adjusting your search or filter"
              : "Create your first estimate to get started"}
          </p>
          {!searchQuery && filterStatus === "all" && (
            <Button className="mt-3 gap-[6px]" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-[16px] h-[16px]" />
              Create Estimate
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-background-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Number
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Client
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                  Project
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  Date
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden lg:table-cell">
                  Expiry
                </th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Total
                </th>
                <th className="px-1.5 py-1 text-center font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Status
                </th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((estimate) => (
                <tr
                  key={estimate.id}
                  className="border-b border-border-subtle hover:bg-background-elevated cursor-pointer transition-colors"
                  onClick={() => setEditingEstimate(estimate)}
                >
                  <td className="px-1.5 py-1">
                    <span className="font-mono text-data text-ops-accent">
                      {estimate.estimateNumber}
                    </span>
                  </td>
                  <td className="px-1.5 py-1">
                    <span className="font-mohave text-body text-text-primary truncate block max-w-[160px]">
                      {estimate.clientId ? clientMap.get(estimate.clientId) ?? "--" : "--"}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 hidden md:table-cell">
                    <span className="font-mohave text-body-sm text-text-tertiary truncate block max-w-[160px]">
                      {estimate.projectId ? projectMap.get(estimate.projectId) ?? "--" : "--"}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 hidden sm:table-cell">
                    <span className="font-mono text-data-sm text-text-tertiary">
                      {formatDate(estimate.date)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 hidden lg:table-cell">
                    <span className="font-mono text-data-sm text-text-tertiary">
                      {formatDate(estimate.expirationDate)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <span className="font-mono text-data text-text-primary">
                      {formatCurrency(estimate.total)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    <StatusBadgeEstimate status={estimate.status} />
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {estimate.status === EstimateStatus.Draft && (
                        <button
                          onClick={() => sendEstimate.mutate(estimate.id)}
                          className="p-[4px] rounded text-text-tertiary hover:text-ops-accent hover:bg-ops-accent-muted transition-colors"
                          title="Send"
                        >
                          <Send className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      {(estimate.status === EstimateStatus.Accepted || estimate.status === EstimateStatus.Sent) && (
                        <button
                          onClick={() => convertToInvoice.mutate(estimate.id)}
                          className="p-[4px] rounded text-text-tertiary hover:text-status-success hover:bg-status-success/10 transition-colors"
                          title="Convert to Invoice"
                        >
                          <ArrowRightLeft className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteEstimate.mutate(estimate.id)}
                        className="p-[4px] rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                        title="Delete"
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

      {/* Create/Edit Modal */}
      <EstimateFormModal
        open={showCreateModal || !!editingEstimate}
        onClose={() => {
          setShowCreateModal(false);
          setEditingEstimate(null);
        }}
        estimate={editingEstimate}
        clients={clients}
        projects={projects}
        products={products}
        companyId={companyId}
        onCreate={(data, lineItems) => {
          createEstimate.mutate(
            { data, lineItems },
            {
              onSuccess: () => {
                setShowCreateModal(false);
              },
            }
          );
        }}
        onUpdate={(id, data, lineItems) => {
          updateEstimate.mutate(
            { id, data, lineItems },
            {
              onSuccess: () => {
                setEditingEstimate(null);
              },
            }
          );
        }}
      />
    </div>
  );
}

// ─── Estimate Form Modal ──────────────────────────────────────────────────────

function EstimateFormModal({
  open,
  onClose,
  estimate,
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
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; title: string }>;
  products: Array<import("@/lib/types/models").Product>;
  companyId: string;
  onCreate: (data: Partial<Estimate> & { companyId: string }, lineItems: Array<Partial<import("@/lib/types/models").LineItem>>) => void;
  onUpdate: (id: string, data: Partial<Estimate> & { companyId: string }, lineItems: Array<Partial<import("@/lib/types/models").LineItem>>) => void;
}) {
  const isEditing = !!estimate;

  const [clientId, setClientId] = useState(estimate?.clientId ?? "");
  const [projectId, setProjectId] = useState(estimate?.projectId ?? "");
  const [date, setDate] = useState(
    estimate?.date
      ? new Date(estimate.date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  );
  const [expirationDate, setExpirationDate] = useState(
    estimate?.expirationDate
      ? new Date(estimate.expirationDate).toISOString().slice(0, 10)
      : ""
  );
  const [notes, setNotes] = useState(estimate?.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(estimate?.internalNotes ?? "");
  const [termsAndConditions, setTermsAndConditions] = useState(estimate?.termsAndConditions ?? "");
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => {
    if (estimate?.lineItems && estimate.lineItems.length > 0) {
      return estimate.lineItems.map((li) => ({
        id: li.id,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxRate: li.taxRate,
        discountPercent: li.discountPercent,
        productId: li.productId,
        type: li.type,
      }));
    }
    return [createEmptyLineItem()];
  });

  // Reset form when estimate changes
  useEffect(() => {
    if (estimate) {
      setClientId(estimate.clientId ?? "");
      setProjectId(estimate.projectId ?? "");
      setDate(estimate.date ? new Date(estimate.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      setExpirationDate(estimate.expirationDate ? new Date(estimate.expirationDate).toISOString().slice(0, 10) : "");
      setNotes(estimate.notes ?? "");
      setInternalNotes(estimate.internalNotes ?? "");
      setTermsAndConditions(estimate.termsAndConditions ?? "");
      if (estimate.lineItems && estimate.lineItems.length > 0) {
        setLineItems(estimate.lineItems.map((li) => ({
          id: li.id,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxRate: li.taxRate,
          discountPercent: li.discountPercent,
          productId: li.productId,
          type: li.type,
        })));
      }
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
  }, [estimate]);

  const handleSubmit = () => {
    const mappedLineItems = lineItems.map((li, index) => {
      const amt = computeAmount(li);
      return {
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amount: amt.base,
        taxRate: li.taxRate,
        taxAmount: amt.tax,
        discountPercent: li.discountPercent,
        discountAmount: amt.discount,
        sortOrder: index,
        productId: li.productId,
        type: li.type,
        estimateId: null,
        invoiceId: null,
      };
    });

    const totals = mappedLineItems.reduce(
      (acc, li) => ({
        subtotal: acc.subtotal + li.amount,
        taxTotal: acc.taxTotal + li.taxAmount,
        discountTotal: acc.discountTotal + li.discountAmount,
      }),
      { subtotal: 0, taxTotal: 0, discountTotal: 0 }
    );
    const total = totals.subtotal + totals.taxTotal - totals.discountTotal;

    const formData: Partial<Estimate> & { companyId: string } = {
      companyId,
      clientId: clientId || null,
      projectId: projectId || null,
      date: date ? new Date(date) : new Date(),
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      notes: notes || null,
      internalNotes: internalNotes || null,
      termsAndConditions: termsAndConditions || null,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      discountTotal: totals.discountTotal,
      total,
      status: estimate?.status ?? EstimateStatus.Draft,
      syncStatus: SyncStatus.Pending,
    };

    if (isEditing && estimate) {
      onUpdate(estimate.id, formData, mappedLineItems);
    } else {
      onCreate(formData, mappedLineItems);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            {isEditing ? `Edit ${estimate?.estimateNumber}` : "New Estimate"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Client + Project */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Client
              </label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary"
              >
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary"
              >
                <option value="">Select project (optional)...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Date
              </label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Valid Until
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
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Line Items
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
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Notes (visible to client)
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes for the client..."
                rows={3}
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Internal Notes
              </label>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Internal notes (not visible to client)..."
                rows={3}
              />
            </div>
          </div>

          {/* T&C */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Terms & Conditions
            </label>
            <Textarea
              value={termsAndConditions}
              onChange={(e) => setTermsAndConditions(e.target.value)}
              placeholder="Terms and conditions..."
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {isEditing ? "Save Changes" : "Create Estimate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
