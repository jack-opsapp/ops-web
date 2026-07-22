"use client";

// ItemEditor — the master-detail editor that REPLACES the DriverPane in the
// left column when a staged card is being edited (approved EDIT mock, spec §10).
//
// Sections follow the card's hierarchy:
//   IDENTITY  — name, unit chip, task-type chip (olive type dot)
//   PRICING   — FLAT | BY OPTION segment toggle. BY OPTION reveals an axis label,
//               a tier ladder (label + mono price, BASE marked on the lowest row),
//               an [ + add tier ], and a lavender "let the agent set pricing"
//               affordance (agent provenance — the ONLY accent-adjacent color here).
//   RECIPE    — "// RECIPE · draws down stock" + material rows ("name × qty") +
//               an [ + add material ].
//   FOOTER    — a Taxable toggle + a DONE button (default/secondary — NOT the
//               steel accent CTA; accent is reserved for build-it).
//
// Edits dispatch the reducer's EDIT_CARD with a Partial<fields>. The pane is a
// controlled view over a single StagingCard — it owns no staging logic, only the
// presentation + the local FLAT/BY-OPTION view toggle (which has no field yet in
// the Phase-1 SellFields model, so it is local UI state).
//
// VOICE: `//` section titles (text-mute slash), [brackets] for instructional
// micro-text, sentence case content, UPPERCASE authority. No steel accent on any
// control (toggles, DONE) — accent is the single build-it CTA elsewhere.

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { Surface } from "@/components/ui/surface";
import { ScrollFade } from "@/components/dashboard/widgets/shared/scroll-fade";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type {
  StagingCard,
  CardFieldsFor,
  ModuleKey,
} from "@/lib/catalog-setup/staging-card";

/** A single pricing tier row (BY OPTION mode). Local UI shape — Phase-1
 *  SellFields has no tier column yet, so tiers live as editor view state until
 *  the option-pricing model lands. */
export interface PricingTier {
  id: string;
  label: string;
  price: number | null;
}

/** A single recipe material row. Local UI shape (same rationale as tiers). */
export interface RecipeMaterial {
  id: string;
  name: string;
  qty: number | null;
}

export interface ItemEditorProps {
  /** The card under edit. Drives every section. */
  card: StagingCard;
  /** Back affordance — returns the left column to the DriverPane. */
  onBack: () => void;
  /** Commit the edit session (DONE). Parent closes the editor. */
  onDone: () => void;
  /**
   * Field-level edit. The parent wires this to the store's
   * `dispatch({ type: "EDIT_CARD", id, fields })`. Partial — only changed fields
   * flow through, the reducer merges the rest.
   */
  onEditField: (fields: Partial<CardFieldsFor<ModuleKey>>) => void;
  className?: string;
}

/** Narrow a card to a label string regardless of module (TYPES uses `display`). */
function cardLabel(card: StagingCard): string {
  return card.module === "types" ? card.fields.display : card.fields.name;
}

/** A small uppercase section title with the decorative `//` slash. */
function SectionTitle({ children }: { children: string }) {
  // Titles arrive prefixed with `//` from the dictionary; render the slash in
  // text-mute (decorative) and the label in text-3 (label tier).
  const label = children.replace(/^\/\/\s*/, "");
  return (
    <h3 className="font-mono text-micro uppercase tracking-wider text-text-3">
      <span className="text-text-mute">{"//"}</span>
      <span className="ml-1.5">{label}</span>
    </h3>
  );
}

/** Inset text input — surface-input bg, line border, 5px radius. */
function FieldInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  mono = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded border border-line bg-surface-input px-1.5 py-1 text-text placeholder:text-text-3 outline-none transition-colors duration-150 focus:border-line-hi",
        mono ? "font-mono text-data-sm tabular-nums" : "font-mohave text-body-sm",
        className,
      )}
    />
  );
}

