"use client";

import {
  DownloadCloud,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Link2Off,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import type { QboStagedCounts } from "@/lib/types/qbo-import";

/** `// TITLE` panel header in the OPS register (JetBrains Mono, slash prefix). */
export function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </h3>
  );
}

// ── Run header ───────────────────────────────────────────────────────────────

export interface ImportRunHeaderProps {
  isConnected: boolean;
  pulling: boolean;
  canPull: boolean;
  onPull: () => void;
  /** Local HH:MM of the last pull, or null when nothing has been pulled. */
  lastPulled: string | null;
  /** QuickBooks write count for the run (MUST be 0). null before any run. */
  writeCalls: number | null;
}

export function ImportRunHeader({
  isConnected,
  pulling,
  canPull,
  onPull,
  lastPulled,
  writeCalls,
}: ImportRunHeaderProps) {
  const { t } = useDictionary("accounting");

  return (
    <div className="glass-surface rounded-panel p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-cakemono text-cake-display uppercase tracking-wider text-text">
            {t("qbo.title")}
          </h2>
          <p className="mt-1 font-mono text-caption-sm text-text-3">
            {t("qbo.readOnlyNote")}
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={onPull}
          disabled={pulling || !canPull}
          className="shrink-0 gap-1.5"
        >
          {pulling ? (
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <DownloadCloud size={14} />
          )}
          {pulling ? t("qbo.pulling") : t("qbo.pull")}
        </Button>
      </div>

      {/* Status ribbon — connection · last pull · read-only guard */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2.5 font-mono text-caption-sm tabular-nums">
        <span
          data-testid="qbo-connection-status"
          className={cn(
            "flex items-center gap-1.5",
            isConnected ? "text-status-success" : "text-text-mute"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full",
              isConnected ? "bg-status-success" : "bg-text-mute"
            )}
          />
          <span className="text-micro uppercase tracking-wider">
            {isConnected ? t("integrations.connected") : t("integrations.notConnected")}
          </span>
        </span>

        {lastPulled && (
          <span className="flex items-center gap-1.5 text-text-3">
            <span className="text-micro uppercase tracking-wider text-text-mute">
              {t("qbo.lastPulled")}
            </span>
            <span>{lastPulled}</span>
          </span>
        )}

        {writeCalls !== null && (
          <span
            data-testid="qbo-write-calls"
            className={cn(
              "flex items-center gap-1.5",
              writeCalls === 0 ? "text-status-success" : "text-rose"
            )}
          >
            {writeCalls === 0 ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
            <span className="text-micro uppercase tracking-wider text-text-mute">
              {t("qbo.writeCalls")}
            </span>
            <span>
              {writeCalls === 0
                ? t("qbo.writeCallsOk")
                : t("qbo.writeCallsFail", { count: writeCalls })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Records manifest ─────────────────────────────────────────────────────────

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-border bg-fill-neutral-dim px-1.5 py-1.5">
      <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
        {label}
      </span>
      <span className="font-mono text-data text-text tabular-nums">
        {value === 0 ? "—" : value}
      </span>
    </div>
  );
}

export function ImportRecordsPanel({ counts }: { counts: QboStagedCounts }) {
  const { t } = useDictionary("accounting");
  return (
    <div className="glass-surface rounded-panel p-3">
      <PanelTitle>{t("qbo.records.title")}</PanelTitle>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCell label={t("qbo.records.estimates")} value={counts.estimates} />
        <StatCell label={t("qbo.records.invoices")} value={counts.invoices} />
        <StatCell label={t("qbo.records.payments")} value={counts.payments} />
        <StatCell label={t("qbo.records.lineItems")} value={counts.lineItems} />
        <StatCell label={t("qbo.records.skippedInvoices")} value={counts.skippedInvoices} />
        <StatCell label={t("qbo.records.orphanPayments")} value={counts.orphanPayments} />
      </div>
      {counts.jobsDetected > 0 && (
        <p className="mt-2 font-mono text-caption-sm text-text-3">
          {t("qbo.jobsDetected", { count: counts.jobsDetected })}
        </p>
      )}
    </div>
  );
}

// ── Apply panel (idle / applying / applied / error) ──────────────────────────

export type ApplyPhase = "idle" | "applying" | "applied" | "error";

export interface ImportApplyPanelProps {
  status: ApplyPhase;
  customersToWrite: number;
  invoices: number;
  payments: number;
  /** Count of rows still flagged needs_review — any > 0 hard-blocks apply. */
  needsReviewCount: number;
  /** Total records written to OPS (shown on the applied state). */
  appliedCount: number;
  onApply: () => void;
}

/** One line of the "what is being written" manifest during apply. */
function ManifestRow({
  label,
  value,
  done,
}: {
  label: string;
  value: number;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-caption-sm">
      <span
        className={cn(
          "flex h-[14px] w-[14px] shrink-0 items-center justify-center",
          done ? "text-status-success" : "text-text-mute"
        )}
      >
        {done ? (
          <Check size={12} />
        ) : (
          <span className="h-[5px] w-[5px] rounded-full bg-current" />
        )}
      </span>
      <span className="uppercase tracking-wider text-text-3">{label}</span>
      <span className="ml-auto tabular-nums text-text-2">{value}</span>
    </div>
  );
}

export function ImportApplyPanel({
  status,
  customersToWrite,
  invoices,
  payments,
  needsReviewCount,
  appliedCount,
  onApply,
}: ImportApplyPanelProps) {
  const { t } = useDictionary("accounting");
  const blocked = needsReviewCount > 0;
  const done = status === "applied";
  const applying = status === "applying";
  const errored = status === "error";

  // ── Applying: honest, non-frozen background state ──────────────────────────
  if (applying) {
    return (
      <div
        data-testid="qbo-apply-progress"
        className="glass-surface rounded-panel p-3"
      >
        <div className="flex items-center gap-2">
          <Loader2
            size={14}
            className="animate-spin text-text-2 motion-reduce:animate-none"
          />
          <PanelTitle>{t("qbo.apply.progressTitle")}</PanelTitle>
        </div>

        {/* Indeterminate sweep — real progress isn't emitted, so we don't fake a
            percentage; the manifest below shows exactly what is being written. */}
        <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-bar bg-fill-neutral-dim">
          <div className="h-full w-1/3 rounded-bar bg-text-2 animate-shimmer motion-reduce:w-full motion-reduce:animate-none" />
        </div>

        <div className="mt-3 space-y-1.5">
          <ManifestRow label={t("qbo.records.customers")} value={customersToWrite} done={false} />
          <ManifestRow label={t("qbo.records.invoices")} value={invoices} done={false} />
          <ManifestRow label={t("qbo.records.payments")} value={payments} done={false} />
        </div>

        <p className="mt-3 font-mono text-micro text-text-mute">
          {t("qbo.apply.inProgressNote")}
        </p>
      </div>
    );
  }

  // ── Applied: written confirmation ──────────────────────────────────────────
  if (done) {
    return (
      <div className="glass-surface rounded-panel p-3">
        <div className="flex items-center gap-2 font-mono text-caption-sm text-status-success">
          <Check size={14} />
          <span>{t("qbo.applied", { count: appliedCount })}</span>
        </div>
      </div>
    );
  }

  // ── Error: nothing partial trusted; retry is idempotent ────────────────────
  if (errored) {
    return (
      <div className="glass-surface rounded-panel border-rose-line p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose" />
          <div className="space-y-2">
            <p className="font-mono text-caption-sm text-rose">{t("qbo.apply.errorTitle")}</p>
            <p className="font-mono text-micro text-text-3">{t("qbo.apply.errorBody")}</p>
            <Button variant="secondary" size="sm" onClick={onApply}>
              {t("qbo.apply.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Idle: confirm + (blocking hint) + primary CTA ──────────────────────────
  return (
    <div className="glass-surface rounded-panel p-3">
      <p className="font-mono text-caption-sm text-text-3">
        {t("qbo.applyConfirm", {
          customers: customersToWrite,
          invoices,
          payments,
        })}
      </p>
      {blocked && (
        <p
          data-testid="qbo-needs-review-hint"
          className="mt-2 flex items-center gap-1.5 font-mono text-caption-sm text-rose"
        >
          <Link2Off size={12} />
          {t("qbo.needsReviewBlock", { count: needsReviewCount })}
        </p>
      )}
      <div className="mt-2.5">
        <Button
          variant="primary"
          size="sm"
          onClick={onApply}
          disabled={blocked}
          data-testid="qbo-apply-button"
        >
          {t("qbo.apply.all")}
        </Button>
      </div>
    </div>
  );
}
