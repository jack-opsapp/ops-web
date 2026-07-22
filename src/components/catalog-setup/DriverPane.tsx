"use client";

// DriverPane — the LEFT pane of the catalog-setup wizard (spec §5–§8, §10).
//
// One pane, two drivers, three honest states:
//   "picker"        — the pre-conversation SOURCE PICKER: "How do you want to
//                     start?" → Connect QuickBooks / Upload a file / Describe it /
//                     Start from a template / Add it yourself. The owner never
//                     picks a "lane" mid-import — they just hand over what they
//                     have, and it all lands on the one canvas. The picker's own
//                     question IS the pane's lead — no doubled prose, and NO
//                     message-input footer (the input belongs to the live agent
//                     conversation alone; a dead input here was chrome that cost
//                     the source options their room at 13" viewports).
//   "conversation"  — the guided-setup transcript (the live agent lane). Agent
//                     mode is generate-all in 1–2 turns, NOT a walkthrough
//                     (spec §10), so the conversation is short by design. The
//                     message input renders ONLY here, and only when a live
//                     `onSend` backs it — never a disabled dead-end.
//
// LAYOUT: header / ScrollFade body / (conversation-only) footer. The body is the
// single flexible region — at ≥md the pane is hard-bounded and the body scrolls
// with fade cues; <md the pane takes its natural height and the page scrolls.
//
// FRAMING (OPS rule): never "AI". The agent is "guided setup" / "suggested".
// Never "contractor" — the audience is the trades / owner-operators / crews.
//
// VOICE: `//` prefix for section titles (text-mute slash), [brackets] for
// instructional micro-text, sentence case for content, UPPERCASE for authority.
// The steel ACCENT never lands on this pane — accent is the one build-it CTA.
//
// All strings via useDictionary("catalog-setup") with English fallbacks so the
// pane renders correctly before the dictionary resolves (the hook loads async).

import { useState } from "react";
import {
  ArrowUp,
  FileSpreadsheet,
  LayoutTemplate,
  Link2,
  Loader2,
  MessageSquareText,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { Surface } from "@/components/ui/surface";
import { ScrollFade } from "@/components/dashboard/widgets/shared/scroll-fade";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  WIZARD_TRADES,
  type WizardTradeId,
} from "@/lib/catalog-setup/trade-list";
import { previewTradeTemplate } from "@/lib/catalog-setup/trade-templates";

/** Mono tabular-lining / slashed-zero — the trade-picker count preview. */
const MONO_NUM: React.CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

export type SetupSource =
  | "quickbooks"
  | "upload"
  | "describe"
  | "template"
  | "manual";

export interface DriverPaneProps {
  /**
   * "picker"       = pre-conversation source choice ("How do you want to start?").
   * "trade-picker" = the per-trade TEMPLATE sub-flow: pick your trade → preview →
   *                  use this starter (spec §8 template lane, §9 TYPES).
   * "conversation" = post-pick guided-setup transcript.
   * Defaults to "conversation" so the standalone preview shows the live-building
   * state (cards already on the canvas).
   */
  mode?: "picker" | "trade-picker" | "conversation";
  /** Choose a source (picker mode). Optional in this presentational phase. */
  onPickSource?: (source: SetupSource) => void;
  /**
   * Confirm a trade in the TEMPLATE sub-flow (trade-picker mode) → the caller
   * stages that trade's starter cards onto the canvas (spec §8/§9). Optional so
   * the standalone preview can render the picker without a live handler.
   */
  onPickTrade?: (trade: WizardTradeId) => void;
  /**
   * Restrict the picker to the lanes that are wired end-to-end. Omitted → all
   * sources show (the standalone preview). The /catalog/setup mount passes only
   * the ready lanes so a not-yet-built source is never a dead button — each lane
   * appears as its phase lands (state-aware, not "coming soon").
   */
  availableSources?: SetupSource[];
  /**
   * Routes the operator to the deterministic guided-setup flow (the offline /
   * no-agent path). Phase 1 wires this to the wizard rail; until then it is an
   * optional no-op so the standalone preview renders the affordance honestly.
   */
  onSwitchToGuided?: () => void;
  /**
   * Submit a description to the Setup Agent (conversation mode). When provided,
   * the message input is LIVE; otherwise it stays disabled (no agent backs it).
   */
  onSend?: (text: string) => void;
  /** Agent generating — disables the input + shows the "on it" turn. */
  busy?: boolean;
  /**
   * Real conversation turns (the owner's submitted messages, oldest first). When
   * provided, the transcript renders these instead of the preview sample.
   */
  turns?: string[];
  className?: string;
}

