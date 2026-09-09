"use client";

import { CatalogPreviewSchema } from "@/lib/agent-control-plane/contracts/catalog-authoring";
import { useDictionary, useLocale } from "@/i18n/client";

/** Values and relationships come only from the sealed server proposal. */
export function CatalogChangesPreview({
  proposal,
  expiresAt,
}: {
  proposal: unknown;
  expiresAt: Date | null;
}) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const parsed = CatalogPreviewSchema.safeParse(proposal);
  if (!parsed.success)
    return (
      <p className="font-mohave text-body text-text-2">
        {t("catalogChanges.unavailable")}
      </p>
    );
  const p = parsed.data;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: p.currency,
    currencyDisplay: "code",
  });
  const format = (
    field: string,
    value: unknown,
    labels: Record<string, string>
  ): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (labels[field]) return labels[field];
    if (
      [
        "price",
        "cost",
        "minimum_charge",
        "effective_price",
        "effective_cost",
      ].includes(field)
    )
      return money.format(Number(value));
    if (typeof value === "number") return number.format(value);
    if (typeof value === "boolean")
      return t(`catalogChanges.${value ? "yes" : "no"}`);
    if (field === "choices" && Array.isArray(value))
      return value.map((v) => `${v.option}: ${v.value}`).join(" · ") || "—";
    if (["kind", "dimension", "pricing_unit"].includes(field))
      return t(`catalogChanges.values.${String(value)}`);
    return String(value);
  };
  return (
    <section
      className="min-w-0 space-y-3 break-words"
      aria-label={t("catalogChanges.title")}
    >
      <header className="space-y-1">
        <h3 className="font-cakemono text-body-sm font-light uppercase text-text-2">
          {t(`catalogChanges.${p.operation}`)}
        </h3>
        <p className="font-mohave text-body text-text">{p.source.name}</p>
        <p className="font-mohave text-body-sm text-text-2">
          {t("catalogChanges.sourceNotice")}
        </p>
        <p className="font-mono text-body-sm tabular-nums text-text">
          {p.currency}
        </p>
      </header>
      <div className="divide-y divide-border-subtle">
        {p.rows.map((row) => (
          <article key={row.row_key} className="space-y-2 py-2">
            <div className="space-y-1">
              <h4 className="font-mohave text-body text-text">
                {row.display_name}
              </h4>
              <p className="font-cakemono text-body-sm uppercase text-text-2">
                {t(`catalogChanges.entities.${row.entity}`)} ·{" "}
                {t(`catalogChanges.status.${row.status}`)}
              </p>
              <p className="font-mono text-micro text-text-3">
                {t("catalogChanges.sourceRow")} {row.source_row}
              </p>
            </div>
            <dl className="space-y-2">
              {Object.entries(row.after ?? {})
                .filter(
                  ([key, value]) =>
                    row.status === "create" ||
                    key === "reason" ||
                    JSON.stringify(
                      (row.before as Record<string, unknown> | null)?.[key]
                    ) !== JSON.stringify(value)
                )
                .map(([field, value]) => (
                  <div key={field} className="space-y-1">
                    <dt className="font-mohave text-body-sm text-text-2">
                      {t(`catalogChanges.fields.${field}`)}
                    </dt>
                    <dd className="font-mono text-body-sm tabular-nums text-text">
                      {row.before && (
                        <>
                          <span>
                            {format(
                              field,
                              (row.before as Record<string, unknown>)[field],
                              row.before_reference_labels
                            )}
                          </span>
                          <span aria-label={t("catalogChanges.to")}> → </span>
                        </>
                      )}
                      {format(field, value, row.reference_labels)}
                    </dd>
                  </div>
                ))}
            </dl>
            {row.issues.map((issue, index) => (
              <p key={index} className="font-mohave text-body-sm text-text-2">
                {issue}
              </p>
            ))}
          </article>
        ))}
      </div>
      {p.skipped_rows.length > 0 && (
        <div className="space-y-1 border-t border-border-subtle pt-2">
          <h4 className="font-cakemono text-body-sm uppercase text-text-2">
            {t("catalogChanges.skipped")}
          </h4>
          {p.skipped_rows.map((row, index) => (
            <p key={index} className="font-mohave text-body-sm text-text-2">
              {row.source_row} · {row.reason}
            </p>
          ))}
        </div>
      )}
      <p className="font-mohave text-body-sm text-text-2">
        {t(`catalogChanges.${p.operation}Boundary`)}
      </p>
      <p className="font-mohave text-body-sm text-text-2">
        {t("catalogChanges.noExternal")}
      </p>
      {expiresAt && (
        <p className="font-mono text-body-sm tabular-nums text-text-2">
          {t("catalogChanges.expires")}{" "}
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(expiresAt)}
        </p>
      )}
    </section>
  );
}
