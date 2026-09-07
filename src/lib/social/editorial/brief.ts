import { z } from "zod";
import type { EditorialKind } from "./policy";

// Bumped whenever the writing instructions or the accepted shape change, and
// stamped onto every package so a draft can always be traced to the brief that
// produced it.
export const EDITORIAL_BRIEF_VERSION = "ops-editorial-2026-09-07-v3";

// A near-duplicate hook is the failure the writer cannot see, so the claim
// always carries the recent history it has to stay clear of.
export const RECENT_HOOKS_LIMIT = 30;

export interface EditorialFormat {
  readonly story_types: readonly string[];
  readonly slides: { readonly min: number; readonly max: number };
  readonly closing_slide: "server" | "none";
}

// Mirrors candidateSchema and the blog closing-slide rule. The routine has no
// access to this codebase, so the accepted shape travels with the assignment.
export const EDITORIAL_LIMITS = {
  title: 100,
  hook: 90,
  angle: 220,
  caption: 1800,
  cta: 120,
  alt_text: 500,
  slide_headline: 100,
  slide_body: 350,
  evidence_quote: [20, 700],
  evidence: [1, 12],
} as const;

const BLOG_FORMAT: EditorialFormat = {
  story_types: ["blog_signal"],
  // Cover plus at least three takeaways; the server owns the closing slide.
  slides: { min: 4, max: 6 },
  closing_slide: "server",
};

const PROTOCOL_FORMAT: EditorialFormat = {
  story_types: ["operator_protocol"],
  slides: { min: 1, max: 6 },
  closing_slide: "none",
};

const ROTATION_FORMAT: EditorialFormat = {
  story_types: [
    "roast_card",
    "field_dispatch",
    "performance_proof",
    "release_note",
    "operator_protocol",
  ],
  slides: { min: 1, max: 6 },
  closing_slide: "none",
};

const FORMATS: Record<EditorialKind, EditorialFormat> = {
  blog: BLOG_FORMAT,
  protocol: PROTOCOL_FORMAT,
  product: PROTOCOL_FORMAT,
  rotation: ROTATION_FORMAT,
};

export interface EditorialBrief {
  readonly version: string;
  readonly format: EditorialFormat;
  readonly limits: typeof EDITORIAL_LIMITS;
}

export function loadEditorialBrief(kind: EditorialKind): EditorialBrief {
  return {
    version: EDITORIAL_BRIEF_VERSION,
    format: FORMATS[kind],
    limits: EDITORIAL_LIMITS,
  };
}

// The independent editor's verdict. Every boolean is a separate judgement so a
// rejection says which one failed instead of collapsing to "no".
export const editorReviewSchema = z
  .object({
    approved: z.boolean(),
    grounded: z.boolean(),
    current: z.boolean(),
    distinct: z.boolean(),
    useful: z.boolean(),
    format_supported: z.boolean(),
    identifies_subject: z.boolean(),
    clear_without_caption: z.boolean(),
    reason: z.enum([
      "approved",
      "unsupported_claim",
      "stale",
      "repetitive",
      "weak_copy",
      "unsupported_format",
      "unclear",
      "off_subject",
    ]),
    notes: z.string().max(1200).optional(),
  })
  .strict();

export type EditorialReview = z.infer<typeof editorReviewSchema>;

export function isEditorialApproved(review: EditorialReview): boolean {
  return (
    review.approved &&
    review.grounded &&
    review.current &&
    review.distinct &&
    review.useful &&
    review.format_supported &&
    review.identifies_subject &&
    review.clear_without_caption &&
    review.reason === "approved"
  );
}