export function ItemEditor({
  card,
  onBack,
  onDone,
  onEditField,
  className,
}: ItemEditorProps) {
  const { t } = useDictionary("catalog-setup");
  const reduced = useReducedMotion();

  // Local view state. FLAT vs BY OPTION has no field in the Phase-1 model — it is
  // an editor-only presentation choice until option pricing lands. Tiers and
  // materials are likewise local rows (the commit step will map them to the real
  // option/recipe tables after the rebase).
  const [byOption, setByOption] = useState(false);
  const [tiers, setTiers] = useState<PricingTier[]>([
    { id: "tier-1", label: "", price: null },
  ]);
  const [materials, setMaterials] = useState<RecipeMaterial[]>([
    { id: "mat-1", name: "", qty: null },
  ]);

  const isSell = card.module === "sell";
  const isTaxable = isSell ? card.fields.isTaxable : false;
  const unit =
    card.module === "sell"
      ? (card.fields.pricingUnit ?? "")
      : card.module === "stock"
        ? (card.fields.unitId ?? "")
        : "";

  // BASE marker. Once any tier has a price, the lowest-priced tier is the base.
  // Until prices exist, the first row is the base (the ladder's foundation always
  // has a base — it never reads as "no base yet").
  const pricedBaseId = tiers
    .filter((tr) => tr.price !== null)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0]?.id;
  const baseTierId = pricedBaseId ?? tiers[0]?.id;

  const setName = (v: string) => {
    if (card.module === "types") onEditField({ display: v } as Partial<CardFieldsFor<ModuleKey>>);
    else onEditField({ name: v } as Partial<CardFieldsFor<ModuleKey>>);
  };

  const ladderReveal = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" },
        exit: { opacity: 0, height: 0 },
      };

  return (
    <motion.aside
      aria-label={`${t("editor.title", "EDIT")} ${cardLabel(card)}`}
      data-testid="item-editor"
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.25, ease: EASE_SMOOTH }}
      className={cn("flex h-full flex-col", className)}
    >
      <Surface variant="default" className="flex h-full flex-col">
        {/* Header — back arrow + EDIT mono + item name (Mohave 500). */}
        <header className="flex items-center gap-1.5 border-b border-line px-2 py-1">
          <button
            type="button"
            onClick={onBack}
            data-testid="editor-back"
            aria-label={t("editor.back", "back")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-text-2 transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          >
            <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t("editor.title", "EDIT")}
          </span>
          <span className="min-w-0 flex-1 truncate font-mohave text-body-sm font-medium text-text">
            {cardLabel(card)}
          </span>
        </header>

        {/* Scrollable section stack — ScrollFade so cut-off fields are always
            discoverable (the fade cue), never a hidden-scrollbar cliff. */}
        <ScrollFade className="px-2 py-2">
          {/* ── IDENTITY ─────────────────────────────────────────── */}
          <section data-testid="editor-section-identity" className="flex flex-col gap-2">
            <SectionTitle>{t("editor.section.identity", "// IDENTITY")}</SectionTitle>

            <FieldInput
              ariaLabel={t("field.name", "name")}
              value={cardLabel(card)}
              onChange={setName}
              placeholder={t("editor.field.name.placeholder", "Item name")}
            />

            <div className="flex flex-wrap items-center gap-2">
              {/* Unit chip — neutral chip, mono value. */}
              <div className="flex items-center gap-1.5 rounded-chip border border-line bg-surface-input px-2 py-1">
                <span className="font-mono text-micro uppercase tracking-wider text-text-3">
                  {t("editor.unit.label", "unit")}
                </span>
                <span className="font-mono text-micro tabular-nums text-text-2">
                  {unit || t("editor.unit.placeholder", "ea")}
                </span>
              </div>

              {/* Task-type chip — olive type dot (semantic positive/type). */}
              <div
                data-testid="editor-type-chip"
                className="flex items-center gap-1.5 rounded-chip border border-line bg-surface-input px-2 py-1"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-olive"
                />
                <span className="font-mono text-micro uppercase tracking-wider text-text-2">
                  {isSell ? card.fields.type : t("editor.taskType.label", "type")}
                </span>
              </div>
            </div>
          </section>

          {/* ── PRICING ──────────────────────────────────────────── */}
          <section data-testid="editor-section-pricing" className="mt-3 flex flex-col gap-2">
            <SectionTitle>{t("editor.section.pricing", "// PRICING")}</SectionTitle>

            {/* FLAT | BY OPTION segment toggle. NO accent — active = white text,
                surface-active bg, line-hi border (toggle spec). */}
            <div
              role="group"
              aria-label={t("editor.section.pricing", "// PRICING")}
              className="inline-flex w-fit rounded border border-line p-0.5"
            >
              <button
                type="button"
                data-testid="pricing-toggle-flat"
                aria-pressed={!byOption}
                onClick={() => setByOption(false)}
                className={cn(
                  "rounded-chip px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider transition-colors duration-150",
                  !byOption
                    ? "border border-line-hi bg-surface-active text-text"
                    : "border border-transparent text-text-3 hover:bg-surface-hover-subtle hover:text-text-2",
                )}
              >
                {t("editor.pricing.flat", "FLAT")}
              </button>
              <button
                type="button"
                data-testid="pricing-toggle-byoption"
                aria-pressed={byOption}
                onClick={() => setByOption(true)}
                className={cn(
                  "rounded-chip px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider transition-colors duration-150",
                  byOption
                    ? "border border-line-hi bg-surface-active text-text"
                    : "border border-transparent text-text-3 hover:bg-surface-hover-subtle hover:text-text-2",
                )}
              >
                {t("editor.pricing.byOption", "BY OPTION")}
              </button>
            </div>

            {/* FLAT: a single price field. */}
            {!byOption && isSell && (
              <FieldInput
                ariaLabel={t("field.defaultPrice", "price")}
                mono
                value={
                  card.fields.defaultPrice === null
                    ? ""
                    : String(card.fields.defaultPrice)
                }
                placeholder={t("editor.pricing.tierPrice.placeholder", "0")}
                onChange={(v) =>
                  onEditField({
                    defaultPrice: v.trim() === "" ? null : Number(v),
                  } as Partial<CardFieldsFor<ModuleKey>>)
                }
                className="w-32"
              />
            )}

            {/* BY OPTION: axis label + tier ladder + add tier + agent affordance. */}
            <AnimatePresence initial={false}>
              {byOption && (
                <motion.div
                  key="tier-ladder"
                  data-testid="pricing-tier-ladder"
                  initial={ladderReveal.initial}
                  animate={ladderReveal.animate}
                  exit={ladderReveal.exit}
                  transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE_SMOOTH }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-3 pt-1">
                    {/* Axis label + axis name input. */}
                    <div className="flex flex-col gap-1.5">
                      <span className="font-mono text-micro-sm uppercase tracking-wider text-text-3">
                        <span className="text-text-mute">{"//"}</span>
                        <span className="ml-1.5">
                          {t("editor.pricing.axisLabel", "// pricing axis").replace(/^\/\/\s*/, "")}
                        </span>
                      </span>
                      <FieldInput
                        ariaLabel={t("editor.pricing.axisLabel", "// pricing axis")}
                        value=""
                        onChange={() => {}}
                        placeholder={t("editor.pricing.axis.placeholder", "Size")}
                        className="w-40"
                      />
                    </div>

                    {/* Tier rows — label input + mono price. BASE marks lowest. */}
                    <div className="flex flex-col gap-2">
                      {tiers.map((tier) => (
                        <div
                          key={tier.id}
                          data-testid="pricing-tier-row"
                          className="flex items-center gap-2"
                        >
                          <FieldInput
                            ariaLabel={t("editor.pricing.tierLabel.placeholder", "Tier name")}
                            value={tier.label}
                            placeholder={t("editor.pricing.tierLabel.placeholder", "Tier name")}
                            onChange={(v) =>
                              setTiers((prev) =>
                                prev.map((tr) =>
                                  tr.id === tier.id ? { ...tr, label: v } : tr,
                                ),
                              )
                            }
                            className="flex-1"
                          />
                          <FieldInput
                            ariaLabel={t("field.defaultPrice", "price")}
                            mono
                            value={tier.price === null ? "" : String(tier.price)}
                            placeholder={t("editor.pricing.tierPrice.placeholder", "0")}
                            onChange={(v) =>
                              setTiers((prev) =>
                                prev.map((tr) =>
                                  tr.id === tier.id
                                    ? { ...tr, price: v.trim() === "" ? null : Number(v) }
                                    : tr,
                                ),
                              )
                            }
                            className="w-24"
                          />
                          {/* BASE marker on the lowest-priced tier. */}
                          <span
                            className={cn(
                              "w-10 shrink-0 font-mono text-micro-sm uppercase tracking-wider",
                              tier.id === baseTierId ? "text-olive" : "text-transparent",
                            )}
                            aria-hidden={tier.id !== baseTierId}
                          >
                            {tier.id === baseTierId ? t("editor.pricing.base", "BASE") : ""}
                          </span>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      data-testid="pricing-add-tier"
                      onClick={() =>
                        setTiers((prev) => [
                          ...prev,
                          { id: `tier-${prev.length + 1}-${Date.now()}`, label: "", price: null },
                        ])
                      }
                      className="self-start font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
                    >
                      {t("editor.pricing.addTier", "[ + add tier ]")}
                    </button>

                    {/* Agent-pricing affordance — lavender (agent provenance is
                        the one sanctioned non-neutral color here). */}
                    <button
                      type="button"
                      data-testid="pricing-agent-set"
                      className="self-start rounded border border-agent-border bg-agent-bg px-1.5 py-0.5 font-mono text-micro tracking-wide text-agent-text transition-colors duration-150 hover:bg-agent-bg-hi"
                    >
                      {t("editor.pricing.agentSet", "let the agent set pricing")}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* ── RECIPE ───────────────────────────────────────────── */}
          <section data-testid="editor-section-recipe" className="mt-3 flex flex-col gap-2">
            <SectionTitle>{t("editor.section.recipe", "// RECIPE · draws down stock")}</SectionTitle>

            <div className="flex flex-col gap-2">
              {materials.map((mat) => (
                <div
                  key={mat.id}
                  data-testid="recipe-material-row"
                  className="flex items-center gap-2"
                >
                  <FieldInput
                    ariaLabel={t("editor.recipe.material.placeholder", "Material")}
                    value={mat.name}
                    placeholder={t("editor.recipe.material.placeholder", "Material")}
                    onChange={(v) =>
                      setMaterials((prev) =>
                        prev.map((m) => (m.id === mat.id ? { ...m, name: v } : m)),
                      )
                    }
                    className="flex-1"
                  />
                  <span aria-hidden="true" className="font-mono text-micro text-text-mute">
                    &times;
                  </span>
                  <FieldInput
                    ariaLabel={t("field.quantity", "on hand")}
                    mono
                    value={mat.qty === null ? "" : String(mat.qty)}
                    placeholder={t("editor.recipe.qty.placeholder", "1")}
                    onChange={(v) =>
                      setMaterials((prev) =>
                        prev.map((m) =>
                          m.id === mat.id
                            ? { ...m, qty: v.trim() === "" ? null : Number(v) }
                            : m,
                        ),
                      )
                    }
                    className="w-20"
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              data-testid="recipe-add-material"
              onClick={() =>
                setMaterials((prev) => [
                  ...prev,
                  { id: `mat-${prev.length + 1}-${Date.now()}`, name: "", qty: null },
                ])
              }
              className="self-start font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
            >
              {t("editor.recipe.addMaterial", "[ + add material ]")}
            </button>
          </section>
        </ScrollFade>

        {/* Footer — Taxable toggle + DONE (default/secondary, NOT accent). */}
        <footer className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
          <button
            type="button"
            data-testid="editor-taxable-toggle"
            role="switch"
            aria-checked={isTaxable}
            disabled={!isSell}
            onClick={() =>
              isSell &&
              onEditField({ isTaxable: !isTaxable } as Partial<CardFieldsFor<ModuleKey>>)
            }
            className="flex items-center gap-2 disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative h-4 w-7 rounded-bar border transition-colors duration-150",
                isTaxable
                  ? "border-line-hi bg-surface-active"
                  : "border-line bg-surface-input",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-text-2 transition-transform duration-150",
                  isTaxable ? "translate-x-3.5" : "translate-x-0.5",
                )}
              />
            </span>
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {t("editor.footer.taxable", "taxable")}
            </span>
          </button>

          <button
            type="button"
            data-testid="editor-done"
            onClick={onDone}
            className="rounded border border-line bg-surface-active px-2 py-0.5 font-cakemono text-cake-button font-light uppercase tracking-wide text-text-2 transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          >
            {t("editor.footer.done", "DONE")}
          </button>
        </footer>
      </Surface>
    </motion.aside>
  );
}

export default ItemEditor;
