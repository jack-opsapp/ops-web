"use client";
import {
  CatalogSetupWritePreviewSchema,
  type CatalogSetupWritePreview,
  type CreateCatalogVariantPreview,
  type SetVariantThresholdsPreview,
} from "@/lib/agent-control-plane/contracts/catalog-setup-write";
import { useDictionary, useLocale } from "@/i18n/client";

type Translate = (key: string) => string;

/**
 * One review surface for every catalogue setup write kind.
 *
 * The header, evidence, effects and expiry are shared; the body is the part
 * that differs, because a create and an edit are not the same decision. A
 * create has no symmetric "before" — the operator is deciding whether one new
 * row should exist — so it reads as a definition list of the fields that can
 * hurt. An edit of levels that already exist is a comparison, so it reads in
 * the same now/after idiom the lead-update row already taught the operator.
 *
 * A later kind (pricing, supplier cost, option) adds a branch on
 * `proposal.kind` beside these two.
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
  const preview: CatalogSetupWritePreview = parsed.data;
  const { family, effects, evidence, expires_at } = preview;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));

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
          {t(`catalogSetupWrite.kind.${preview.kind}`)}
        </p>
      </div>

      {preview.kind === "create_variant" ? (
        <CreateVariantBody preview={preview} locale={locale} t={t} />
      ) : (
        <SetThresholdsBody preview={preview} t={t} />
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
        {preview.kind === "set_thresholds"
          ? t("catalogSetupWrite.thresholdEffects")
          : t("catalogSetupWrite.effects")}
        {preview.kind === "create_variant" && effects.stock_events_recorded === 1
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

/**
 * The new row is the short list of fields that can hurt: what it is, what it
 * sells for and where that price comes from, what it costs, when it warns, and
 * how much stock arrives with it. An unset field reads as an em dash rather
 * than disappearing, because an absent threshold and a zero threshold are
 * different answers.
 */
function CreateVariantBody({
  preview,
  locale,
  t,
}: {
  preview: CreateCatalogVariantPreview;
  locale: string;
  t: Translate;
}) {
  const { before, after } = preview;
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
    <>
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
    </>
  );
}

/**
 * Both levels are always shown, including the one the request left alone: an
 * operator approving a critical level has to see the warning level it sits
 * under, or they cannot tell whether the pair makes sense. Where each value
 * comes from is read as part of the sentence rather than as a legend, because
 * "24 · set on this variant" and "24 · from the family" are the difference
 * between a level that stays put and one a later family edit moves.
 */
function SetThresholdsBody({
  preview,
  t,
}: {
  preview: SetVariantThresholdsPreview;
  t: Translate;
}) {
  const { before, after } = preview;
  const labels = after.variant.value_labels.join(" / ");
  const rows = [
    ["warning", before.warning, after.warning],
    ["critical", before.critical, after.critical],
  ] as const;

  return (
    <>
      <p className="font-mohave text-body-sm text-text-3">
        {labels === "" ? "—" : labels}
        {" · "}
        {t("catalogSetupWrite.sku")}{" "}
        <span className="font-mono tabular-nums text-text-2">
          {after.variant.sku ?? "—"}
        </span>
      </p>

      <dl className="divide-y divide-border-subtle border-t border-border-subtle">
        {rows.map(([key, past, next]) => (
          <div key={key} className="space-y-1 py-2">
            <dt className="font-mono text-micro uppercase tracking-authority text-text-3">
              {t(`catalogSetupWrite.${key}`)}
            </dt>
            <dd className="space-y-1">
              <p className="break-words font-mohave text-body-sm text-text-3">
                <span className="font-mono text-micro">
                  {t("catalogSetupWrite.now")}{" "}
                </span>
                <span className="font-mono tabular-nums">
                  {past.value ?? "—"}
                </span>
                {` · ${t(`catalogSetupWrite.origin.${past.origin}`)}`}
              </p>
              <p className="break-words font-mohave text-body-sm text-text">
                <span className="font-mono text-micro">
                  {t("catalogSetupWrite.after")}{" "}
                </span>
                <span className="font-mono tabular-nums">
                  {next.value ?? "—"}
                </span>
                {` · ${t(`catalogSetupWrite.origin.${next.origin}`)}`}
              </p>
            </dd>
          </div>
        ))}
      </dl>

      <p className="font-mohave text-body-sm text-text-3">
        {t("catalogSetupWrite.wholeUnitsNote")}
      </p>
    </>
  );
}
