"use client";

/**
 * AccountingTotals — the sticky 3-cell financial summary strip that
 * pins to the bottom of the ACCOUNTING tab body (spec § 6.4). Pure
 * presentation: takes three pre-summed dollar amounts and renders them
 * as tactical bracket-labeled metrics.
 *
 *   [OUTSTANDING] $2,847     [PAID 30D] $14,200     [OVERDUE] $0
 *        tan-tinted               olive-tinted        rose-tinted
 *                                                    (entire cell mutes
 *                                                     to text-mute when
 *                                                     overdue is zero —
 *                                                     no alarm when there's
 *                                                     nothing to alarm on)
 *
 * Sticky positioning is the caller's responsibility — AccountingView
 * adds `sticky bottom-0` so this strip floats above the scrollable
 * sections without any motion logic here.
 */

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface AccountingTotalsProps {
  /** Sum of invoices in OUTSTANDING state (sent/outstanding/pending), in
   *  dollars. */
  outstanding: number;
  /** Sum of invoices in PAID state with updatedAt within the trailing
   *  30 days, in dollars. */
  paid30d: number;
  /** Sum of invoices in OVERDUE state, in dollars. Zero mutes the entire
   *  cell (label + value) to text-mute — a positive number snaps to rose. */
  overdue: number;
  className?: string;
}

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

/**
 * Format an integer dollar value as `$X,XXX`. Drops cents — operator
 * doesn't need decimal precision in a peek surface, and the source
 * `numeric` columns can carry fractional cents we'd rather hide.
 */
function formatCurrency(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-$${abs}` : `$${abs}`;
}

export function AccountingTotals({
  outstanding,
  paid30d,
  overdue,
  className,
}: AccountingTotalsProps) {
  const { t } = useDictionary("inbox");
  const overdueMuted = overdue === 0;

  return (
    <div
      data-testid="accounting-totals"
      className={cn(
        "flex items-baseline gap-4 border-t border-line bg-inbox-panel px-3.5 py-3",
        className,
      )}
    >
      <Cell
        label={t("rail.totalOutstanding", "[OUTSTANDING]")}
        value={formatCurrency(outstanding)}
        valueClassName="text-tan"
      />
      <Cell
        label={t("rail.totalPaid30d", "[PAID 30D]")}
        value={formatCurrency(paid30d)}
        valueClassName="text-olive"
      />
      <Cell
        label={t("rail.totalOverdue", "[OVERDUE]")}
        value={formatCurrency(overdue)}
        valueClassName={overdueMuted ? "text-text-mute" : "text-rose"}
        labelClassName={overdueMuted ? "text-text-mute" : undefined}
        testId="accounting-totals-overdue"
      />
    </div>
  );
}

interface CellProps {
  label: string;
  value: string;
  /** Tone class on the value (text-tan / text-olive / text-rose /
   *  text-text-mute when overdue is zero). */
  valueClassName: string;
  /** Optional override on the label — used to mute the OVERDUE label
   *  alongside the value when the metric is zero. Default keeps the
   *  shared `text-text-mute` label tone. */
  labelClassName?: string;
  testId?: string;
}

function Cell({ label, value, valueClassName, labelClassName, testId }: CellProps) {
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <span
        className={cn(
          "font-mono text-[11px] uppercase tracking-[0.14em]",
          labelClassName ?? "text-text-mute",
        )}
        style={TNUM_ZERO}
      >
        {label}
      </span>
      <span
        className={cn("font-mono text-[13px] font-medium", valueClassName)}
        style={TNUM_ZERO}
      >
        {value}
      </span>
    </div>
  );
}