/**
 * The left-pane driver. Stateless and presentational — it owns no staging logic
 * (that lives in the reducer/store). It frames the build, offers a way in (source
 * picker) or shows the guided transcript, offers the guided-setup escape, and
 * reserves the Phase-4 live-agent seam.
 */
export function DriverPane({
  mode = "conversation",
  onPickSource,
  onPickTrade,
  availableSources,
  onSwitchToGuided,
  onSend,
  busy = false,
  turns,
  className,
}: DriverPaneProps) {
  const { t } = useDictionary("catalog-setup");
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState("");
  // The input is LIVE only when a send handler is wired and the agent isn't busy.
  const inputLive = !!onSend && !busy;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !onSend || busy) return;
    onSend(text);
    setDraft("");
  };

  // Entry beat (animation-architect: ARRIVAL) — the pane lands with precision,
  // no bounce. Reduced motion serves the same beat through opacity alone.
  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.aside
      aria-label={t("driver.title", "// SETUP")}
      data-testid="driver-pane"
      initial={enter.initial}
      animate={enter.animate}
      transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE_SMOOTH }}
      className={cn("flex h-full flex-col", className)}
    >
      <Surface variant="default" className="flex min-h-0 flex-1 flex-col">
        {/* Header — panel title in mono, // slash in text-mute (decorative).
            The guided lead frames ONLY the conversation; in picker mode the
            picker's own question is the lead. */}
        <header className="px-2 pb-1.5 pt-2">
          <h2 className="font-mono text-micro uppercase tracking-wider text-text-3">
            <span className="text-text-mute">{"//"}</span>
            <span className="ml-1.5">
              {t("driver.title", "// SETUP").replace(/^\/\/\s*/, "")}
            </span>
          </h2>
          {mode === "conversation" ? (
            <p className="mt-1.5 max-w-[42ch] font-mohave text-body-sm text-text-2">
              {t(
                "driver.lead",
                "Tell me what you sell. Drop in a price list, pick your trade, or just type a line — it lands on the canvas as you go.",
              )}
            </p>
          ) : null}
        </header>

        {/* Body — the one flexible region. Keyed sub-view mount (no exit gating;
            see the shell's MOTION note) inside a ScrollFade so overflow is
            always discoverable, never a hidden-scrollbar cliff. */}
        <ScrollFade className="px-2 pb-2">
          {mode === "picker" ? (
            <SourcePicker
              key="picker"
              t={t}
              reduced={!!reduced}
              onPickSource={onPickSource}
              availableSources={availableSources}
            />
          ) : mode === "trade-picker" ? (
            <TradePicker
              key="trade-picker"
              t={t}
              reduced={!!reduced}
              onPickTrade={onPickTrade}
              onBack={onSwitchToGuided}
            />
          ) : (
            <Conversation
              key="conversation"
              t={t}
              reduced={!!reduced}
              turns={turns}
              busy={busy}
            />
          )}
        </ScrollFade>

        {/* Footer — conversation mode only: the live message input (only when an
            agent actually backs it) + the offline/guided escape. Picker and
            trade-picker carry no footer — their next moves live in their body. */}
        {mode === "conversation" ? (
          <footer className="flex flex-col gap-1.5 border-t border-glass-border px-2 py-1.5">
            {onSend ? (
              <form
                onSubmit={handleSubmit}
                className={cn(
                  "flex items-center gap-2 rounded border border-line bg-surface-input px-1.5 py-1",
                  inputLive ? "" : "opacity-60",
                )}
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={!inputLive}
                  aria-label={t("driver.prompt.placeholder", "Describe what you sell")}
                  placeholder={t("driver.prompt.placeholder", "Describe what you sell")}
                  className={cn(
                    "flex-1 bg-transparent font-mohave text-body-sm text-text placeholder:text-text-3 outline-none",
                    inputLive ? "" : "cursor-not-allowed disabled:cursor-not-allowed",
                  )}
                />
                <button
                  type="submit"
                  data-testid="driver-send"
                  aria-label={t("driver.prompt.send", "send")}
                  disabled={!inputLive || draft.trim().length === 0}
                  className="flex h-3 w-3 shrink-0 items-center justify-center text-text-2 transition-opacity duration-150 disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
              </form>
            ) : null}

            {/* Offline → guided-setup affordance. Bracket micro-text, text-3,
                brightens to text-2 on hover. A real button (keyboard + a11y). */}
            <button
              type="button"
              onClick={onSwitchToGuided}
              data-testid="driver-offline-switch"
              className="self-start font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
            >
              {t("driver.offline", "[ offline? switch to guided setup ]")}
            </button>
          </footer>
        ) : null}
      </Surface>
    </motion.aside>
  );
}

export default DriverPane;

// ── source picker ────────────────────────────────────────────────────────────

type Tt = (key: string, fb?: string) => string;

