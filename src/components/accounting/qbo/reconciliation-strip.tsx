"use client";

import { useDictionary } from "@/i18n/client";
import { formatCurrency } from "@/lib/types/pipeline";
import { cn } from "@/lib/utils/cn";
import type { QboImportReview } from "@/lib/types/qbo-import";

type Recon = QboImportReview["reconciliation"];

// Money equality to the cent (avoids float dust from summed line totals).
function moneyEq(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

interface RowSpec {
  id: string;
  labelKey: string;
  qb: number;
  ops: number;
  kind: "money" | "count";
}

const GRID = "grid grid-cols-[10px_minmax(0,1fr)_auto_auto_88px] items-center gap-3";

function ReconRow({ spec, t }: { spec: RowSpec; t: (k: string) => string }) {
  const matched =
    spec.kind === "money" ? moneyEq(spec.qb, spec.ops) : spec.qb === spec.ops;
  const delta = spec.ops - spec.qb;
  const fmt = (n: number) =>
    spec.kind === "money" ? formatCurrency(n) : String(n);

  return (
    <div
      data-testid={`recon-row-${spec.id}`}
      data-matched={matched ? "true" : "false"}
      className={cn(GRID, "px-1.5 py-1 rounded font-mono text-data-sm tabular-nums")}
    >
      {/* Status pip — carries the matched/breach signal independently of color (a11y). */}
      <span
        aria-hidden
        className={cn(
          "h-[6px] w-[6px] rounded-full",
          matched ? "bg-status-success" : "bg-rose"
        )}
      />
      <span className="truncate text-text-3 uppercase tracking-wider text-caption-sm">
        {t(spec.labelKey)}
      </span>
      <span className={cn("text-right tabular-nums", matched ? "text-text-2" : "text-rose")}>
        {fmt(spec.qb)}
      </span>
      <span className={cn("text-right tabular-nums", matched ? "text-text" : "text-rose")}>
        {fmt(spec.ops)}
      </span>
      <span
        data-testid={`recon-delta-${spec.id}`}
        className={cn(
          "text-right tabular-nums",
          matched ? "text-text-mute" : "text-rose"
        )}
      >
        {matched ? "—" : fmt(Math.abs(delta))}
      </span>
    </div>
  );
}

/**
 * QuickBooks-vs-OPS reconciliation strip. Because QB is authoritative in the
 * read-only model, OPS mirrors QB on apply: A/R compares `qbOpenAr` against
 * `opsToBeOpenAr` (the only independent pair), while collected + customer
 * counts mirror QB by construction and are therefore always matched. Each row
 * carries an olive pip when equal — to the cent on money, exact on counts — and
 * a rose pip + rose figures when a delta breaches.
 */
export function ReconciliationStrip({ recon }: { recon: Recon }) {
  const { t } = useDictionary("accounting");

  const rows: RowSpec[] = [
    {
      id: "openAr",
      labelKey: "qbo.recon.openAr",
      qb: recon.qbOpenAr,
      ops: recon.opsToBeOpenAr,
      kind: "money",
    },
    {
      // # open invoices — OPS mirrors QB on apply, so this count is matched by
      // construction (spec §9.2).
      id: "openInvoices",
      labelKey: "qbo.recon.openInvoices",
      qb: recon.openInvoiceCount,
      ops: recon.openInvoiceCount,
      kind: "count",
    },
    {
      id: "collected24mo",
      labelKey: "qbo.recon.collected24mo",
      qb: recon.collectedInWindow,
      ops: recon.collectedInWindow,
      kind: "money",
    },
    {
      id: "customers",
      labelKey: "qbo.recon.customers",
      qb: recon.customerCount,
      ops: recon.customerCount,
      kind: "count",
    },
  ];

  return (
    <div className="space-y-0.5">
      <div className={cn(GRID, "px-1.5 pb-1 border-b border-border")}>
        <span />
        <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">
          <span className="text-text-mute">{"// "}</span>
          {t("qbo.recon.title")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right">
          {t("qbo.recon.quickbooks")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right">
          {t("qbo.recon.ops")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right">
          {t("qbo.recon.delta")}
        </span>
      </div>
      {rows.map((spec) => (
        <ReconRow key={spec.id} spec={spec} t={t} />
      ))}
    </div>
  );
}
