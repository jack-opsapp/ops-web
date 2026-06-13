/**
 * RegisterEmpty — the tactical empty state for register/segment tables.
 *
 * States the fact only: a hero count + a `// NOUN` caption (the widget hero-number
 * anatomy, DESIGN.md §10), with an optional terse hint. NO icon hero, NO description
 * sentence, NO CTA — DESIGN.md §2 bans coach-marks for empty states ("$0, 0%, or —.
 * No illustrations. No coach-marks.").
 *
 * This is the register counterpart to `OnboardingHint` (the soft, guidance-bearing
 * coach-mark form), which is reserved for non-register surfaces (onboarding nudges,
 * widget/panel placeholders) — never for a register that is simply empty.
 *
 * Adopted by Books (invoices/estimates), Catalog (products/stock), Clients, and the
 * inventory items register so every empty register renders byte-identical treatment.
 */

import { cn } from "@/lib/utils/cn";

export interface RegisterEmptyProps {
  /** The register noun, shown after the `//` mark. Uppercased in render. e.g. "Invoices", "Matches". */
  noun: string;
  /**
   * The empty fact rendered as the hero figure. Defaults to "0" (row count).
   * DESIGN.md §2 enumerates the empty vocabulary: "$0", "0%", or "—" — pass one of
   * those for money / percentage / dash registers.
   */
  value?: string;
  /** Optional terse note under the count. Tactical voice — a fact or a `[bracketed]` cue, never a coaching sentence. */
  hint?: string;
  className?: string;
}

export function RegisterEmpty({ noun, value = "0", hint, className }: RegisterEmptyProps) {
  return (
    <div className={cn("flex flex-col items-start gap-1 px-4 py-10", className)}>
      <span className="font-mono text-data-lg tabular-nums text-text-2">{value}</span>
      <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span aria-hidden className="text-text-mute">
          {"// "}
        </span>
        {noun}
      </span>
      {hint && <span className="font-mono text-micro tracking-[0.06em] text-text-3">{hint}</span>}
    </div>
  );
}
