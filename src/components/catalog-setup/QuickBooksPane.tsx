"use client";

// QuickBooksPane — the QuickBooks read-only catalog-pull lane (spec §8, §11; plan
// Phase 6 deferred source lanes). Mounts in the LEFT pane (master-detail) when
// the owner picks "Connect QuickBooks" in the source picker. Mirrors UploadPane:
// a separate pane the shell swaps in, presentational only — the route owns the
// OAuth read, the pull, the map, and the dedupe; this pane renders the state.
//
// ── DESIGN JUDGMENT (root CLAUDE.md law — every element justified) ─────────────
//  • DETECT, don't choose (spec §8, the canonical design-judgment rule). The
//    accounting connection already exists, so the pane DETECTS QuickBooks and
//    offers ONE action — "pull your items in" — never a QuickBooks-vs-Sage peer
//    pick. A compact live badge says "you're connected"; switching/disconnecting
//    lives in accounting settings, not mid-setup.
//  • Read-only is load-bearing TRUST. A trades owner's books are sacred — the
//    pane says, plainly, that nothing is written back to QuickBooks. That line
//    earns the pull.
//  • No accent. The steel #6F94B0 is the one BUILD IT element on the deck; PULL
//    ITEMS / CONNECT stay neutral outline. State meaning rides earth tones only —
//    olive (connected / pulled), tan (heads-up: matches to review / reconnect).
//  • Never a dead end. A reconnect-needed or unreachable QuickBooks tells the
//    owner exactly the next move (reconnect / try again), inline.
//
// ── MOTION (animation-architect → web-animations; EASE_SMOOTH, no spring) ──────
//  • Beats: ARRIVAL (pane lands), TRANSITION (state crossfade via AnimatePresence
//    mode="wait"), DISCOVERY (the pull button responds instantly), restrained
//    ACHIEVEMENT (the pulled readout — a stamp; the parade is the cards cascading
//    onto the canvas). EASE_SMOOTH throughout; reduced motion → opacity-only.
//
// VOICE: `//` mono slash titles, [brackets] for instructional micro-text, sentence
// case content, UPPERCASE authority. Never "AI", never "contractor". Strings via
// useDictionary("catalog-setup").

