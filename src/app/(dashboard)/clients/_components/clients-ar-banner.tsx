"use client";

import { ArrowRight } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { formatCurrency } from "@/lib/utils/format";

/**
 * A/R banner — the Direction-B signature. The one actionable number on the
 * Clients surface: how much is owed, by how many, and how stale the oldest
 * debt is. Rose carries the "money at risk" semantics (the owner's pain).
 * [CHASE →] filters the roster to the clients who owe. Rendered by the page
 * only when the operator can see invoices AND someone actually owes.
 */
export function ClientsArBanner({
  clientsOwing,
  amount,
  oldestDueDate,
  onChase,
}: {
  clientsOwing: number;
  amount: number;
  oldestDueDate: Date | null;
  onChase: () => void;
}) {
  const { t } = useDictionary("clients");

  const days = oldestDueDate
    ? Math.max(0, Math.floor((Date.now() - oldestDueDate.getTime()) / 86_400_000))
    : 0;

  const summary =
    clientsOwing === 1
      ? t("ar.oweOne", { count: String(clientsOwing), amount: formatCurrency(amount) })
      : t("ar.owe", { count: String(clientsOwing), amount: formatCurrency(amount) });

  return (
    <div className="flex items-center gap-3 rounded-panel border border-rose-line bg-rose-soft px-3 py-2">
      <span className="font-mono text-micro uppercase tracking-[0.12em] tabular-nums text-rose">
        <span aria-hidden className="text-text-mute">
          {"// "}
        </span>
        {summary}
        {days > 0 ? ` — ${t("ar.oldest", { days: String(days) })}` : ""}
      </span>
      <button
        type="button"
        onClick={onChase}
        className="ml-auto inline-flex items-center gap-1 font-mono text-micro uppercase tracking-[0.12em] text-text-2 transition-colors duration-150 ease-smooth hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent rounded-[3px]"
      >
        {t("ar.chase")}
        <ArrowRight className="h-[12px] w-[12px]" aria-hidden />
      </button>
    </div>
  );
}
