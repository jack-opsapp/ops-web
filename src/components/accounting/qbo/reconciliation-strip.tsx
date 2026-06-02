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

function ReconRow({ spec, t }: { spec: RowSpec; t: (k: string) => string }) {
  const matched =
    spec.kind === "money" ? moneyEq(spec.qb, spec.ops) : spec.qb === spec.ops;
  const delta = spec.ops - spec.qb;
  const fmt = (n: number) =>
    spec.kind === "money" ? formatCurrency(n) : String(n);

  return (
    <div
      data-testid={`recon-row-${spec.id}`}
      className={cn(
        "grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-1.5 py-1 rounded",
        "font-mono text-data-sm tabular-nums",
        matched ? "text-status-success" : "text-[#B58289]"
      )}
    >
      <span className="text-text-3 uppercase tracking-wider text-caption-sm">
        {t(spec.labelKey)}
      </span>
      <span className="text-right tabular-nums">{fmt(spec.qb)}</span>
      <span className="text-right tabular-nums">{fmt(spec.ops)}</span>
      <span
        data-testid={`recon-delta-${spec.id}`}
        className="text-right tabular-nums w-[80px]"
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
 * counts mirror QB by construction and are therefore always matched. Rows turn
 * olive (`text-status-success`) when equal — to the cent on money, exact on
 * counts — and rose (`#B58289`) when a delta breaches.
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
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-1.5 pb-0.5 border-b border-border">
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
          {t("qbo.recon.title")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right">
          {t("qbo.recon.quickbooks")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right">
          {t("qbo.recon.ops")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right w-[80px]">
          {t("qbo.recon.delta")}
        </span>
      </div>
      {rows.map((spec) => (
        <ReconRow key={spec.id} spec={spec} t={t} />
      ))}
    </div>
  );
}
