import type { CollectionsDraftPreview as CollectionsDraftPreviewData } from "@/lib/agent-control-plane/contracts/collections";

export interface CollectionsDraftPreviewLabels {
  readonly reviewHeading: string;
  readonly notSent: string;
  readonly recipient: string;
  readonly asOf: string;
  readonly oldestDue: string;
  readonly daysPastDue: string;
  readonly balances: string;
  readonly invoices: string;
  readonly invoice: string;
  readonly due: string;
  readonly aging: string;
  readonly balance: string;
  readonly subject: string;
  readonly body: string;
  readonly approvalSeal: string;
}

interface CollectionsDraftPreviewProps {
  readonly preview: CollectionsDraftPreviewData;
  readonly previewSha256: string;
  readonly locale: string;
  readonly labels: CollectionsDraftPreviewLabels;
}

function money(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function agingLabel(
  bucket: CollectionsDraftPreviewData["escalation_tier"]
): string {
  switch (bucket) {
    case "current":
      return "CURRENT";
    case "1_30":
      return "1–30";
    case "31_60":
      return "31–60";
    case "61_90":
      return "61–90";
    case "91_plus":
      return "91+";
  }
}

export function CollectionsDraftPreview({
  preview,
  previewSha256,
  locale,
  labels,
}: CollectionsDraftPreviewProps) {
  return (
    <section
      aria-label={labels.reviewHeading}
      className="space-y-4 rounded-chip border border-border-subtle bg-fill-neutral-dim p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mohave text-body-sm uppercase text-text">
            {labels.reviewHeading}
          </p>
          <p className="font-mono text-caption text-text-2">
            {preview.customer_display_name}
          </p>
        </div>
        <span className="rounded-bar border border-border-subtle bg-fill-neutral px-2 py-1 font-mono text-micro uppercase text-text-2">
          {labels.notSent}
        </span>
      </header>

      <dl className="grid gap-3 border-y border-border-subtle py-3 md:grid-cols-4">
        <div>
          <dt className="font-mono text-micro uppercase text-text-3">
            {labels.recipient}
          </dt>
          <dd className="font-mono text-caption text-text-2">
            {preview.recipient.display_name}
          </dd>
          <dd className="font-mono text-micro text-text-3">
            {preview.recipient.address}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase text-text-3">
            {labels.asOf}
          </dt>
          <dd className="font-mono text-caption tabular-nums text-text-2">
            {preview.as_of_date}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase text-text-3">
            {labels.oldestDue}
          </dt>
          <dd className="font-mono text-caption tabular-nums text-text-2">
            {preview.oldest_due_date}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase text-text-3">
            {labels.daysPastDue}
          </dt>
          <dd className="font-mono text-caption tabular-nums text-text-2">
            {preview.max_days_past_due} · {agingLabel(preview.escalation_tier)}
          </dd>
        </div>
      </dl>

      <div>
        <p className="font-mono text-micro uppercase text-text-3">
          {labels.balances}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {preview.balances.map((balance) => (
            <span
              key={balance.currency}
              className="rounded-bar border border-border-subtle px-2 py-1 font-mono text-caption tabular-nums text-text-2"
            >
              {money(balance.amount_minor, balance.currency, locale)} ·{" "}
              {balance.currency}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="font-mono text-micro uppercase text-text-3">
          {labels.invoices}
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-subtle font-mono text-micro uppercase text-text-3">
                <th className="py-2 pr-3 font-normal">{labels.invoice}</th>
                <th className="px-3 py-2 font-normal">{labels.due}</th>
                <th className="px-3 py-2 font-normal">{labels.aging}</th>
                <th className="py-2 pl-3 text-right font-normal">
                  {labels.balance}
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.invoices.map((invoice) => (
                <tr
                  key={invoice.invoice_ref.id}
                  className="border-b border-border-subtle font-mono text-caption text-text-2 last:border-b-0"
                >
                  <td className="py-2 pr-3">{invoice.document_number}</td>
                  <td className="px-3 py-2 tabular-nums">{invoice.due_date}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {invoice.days_past_due} · {agingLabel(invoice.aging_bucket)}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {money(
                      invoice.balance_due.amount_minor,
                      invoice.balance_due.currency,
                      locale
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 border-t border-border-subtle pt-3">
        <div>
          <p className="font-mono text-micro uppercase text-text-3">
            {labels.subject}
          </p>
          <p className="font-mono text-caption text-text-2">
            {preview.subject}
          </p>
        </div>
        <div>
          <p className="font-mono text-micro uppercase text-text-3">
            {labels.body}
          </p>
          <p className="whitespace-pre-wrap font-mono text-caption text-text-2">
            {preview.body}
          </p>
        </div>
      </div>

      <footer className="space-y-2 border-t border-border-subtle pt-3">
        <p className="font-mono text-micro text-text-3">
          {preview.truth_boundary}
        </p>
        <div>
          <p className="font-mono text-micro uppercase text-text-3">
            {labels.approvalSeal}
          </p>
          <p className="break-all font-mono text-micro text-text-2">
            {previewSha256}
          </p>
        </div>
      </footer>
    </section>
  );
}