import {
  AlertTriangle,
  Check,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

const MONO_NUM: React.CSSProperties = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

/** The pull lifecycle the route drives; the pane renders exactly this. */
export type QuickBooksPaneStatus =
  /** Resolving whether the company has a live QuickBooks connection. */
  | "checking"
  /** No live connection — offer to connect (OAuth lives in accounting settings). */
  | "connect"
  /** Connected + detected — offer the read-only pull. */
  | "ready"
  /** Pull in flight (GET-only read of QB Items). */
  | "pulling"
  /** Items pulled + staged on the canvas. */
  | "result"
  /** The pull failed — generic (retry) or reconnect-required. */
  | "error";

/** Counts surfaced after a successful pull. */
export interface QuickBooksPaneSummary {
  /** Items mapped + staged onto the canvas. */
  pulled: number;
  /** Of those, how many matched a row already in the catalog (merge cards). */
  matched: number;
  /** Rows that can't commit until fixed (e.g. missing a name). */
  blockers?: number;
  /** Safe-defaulted rows the owner should confirm (e.g. bundles, unknown types). */
  needsReview?: number;
}

export interface QuickBooksPaneProps {
  status: QuickBooksPaneStatus;
  /** Present in the "result" state. */
  summary?: QuickBooksPaneSummary | null;
  /** Distinguishes a transient failure (retry) from a stale token (reconnect). */
  errorKind?: "generic" | "reconnect";
  /** Run the read-only pull (ready / result-again / generic-error retry). */
  onPull?: () => void;
  /** Send the owner to connect / reconnect QuickBooks (accounting OAuth). */
  onConnect?: () => void;
  /** Return to the source picker. */
  onBack?: () => void;
  className?: string;
}

type Tt = (key: string, fb?: string) => string;

export function QuickBooksPane({
  status,
  summary,
  errorKind = "generic",
  onPull,
  onConnect,
  onBack,
  className,
}: QuickBooksPaneProps) {
  const { t } = useDictionary("catalog-setup");
  const reduced = useReducedMotion();

  // Entry beat (ARRIVAL): lands with precision, no bounce; reduced motion fades.
  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  // The connected live badge shows once we know there's a connection.
  const connected = status === "ready" || status === "pulling" || status === "result";

  return (
    <motion.aside
      aria-label={t("qb.title", "// QUICKBOOKS")}
      data-testid="quickbooks-pane"
      data-status={status}
      initial={enter.initial}
      animate={enter.animate}
      transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE_SMOOTH }}
      className={cn("flex h-full flex-col", className)}
    >
      <Surface variant="default" className="flex h-full flex-col p-[30px]">
        {/* Header — panel title in mono, // slash in text-mute; compact live badge. */}
        <header>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-mono text-micro uppercase tracking-wider text-text-3">
              <span className="text-text-mute">{"//"}</span>
              <span className="ml-1.5">
                {t("qb.title", "// QUICKBOOKS").replace(/^\/\/\s*/, "")}
              </span>
            </h2>
            {connected ? (
              <span
                data-testid="quickbooks-connected-badge"
                className="flex items-center gap-1.5 rounded-chip border border-olive-line bg-olive-soft px-[6px] py-[2px] font-mono text-[10px] uppercase tracking-wider text-olive"
              >
                <span className="h-[6px] w-[6px] rounded-full bg-olive" aria-hidden />
                {t("qb.connected", "connected")}
              </span>
            ) : null}
          </div>
          <p className="mt-4 max-w-[42ch] font-mohave text-body-sm text-text-2">
            {t(
              "qb.lead",
              "Pull your price book straight from QuickBooks. It lands on the canvas, and nothing saves until you build it.",
            )}
          </p>
        </header>

        {/* Body — state crossfade (TRANSITION beat). */}
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto scrollbar-hide">
          <AnimatePresence mode="wait" initial={false}>
            {status === "checking" ? (
              <Working key="checking" t={t} reduced={!!reduced} labelKey="qb.checking" fb="Checking your QuickBooks connection…" />
            ) : status === "pulling" ? (
              <Working key="pulling" t={t} reduced={!!reduced} labelKey="qb.pulling" fb="Reading your items…" />
            ) : status === "result" ? (
              <ResultState key="result" t={t} reduced={!!reduced} summary={summary ?? { pulled: 0, matched: 0 }} onPull={onPull} />
            ) : status === "error" ? (
              <ErrorState key="error" t={t} reduced={!!reduced} errorKind={errorKind} onPull={onPull} onConnect={onConnect} />
            ) : status === "connect" ? (
              <ConnectState key="connect" t={t} reduced={!!reduced} onConnect={onConnect} />
            ) : (
              <ReadyState key="ready" t={t} reduced={!!reduced} onPull={onPull} />
            )}
          </AnimatePresence>
        </div>

        {/* Footer — back to the source picker. Bracket micro-text. */}
        <footer className="mt-6">
          <button
            type="button"
            onClick={onBack}
            data-testid="quickbooks-back"
            className="self-start font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
          >
            {t("qb.back", "[ back ]")}
          </button>
        </footer>
      </Surface>
    </motion.aside>
  );
}

export default QuickBooksPane;

// ── shared state-crossfade wrapper ───────────────────────────────────────────

function StateShell({
  testid,
  reduced,
  children,
}: {
  testid: string;
  reduced: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      data-testid={testid}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className="flex flex-col gap-4"
    >
      {children}
    </motion.div>
  );
}

/** Neutral-outline primary action (NOT accent — accent is BUILD IT alone). */
function PaneAction({
  testid,
  label,
  onClick,
  icon,
}: {
  testid: string;
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className="flex items-center gap-2 self-start rounded-[5px] border border-glass-border px-4 py-2 font-cakemono text-[12px] font-light uppercase tracking-wide text-text-2 transition-colors duration-150 hover:border-[rgba(255,255,255,0.18)] hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
    >
      {icon}
      {label}
    </button>
  );
}

// ── states ───────────────────────────────────────────────────────────────────

function Working({
  t,
  reduced,
  labelKey,
  fb,
}: {
  t: Tt;
  reduced: boolean;
  labelKey: string;
  fb: string;
}) {
  return (
    <StateShell testid="quickbooks-working" reduced={reduced}>
      <div className="flex items-center gap-3 rounded-panel border border-glass-border bg-[rgba(255,255,255,0.02)] px-4 py-4">
        <Loader2 size={18} className="animate-spin text-text-3" aria-hidden="true" />
        <span className="font-mohave text-body-sm text-text-2">{t(labelKey, fb)}</span>
      </div>
    </StateShell>
  );
}

function ReadyState({ t, reduced, onPull }: { t: Tt; reduced: boolean; onPull?: () => void }) {
  return (
    <StateShell testid="quickbooks-ready" reduced={reduced}>
      <p className="font-mohave text-body-sm text-text">
        {t("qb.ready", "You're on QuickBooks. Pull your items in?")}
      </p>
      <PaneAction
        testid="quickbooks-pull"
        label={t("qb.pull", "PULL ITEMS")}
        onClick={onPull}
        icon={<RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />}
      />
      <span className="font-mono text-micro tracking-wide text-text-3">
        {t("qb.readonly", "[ read-only — nothing changes in QuickBooks ]")}
      </span>
    </StateShell>
  );
}

