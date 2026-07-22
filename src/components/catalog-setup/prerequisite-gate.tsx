"use client";

/**
 * PrerequisiteGate / GatePanel — the calm, honest stand-in shown when the
 * Catalog Setup Wizard can't run (spec §16 "Prerequisites" + "only one setup
 * session at a time per company"; plan Task 6.10 + 6.3). It NEVER crashes and
 * NEVER dead-ends: every blocked state reads as a plain, reassuring statement of
 * what's missing and what to do next.
 *
 *   • PrerequisiteGate wraps the wizard. `blocker == null` → renders children
 *     (the wizard). Otherwise it renders the matching GatePanel instead.
 *   • GatePanel is the shared presentational surface, reused for the four
 *     prerequisite reasons (no_company / baseline_not_seeded /
 *     catalog_surface_absent / subscription_locked) AND the single-session lock
 *     ("session_locked"), so there is exactly one panel implementation.
 *
 * DESIGN (DESIGN.md + plan 6.10 tokens, audit-design-system clean):
 *   • Surface `.glass-surface` (radius 10, hairline border, no shadow).
 *   • Title Cake Mono Light UPPERCASE `text-text`; body Mohave sentence-case
 *     `text-text-2`; kicker + icon in `text-text-3`. NO accent anywhere — the
 *     steel accent is reserved for the one BUILD IT CTA.
 *   • Reasons a reload can clear (a wait / a concurrency lock) offer a neutral
 *     RELOAD; reasons it can't (no company / billing) offer only a quiet exit.
 *   • Entrance: 250ms y-slide on EASE_SMOOTH; reduced motion → opacity-only
 *     (same Entry/Transition beat through fade alone). Imports `framer-motion`
 *     to match the codebase (motion.ts / offline-banner), not `motion/react`.
 *   • Copy via useDictionary("catalog-setup"); fallbacks mirror the en dict so
 *     the panel reads correctly before the namespace hydrates.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Building2,
  Clock,
  CloudOff,
  CreditCard,
  Lock,
  RotateCcw,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { BlockingPrerequisite } from "@/lib/catalog-setup/prerequisites";

/** The four prerequisite blockers plus the single-session lock. */
export type GateReason = BlockingPrerequisite | "session_locked";

/** A subtle, monochrome lucide glyph per reason (clarifies, never decorates). */
const ICONS: Record<GateReason, LucideIcon> = {
  no_company: Building2,
  baseline_not_seeded: Clock,
  catalog_surface_absent: CloudOff,
  subscription_locked: CreditCard,
  session_locked: Lock,
};

/**
 * Reasons a reload can clear: a transient wait (the baseline is still seeding,
 * the surface is momentarily unavailable) or a concurrency lock (close the other
 * window, then reload). A missing company or a billing state can't be fixed by
 * reloading — those get a quiet exit instead.
 */
const RETRYABLE: ReadonlySet<GateReason> = new Set<GateReason>([
  "baseline_not_seeded",
  "catalog_surface_absent",
  "session_locked",
]);

/** Fallback copy — mirrors the en dictionary (gate.*). */
const FALLBACK: Record<GateReason, { title: string; body: string }> = {
  no_company: {
    title: "NO COMPANY YET",
    body: "Your account isn't tied to a company. Set one up first — your catalog lives inside it.",
  },
  baseline_not_seeded: {
    title: "ALMOST READY",
    body: "We're still standing up your company's basics. Give it a minute, then reload — setup opens once that's done.",
  },
  catalog_surface_absent: {
    title: "CATALOG OFFLINE",
    body: "The catalog isn't loading right now. Try again in a moment — your setup will be here when it's back.",
  },
  subscription_locked: {
    title: "PLAN NEEDS ATTENTION",
    body: "Sort your subscription out and setup picks right back up. Nothing you've built is lost.",
  },
  session_locked: {
    title: "ALREADY IN SETUP",
    body: "Your catalog's open in another window. Finish or close it, then reload here — nothing's lost.",
  },
};

export interface GatePanelProps {
  reason: GateReason;
  /** Re-check the gate (shown only for reasons a reload can clear). */
  onReload?: () => void;
  /** Quiet exit back to the catalog. */
  onExit?: () => void;
  className?: string;
}

export function GatePanel({ reason, onReload, onExit, className }: GatePanelProps) {
  const { t } = useDictionary("catalog-setup");
  const reduced = useReducedMotion();
  const Icon = ICONS[reason];
  const fb = FALLBACK[reason];
  const showReload = RETRYABLE.has(reason) && !!onReload;
  const showExit = !!onExit;

  // The panel REPLACES the wizard (gate and shell never coexist), so it is the
  // page's primary content when shown. Move focus to it on mount so keyboard /
  // screen-reader users land on the new content and can reach RELOAD/exit — the
  // same focus-management pattern the onboarding setup screen uses. The labelled
  // region (title + body) is then announced on focus.
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className={cn(
        "flex min-h-[60vh] items-center justify-start px-3 py-6",
        className,
      )}
    >
      <motion.div
        ref={panelRef}
        role="region"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="catalog-setup-gate"
        data-reason={reason}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0.15 : 0.25, ease: EASE_SMOOTH }}
        className="glass-surface w-full max-w-[520px] px-[28px] py-[26px] outline-none"
      >
        <div className="mb-[18px] flex items-center gap-[10px]">
          <span className="flex h-[36px] w-[36px] items-center justify-center rounded-md border border-line">
            <Icon aria-hidden className="h-[20px] w-[20px] text-text-3" />
          </span>
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            {t("gate.kicker", "// catalog setup")}
          </span>
        </div>

        <h1
          id={titleId}
          className="font-cakemono text-[20px] font-light uppercase leading-tight tracking-[0.02em] text-text"
        >
          {t(`gate.${reason}.title`, fb.title)}
        </h1>
        <p
          id={bodyId}
          className="mt-[10px] max-w-[44ch] font-mohave text-body-sm font-normal leading-relaxed text-text-2"
        >
          {t(`gate.${reason}.body`, fb.body)}
        </p>

        {(showReload || showExit) && (
          <div className="mt-3 flex items-center gap-2">
            {showReload && (
              <button
                type="button"
                onClick={onReload}
                data-testid="catalog-setup-gate-reload"
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-cakemono text-cake-button font-light uppercase tracking-[0.04em] text-text-2 transition-colors hover:border-line-hi hover:text-text"
              >
                <RotateCcw aria-hidden className="h-[16px] w-[16px]" />
                {t("gate.reload", "RELOAD")}
              </button>
            )}
            {showExit && (
              <button
                type="button"
                onClick={onExit}
                data-testid="catalog-setup-gate-exit"
                className="inline-flex items-center gap-[6px] font-mohave text-body-sm font-normal text-text-3 transition-colors hover:text-text-2"
              >
                <ArrowLeft aria-hidden className="h-[16px] w-[16px]" />
                {t("gate.exit", "Back to catalog")}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

export interface PrerequisiteGateProps {
  /** The highest-priority blocker, or null when the wizard may run. */
  blocker: BlockingPrerequisite | null;
  children: ReactNode;
  onReload?: () => void;
  onExit?: () => void;
}

/**
 * Renders the wizard (children) when nothing blocks it, else the matching calm
 * gate panel. Pure presentation — the route derives `blocker` from live data
 * via deriveBlockingPrerequisite().
 */
export function PrerequisiteGate({
  blocker,
  children,
  onReload,
  onExit,
}: PrerequisiteGateProps) {
  if (blocker == null) return <>{children}</>;
  return <GatePanel reason={blocker} onReload={onReload} onExit={onExit} />;
}

export default PrerequisiteGate;
