"use client";

import { useState, useMemo } from "react";
import {
  Calculator,
  Link2,
  Link2Off,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/ops/metric-card";
import {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useTriggerSync,
  useSyncHistory,
  useInvoices,
} from "@/lib/hooks";
import {
  AccountingProvider,
  InvoiceStatus,
  formatCurrency,
} from "@/lib/types/models";
import type { AccountingConnection, Invoice } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";

type TabValue = "dashboard" | "integrations";

// ─── Provider Info ──────────────────────────────────────────────────────────

const PROVIDER_INFO: Record<
  AccountingProvider,
  { name: string; description: string; color: string; bgColor: string }
> = {
  [AccountingProvider.QuickBooks]: {
    name: "QuickBooks Online",
    description: "Sync invoices, estimates, payments, and customers with Intuit QuickBooks Online.",
    color: "#2CA01C",
    bgColor: "rgba(44,160,28,0.1)",
  },
  [AccountingProvider.Sage]: {
    name: "Sage Business Cloud",
    description: "Sync invoices, quotes, payments, and contacts with Sage Business Cloud Accounting.",
    color: "#00DC00",
    bgColor: "rgba(0,220,0,0.08)",
  },
};

// ─── Aging Helpers ──────────────────────────────────────────────────────────

function calculateAgingBuckets(invoices: Invoice[]) {
  const now = new Date();
  const buckets = {
    current: 0,    // not yet due
    days1_30: 0,   // 1-30 days overdue
    days31_60: 0,  // 31-60 days overdue
    days61_90: 0,  // 61-90 days overdue
    days90Plus: 0, // 90+ days overdue
  };

  for (const inv of invoices) {
    if (
      inv.status === InvoiceStatus.Void ||
      inv.status === InvoiceStatus.Draft ||
      inv.status === InvoiceStatus.Paid
    ) continue;

    const balance = inv.balance;
    if (balance <= 0) continue;

    if (!inv.dueDate) {
      buckets.current += balance;
      continue;
    }

    const due = new Date(inv.dueDate);
    const diffMs = now.getTime() - due.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) buckets.current += balance;
    else if (diffDays <= 30) buckets.days1_30 += balance;
    else if (diffDays <= 60) buckets.days31_60 += balance;
    else if (diffDays <= 90) buckets.days61_90 += balance;
    else buckets.days90Plus += balance;
  }

  return buckets;
}

// ─── Connection Card ────────────────────────────────────────────────────────

