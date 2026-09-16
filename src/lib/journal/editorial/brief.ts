import { z } from "zod";

// Bumped whenever the writing instructions or the accepted shape change, and
// stamped onto every package so a draft can always be traced to the brief that
// produced it.
export const JOURNAL_BRIEF_VERSION = "ops-journal-2026-09-16-v3";

// Mirrors the candidate schema in policy.ts. The routine has no access to this
// codebase, so the accepted shape travels with every claim.
export const JOURNAL_LIMITS = {
  // Sam Parr's guide: a plain-English headline of three to ten words.
  title_words: [3, 10],
  title_chars: 80,
  subtitle: 160,
  slug: 80,
  meta_title: [50, 60],
  summary: 300,
  teaser: 200,
  topic_angle: 300,
  // Art direction for the generated header photograph; OPS appends the house style.
  image_prompt: [120, 1500],
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
  recent_images: 8,
} as const;

// The pitch: the week's topic, why now, the angle and the hook, handed to OPS
// before a word of the article is written. Mirrors pitch.ts.
export const JOURNAL_PITCH_LIMITS = {
  topic: 200,
  reader: 400,
  why_now: 800,
  ethos: 400,
  angle: 300,
  hook: 400,
  headline: 80,
  signals: [0, 12],
  chatter: [0, 8],
  chatter_shows: 240,
  // Radar signals plus search results that show the topic is hot.
  evidence_min: 3,
  // Sam Parr's guide: write 25 headlines; the editor's tightened winner may add one more.
  hooks_considered: [25, 30],
  // Three independent readers each name the three headlines they would click.
  readers: 3,
  hook_verdict: 240,
  runners_up: [2, 4],
  runner_why_not: 300,
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
    // The title and cold open deliver the pitch's hook: a business owner
    // scrolling past would stop, and the post keeps the hook's promise.
    hooked: z.boolean(),
    reason: z.enum([
      "approved",
      "unsupported_claim",
      "stale",
      "duplicate",
      "weak_copy",
      "weak_hook",
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
    review.hooked &&
    review.reason === "approved"
  );
}
