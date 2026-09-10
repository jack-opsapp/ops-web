import { z } from "zod";

// Bumped whenever the writing instructions or the accepted shape change, and
// stamped onto every package so a draft can always be traced to the brief that
// produced it.
export const JOURNAL_BRIEF_VERSION = "ops-journal-2026-09-10-v1";

// Mirrors the candidate schema in policy.ts. The routine has no access to this
// codebase, so the accepted shape travels with every claim.
export const JOURNAL_LIMITS = {
  title_words: [5, 10],
  title_chars: 80,
  subtitle: 160,
  slug: 80,
  meta_title: [50, 60],
  summary: 300,
  teaser: 200,
  topic_angle: 300,
  // Three rows of the hero plate inside the band every public crop keeps.
  hero_line: 60,
  body_words: [1000, 1400],
  block_text: 1600,
  list_items: [2, 8],
  list_item: 400,
  internal_links: [8, 12],
  faqs: [6, 8],
  faq_question: 160,
  faq_answer_words: [60, 120],
  faq_answer_chars: 900,
  email_words: [120, 250],
  email_chars: 1800,
  citations: [2, 16],
  evidence: [1, 30],
  evidence_quote: [20, 700],
  evidence_claim: 400,
  worked_examples: 4,
} as const;

export const JOURNAL_FORMAT = {
  block_types: ["p", "h2", "h3", "blockquote", "ul", "ol"],
  inline_markup: ["**bold**", "*italic*", "[label](url)"],
  closing_line: "blockquote",
  sources_section: "server",
} as const;

// The independent editor's verdict. Every boolean is a separate judgement so a
// rejection says which one failed instead of collapsing to "no".
export const journalEditorSchema = z
  .object({
    approved: z.boolean(),
    grounded: z.boolean(),
    current: z.boolean(),
    original: z.boolean(),
    useful: z.boolean(),
    on_voice: z.boolean(),
    structured: z.boolean(),
    reason: z.enum([
      "approved",
      "unsupported_claim",
      "stale",
      "duplicate",
      "weak_copy",
      "off_voice",
      "structure",
    ]),
    notes: z.string().max(1200).optional(),
  })
  .strict();

export type JournalEditorReview = z.infer<typeof journalEditorSchema>;

export function isJournalApproved(review: JournalEditorReview): boolean {
  return (
    review.approved &&
    review.grounded &&
    review.current &&
    review.original &&
    review.useful &&
    review.on_voice &&
    review.structured &&
    review.reason === "approved"
  );
}
