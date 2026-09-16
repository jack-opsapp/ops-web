"use client";
import {
  CatalogSetupWritePreviewSchema,
  type CatalogSetupWritePreview,
  type CreateCatalogOptionPreview,
  type CreateCatalogVariantPreview,
  type SetCatalogPricingPreview,
  type SetSupplierCostPreview,
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
 * Each kind adds a branch on `proposal.kind` beside these.
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
      ) : preview.kind === "set_thresholds" ? (
        <SetThresholdsBody preview={preview} t={t} />
      ) : preview.kind === "set_pricing" ? (
        <SetPricingBody preview={preview} locale={locale} t={t} />
      ) : preview.kind === "set_supplier_cost" ? (
        <SetSupplierCostBody preview={preview} locale={locale} t={t} />
      ) : (
        <CreateOptionBody preview={preview} t={t} />
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
          : preview.kind === "set_pricing"
            ? t("catalogSetupWrite.pricingEffects")
            : preview.kind === "set_supplier_cost"
              ? t("catalogSetupWrite.supplierCostEffects")
              : preview.kind === "create_option"
                ? t("catalogSetupWrite.optionEffects")
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

/**
 * A price change is two questions at once and the body answers them in that
 * order. What does this thing sell for, now and after — read in the same
 * now/after idiom as the levels, because the number alone does not say whether
 * it is the item's own price or one it inherits, and those behave differently
 * the next time somebody edits the family. Then: which variants does this
 * actually move, and what does each of them sell for on either side.
 *
 * Every affected variant is listed rather than counted. A family default that
 * moves eleven prices is eleven decisions, and an operator approving it has to
 * be able to see all eleven. A variant landing on no price at all is the loudest
 * outcome here, so it is called out above the list and reads as an em dash
 * inside it — an unpriced variant does not quietly disappear from the table.
 */
function SetPricingBody({
  preview,
  locale,
  t,
}: {
  preview: SetCatalogPricingPreview;
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
        currency: after.price.currency,
      }).format(value);
    } catch {
      // A company currency Intl does not know is still a number worth showing.
      return `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
      }).format(value)} ${after.price.currency}`;
    }
  };

  const labels = after.target.value_labels.join(" / ");
  const rows = after.affected_variants.map((variant, index) => ({
    variant,
    past: before.affected_variants[index],
  }));
  const losingPrice = rows.filter(
    (row) => row.variant.sale_price === null && row.past?.sale_price !== null
  ).length;

  return (
    <>
      <p className="font-mohave text-body-sm text-text-3">
        {t(
          after.target.item_ref.kind === "catalog_family"
            ? "catalogSetupWrite.targetFamily"
            : "catalogSetupWrite.targetVariant"
        )}
        {labels === "" ? "" : ` · ${labels}`}
      </p>

      <dl className="divide-y divide-border-subtle border-t border-border-subtle">
        <div className="space-y-1 py-2">
          <dt className="font-mono text-micro uppercase tracking-authority text-text-3">
            {t("catalogSetupWrite.salePrice")}
          </dt>
          <dd className="space-y-1">
            <p className="break-words font-mohave text-body-sm text-text-3">
              <span className="font-mono text-micro">
                {t("catalogSetupWrite.now")}{" "}
              </span>
              <span className="font-mono tabular-nums">
                {money(before.price.amount) ?? "—"}
              </span>
              {` · ${t(
                `catalogSetupWrite.priceOrigin.${before.price.origin}`
              )}`}
            </p>
            <p className="break-words font-mohave text-body-sm text-text">
              <span className="font-mono text-micro">
                {t("catalogSetupWrite.after")}{" "}
              </span>
              <span className="font-mono tabular-nums">
                {money(after.price.amount) ?? "—"}
              </span>
              {` · ${t(`catalogSetupWrite.priceOrigin.${after.price.origin}`)}`}
            </p>
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <h4 className="font-mono text-micro uppercase tracking-authority text-text-3">
          {t("catalogSetupWrite.affected")}
          <span className="text-text-mute">{" :: "}</span>
          <span className="tabular-nums">{rows.length}</span>
        </h4>
        {losingPrice > 0 && (
          <p className="border-l border-rose pl-3 font-mohave text-body-sm text-text-2">
            {t("catalogSetupWrite.losingPrice")}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-3">
            {t("catalogSetupWrite.affectedNone")}
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle scrollbar-hide">
            {rows.map(({ variant, past }) => (
              <li
                key={variant.variant_ref.id}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="break-words font-mohave text-body-sm text-text">
                  {variant.value_labels.join(" / ") || "—"}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-body-sm">
                  <span className="text-text-3">
                    {money(past?.sale_price ?? null) ?? "—"}
                  </span>
                  <span className="text-text-mute">{" → "}</span>
                  <span className="text-text">
                    {money(variant.sale_price) ?? "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * A cost change reads as the variant's cost sheet, because that is what it is.
 * The rows are listed in the order they will stand — default first — each
 * carrying what this approval does to it and, where the number moves, both
 * numbers. The operator is not asked to compute the default flip from a diff:
 * the DEFAULT marker sits on the row that will carry it, and the row losing it
 * says so.
 *
 * Above the sheet is the one number that leaves this table. `unit_cost_override`
 * is the simple cost field the rest of OPS reads, and it follows the default
 * profile — so it is shown now/after, in the same idiom as a threshold or a
 * price, rather than buried as an effect counter.
 *
 * A row whose stored text OPS will not display keeps its key, its cost and its
 * default flag and says its text was withheld. Dropping such a row would hide a
 * cost that is in force; showing the bytes would put control characters on
 * screen.
 */
function SetSupplierCostBody({
  preview,
  locale,
  t,
}: {
  preview: SetSupplierCostPreview;
  locale: string;
  t: Translate;
}) {
  const { before, after } = preview;
  const currency = after.profiles[0]?.currency ?? "CAD";
  const money = (amount: string | null) => {
    if (amount === null) return null;
    const value = Number.parseFloat(amount);
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      }).format(value);
    } catch {
      // A company currency Intl does not know is still a number worth showing.
      return `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
      }).format(value)} ${currency}`;
    }
  };

  const labels = after.variant.value_labels.join(" / ");
  const priorByKey = new Map(
    before.profiles.map((entry) => [entry.profile_key, entry])
  );
  const withheld = after.profiles.some((entry) => entry.label === null);

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
        <div className="space-y-1 py-2">
          <dt className="font-mono text-micro uppercase tracking-authority text-text-3">
            {t("catalogSetupWrite.variantCost")}
          </dt>
          <dd className="space-y-1">
            <p className="break-words font-mohave text-body-sm text-text-3">
              <span className="font-mono text-micro">
                {t("catalogSetupWrite.now")}{" "}
              </span>
              <span className="font-mono tabular-nums">
                {money(before.variant_unit_cost) ?? "—"}
              </span>
            </p>
            <p className="break-words font-mohave text-body-sm text-text">
              <span className="font-mono text-micro">
                {t("catalogSetupWrite.after")}{" "}
              </span>
              <span className="font-mono tabular-nums">
                {money(after.variant_unit_cost) ?? "—"}
              </span>
            </p>
          </dd>
        </div>
      </dl>
      <p className="font-mohave text-body-sm text-text-3">
        {t("catalogSetupWrite.variantCostNote")}
      </p>

      <div className="space-y-2">
        <h4 className="font-mono text-micro uppercase tracking-authority text-text-3">
          {t("catalogSetupWrite.costSheet")}
          <span className="text-text-mute">{" :: "}</span>
          <span className="tabular-nums">{after.profiles.length}</span>
        </h4>
        <ul className="max-h-64 divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle scrollbar-hide">
          {after.profiles.map((entry) => {
            const past = priorByKey.get(entry.profile_key);
            const moved =
              past !== undefined && past.unit_cost !== entry.unit_cost;
            return (
              <li key={entry.profile_key} className="space-y-1 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words font-mono text-body-sm text-text">
                    {entry.profile_key}
                    {entry.is_default && (
                      <span className="ml-2 border border-border-subtle px-1 font-mono text-micro uppercase tracking-authority text-text-2">
                        {t("catalogSetupWrite.default")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-body-sm">
                    {moved && (
                      <>
                        <span className="text-text-3">
                          {money(past.unit_cost)}
                        </span>
                        <span className="text-text-mute">{" → "}</span>
                      </>
                    )}
                    <span className="text-text">{money(entry.unit_cost)}</span>
                  </span>
                </div>
                <p className="break-words font-mohave text-body-sm text-text-3">
                  {entry.label ?? t("catalogSetupWrite.withheldText")}
                  {entry.state === "unchanged"
                    ? ""
                    : ` · ${t(`catalogSetupWrite.profileState.${entry.state}`)}`}
                </p>
              </li>
            );
          })}
        </ul>
        {withheld && (
          <p className="border-l border-border-subtle pl-3 font-mohave text-body-sm text-text-3">
            {t("catalogSetupWrite.withheldNote")}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Adding a dimension is one decision with two halves, and the body answers them
 * in that order.
 *
 * What is being added: the option, its values, and — because the operator has
 * to be able to catch the wrong one — which single value every variant already
 * on file is about to be given. That value is marked on the value it sits on
 * rather than restated below, so there is one place to look.
 *
 * Then what it does to the grid. The variants are not counted, they are listed,
 * each as the identity it has now and the identity it will have — the new axis
 * read as a column arriving on every row. An operator scanning that list is
 * looking for the row where the backfilled value is wrong, and a count cannot
 * show them that. The count is stated once, above the list, so the scale of the
 * change is legible before the rows are.
 *
 * A family with no variants says so, rather than showing an empty list: there is
 * nothing to backfill, and that is the whole answer.
 */
function CreateOptionBody({
  preview,
  t,
}: {
  preview: CreateCatalogOptionPreview;
  t: Translate;
}) {
  const { before, after } = preview;
  const dimension = after.options.find((entry) => entry.state === "created");
  const backfill = after.backfill.value;
  const rows = after.variants.map((variant, index) => ({
    variant,
    past: before.variants[index],
  }));

  return (
    <>
      <dl className="divide-y divide-border-subtle border-t border-border-subtle">
        <div className="flex gap-3 py-2">
          <dt className="w-40 shrink-0 font-mono text-micro uppercase tracking-authority text-text-3">
            {t("catalogSetupWrite.dimension")}
          </dt>
          <dd className="break-words font-mohave text-body-sm text-text">
            {dimension?.name ?? "—"}
          </dd>
        </div>
        <div className="flex gap-3 py-2">
          <dt className="w-40 shrink-0 font-mono text-micro uppercase tracking-authority text-text-3">
            {t("catalogSetupWrite.optionValues")}
          </dt>
          <dd className="min-w-0 space-y-1">
            {(dimension?.values ?? []).map((value) => (
              <p
                key={value.value}
                className="break-words font-mohave text-body-sm text-text"
              >
                {value.value}
                {value.value === backfill && (
                  <span className="ml-2 border border-border-subtle px-1 font-mono text-micro uppercase tracking-authority text-text-2">
                    {t("catalogSetupWrite.everyVariant")}
                  </span>
                )}
              </p>
            ))}
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <h4 className="font-mono text-micro uppercase tracking-authority text-text-3">
          {t("catalogSetupWrite.grid")}
          <span className="text-text-mute">{" :: "}</span>
          <span className="tabular-nums">{rows.length}</span>
        </h4>
        {rows.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-3">
            {t("catalogSetupWrite.backfillNone")}
          </p>
        ) : (
          <>
            {backfill !== null && (
              <p className="font-mohave text-body-sm text-text-2">
                {t("catalogSetupWrite.backfills")}
                <span className="text-text-mute">{" :: "}</span>
                <span className="font-mono tabular-nums text-text">
                  {after.backfill.variant_count}
                </span>
              </p>
            )}
            <ul className="max-h-64 divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle scrollbar-hide">
              {rows.map(({ variant, past }) => (
                <li key={variant.variant_ref.id} className="space-y-1 py-2">
                  <p className="break-words font-mohave text-body-sm text-text-3">
                    {past?.value_labels.join(" / ") || "—"}
                  </p>
                  <p className="break-words font-mohave text-body-sm text-text">
                    <span className="text-text-mute">{"→ "}</span>
                    {variant.value_labels.join(" / ") || "—"}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="font-mohave text-body-sm text-text-3">
        {t("catalogSetupWrite.optionNextStep")}
      </p>
    </>
  );
}
