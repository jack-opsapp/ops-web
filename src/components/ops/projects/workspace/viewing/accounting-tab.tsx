"use client";

import * as React from "react";
import {
  useProjectPipeline,
  type ProjectPipelineSummary,
} from "@/lib/hooks/use-project-pipeline";
import {
  useProjectLedger,
  type LedgerRow,
  type LedgerStatusTone,
  type LedgerAmountTone,
} from "@/lib/hooks/use-project-ledger";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Hairline } from "@/components/ops/projects/workspace/atoms/hairline";
import { Chip, type ChipVariant } from "@/components/ops/projects/workspace/atoms/chip";
import { formatCurrency } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

// `AccountingTab` — 4-cell pipeline + chronological ledger.
//
// Pipeline cells: QUOTED · INVOICED · RECEIVED · OUTSTANDING
//   - Each cell shows the headline currency value (mono tabular) above a
//     ghost meta line (record id, change-order count, deposit %, age).
//   - Currency uses formatCurrency(USD); empty cells render — (em-dash) so
//     the grid stays geometrically intact.
//
// Ledger: useProjectLedger merges estimates + invoices + change orders +
// payments + expenses, sorts desc by date, tone-codes status. Negative
// amounts (payments, expenses) lean rose/olive — amountTone from the hook.
// Empty state is dim. We never show "$0.00" for a missing total — show —.

interface AccountingTabProps {
  projectId: string;
}

const STATUS_TONE_TO_CHIP: Record<LedgerStatusTone, ChipVariant> = {
  neutral: "neutral",
  olive: "olive",
  tan: "tan",
  rose: "rose",
  accent: "accent",
};

const SOURCE_KEY: Record<LedgerRow["source"], string> = {
  estimate: "accounting.source.estimate",
  invoice: "accounting.source.invoice",
  change_order: "accounting.source.changeOrder",
  payment: "accounting.source.payment",
  expense: "accounting.source.expense",
};

function moneyOrDash(amount: number | null): string {
  if (amount == null || Number.isNaN(amount) || amount === 0) return "—";
  return formatCurrency(Math.abs(amount));
}

function PipelineCell({
  label,
  amount,
  meta,
  tone,
  testId,
}: {
  label: string;
  amount: number;
  meta?: React.ReactNode;
  tone?: "default" | "olive" | "rose";
  testId: string;
}) {
  const amountColor =
    tone === "olive"
      ? "var(--olive)"
      : tone === "rose"
        ? "var(--rose)"
        : "var(--text)";
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 border-r border-glass-border px-3 py-2 last:border-r-0"
    >
      <Mono color="text-3" size={9}>
        {label}
      </Mono>
      <span
        className="font-mono text-[18px] leading-[1.1] tabular-nums tracking-[0.02em]"
        style={{
          color: amount === 0 ? "var(--text-3)" : amountColor,
          fontFeatureSettings: '"tnum" 1, "zero" 1',
        }}
      >
        {moneyOrDash(amount)}
      </span>
      {meta ? <div className="min-h-[12px]">{meta}</div> : <div className="min-h-[12px]" />}
    </div>
  );
}

function PipelineGrid({ summary }: { summary: ProjectPipelineSummary }) {
  const { t } = useDictionary("project-workspace");
  const ageMeta = (() => {
    if (!summary.outstanding.daysAged && !summary.outstanding.dueDate) return null;
    if (summary.outstanding.daysAged != null && summary.outstanding.daysAged > 0) {
      return (
        <Mono
          color={summary.outstanding.daysAged > 30 ? "rose" : "tan"}
          size={9}
        >
          {t("accounting.pipeline.overdueTemplate").replace(
            "{n}",
            String(summary.outstanding.daysAged),
          )}
        </Mono>
      );
    }
    if (summary.outstanding.dueDate) {
      return (
        <Mono color="text-3" size={9}>
          {t("accounting.pipeline.dueTemplate").replace(
            "{date}",
            formatDate(summary.outstanding.dueDate, "MMM d").toUpperCase(),
          )}
        </Mono>
      );
    }
    return null;
  })();

  return (
    <div
      data-testid="pipeline-grid"
      className="grid grid-cols-4 rounded border border-glass-border bg-[var(--surface-vignette)]"
    >
      <PipelineCell
        testId="pipeline-cell-quoted"
        label={t("accounting.pipeline.quoted")}
        amount={summary.quoted.total}
        meta={
          summary.quoted.recordId ? (
            <Mono color="text-3" size={9}>{summary.quoted.recordId}</Mono>
          ) : null
        }
      />
      <PipelineCell
        testId="pipeline-cell-invoiced"
        label={t("accounting.pipeline.invoiced")}
        amount={summary.invoiced.total}
        meta={
          summary.invoiced.changeOrdersCount > 0 ? (
            <Mono color="tan" size={9}>
              {t("accounting.pipeline.changeOrdersTemplate").replace(
                "{n}",
                String(summary.invoiced.changeOrdersCount),
              )}
            </Mono>
          ) : summary.invoiced.recordId ? (
            <Mono color="text-3" size={9}>{summary.invoiced.recordId}</Mono>
          ) : null
        }
      />
      <PipelineCell
        testId="pipeline-cell-received"
        label={t("accounting.pipeline.received")}
        amount={summary.received.total}
        tone={summary.received.total > 0 ? "olive" : "default"}
        meta={
          summary.received.depositPct != null ? (
            <Mono color="olive" size={9}>
              {t("accounting.pipeline.depositTemplate").replace(
                "{pct}",
                String(Math.round(summary.received.depositPct)),
              )}
            </Mono>
          ) : summary.received.recordId ? (
            <Mono color="text-3" size={9}>{summary.received.recordId}</Mono>
          ) : null
        }
      />
      <PipelineCell
        testId="pipeline-cell-outstanding"
        label={t("accounting.pipeline.outstanding")}
        amount={summary.outstanding.total}
        tone={
          summary.outstanding.daysAged != null && summary.outstanding.daysAged > 30
            ? "rose"
            : "default"
        }
        meta={ageMeta}
      />
    </div>
  );
}