function ConnectState({ t, reduced, onConnect }: { t: Tt; reduced: boolean; onConnect?: () => void }) {
  return (
    <StateShell testid="quickbooks-connect" reduced={reduced}>
      <p className="font-mohave text-body-sm text-text-2">
        {t("qb.connectLead", "Connect QuickBooks to pull your price book in.")}
      </p>
      <PaneAction
        testid="quickbooks-connect-action"
        label={t("qb.connect", "CONNECT QUICKBOOKS")}
        onClick={onConnect}
        icon={<Link2 size={14} strokeWidth={1.75} aria-hidden="true" />}
      />
      <span className="font-mono text-micro tracking-wide text-text-3">
        {t("qb.readonly", "[ read-only — nothing changes in QuickBooks ]")}
      </span>
    </StateShell>
  );
}

function ResultState({
  t,
  reduced,
  summary,
  onPull,
}: {
  t: Tt;
  reduced: boolean;
  summary: QuickBooksPaneSummary;
  onPull?: () => void;
}) {
  return (
    <StateShell testid="quickbooks-result" reduced={reduced}>
      <div
        data-testid="quickbooks-pulled"
        className="flex flex-col gap-2 rounded-panel border border-olive-line bg-olive-soft px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Check size={15} strokeWidth={2} className="text-olive" aria-hidden="true" />
          <span className="font-mohave text-body-sm text-text" style={MONO_NUM}>
            {t("qb.pulled", "Pulled {count} — review them on the right").replace(
              "{count}",
              String(summary.pulled),
            )}
          </span>
        </div>
        {summary.matched > 0 ? (
          <span
            data-testid="quickbooks-matched"
            className="font-mohave text-micro text-tan"
            style={MONO_NUM}
          >
            {t(
              "qb.matched",
              "{count} already in your catalog — merge or skip on each",
            ).replace("{count}", String(summary.matched))}
          </span>
        ) : null}
        {summary.blockers ? (
          <span
            data-testid="quickbooks-blockers"
            className="font-mohave text-micro text-rose"
            style={MONO_NUM}
          >
            {t("qb.blockers", "{count} need a name before they can save").replace(
              "{count}",
              String(summary.blockers),
            )}
          </span>
        ) : null}
        {summary.needsReview ? (
          <span
            data-testid="quickbooks-needs-review"
            className="font-mohave text-micro text-tan"
            style={MONO_NUM}
          >
            {t("qb.needsReview", "{count} to confirm — we made a best guess").replace(
              "{count}",
              String(summary.needsReview),
            )}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        data-testid="quickbooks-pull-again"
        onClick={onPull}
        className="self-start font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
      >
        {t("qb.pullAgain", "[ pull again ]")}
      </button>
    </StateShell>
  );
}

function ErrorState({
  t,
  reduced,
  errorKind,
  onPull,
  onConnect,
}: {
  t: Tt;
  reduced: boolean;
  errorKind: "generic" | "reconnect";
  onPull?: () => void;
  onConnect?: () => void;
}) {
  const isReconnect = errorKind === "reconnect";
  return (
    <StateShell testid="quickbooks-error" reduced={reduced}>
      <div className="flex items-start gap-2 rounded-panel border border-tan-line bg-tan-soft px-4 py-3">
        <AlertTriangle
          size={15}
          strokeWidth={1.75}
          className="mt-[2px] shrink-0 text-tan"
          aria-hidden="true"
        />
        <span className="font-mohave text-body-sm text-text-2">
          {isReconnect
            ? t("qb.reconnectLead", "QuickBooks needs reconnecting before you can pull.")
            : t("qb.errorLead", "Couldn't reach QuickBooks. Try again in a moment.")}
        </span>
      </div>
      {isReconnect ? (
        <PaneAction
          testid="quickbooks-reconnect"
          label={t("qb.reconnect", "RECONNECT QUICKBOOKS")}
          onClick={onConnect}
          icon={<Link2 size={14} strokeWidth={1.75} aria-hidden="true" />}
        />
      ) : (
        <button
          type="button"
          data-testid="quickbooks-retry"
          onClick={onPull}
          className="self-start font-mono text-micro tracking-wide text-text-2 transition-colors duration-150 hover:text-text"
        >
          {t("qb.retry", "[ try again ]")}
        </button>
      )}
    </StateShell>
  );
}
