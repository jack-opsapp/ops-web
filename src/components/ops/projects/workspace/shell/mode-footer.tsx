"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
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

export interface ModeFooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
  return (
    <div
      data-testid="mode-footer"
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
      {destructive ? (
        <Btn
          variant="destructive"
          size="sm"
          onClick={destructive.onClick}
          disabled={destructive.disabled}
        >
          {destructive.label}
        </Btn>
      ) : null}

      {/* Meta slot — typically a `// AUTOSAVED 19:22` Mono caption */}
      {meta ? <div className="flex items-center min-w-0">{meta}</div> : null}

      {/* Spacer — pushes the right-side group to the far edge */}
      <div className="flex-1" />

      {/* Right group — secondary[], ghost, primary */}
      {secondary.map((action) => (
        <Btn
          key={action.label}
          variant="secondary"
          size="sm"
          onClick={action.onClick}
          disabled={action.disabled}
          type={action.type}
          form={action.form}
        >
          {action.label}
        </Btn>
      ))}
      {ghost ? (
        <Btn
          variant="ghost"
          size="sm"
          onClick={ghost.onClick}
          disabled={ghost.disabled}
          type={ghost.type}
          form={ghost.form}
        >
          {ghost.label}
        </Btn>
      ) : null}
      {primary ? (
        <Btn
          variant="primary"
          size="sm"
          onClick={primary.onClick}
          disabled={primary.disabled}
          type={primary.type}
          form={primary.form}
        >
          {primary.label}
        </Btn>
      ) : null}
    </div>
  );
}