function AmountColor(tone: LedgerAmountTone): string {
  if (tone === "olive") return "var(--olive)";
  if (tone === "rose") return "var(--rose)";
  return "var(--text)";
}

function LedgerRowItem({ row }: { row: LedgerRow }) {
  const { t } = useDictionary("project-workspace");
  return (
    <div data-testid="ledger-row" data-source={row.source} className="flex items-center gap-3 py-2">
      <Mono color="mute" size={9} className="w-[60px] shrink-0">
        {row.date ? formatDate(row.date, "MMM d").toUpperCase() : "—"}
      </Mono>
      <Mono color="text-3" size={9} className="w-[112px] shrink-0">
        {t(SOURCE_KEY[row.source])}
      </Mono>
      <div className="min-w-0 flex-1">
        <Inline gap={1.5} align="baseline" wrap>
          <Body size={14} color="text" className="truncate">
            {row.description}
          </Body>
          <Mono color="text-3" size={9}>{row.recordId}</Mono>
        </Inline>
      </div>
      <Chip variant={STATUS_TONE_TO_CHIP[row.statusTone]} size="sm" className="shrink-0">
        {row.status.replace(/_/g, " ").toUpperCase()}
      </Chip>
      <span
        className={cn("w-[112px] shrink-0 text-right font-mono text-[13px] tabular-nums")}
        style={{
          color: AmountColor(row.amountTone),
          fontFeatureSettings: '"tnum" 1, "zero" 1',
        }}
      >
        {row.amount < 0 ? "-" : ""}
        {formatCurrency(Math.abs(row.amount))}
      </span>
    </div>
  );
}

export function AccountingTab({ projectId }: AccountingTabProps) {
  const { t } = useDictionary("project-workspace");
  const pipeline = useProjectPipeline(projectId);
  const ledger = useProjectLedger(projectId);

  const summary = pipeline.data ?? {
    quoted: { total: 0, recordId: null },
    invoiced: { total: 0, recordId: null, changeOrdersCount: 0 },
    received: { total: 0, recordId: null, depositPct: null },
    outstanding: { total: 0, dueDate: null, daysAged: null },
  };
  const rows = ledger.data ?? [];

  return (
    <Stack gap={4} className="px-4 py-3">
      <Section title={t("accounting.pipeline.section")}>
        <div className="pt-1">
          <PipelineGrid summary={summary} />
        </div>
      </Section>

      <Section
        title={t("accounting.ledger.section")}
        rightSlot={<Mono color="text-3" size={9}>{`${rows.length}`}</Mono>}
      >
        {ledger.isLoading ? (
          <Body size={14} color="text-3" className="py-6">
            {t("accounting.ledger.loading")}
          </Body>
        ) : rows.length === 0 ? (
          <Body size={14} color="text-3" className="py-6">
            {t("accounting.ledger.empty")}
          </Body>
        ) : (
          <>
            <Hairline variant="dashed" className="mb-1" />
            <div className="divide-y divide-glass-border">
              {rows.map((r) => (
                <LedgerRowItem key={`${r.source}-${r.recordId}-${r.date}`} row={r} />
              ))}
            </div>
          </>
        )}
      </Section>
    </Stack>
  );
}
