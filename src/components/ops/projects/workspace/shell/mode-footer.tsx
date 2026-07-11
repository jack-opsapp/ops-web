"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { Btn } from "@/components/ops/projects/workspace/atoms/btn";

// `ModeFooter` — bottom action bar of the workspace. Slot order is
// strict, left → right:
//
//   destructive | meta | (spacer) | secondary[] | ghost | primary
//
// Each mode (viewing / editing / creating) supplies its own config; the
// footer is dumb — it just lays out whatever the config gives it. ONE
// primary slot enforces the brand rule: a single accent CTA per
// surface. The rule is enforced by the type (primary is a single
// optional value, not an array).
//
// Phase 12.3 — FLIP layout animation. Each button slot is a motion.div
// keyed by its label so when modes swap (viewing ⇄ editing ⇄ creating)
// and the action set changes wholesale, framer-motion animates each
// button to its new position over 220ms. Buttons that disappear fade +
// scale out via AnimatePresence; buttons that appear fade + scale in.
// Reduced motion kills the layout animation and collapses the
// fade/scale to a 0ms swap.

const FOOTER_LAYOUT_DURATION = 0.22;

export interface ModeFooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  // Optional leading glyph rendered before the label (14–16px lucide,
  // monochrome via `currentColor`). Only the client-workspace quick actions
  // (NEW ESTIMATE / PROJECT / INVOICE) set it today; every existing project-
  // workspace action omits it and renders label-only, unchanged.
  icon?: React.ReactNode;
  // Optional native button attributes — used by the workspace container
  // to bind a footer CTA to the edit/create composer's form via the HTML
  // `form="<id>"` association. The body's react-hook-form handler then
  // owns submit dispatch without the footer needing a callback ref.
  type?: "button" | "submit" | "reset";
  form?: string;
}

export interface ModeFooterConfig {
  /** Far-left destructive action — archive, delete, etc. */
  destructive?: ModeFooterAction;
  /** Free-form meta content (timestamps, autosave indicator). */
  meta?: React.ReactNode;
  /** Right-side secondary actions, rendered in order. */
  secondary: ReadonlyArray<ModeFooterAction>;
  /** Optional ghost CTA to the immediate left of primary (Cancel). */
  ghost?: ModeFooterAction;
  /**
   * Single primary CTA — the accent button. Optional because viewing
   * mode has no primary action; editing has SAVE; creating has CREATE.
   */
  primary?: ModeFooterAction;
}

export interface ModeFooterProps {
  config: ModeFooterConfig;
  className?: string;
}

export function ModeFooter({ config, className }: ModeFooterProps) {
  const { destructive, meta, secondary, ghost, primary } = config;
  const reducedMotion = useReducedMotion() ?? false;
  const transition = reducedMotion
    ? { duration: 0 }
    : { duration: FOOTER_LAYOUT_DURATION, ease: EASE_SMOOTH };

  const slotInitial = reducedMotion ? false : { opacity: 0, scale: 0.96 };
  const slotAnimate = { opacity: 1, scale: 1 };
  const slotExit = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.96 };

  return (
    <motion.div
      data-testid="mode-footer"
      layout={!reducedMotion}
      transition={transition}
      className={cn(
        "flex items-center gap-[10px]",
        "py-[10px] px-[18px]",
        "border-t border-glass-border",
        // Footer reads as a slightly heavier glass than the body — the
        // --scrim-input-bg (0.45) + 12px blur produces enough contrast
        // that the primary CTA outlined-accent border separates from
        // the body. (Consolidated from 0.42 → 0.45 per design-token
        // mapping 2026-05-07; visual delta undetectable.)
        "bg-[var(--scrim-input-bg)] backdrop-blur-[12px]",
        className,
      )}
    >
      {/* Destructive — far left */}
      <AnimatePresence initial={false}>
        {destructive ? (
          <motion.div
            key={`destructive:${destructive.label}`}
            data-testid={`mode-footer-slot-destructive:${destructive.label}`}
            layout={!reducedMotion}
            initial={slotInitial}
            animate={slotAnimate}
            exit={slotExit}
            transition={transition}
            className="inline-flex"
          >
            <Btn
              variant="destructive"
              size="sm"
              onClick={destructive.onClick}
              disabled={destructive.disabled}
              type={destructive.type}
              form={destructive.form}
            >
              {destructive.icon}
              {destructive.label}
            </Btn>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Meta slot — typically a `// AUTOSAVED 19:22` Mono caption */}
      {meta ? <div className="flex items-center min-w-0">{meta}</div> : null}

      {/* Spacer — pushes the right-side group to the far edge */}
      <div className="flex-1" />

      {/* Right group — secondary[], ghost, primary. AnimatePresence
          here owns the enter/exit; layout prop on each slot animates
          position when sibling buttons appear/disappear. */}
      <AnimatePresence initial={false}>
        {secondary.map((action) => (
          <motion.div
            key={`secondary:${action.label}`}
            data-testid={`mode-footer-slot-secondary:${action.label}`}
            layout={!reducedMotion}
            initial={slotInitial}
            animate={slotAnimate}
            exit={slotExit}
            transition={transition}
            className="inline-flex"
          >
            <Btn
              variant="secondary"
              size="sm"
              onClick={action.onClick}
              disabled={action.disabled}
              type={action.type}
              form={action.form}
            >
              {action.icon}
              {action.label}
            </Btn>
          </motion.div>
        ))}
        {ghost ? (
          <motion.div
            key={`ghost:${ghost.label}`}
            data-testid={`mode-footer-slot-ghost:${ghost.label}`}
            layout={!reducedMotion}
            initial={slotInitial}
            animate={slotAnimate}
            exit={slotExit}
            transition={transition}
            className="inline-flex"
          >
            <Btn
              variant="ghost"
              size="sm"
              onClick={ghost.onClick}
              disabled={ghost.disabled}
              type={ghost.type}
              form={ghost.form}
            >
              {ghost.icon}
              {ghost.label}
            </Btn>
          </motion.div>
        ) : null}
        {primary ? (
          <motion.div
            key={`primary:${primary.label}`}
            data-testid={`mode-footer-slot-primary:${primary.label}`}
            layout={!reducedMotion}
            initial={slotInitial}
            animate={slotAnimate}
            exit={slotExit}
            transition={transition}
            className="inline-flex"
          >
            <Btn
              variant="primary"
              size="sm"
              onClick={primary.onClick}
              disabled={primary.disabled}
              type={primary.type}
              form={primary.form}
            >
              {primary.icon}
              {primary.label}
            </Btn>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