function ConnectionCard({
  provider,
  connection,
  onConnect,
  onDisconnect,
  onSync,
  isSyncing,
}: {
  provider: AccountingProvider;
  connection?: AccountingConnection;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  isSyncing: boolean;
}) {
  const info = PROVIDER_INFO[provider];
  const isConnected = connection?.isConnected ?? false;

  return (
    <Card variant="default" className="p-3 space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-[40px] h-[40px] rounded-lg flex items-center justify-center"
            style={{ backgroundColor: info.bgColor }}
          >
            <Calculator
              className="w-[20px] h-[20px]"
              style={{ color: info.color }}
            />
          </div>
          <div>
            <h3 className="font-mohave text-body text-text-primary uppercase">
              {info.name}
            </h3>
            <p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5">
              {info.description}
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-kosugi uppercase tracking-wider",
            isConnected
              ? "bg-[rgba(157,181,130,0.15)] text-status-success"
              : "bg-[rgba(156,163,175,0.1)] text-text-tertiary"
          )}
        >
          {isConnected ? (
            <>
              <CheckCircle2 className="w-[10px] h-[10px]" />
              Connected
            </>
          ) : (
            <>
              <Link2Off className="w-[10px] h-[10px]" />
              Not Connected
            </>
          )}
        </div>
      </div>

      {/* Connection details */}
      {isConnected && connection && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-border">
          <div>
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
              Last Synced
            </span>
            <span className="font-mono text-data-sm text-text-secondary">
              {connection.lastSyncAt
                ? new Date(connection.lastSyncAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Never"}
            </span>
          </div>
          <div>
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
              Auto-Sync
            </span>
            <span className="font-mono text-data-sm text-text-secondary">
              {connection.syncEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div>
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
              Realm ID
            </span>
            <span className="font-mono text-data-sm text-text-secondary truncate block">
              {connection.realmId || "—"}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1">
        {isConnected ? (
          <>
            <Button
              variant="default"
              size="sm"
              onClick={onSync}
              disabled={isSyncing}
              className="gap-1"
            >
              {isSyncing ? (
                <Loader2 className="w-[14px] h-[14px] animate-spin" />
              ) : (
                <RefreshCw className="w-[14px] h-[14px]" />
              )}
              {isSyncing ? "Syncing..." : "Sync Now"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              className="text-text-tertiary hover:text-ops-error"
            >
              <Link2Off className="w-[14px] h-[14px] mr-0.5" />
              Disconnect
            </Button>
          </>
        ) : (
          <Button variant="default" size="sm" onClick={onConnect} className="gap-1">
            <Link2 className="w-[14px] h-[14px]" />
            Connect {info.name}
          </Button>
        )}
      </div>
    </Card>
  );
}

// ─── Sync History Row ───────────────────────────────────────────────────────

function SyncHistoryRow({
  entry,
}: {
  entry: { id: string; provider: string; status: string; timestamp: Date; details: string | null };
}) {
  const statusIcon =
    entry.status === "success" ? (
      <CheckCircle2 className="w-[12px] h-[12px] text-status-success" />
    ) : entry.status === "error" ? (
      <AlertCircle className="w-[12px] h-[12px] text-ops-error" />
    ) : (
      <Clock className="w-[12px] h-[12px] text-ops-amber" />
    );

  return (
    <div className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[rgba(255,255,255,0.02)]">
      {statusIcon}
      <span className="font-kosugi text-caption-sm text-text-secondary uppercase flex-1 truncate">
        {entry.provider} — {entry.status}
      </span>
      <span className="font-mono text-[10px] text-text-disabled shrink-0">
        {new Date(entry.timestamp).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      {entry.details && (
        <span className="font-kosugi text-[10px] text-text-disabled truncate max-w-[200px]">
          {entry.details}
        </span>
      )}
    </div>
  );
}

// ─── Aging Bar ──────────────────────────────────────────────────────────────

function AgingBar({
  label,
  amount,
  maxAmount,
  color,
}: {
  label: string;
  amount: number;
  maxAmount: number;
  color: string;
}) {
  const pct = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-wider">
          {label}
        </span>
        <span className="font-mono text-data-sm text-text-secondary">
          {formatCurrency(amount)}
        </span>
      </div>
      <div className="h-[6px] rounded-full bg-[rgba(255,255,255,0.04)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const [activeTab, setActiveTab] = useState<TabValue>("dashboard");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  // Data
  const { data: connections = [], isLoading: connectionsLoading } = useAccountingConnections();
  const { data: syncHistory = [], isLoading: historyLoading } = useSyncHistory();
  const { data: invoices = [] } = useInvoices();

  // Mutations
  const initiateOAuth = useInitiateOAuth();
  const disconnectProvider = useDisconnectProvider();
  const triggerSync = useTriggerSync();

  // Find connections by provider
  const qbConnection = connections.find((c) => c.provider === AccountingProvider.QuickBooks);
  const sageConnection = connections.find((c) => c.provider === AccountingProvider.Sage);

  // ─── Dashboard Metrics ──────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let outstanding = 0;
    let overdue = 0;
    let paidThisMonth = 0;
    let totalInvoiced = 0;

    for (const inv of invoices) {
      if (inv.status === InvoiceStatus.Void) continue;
      totalInvoiced += inv.total;

      if (
        inv.status === InvoiceStatus.Sent ||
        inv.status === InvoiceStatus.Partial ||
        inv.status === InvoiceStatus.Overdue
      ) {
        outstanding += inv.balance;
      }

      if (inv.status === InvoiceStatus.Overdue) {
        overdue += inv.balance;
      }

      if (inv.paidAt && new Date(inv.paidAt) >= monthStart) {
        paidThisMonth += inv.amountPaid;
      } else if (inv.status === InvoiceStatus.Paid && inv.updatedAt && new Date(inv.updatedAt) >= monthStart) {
        paidThisMonth += inv.amountPaid;
      }
    }

    return { outstanding, overdue, paidThisMonth, totalInvoiced };
  }, [invoices]);

  const aging = useMemo(() => calculateAgingBuckets(invoices), [invoices]);

  const maxAging = Math.max(
    aging.current,
    aging.days1_30,
    aging.days31_60,
    aging.days61_90,
    aging.days90Plus,
    1
  );

  // ─── Top Clients ────────────────────────────────────────────────────────────

  const topClients = useMemo(() => {
    const clientMap = new Map<string, { name: string; total: number; paid: number }>();

    for (const inv of invoices) {
      if (inv.status === InvoiceStatus.Void || !inv.clientId) continue;
      const existing = clientMap.get(inv.clientId) || {
        name: inv.clientId, // Will be replaced if client data is available
        total: 0,
        paid: 0,
      };
      existing.total += inv.total;
      existing.paid += inv.amountPaid;
      clientMap.set(inv.clientId, existing);
    }

    return Array.from(clientMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [invoices]);

  // ─── Sync Handlers ──────────────────────────────────────────────────────────

  const handleConnect = (provider: AccountingProvider) => {
    if (!companyId) return;
    initiateOAuth.mutate({ companyId, provider });
  };

  const handleDisconnect = (provider: AccountingProvider) => {
    if (!companyId) return;
    disconnectProvider.mutate({ companyId, provider });
  };

  const handleSync = (provider: AccountingProvider) => {
    if (!companyId) return;
    triggerSync.mutate({ companyId, provider });
  };

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  const tabs: { value: TabValue; label: string }[] = [
    { value: "dashboard", label: "Dashboard" },
    { value: "integrations", label: "Integrations" },
  ];

  return (
    <div className="space-y-3 pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="font-mohave text-heading text-text-primary uppercase tracking-wider">
            Accounting
          </h1>
          <p className="font-mohave text-body-sm text-text-tertiary">
            Financial overview and accounting integrations
          </p>
        </div>

        {/* Tabs */}
        <div className="flex bg-background-card border border-border rounded-lg p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "px-3 py-1 rounded font-mohave text-body-sm uppercase transition-colors",
                activeTab === tab.value
                  ? "bg-[rgba(255,255,255,0.08)] text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && (
        <div className="space-y-3">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <MetricCard
              label="Total Outstanding"
              value={formatCurrency(metrics.outstanding)}
              icon={<DollarSign className="w-[16px] h-[16px]" />}
            />
            <MetricCard
              label="Overdue"
              value={formatCurrency(metrics.overdue)}
              icon={<AlertTriangle className="w-[16px] h-[16px]" />}
            />
            <MetricCard
              label="Paid This Month"
              value={formatCurrency(metrics.paidThisMonth)}
              icon={<TrendingUp className="w-[16px] h-[16px]" />}
            />
            <MetricCard
              label="Total Invoiced"
              value={formatCurrency(metrics.totalInvoiced)}
              icon={<Calculator className="w-[16px] h-[16px]" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Aging Report */}
            <Card variant="default" className="p-3 space-y-2">
              <h2 className="font-mohave text-body-lg text-text-primary uppercase tracking-wider">
                Overdue Aging
              </h2>
              <div className="space-y-1.5">
                <AgingBar
                  label="Current"
                  amount={aging.current}
                  maxAmount={maxAging}
                  color="#9DB582"
                />
                <AgingBar
                  label="1 – 30 days"
                  amount={aging.days1_30}
                  maxAmount={maxAging}
                  color="#C4A868"
                />
                <AgingBar
                  label="31 – 60 days"
                  amount={aging.days31_60}
                  maxAmount={maxAging}
                  color="#D4944A"
                />
                <AgingBar
                  label="61 – 90 days"
                  amount={aging.days61_90}
                  maxAmount={maxAging}
                  color="#B58289"
                />
                <AgingBar
                  label="90+ days"
                  amount={aging.days90Plus}
                  maxAmount={maxAging}
                  color="#D45050"
                />
              </div>
            </Card>

            {/* Top Clients */}
            <Card variant="default" className="p-3 space-y-2">
              <h2 className="font-mohave text-body-lg text-text-primary uppercase tracking-wider">
                Top Clients by Revenue
              </h2>
              {topClients.length === 0 ? (
                <p className="font-kosugi text-caption-sm text-text-disabled py-3 text-center">
                  No invoice data yet
                </p>
              ) : (
                <div className="space-y-1">
                  {topClients.map((client, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-[rgba(255,255,255,0.02)]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] text-text-disabled w-[16px] text-right shrink-0">
                          {idx + 1}.
                        </span>
                        <span className="font-kosugi text-caption text-text-secondary truncate">
                          {client.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-data-sm text-text-primary">
                          {formatCurrency(client.total)}
                        </span>
                        <span className="font-mono text-[10px] text-text-disabled">
                          ({formatCurrency(client.paid)} paid)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Invoice Status Breakdown */}
          <Card variant="default" className="p-3 space-y-2">
            <h2 className="font-mohave text-body-lg text-text-primary uppercase tracking-wider">
              Invoice Breakdown
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {Object.values(InvoiceStatus).map((status) => {
                const count = invoices.filter((i) => i.status === status).length;
                const total = invoices
                  .filter((i) => i.status === status)
                  .reduce((sum, i) => sum + i.total, 0);
                return (
                  <div
                    key={status}
                    className="flex flex-col gap-0.5 p-1.5 rounded bg-[rgba(255,255,255,0.02)] border border-border"
                  >
                    <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
                      {status}
                    </span>
                    <span className="font-mono text-data text-text-primary">{count}</span>
                    <span className="font-mono text-[10px] text-text-tertiary">
                      {formatCurrency(total)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === "integrations" && (
        <div className="space-y-3">
          {/* Connection Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ConnectionCard
              provider={AccountingProvider.QuickBooks}
              connection={qbConnection}
              onConnect={() => handleConnect(AccountingProvider.QuickBooks)}
              onDisconnect={() => handleDisconnect(AccountingProvider.QuickBooks)}
              onSync={() => handleSync(AccountingProvider.QuickBooks)}
              isSyncing={
                triggerSync.isPending &&
                triggerSync.variables?.provider === AccountingProvider.QuickBooks
              }
            />
            <ConnectionCard
              provider={AccountingProvider.Sage}
              connection={sageConnection}
              onConnect={() => handleConnect(AccountingProvider.Sage)}
              onDisconnect={() => handleDisconnect(AccountingProvider.Sage)}
              onSync={() => handleSync(AccountingProvider.Sage)}
              isSyncing={
                triggerSync.isPending &&
                triggerSync.variables?.provider === AccountingProvider.Sage
              }
            />
          </div>

          {/* Sync History */}
          <Card variant="default" className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-mohave text-body-lg text-text-primary uppercase tracking-wider">
                Sync History
              </h2>
              {connectionsLoading && (
                <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              )}
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-[20px] h-[20px] text-text-disabled animate-spin" />
              </div>
            ) : syncHistory.length === 0 ? (
              <p className="font-kosugi text-caption-sm text-text-disabled py-4 text-center">
                No sync history yet. Connect an accounting provider to get started.
              </p>
            ) : (
              <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
                {syncHistory.map((entry) => (
                  <SyncHistoryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </Card>

          {/* Sync Settings Info */}
          <Card variant="default" className="p-3 space-y-1.5">
            <h2 className="font-mohave text-body-lg text-text-primary uppercase tracking-wider">
              How Sync Works
            </h2>
            <div className="space-y-1">
              <div className="flex items-start gap-1.5">
                <div className="w-[20px] h-[20px] rounded-full bg-[rgba(44,160,28,0.1)] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="font-mono text-[10px] text-status-success">1</span>
                </div>
                <p className="font-kosugi text-caption-sm text-text-secondary">
                  <strong className="text-text-primary">Outbound:</strong> When you create or update invoices,
                  estimates, or payments in OPS, they are automatically pushed to your connected accounting software.
                </p>
              </div>
              <div className="flex items-start gap-1.5">
                <div className="w-[20px] h-[20px] rounded-full bg-[rgba(129,149,181,0.1)] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="font-mono text-[10px] text-[#8195B5]">2</span>
                </div>
                <p className="font-kosugi text-caption-sm text-text-secondary">
                  <strong className="text-text-primary">Inbound:</strong> Changes made in QuickBooks or Sage are
                  synced back to OPS via webhooks (QuickBooks) or periodic polling (Sage).
                </p>
              </div>
              <div className="flex items-start gap-1.5">
                <div className="w-[20px] h-[20px] rounded-full bg-[rgba(196,168,104,0.1)] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="font-mono text-[10px] text-[#C4A868]">3</span>
                </div>
                <p className="font-kosugi text-caption-sm text-text-secondary">
                  <strong className="text-text-primary">Conflicts:</strong> If both sides change the same record,
                  OPS data takes priority by default. Conflicting changes are flagged for manual review.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
