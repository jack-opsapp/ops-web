"use client";

import { useDictionary } from "@/i18n/client";
import { useClientFinancials } from "@/lib/hooks";
import { InvoiceStatus, type Invoice } from "@/lib/types/pipeline";
import { formatCurrency, formatEnumLabel } from "@/lib/utils/format";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Tag } from "@/components/ui/tag";

type TagVariant = "neutral" | "olive" | "tan" | "rose" | "dim" | "mute";

function statusTone(status: InvoiceStatus): TagVariant {
  switch (status) {
    case InvoiceStatus.Paid:
      return "olive";
    case InvoiceStatus.PastDue:
      return "rose";
    case InvoiceStatus.PartiallyPaid:
    case InvoiceStatus.AwaitingPayment:
      return "tan";
    case InvoiceStatus.Draft:
    case InvoiceStatus.Void:
      return "dim";
    case InvoiceStatus.WrittenOff:
      return "mute";
    default:
      return "neutral";
  }
}

function Metric({
  label,
  value,
  tone = "text",
}: {
  label: string;
  value: string;
  tone?: "text" | "olive" | "rose";
}) {
  const valueClass =
    tone === "olive"
      ? "text-olive"
      : tone === "rose"
        ? "text-rose"
        : "text-text";
  return (
    <div className="rounded-[6px] bg-surface-input px-2.5 py-2">
      <Mono size={10} color="text-3" className="block">
        {label}
      </Mono>
      <span className={`mt-0.5 block font-mono text-[15px] font-medium tabular-nums ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const owed = invoice.balanceDue > 0;
  return (
    <Inline justify="between" align="center" className="py-2">
      <Inline gap={1.5} align="center" className="min-w-0">
        <span className="font-mono text-[13px] tabular-nums text-text">
          {invoice.invoiceNumber}
        </span>
        <Tag variant={statusTone(invoice.status)}>
          {formatEnumLabel(invoice.status)}
        </Tag>
      </Inline>
      <span
        className={`shrink-0 font-mono text-[13px] tabular-nums ${
          owed ? "text-rose" : "text-text-3"
        }`}
      >
        {owed ? formatCurrency(invoice.balanceDue) : formatCurrency(invoice.total)}
      </span>
    </Inline>
  );
}

export function MoneyTab({ clientId }: { clientId: string }) {
  const { t } = useDictionary("clients");
  const fin = useClientFinancials(clientId);

  if (!fin.canView) {
    return (
      <div className="p-5">
        <Mono size={11} color="mute">
          {t("money.locked")}
        </Mono>
      </div>
    );
  }

  const paidPct =
    fin.invoiced > 0 ? Math.min(100, Math.round((fin.paid / fin.invoiced) * 100)) : 0;

  return (
    <Stack gap={3} className="p-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={t("money.invoiced")} value={formatCurrency(fin.invoiced)} />
        <Metric label={t("money.paid")} value={formatCurrency(fin.paid)} tone="olive" />
        <Metric
          label={t("money.outstanding")}
          value={formatCurrency(fin.outstanding)}
          tone={fin.outstanding > 0 ? "rose" : "text"}
        />
        <Metric
          label={t("money.overdue")}
          value={formatCurrency(fin.overdueBalance)}
          tone={fin.overdueBalance > 0 ? "rose" : "text"}
        />
      </div>

      {fin.invoiced > 0 && (
        <div
          className="flex h-1 overflow-hidden rounded-bar bg-fill-neutral-dim"
          role="img"
          aria-label={`${paidPct}%`}
        >
          <div className="h-full bg-olive" style={{ width: `${paidPct}%` }} />
          {fin.outstanding > 0 && (
            <div className="h-full flex-1 bg-rose/60" />
          )}
        </div>
      )}

      <Section title={t("money.invoices")}>
        {fin.invoices.length === 0 ? (
          <Mono size={11} color="mute" className="py-1">
            {t("money.empty")}
          </Mono>
        ) : (
          <Stack gap={0} className="divide-y divide-glass-border">
            {fin.invoices.map((inv) => (
              <InvoiceRow key={inv.id} invoice={inv} />
            ))}
          </Stack>
        )}
      </Section>
    </Stack>
  );
}
