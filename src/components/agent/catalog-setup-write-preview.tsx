"use client";
import { CatalogSetupWritePreviewSchema } from "@/lib/agent-control-plane/contracts/catalog-setup-write";
import { useDictionary, useLocale } from "@/i18n/client";

/**
 * One review surface for every catalogue setup write kind.
 *
 * A create has no symmetric "before" — the operator is not comparing two
 * versions of a row, they are deciding whether one new row should exist. So the
 * family's current shape is a single context line, and the new row is a
 * definition list of exactly the fields that can hurt: what it is, what it
 * sells for, what it costs, when it warns, and how much arrives with it. Fields
 * the request did not set are shown as `—` rather than hidden, because an
 * absent threshold and a zero threshold are different answers.
 *
 * A later kind (thresholds, pricing, supplier cost, option) adds a branch on
 * `proposal.kind` beside the create branch; the header, effects, evidence and
 * expiry blocks below are already shared.
 */
export function CatalogSetupWritePreview({ proposal }: { proposal: unknown }) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const parsed = CatalogSetupWritePreviewSchema.safeParse(proposal);
  if (!parsed.success)
    return (
      <p role="alert" className="font-mohave text-body-sm text-rose">
        {t("catalogSetupWrite.invalid")}
      </p>
    );
  const { family, before, after, effects, evidence, expires_at } = parsed.data;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));
  const money = (amount: string | null) => {
    if (amount === null) return null;
    const value = Number.parseFloat(amount);
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: after.currency,
      }).format(value);
    } catch {
      // A company currency Intl does not know is still a number worth showing.
      return `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
      }).format(value)} ${after.currency}`;
    }
  };

  const identity = after.variant.option_values
    .map((entry) => entry.value)
    .join(" / ");
  const rows: Array<[string, string | null, boolean]> = [
    ["identity", identity, false],
    ["sku", after.variant.sku, true],
    [
      "salePrice",
      money(after.variant.sale_price) === null
        ? null
        : `${money(after.variant.sale_price)} · ${t(
            after.variant.sale_price_source === "variant_override"
              ? "catalogSetupWrite.priceOwn"
              : "catalogSetupWrite.priceInherited"
          )}`,
      true,
    ],
    ["unitCost", money(after.variant.unit_cost), true],
    ["warning", after.variant.warning_threshold, true],
    ["critical", after.variant.critical_threshold, true],
    [
      "openingStock",
      after.opening_quantity === null ? null : after.opening_quantity.quantity,
      true,
    ],
  ];

  return (
    <section className="space-y-3" aria-label={t("catalogSetupWrite.heading")}>
      <div>
        <p className="font-mono text-micro uppercase tracking-authority text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("catalogSetupWrite.family")}
          <span className="text-text-mute">{" :: "}</span>
          {family.name}
        </p>
        <h3 className="font-cakemono text-body font-light uppercase text-text">
          {t("catalogSetupWrite.heading")}
        </h3>
        <p className="font-mohave text-body-sm text-text-2">
          {t("catalogSetupWrite.kind.create_variant")}
        </p>
      </div>

      <p className="font-mohave text-body-sm text-text-3">
        {t("catalogSetupWrite.familyContext")}{" "}
        <span className="font-mono tabular-nums text-text-2">
          {before.variant_count}
        </span>
        {before.default_price === null
          ? ` · ${t("catalogSetupWrite.noFamilyPrice")}`
          : ` · ${t("catalogSetupWrite.familyPrice")} ${money(
              before.default_price
            )}`}
      </p>

      <dl className="divide-y divide-border-subtle border-t border-border-subtle">
        {rows.map(([key, value, mono]) => (
          <div key={key} className="flex gap-3 py-2">
            <dt className="w-40 shrink-0 font-mono text-micro uppercase tracking-authority text-text-3">
              {t(`catalogSetupWrite.${key}`)}
            </dt>
            <dd
              className={
                mono
                  ? "break-words font-mono tabular-nums text-body-sm text-text"
                  : "break-words font-mohave text-body-sm text-text"
              }
            >
              {value === null || value === "" ? "—" : value}
            </dd>
          </div>
        ))}
      </dl>

      {after.opening_quantity !== null && (
        <p className="font-mohave text-body-sm text-text-3">
          {t("catalogSetupWrite.openingStockNote")}
          {after.opening_quantity.note
            ? ` · ${after.opening_quantity.note}`
            : ""}
        </p>
      )}

      <div className="space-y-3 border-t border-border-subtle pt-3">
        <h4 className="font-mono text-micro uppercase tracking-authority text-text-3">
          {t("catalogSetupWrite.evidence")}
        </h4>
        {evidence.map((item, index) => (
          <blockquote
            key={index}
            className="space-y-1 border-l border-border-subtle pl-3"
          >
            <p className="whitespace-pre-wrap break-words font-mohave text-body-sm text-text-2">
              {item.text}
            </p>
            <footer className="font-mono text-micro text-text-3">
              {t("catalogSetupWrite.statement")}
            </footer>
          </blockquote>
        ))}
      </div>

      <p className="font-mohave text-body-sm text-text-2">
        {t("catalogSetupWrite.effects")}
        {effects.stock_events_recorded === 1
          ? ` ${t("catalogSetupWrite.stockEffects")}`
          : ""}
      </p>
      <p className="font-mono text-micro text-text-3">
        {t("catalogSetupWrite.expires")}{" "}
        <span className="tabular-nums">{stamp(expires_at)}</span>
      </p>
    </section>
  );
}