const SOURCES: {
  key: SetupSource;
  icon: LucideIcon;
  titleKey: string;
  titleFb: string;
  descKey: string;
}[] = [
  {
    key: "quickbooks",
    icon: Link2,
    titleKey: "driver.start.quickbooks",
    titleFb: "Connect QuickBooks",
    descKey: "driver.start.quickbooks.desc",
  },
  {
    key: "upload",
    icon: FileSpreadsheet,
    titleKey: "driver.start.upload",
    titleFb: "Upload a file",
    descKey: "driver.start.upload.desc",
  },
  {
    key: "describe",
    icon: MessageSquareText,
    titleKey: "driver.start.describe",
    titleFb: "Describe it",
    descKey: "driver.start.describe.desc",
  },
  {
    key: "template",
    icon: LayoutTemplate,
    titleKey: "driver.start.template",
    titleFb: "Start from a template",
    descKey: "driver.start.template.desc",
  },
  {
    key: "manual",
    icon: Plus,
    titleKey: "driver.start.manual",
    titleFb: "Add it yourself",
    descKey: "driver.start.manual.desc",
  },
];

function SourcePicker({
  t,
  reduced,
  onPickSource,
  availableSources,
}: {
  t: Tt;
  reduced: boolean;
  onPickSource?: (source: SetupSource) => void;
  availableSources?: SetupSource[];
}) {
  const sources = availableSources
    ? SOURCES.filter((s) => availableSources.includes(s.key))
    : SOURCES;
  return (
    <motion.div
      data-testid="driver-source-picker"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-mohave text-body text-text">
          {t("driver.start.title", "How do you want to start?")}
        </h3>
        <span className="font-mono text-micro tracking-wide text-text-3">
          {t("driver.start.hint", "[everything lands on one canvas — pick what's easiest]")}
        </span>
      </div>

      <ul className="flex flex-col gap-1" role="list">
        {sources.map(({ key, icon: Icon, titleKey, titleFb, descKey }) => (
          <li key={key}>
            <button
              type="button"
              data-testid={`driver-source-${key}`}
              onClick={onPickSource ? () => onPickSource(key) : undefined}
              className="group flex w-full items-center gap-1.5 rounded-panel border border-glass-border bg-surface-hover-subtle px-1.5 py-1 text-left transition-colors duration-150 hover:border-line-hi hover:bg-surface-hover"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-input text-text-3 transition-colors duration-150 group-hover:text-text-2">
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mohave text-body-sm text-text">
                  {t(titleKey, titleFb)}
                </span>
                <span className="truncate font-mohave text-micro text-text-3">
                  {t(descKey, "")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

// ── trade picker (TEMPLATE lane) ─────────────────────────────────────────────
//
// The offline / declined / "I'll do it myself" FLOOR (spec §8): the owner picks
// the ONE trade their business does (either/or → single-select, one confirm —
// the design-judgment rule), previews what they'll get, then stages the trade's
// starter cards onto the canvas. A starting point, not a finished catalog — the
// reassurance copy says so, and every card lands "proposed" to trim.
//
// MOTION: the grid mirrors the source picker's TRANSITION entry/exit; selecting
// a trade is a DISCOVERY beat (instant olive selection, no accent — accent is
// the one BUILD IT CTA), and the preview + confirm reveal on first selection.
// EASE_SMOOTH throughout, reduced-motion → opacity only.

function TradePicker({
  t,
  reduced,
  onPickTrade,
  onBack,
}: {
  t: Tt;
  reduced: boolean;
  onPickTrade?: (trade: WizardTradeId) => void;
  onBack?: () => void;
}) {
  const [selected, setSelected] = useState<WizardTradeId | null>(null);
  const preview = selected ? previewTradeTemplate(selected) : null;

  return (
    <motion.div
      data-testid="driver-trade-picker"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mohave text-body text-text">
            {t("driver.trade.title", "Pick your trade")}
          </h3>
          {/* Back to the source picker. Bracket micro-text, text-3 → text-2. */}
          <button
            type="button"
            data-testid="driver-trade-back"
            onClick={onBack}
            className="shrink-0 font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
          >
            {t("driver.trade.back", "[ back ]")}
          </button>
        </div>
        <span className="font-mono text-micro tracking-wide text-text-3">
          {t("driver.trade.hint", "[a starting point — trim what doesn't fit]")}
        </span>
      </div>

      {/* Two-column grid — single-select. Selected = olive (positive), never
          accent. Cake Mono Light UPPERCASE label per the trade-label tier. */}
      <ul className="grid grid-cols-2 gap-1" role="list">
        {WIZARD_TRADES.map((trade) => {
          const isSelected = selected === trade.id;
          return (
            <li key={trade.id}>
              <button
                type="button"
                data-testid={`driver-trade-${trade.id}`}
                aria-pressed={isSelected}
                onClick={() => setSelected(trade.id)}
                className={cn(
                  "flex w-full items-center rounded-chip border px-1.5 py-1 text-left font-cakemono text-cake-badge font-light uppercase tracking-wide transition-colors duration-150",
                  isSelected
                    ? "border-olive-line bg-olive-soft text-olive"
                    : "border-glass-border bg-surface-hover-subtle text-text-2 hover:border-line-hi hover:bg-surface-hover hover:text-text",
                )}
              >
                <span className="truncate">{trade.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Preview + confirm — revealed once a trade is selected (a selection can
          change but never clear, so the reveal only ever enters — a keyed mount,
          no exit choreography). The count is the honest "this is what you'll
          get"; the confirm is SECONDARY (neutral outline), never the accent —
          that belongs to BUILD IT alone. */}
      {selected && preview ? (
        <motion.div
          key="trade-confirm"
          data-testid="driver-trade-confirm-row"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: EASE_SMOOTH }}
          className="mt-0.5 flex items-center justify-between gap-2 border-t border-glass-border pt-1.5"
        >
          <span
            data-testid="driver-trade-preview"
            className="font-mono text-micro tracking-wide text-text-2"
            style={MONO_NUM}
          >
            {t("driver.trade.preview", "{types} task types · {sell} starter lines")
              .replace("{types}", String(preview.taskTypes))
              .replace("{sell}", String(preview.sell))}
          </span>
          <button
            type="button"
            data-testid="driver-trade-confirm"
            onClick={onPickTrade ? () => onPickTrade(selected) : undefined}
            className="shrink-0 rounded border border-glass-border px-2 py-1 font-cakemono text-cake-button font-light uppercase tracking-wide text-text-2 transition-colors duration-150 hover:border-line-hi hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {t("driver.trade.confirm", "USE THIS STARTER")}
          </button>
        </motion.div>
      ) : null}
    </motion.div>
  );
}

// ── conversation (presentational) ────────────────────────────────────────────

function Conversation({
  t,
  reduced,
  turns,
  busy,
}: {
  t: Tt;
  reduced: boolean;
  turns?: string[];
  busy?: boolean;
}) {
  // Live mode: a real transcript (the owner's submitted turns) is threaded in.
  // Preview mode: `turns` is undefined → render the static sample + seam marker.
  const live = turns !== undefined;
  return (
    <motion.div
      data-testid="driver-conversation"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className="flex flex-col gap-2"
    >
      {/* agent bubble — lavender provenance (guided setup wrote this) */}
      <Bubble who="agent">
        {t("driver.convo.lead", "What do you sell, and how do you charge for it?")}
      </Bubble>

      {live ? (
        <>
          {turns!.map((text, i) => (
            <Bubble key={i} who="user" label={t("driver.convo.you", "you")}>
              {text}
            </Bubble>
          ))}
          {busy && (
            <Bubble who="agent">
              {t("driver.convo.generating", "On it — building your catalog…")}
            </Bubble>
          )}
        </>
      ) : (
        <>
          <Bubble who="user" label={t("driver.convo.you", "you")}>
            {t("driver.convo.user.sample", "Vehicle wraps. Full wraps by the vehicle, materials by the foot.")}
          </Bubble>
          <Bubble who="agent">
            {t(
              "driver.convo.reply",
              "On it. Here's your catalog — skim it, fix anything off, then build it.",
            )}
          </Bubble>
          <span
            data-testid="driver-agent-seam"
            data-deferred-phase="4"
            className="pt-1 font-mono text-micro-sm uppercase tracking-wider text-agent-text2"
          >
            {t("driver.agentSeam", "// guided assistant lands here")}
          </span>
        </>
      )}
    </motion.div>
  );
}

function Bubble({
  who,
  label,
  children,
}: {
  who: "agent" | "user";
  label?: string;
  children: React.ReactNode;
}) {
  const isAgent = who === "agent";
  return (
    <div
      data-testid={`driver-bubble-${who}`}
      className={cn("flex flex-col gap-1", isAgent ? "items-start" : "items-end")}
    >
      {label ? (
        <span className="px-1 font-mono text-micro uppercase tracking-wider text-text-mute">
          {label}
        </span>
      ) : null}
      <div
        className={cn(
          "max-w-[88%] rounded-panel border px-1.5 py-1 font-mohave text-body-sm leading-relaxed",
          isAgent
            ? "rounded-tl-chip border-agent-border bg-agent-bg text-agent-text"
            : "rounded-tr-chip border-glass-border bg-surface-hover text-text",
        )}
      >
        {children}
      </div>
    </div>
  );
}
