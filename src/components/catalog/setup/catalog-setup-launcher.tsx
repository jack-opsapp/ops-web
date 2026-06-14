"use client";

/**
 * CatalogSetupLauncher — the first-run invitation that takes over /catalog when a
 * company has 0 products AND 0 stock (spec §6 entry-point 1). It replaces the
 * empty supply strip + segment tables with a single, quiet invitation into the
 * guided setup — never a wall, never a block.
 *
 * ── DESIGN JUDGMENT (root CLAUDE.md law — every element justified) ─────────────
 *  • This is the Entry/Arrival beat: a stressed owner just hit an empty catalog,
 *    thinking "another setup chore." The surface counters that with one calm,
 *    confident move — a lifeline, not a tech demo. So it is ONE glass card, ONE
 *    headline, ONE sub, ONE accent CTA, and a ghost exit. Nothing else.
 *  • The accent (#6F94B0) lands on the single CTA only — the one element that
 *    moves the operator forward. The exit is a ghost (text-3), because once-ever
 *    setup must never own prime space and leaving must cost nothing (spec §6:
 *    "set up later" always available).
 *  • No hero icon. DESIGN.md bans icon-heroes on empty surfaces; the Cake Mono
 *    headline IS the hero. The lone glyph is the CTA's forward arrow — an
 *    affordance ("this goes into setup"), not decoration.
 *  • Permission-aware: operators/crew without catalog.run_setup never see a dead
 *    CTA — the component renders null for them (spec §16 role matrix). The empty
 *    catalog they see is the honest register empty state, not a locked invite.
 *
 * ── MOTION (animation-architect → web-animations) ─────────────────────────────
 *  Entry beat — the card arrives with precision: a staggered fade + 8px rise
 *  (kicker → headline → sub → actions) on the canonical EASE_SMOOTH curve, no
 *  spring, no bounce. Under prefers-reduced-motion it degrades to an opacity-only
 *  fade that serves the same arrival beat (never a disabled no-op). No haptic
 *  (web). The choreography reuses the wizard's motion tokens so the invitation
 *  and the deck it opens speak one motion language.
 *
 * VOICE: `//` mono kicker (the honest situation), Cake Mono Light UPPERCASE
 * headline + CTA (authority), Mohave sentence-case sub (content), JetBrains Mono
 * micro for the kicker + exit. Strings via useDictionary("catalog-setup").
 */

import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  CARD_ENTER_DURATION,
  CARD_STAGGER,
  REDUCED_DURATION,
} from "@/lib/catalog-setup/motion";

export interface CatalogSetupLauncherProps {
  /** Quiet "set up later" exit — flips the host back to the (still-empty) catalog. */
  onDismiss?: () => void;
  className?: string;
}

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: CARD_STAGGER, delayChildren: 0.02 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: CARD_ENTER_DURATION, ease: EASE_SMOOTH },
  },
};
const reducedContainerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0 } },
};
const reducedItemVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: REDUCED_DURATION } },
};

export function CatalogSetupLauncher({ onDismiss, className }: CatalogSetupLauncherProps) {
  const { t } = useDictionary("catalog-setup");
  const can = usePermissionStore((s) => s.can);
  const reduced = useReducedMotion();

  // Operators / crew without the run-setup grant never see a dead CTA. Their
  // empty catalog stays the honest register empty state (spec §16).
  if (!can("catalog.run_setup")) return null;

  const container = reduced ? reducedContainerVariants : containerVariants;
  const item = reduced ? reducedItemVariants : itemVariants;

  return (
    <motion.section
      aria-label="Catalog setup"
      data-testid="catalog-setup-launcher"
      initial="hidden"
      animate="visible"
      variants={container}
      className={cn(
        "glass-surface flex max-w-[640px] flex-col items-start px-5 py-5",
        className,
      )}
    >
      <motion.span
        variants={item}
        className="font-mono text-micro uppercase tracking-[0.16em] text-text-3"
      >
        <span aria-hidden className="text-text-mute">
          {"// "}
        </span>
        {t("firstRun.kicker", "nothing here yet")}
      </motion.span>

      <motion.h2
        variants={item}
        className="mt-2 font-cakemono text-[28px] font-light uppercase leading-none text-text"
      >
        {t("firstRun.headline", "Stand up your catalog")}
      </motion.h2>

      <motion.p
        variants={item}
        className="mt-4 max-w-[48ch] font-mohave text-body text-text-2"
      >
        {t(
          "firstRun.sub",
          "Your price book, your stock, your trades — set up once, ready for every estimate.",
        )}
      </motion.p>

      <motion.div variants={item} className="mt-6 flex items-center gap-4">
        {/* The ONE ops-accent element — outlined at rest, fills on hover. A
            next/link so it is a real navigation (and right-clickable). */}
        <Link
          href="/catalog/setup"
          data-testid="catalog-setup-start"
          className="group inline-flex items-center gap-2 rounded-[5px] border border-ops-accent px-6 py-2 font-cakemono text-[14px] font-light uppercase tracking-wide text-ops-accent transition-colors duration-150 hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {t("firstRun.cta", "Start setup")}
          <ArrowRight aria-hidden className="h-[16px] w-[16px]" />
        </Link>

        <button
          type="button"
          data-testid="catalog-setup-later"
          onClick={onDismiss}
          className="font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
        >
          {t("firstRun.later", "Set up later")}
        </button>
      </motion.div>
    </motion.section>
  );
}

export default CatalogSetupLauncher;
