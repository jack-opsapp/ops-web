"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Search,
  Receipt,
  Send,
  DollarSign,
  Ban,
  Trash2,
  AlertTriangle,
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
  PAYMENT_TERMS_OPTIONS,
  calculateDueDate,
  PaymentMethod,
  SyncStatus,
} from "@/lib/types/models";
import type { Invoice } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { cn } from "@/lib/utils/cn";

type FilterStatus = "all" | InvoiceStatus;

const statusFilters: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: InvoiceStatus.Draft, label: "Draft" },
  { value: InvoiceStatus.Sent, label: "Sent" },
  { value: InvoiceStatus.Partial, label: "Partial" },
  { value: InvoiceStatus.Paid, label: "Paid" },
  { value: InvoiceStatus.Overdue, label: "Overdue" },
];

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

function formatDate(date: Date | null): string {
  if (!date) return "--";
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const paymentMethodLabels: Record<PaymentMethod, string> = {
  [PaymentMethod.Cash]: "Cash",
  [PaymentMethod.Check]: "Check",
  [PaymentMethod.CreditCard]: "Credit Card",
  [PaymentMethod.BankTransfer]: "Bank Transfer",
  [PaymentMethod.Other]: "Other",
};

export default function InvoicesPage() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
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

  const setActions = usePageActionsStore((s) => s.setActions);
  const clearActions = usePageActionsStore((s) => s.clearActions);
  useEffect(() => {
    setActions([
      { label: "New Invoice", icon: Plus, onClick: () => setShowCreateModal(true) },
    ]);
    return () => clearActions();
  }, [setActions, clearActions]);

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
      .reduce((sum, i) => sum + i.balance, 0);
    const overdue = invoices
      .filter((i) => i.status === InvoiceStatus.Overdue)
      .reduce((sum, i) => sum + i.balance, 0);
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
          label="Outstanding"
          value={formatCurrency(metrics.outstanding)}
          icon={<Receipt className="w-[16px] h-[16px]" />}
        />
        <MetricCard
          label="Overdue"
          value={formatCurrency(metrics.overdue)}
          icon={metrics.overdue > 0 ? <AlertTriangle className="w-[16px] h-[16px] text-ops-error" /> : undefined}
        />
        <MetricCard label="Paid This Month" value={formatCurrency(metrics.paidThisMonth)} />
        <MetricCard label="Drafts" value={String(metrics.draftCount)} />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-kosugi text-caption-sm text-text-tertiary">
          {filtered.length} invoice{filtered.length !== 1 ? "s" : ""}
        </span>
        <Button className="gap-[6px]" onClick={() => setShowCreateModal(true)}>
          <Plus className="w-[16px] h-[16px]" />
          New Invoice
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 max-w-[400px]">
          <Input
            placeholder="Search invoices..."
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
            {searchQuery || filterStatus !== "all" ? "No matching invoices" : "No invoices yet"}
          </h3>
          <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
            {searchQuery || filterStatus !== "all"
              ? "Try adjusting your search or filter"
              : "Create your first invoice to start tracking payments"}
          </p>
          {!searchQuery && filterStatus === "all" && (
            <Button className="mt-3 gap-[6px]" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-[16px] h-[16px]" />
              Create Invoice
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-background-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Number</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Client</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">Project</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">Date</th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden lg:table-cell">Due</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Total</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">Paid</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Balance</th>
                <th className="px-1.5 py-1 text-center font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Status</th>
                <th className="px-1.5 py-1 text-right font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Actions</th>
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
                    <span className="font-mono text-data-sm text-text-tertiary">{formatDate(invoice.date)}</span>
                  </td>
                  <td className="px-1.5 py-1 hidden lg:table-cell">
                    <span className={cn(
                      "font-mono text-data-sm",
                      invoice.status === InvoiceStatus.Overdue ? "text-ops-error" : "text-text-tertiary"
                    )}>
                      {formatDate(invoice.dueDate)}
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
                      invoice.balance > 0 ? "text-text-primary" : "text-status-success"
                    )}>
                      {formatCurrency(invoice.balance)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    <StatusBadgeInvoice status={invoice.status} />
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {invoice.status === InvoiceStatus.Draft && (
                        <button
                          onClick={() => sendInvoice.mutate(invoice.id)}
                          className="p-[4px] rounded text-text-tertiary hover:text-ops-accent hover:bg-ops-accent-muted transition-colors"
                          title="Send"
                        >
                          <Send className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      {invoice.status !== InvoiceStatus.Paid && invoice.status !== InvoiceStatus.Void && (
                        <button
                          onClick={() => setPaymentInvoice(invoice)}
                          className="p-[4px] rounded text-text-tertiary hover:text-status-success hover:bg-status-success/10 transition-colors"
                          title="Record Payment"
                        >
                          <DollarSign className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      {invoice.status !== InvoiceStatus.Void && invoice.status !== InvoiceStatus.Paid && (
                        <button
                          onClick={() => voidInvoice.mutate(invoice.id)}
                          className="p-[4px] rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                          title="Void"
                        >
                          <Ban className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteInvoice.mutate(invoice.id)}
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
  products: Array<import("@/lib/types/models").Product>;
  companyId: string;
  onCreate: (data: Partial<Invoice> & { companyId: string }, lineItems: Array<Partial<import("@/lib/types/models").LineItem>>) => void;
  onUpdate: (id: string, data: Partial<Invoice> & { companyId: string }, lineItems: Array<Partial<import("@/lib/types/models").LineItem>>) => void;
}) {
  const isEditing = !!invoice;

  const [clientId, setClientId] = useState(invoice?.clientId ?? "");
  const [projectId, setProjectId] = useState(invoice?.projectId ?? "");
  const [date, setDate] = useState(
    invoice?.date ? new Date(invoice.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [paymentTerms, setPaymentTerms] = useState(invoice?.paymentTerms ?? "Net 30");
  const [dueDate, setDueDate] = useState(
    invoice?.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : ""
  );
  const [depositAmount, setDepositAmount] = useState(invoice?.depositAmount ?? 0);
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(invoice?.internalNotes ?? "");
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => {
    if (invoice?.lineItems && invoice.lineItems.length > 0) {
      return invoice.lineItems.map((li) => ({
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
      setDate(invoice.date ? new Date(invoice.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      setPaymentTerms(invoice.paymentTerms ?? "Net 30");
      setDueDate(invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : "");
      setDepositAmount(invoice.depositAmount ?? 0);
      setNotes(invoice.notes ?? "");
      setInternalNotes(invoice.internalNotes ?? "");
      if (invoice.lineItems && invoice.lineItems.length > 0) {
        setLineItems(invoice.lineItems.map((li) => ({
          id: li.id, description: li.description, quantity: li.quantity,
          unitPrice: li.unitPrice, taxRate: li.taxRate, discountPercent: li.discountPercent,
          productId: li.productId, type: li.type,
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
        description: li.description, quantity: li.quantity, unitPrice: li.unitPrice,
        amount: amt.base, taxRate: li.taxRate, taxAmount: amt.tax,
        discountPercent: li.discountPercent, discountAmount: amt.discount,
        sortOrder: index, productId: li.productId, type: li.type,
        estimateId: null, invoiceId: null,
      };
    });

    const totals = mappedLineItems.reduce(
      (acc, li) => ({ subtotal: acc.subtotal + li.amount, taxTotal: acc.taxTotal + li.taxAmount, discountTotal: acc.discountTotal + li.discountAmount }),
      { subtotal: 0, taxTotal: 0, discountTotal: 0 }
    );
    const total = totals.subtotal + totals.taxTotal - totals.discountTotal;

    const formData: Partial<Invoice> & { companyId: string } = {
      companyId,
      clientId: clientId || null,
      projectId: projectId || null,
      date: date ? new Date(date) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentTerms,
      depositAmount,
      notes: notes || null,
      internalNotes: internalNotes || null,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      discountTotal: totals.discountTotal,
      total,
      balance: total - (invoice?.amountPaid ?? 0),
      amountPaid: invoice?.amountPaid ?? 0,
      status: invoice?.status ?? InvoiceStatus.Draft,
      syncStatus: SyncStatus.Pending,
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
            {isEditing ? `Edit ${invoice?.invoiceNumber}` : "New Invoice"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Client + Project */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                <option value="">Select project (optional)...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          </div>

          {/* Date + Terms + Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Payment Terms</label>
              <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Due Date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Deposit */}
          <div className="max-w-[200px] space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Deposit / Retainer</label>
            <Input type="number" min={0} step={0.01} value={depositAmount} onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)} />
          </div>

          {/* Line Items */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Line Items</label>
            <LineItemEditor items={lineItems} onChange={setLineItems} products={products} />
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Notes / Memo</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment instructions, thank you note..." rows={3} />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Internal Notes</label>
              <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Internal notes..." rows={3} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit}>{isEditing ? "Save Changes" : "Create Invoice"}</Button>
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
  onSubmit: (data: { invoiceId: string; companyId: string; amount: number; date: Date; method: PaymentMethod; referenceNumber: string | null; notes: string | null }) => void;
}) {
  const [amount, setAmount] = useState(invoice?.balance ?? 0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.Other);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (invoice) {
      setAmount(invoice.balance);
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
            Record Payment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          <div className="bg-background-elevated rounded p-1.5 space-y-0.5">
            <div className="flex justify-between">
              <span className="font-kosugi text-caption text-text-tertiary">Invoice</span>
              <span className="font-mono text-data text-ops-accent">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-kosugi text-caption text-text-tertiary">Total</span>
              <span className="font-mono text-data text-text-primary">{formatCurrency(invoice.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-kosugi text-caption text-text-tertiary">Balance Due</span>
              <span className="font-mono text-data text-ops-error">{formatCurrency(invoice.balance)}</span>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Amount</label>
            <div className="flex gap-1">
              <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} className="flex-1" />
              <Button variant="secondary" size="sm" onClick={() => setAmount(invoice.balance)}>Pay in Full</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text-primary">
                {Object.entries(paymentMethodLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Reference #</label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Check #, transaction ID..." />
          </div>

          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment notes..." rows={2} />
          </div>

          <div className="flex justify-end gap-1 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                onSubmit({
                  invoiceId: invoice.id,
                  companyId,
                  amount,
                  date: new Date(date),
                  method,
                  referenceNumber: referenceNumber || null,
                  notes: notes || null,
                });
              }}
              disabled={amount <= 0}
            >
              Record Payment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
