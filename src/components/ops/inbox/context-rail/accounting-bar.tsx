"use client";

import { cn } from "@/lib/utils/cn";

interface AccountingBarProps {
  total: number;
  invoiced: number;
  paid: number;
  className?: string;
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.max(0, (part / total) * 100))}%`;
}

export function AccountingBar({
  total,
  invoiced,
  paid,
  className,
}: AccountingBarProps) {
  const paidPct = pct(paid, total);
  const invoicedRemainder = Math.max(0, invoiced - paid);
  const invoicedPct = pct(invoicedRemainder, total);

  return (
    <div
      data-testid="accounting-bar"
      className={cn(
        "relative h-1 w-full overflow-hidden rounded-[2.5px] bg-inbox-bg-deep",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={paid}
    >
      <span
        data-testid="accounting-bar-paid"
        className="absolute inset-y-0 left-0 bg-olive"
        style={{ width: paidPct }}
      />
      <span
        data-testid="accounting-bar-invoiced"
        className="absolute inset-y-0 bg-tan/[0.7]"
        style={{ left: paidPct, width: invoicedPct }}
      />
    </div>
  );
}
