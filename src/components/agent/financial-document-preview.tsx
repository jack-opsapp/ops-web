"use client";

import { FinancialDocumentPreviewSchema } from "@/lib/agent-control-plane/contracts/financial-document";
import { useDictionary, useLocale } from "@/i18n/client";

/** Render only the sealed server preview. Browser formatting never calculates money. */
export function FinancialDocumentPreview({ proposal }: { proposal: unknown }) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const parsed = FinancialDocumentPreviewSchema.safeParse(proposal);
  if (!parsed.success)
    return (
      <p className="font-mohave text-body text-text-2">
        {t("financialDocument.unavailable")}
      </p>
    );
  const p = parsed.data;
  const r = p.request;
  const money = (value: string) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: r.currency,
      currencyDisplay: "code",
    }).format(Number(value));
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(`${value}T00:00:00Z`));
  const heading = "font-cakemono text-body-sm font-light uppercase text-text-2";
  const value = "font-mono text-body-sm tabular-nums text-text";
  return (
    <section
      className="min-w-0 space-y-3 break-words"
      aria-label={t("financialDocument.title")}
    >
      <header className="space-y-1">
        <h3 className={heading}>{t(`financialDocument.${r.document_kind}`)}</h3>
        <p className="font-mohave text-body text-text">{r.title}</p>
        <p className="font-mohave text-body text-text-2">
          {p.client_name} · {p.target_name}
        </p>
        <p className={value}>
          {t("financialDocument.version")} {p.document_version} · {r.currency}
        </p>
        <p className={value}>
          {t("financialDocument.issue")} {date(r.issue_date)}
        </p>
        <p className={value}>
          {t("financialDocument.expiry")} {date(r.expiration_date)}
        </p>
      </header>
      {(["inclusions", "exclusions", "client_message", "terms"] as const).map(
        (key) => (
          <div key={key} className="space-y-1">
            <h4 className={heading}>{t(`financialDocument.${key}`)}</h4>
            <p className="whitespace-pre-wrap font-mohave text-body text-text">
              {r[key] || "—"}
            </p>
          </div>
        )
      )}
      <div className="space-y-1">
        <h4 className={heading}>{t("financialDocument.scope")}</h4>
        <blockquote className="whitespace-pre-wrap border-l border-border-subtle pl-2 font-mohave text-body text-text-2">
          {r.scope_evidence.statement}
        </blockquote>
        <p className="break-all font-mono text-micro text-text-3">
          {r.scope_evidence.reference_id ?? t("financialDocument.operator")}
        </p>
      </div>
      <div className="divide-y divide-border-subtle">
        {p.lines.map((line) => {
          const input = r.lines[line.position];
          return (
            <article key={line.position} className="space-y-1 py-2">
              <h4 className="font-mohave text-body text-text">{input.name}</h4>
              {input.description && (
                <p className="whitespace-pre-wrap font-mohave text-body text-text-2">
                  {input.description}
                </p>
              )}
              <p className={value}>
                {input.quantity} {input.unit} × {money(line.unit_price)}
              </p>
              <dl className="grid grid-cols-2 gap-1">
                <dt className="font-mohave text-body-sm text-text-2">
                  {t("financialDocument.unitPrice")}
                </dt>
                <dd className={value}>
                  {money(line.source_unit_price)} → {money(line.unit_price)}
                </dd>
                <dt className="font-mohave text-body-sm text-text-2">
                  {t("financialDocument.minimum")}
                </dt>
                <dd className={value}>
                  {money(line.source_minimum_charge)} →{" "}
                  {money(line.minimum_charge)}
                </dd>
                <dt className="font-mohave text-body-sm text-text-2">
                  {t("financialDocument.discount")}
                </dt>
                <dd className={value}>{input.discount_percent}%</dd>
                <dt className="font-mohave text-body-sm text-text-2">
                  {t("financialDocument.subtotal")}
                </dt>
                <dd className={value}>{money(line.line_total)}</dd>
                <dt className="font-mohave text-body-sm text-text-2">
                  {input.is_taxable
                    ? t("financialDocument.tax")
                    : t("financialDocument.nonTaxable")}
                </dt>
                <dd className={value}>{money(line.tax_amount)}</dd>
              </dl>
              <p className="font-mohave text-body-sm text-text-2">
                {t(`financialDocument.${line.source_kind}`)}
              </p>
              {input.source.reference_id && (
                <p className="break-all font-mono text-micro text-text-3">
                  {input.source.reference_id}
                </p>
              )}
            </article>
          );
        })}
      </div>
      <p className="font-mohave text-body text-text-2">
        <span className={value}>+{r.increase_percent}% </span>
        {t("financialDocument.adjustment")}
      </p>
      <dl className="grid grid-cols-2 gap-2 border-t border-border-subtle pt-2">
        {p.baseline_total && (
          <>
            <dt className={heading}>{t("financialDocument.baseline")}</dt>
            <dd className={value}>{money(p.baseline_total)}</dd>
          </>
        )}
        {p.previous_total && (
          <>
            <dt className={heading}>{t("financialDocument.previous")}</dt>
            <dd className={value}>{money(p.previous_total)}</dd>
          </>
        )}
        <dt className={heading}>{t("financialDocument.subtotal")}</dt>
        <dd className={value}>{money(p.subtotal)}</dd>
        <dt className={heading}>{p.tax_name}</dt>
        <dd className={value}>{money(p.tax_amount)}</dd>
        <dt className={heading}>{t("financialDocument.total")}</dt>
        <dd className={value}>{money(p.total)}</dd>
      </dl>
      {p.previous_revision && (
        <details className="space-y-2 border-t border-border-subtle pt-2">
          <summary className="cursor-pointer font-cakemono text-body-sm font-light uppercase text-text-2 focus-visible:outline-ops-accent">
            {t("financialDocument.previousDocument")}
          </summary>
          <p className={value}>
            {p.previous_revision.number} · {t("financialDocument.version")}{" "}
            {p.previous_revision.version}
          </p>
          {(
            [
              "title",
              "inclusions",
              "exclusions",
              "client_message",
              "terms",
            ] as const
          ).map((key) => (
            <div key={key}>
              <h4 className={heading}>{t(`financialDocument.${key}`)}</h4>
              <p className="whitespace-pre-wrap font-mohave text-body text-text">
                {p.previous_revision![key] || "—"}
              </p>
            </div>
          ))}
          {p.previous_revision.lines.map((line, index) => (
            <article
              key={index}
              className="space-y-1 border-t border-border-subtle py-2"
            >
              <p className="font-mohave text-body text-text">{line.name}</p>
              <p className="whitespace-pre-wrap font-mohave text-body text-text-2">
                {line.description}
              </p>
              <p className={value}>
                {line.quantity} {line.unit} × {money(line.unit_price)}
              </p>
              <p className={value}>
                {t("financialDocument.minimum")} {money(line.minimum_charge)} ·{" "}
                {t("financialDocument.discount")} {line.discount_percent}%
              </p>
              <p className={value}>
                {t("financialDocument.subtotal")} {money(line.line_total)} ·{" "}
                {line.is_taxable
                  ? t("financialDocument.taxable")
                  : t("financialDocument.nonTaxable")}
              </p>
            </article>
          ))}
          <p className={value}>
            {t("financialDocument.issue")}{" "}
            {date(p.previous_revision.issue_date)} ·{" "}
            {t("financialDocument.expiry")}{" "}
            {p.previous_revision.expiration_date
              ? date(p.previous_revision.expiration_date)
              : "—"}
          </p>
          <p className={value}>
            {t("financialDocument.subtotal")}{" "}
            {money(p.previous_revision.subtotal)} · {t("financialDocument.tax")}{" "}
            {money(p.previous_revision.tax_amount)} ·{" "}
            {t("financialDocument.total")} {money(p.previous_revision.total)}
          </p>
        </details>
      )}
      <p className="font-mohave text-body text-text-2">
        {t("financialDocument.effects")}
      </p>
      <p className="break-all font-mono text-micro text-text-3">
        {t("financialDocument.policy")} {r.policy_id}
      </p>
      <p className="font-mono text-micro text-text-3">
        {t("financialDocument.approvalExpiry")}{" "}
        {new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(p.expires_at))}{" "}
        UTC
      </p>
    </section>
  );
}
