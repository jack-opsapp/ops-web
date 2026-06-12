"use client";

/**
 * Tag — the shared DESIGN.md §9 tag/badge.
 *
 * Spec: JetBrains Mono 500 / 11px / 0.12em tracked / uppercase,
 * 4px radius, 2px 6px padding. Neutral by default; earth tones ONLY when
 * the color carries semantic meaning (olive = positive, tan = attention,
 * rose = negative, dim = retired/inert).
 *
 * Promoted from the Books status tags (P3.1). The older `ui/badge`
 * (Cake Mono, 2.5px radius, status-palette variants) predates spec v2 —
 * the P4 conformance sweep reconciles its consumers onto this primitive.
 */

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const tagVariants = cva(
  [
    "inline-flex items-center gap-[4px] whitespace-nowrap rounded-[4px] border px-[6px] py-[2px]",
    "font-mono text-micro font-medium uppercase tracking-[0.12em]",
  ],
  {
    variants: {
      variant: {
        neutral: "border-border bg-[rgba(255,255,255,0.05)] text-text-2",
        olive: "border-olive-line bg-olive-soft text-olive",
        tan: "border-tan-line bg-tan-soft text-tan",
        rose: "border-rose-line bg-rose-soft text-rose",
        /** Inert/retired states (draft, void): outline only, quiet text. */
        dim: "border-border bg-transparent text-text-3",
        /** Fully muted terminal states (written off). */
        mute: "border-border bg-transparent text-text-mute",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface TagProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof tagVariants> {}

export function Tag({ className, variant, ...props }: TagProps) {
  return <span className={cn(tagVariants({ variant }), className)} {...props} />;
}
