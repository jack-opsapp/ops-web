import { z } from "zod";
import { isDuplicate } from "../../social/editorial/policy";
import { JOURNAL_LIMITS } from "./brief";
import {
  JournalMarkupError,
  assertPlainText,
  countJournalWords,
  countPlainWords,
  renderBlocks,
  renderEmailContent,
  renderSourcesSection,
  sanitizeJournalHtml,
  type InlineLink,
  type JournalBlock,
} from "./article-html";

export const JOURNAL_CATEGORY_SLUGS = [
  "growth",
  "industry-intel",
  "leadership-and-crew",
  "money-and-margins",
  "operations",
  "technology",
] as const;

// ops-site `src/lib/industries.ts` on origin/main 5c2701a (2026-09-03). The
// writer receives this list on every claim and may link only these pages.
export const JOURNAL_INDUSTRY_SLUGS = [
  "landscaping", "auto-detailing", "railings", "pool-service", "garage-door",
  "fencing", "tree-service", "concrete", "flooring", "drywall",
  "appliance-repair", "handyman", "pressure-washing", "snow-removal",
  "window-cleaning", "chimney-sweep", "locksmith", "hvac", "plumbing",
  "electrical", "roofing", "pest-control", "painting", "general-contracting",
  "cleaning", "property-maintenance", "glass", "septic", "irrigation",
  "water-treatment", "insulation", "fire-protection", "demolition",
  "restoration", "mold-remediation", "waterproofing", "siding", "gutters",
  "paving", "welding", "excavation", "tile", "stucco", "carpentry", "cabinets",
  "commercial-door", "elevator", "audio-visual", "scaffolding",
] as const;

export const JOURNAL_DRAFT_CODES = [
  "SCHEMA_INVALID",
  "MARKUP_INVALID",
  "TITLE_FORMAT",
  "META_TITLE_LENGTH",
  "CATEGORY_INVALID",
  "TOPIC_INVALID",
  "STRUCTURE",
  "WORD_COUNT",
  "FAQ_COUNT",
  "FAQ_LENGTH",
  "EMAIL_LENGTH",
  "VOICE_REJECTED",
  "STALE_FRAMING",
  "SLUG_TAKEN",
  "DUPLICATE_TOPIC",
  "CITATION_INVALID",
  "EVIDENCE_INVALID",
  "LINK_REJECTED",
  "INTERNAL_LINKS",
  "WORKED_EXAMPLE_INVALID",
  "UNSUPPORTED_NUMBER",
] as const;
export type JournalDraftCode = (typeof JOURNAL_DRAFT_CODES)[number];

export interface JournalDraftIssue {
  path: string;
  message: string;
}

/** A fixable rejection: the routine reads the code and the issues and resubmits. */
export class JournalDraftError extends Error {
  constructor(
    public readonly code: JournalDraftCode,
    public readonly issues: JournalDraftIssue[] = []
  ) {
    super(code);
    this.name = "JournalDraftError";
  }
}

const L = JOURNAL_LIMITS;
const field = (max: number) => z.string().trim().min(1).max(max);
const textBlock = z
  .object({ type: z.enum(["p", "h2", "h3", "blockquote"]), text: field(L.block_text) })
  .strict();
const listBlock = z
  .object({
    type: z.enum(["ul", "ol"]),
    items: z.array(field(L.list_item)).min(L.list_items[0]).max(L.list_items[1]),
  })
  .strict();

export const journalCandidateSchema = z
  .object({
    title: field(L.title_chars),
    subtitle: field(L.subtitle),
    slug: z
      .string()
      .max(L.slug)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    meta_title: field(80),
    summary: field(L.summary),
    teaser: field(L.teaser),
    category: z.string(),
    topic: z
      .object({
        backlog_topic_id: z.string().uuid().nullable(),
        angle: field(L.topic_angle),
      })
      .strict(),
    hero_line: field(L.hero_line),
    body: z.array(z.union([textBlock, listBlock])).min(8).max(90),
    faqs: z
      .array(
        z
          .object({ question: field(L.faq_question), answer: field(L.faq_answer_chars) })
          .strict()
      )
      .min(1)
      .max(12),
    email_content: field(L.email_chars),
    citations: z
      .array(
        z
          .object({ source_id: z.string().uuid(), role: z.enum(["primary", "supporting"]) })
          .strict()
      )
      .min(1)
      .max(L.citations[1]),
    evidence: z
      .array(
        z
          .object({
            claim: field(L.evidence_claim),
            source_id: z.string().uuid(),
            quote: z.string().min(L.evidence_quote[0]).max(L.evidence_quote[1]),
          })
          .strict()
      )
      .min(L.evidence[0])
      .max(L.evidence[1]),
    worked_examples: z.array(field(600)).max(L.worked_examples).default([]),
  })
  .strict();
export type JournalCandidate = z.infer<typeof journalCandidateSchema>;

export interface JournalSourceRef {
  id: string;
  url: string;
  final_url: string;
  title: string | null;
  site_name: string | null;
  text: string;
}

export interface JournalPolicyContext {
  /** Every snapshot OPS stored for this assignment. */
  sources: JournalSourceRef[];
  /** Live posts: link targets, taken slugs and the duplicate window. */
  livePosts: Array<{ slug: string; title: string; published_at: string }>;
  categories: Array<{ id: string; slug: string }>;
  backlogTopicIds: string[];
  industrySlugs: readonly string[];
  /** The product-facts document: numbers in it are approved brand facts. */
  productFacts: string;
  now: Date;
}

export interface PreparedJournalDraft {
  article: {
    title: string;
    subtitle: string;
    slug: string;
    meta_title: string;
    summary: string;
    teaser: string;
    category: string;
    topic: { backlog_topic_id: string | null; angle: string };
    hero_line: string;
    faqs: Array<{ question: string; answer: string }>;
    email_content: string;
  };
  html: string;
  word_count: number;
  category_id: string;
  citations: Array<{
    source_id: string;
    role: "primary" | "supporting";
    url: string;
    final_url: string;
    title: string | null;
    site_name: string | null;
  }>;
  evidence: JournalCandidate["evidence"];
  worked_examples: string[];
  internal_links: string[];
}

// Word lists come from the ops-copywriter brand-voice bible and the Bible's
// universal don't-say list (14_FEATURE_POSITIONING.md).
const BANNED_WORDS = [
  "leverage", "leverages", "leveraging", "synergy", "synergies", "paradigm",
  "ecosystem", "ecosystems", "revolutionary", "disruptive", "cutting-edge",
  "state-of-the-art", "best-in-class", "world-class", "enterprise-grade",
  "seamless", "seamlessly", "frictionless", "holistic", "empower", "empowers",
  "empowering", "solution", "solutions", "platform", "platforms",
  "stakeholders", "facilitate", "facilitates", "optimize", "optimizes",
  "optimizing", "maximize", "maximizes", "robust", "streamlined", "scalable",
  "powerful", "next-generation", "ai-powered",
];
const BANNED_PATTERN = new RegExp(
  // Hyphens are literal outside a character class, and the unicode flag
  // rejects an escaped one.
  `(?<![\\p{L}\\p{N}-])(?:${BANNED_WORDS.join("|")})(?![\\p{L}\\p{N}-])`,
  "iu"
);
const CONTRACTOR = /(?<![\p{L}])contractors?(?![\p{L}])/iu;
const HEDGES = /\b(?:could potentially|we believe)\b/i;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/u;
const STALE = /\b(?:this week|last week|next week|today|today's|tonight|yesterday|tomorrow|this morning|breaking news|just announced|just released|just launched)\b/i;
const ILLUSTRATION_CUE = /\b(?:say|for example|for instance|imagine|suppose|call it|picture|if a|if an|if your|if you)\b/i;
const NUMBER = /\d(?:[\d,]*\d)?(?:\.\d+)?/g;

export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function numbersIn(value: string): string[] {
  return (value.match(NUMBER) ?? []).map((token) => token.replace(/,/g, ""));
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function fail(code: JournalDraftCode, issues: JournalDraftIssue[]): never {
  throw new JournalDraftError(code, issues.slice(0, 20));
}

function wordsOf(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function isTitleCase(value: string): boolean {
  const words = wordsOf(value).filter((word) => /\p{L}/u.test(word));
  return words.length >= 3 && words.every((word) => /^\p{Lu}/u.test(word.replace(/^[^\p{L}]+/u, "")));
}

function isShouting(value: string): boolean {
  const letters = value.replace(/[^\p{L}]/gu, "");
  return letters.length > 3 && letters === letters.toUpperCase();
}

export function prepareJournalDraft(
  raw: unknown,
  ctx: JournalPolicyContext
): PreparedJournalDraft {
  const parsed = journalCandidateSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      "SCHEMA_INVALID",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  const c = parsed.data;
  const body = c.body as JournalBlock[];

  // --- markup ---------------------------------------------------------------
  let rendered: ReturnType<typeof renderBlocks>;
  try {
    rendered = renderBlocks(body);
  } catch (error) {
    fail("MARKUP_INVALID", [
      { path: "body", message: error instanceof Error ? error.message : "Invalid markup" },
    ]);
  }
  const plainFields: Array<[string, string]> = [
    ["title", c.title],
    ["subtitle", c.subtitle],
    ["meta_title", c.meta_title],
    ["summary", c.summary],
    ["teaser", c.teaser],
    ["hero_line", c.hero_line],
    ["email_content", c.email_content],
    ...c.faqs.flatMap((faq, index): Array<[string, string]> => [
      [`faqs.${index}.question`, faq.question],
      [`faqs.${index}.answer`, faq.answer],
    ]),
  ];
  const markupIssues: JournalDraftIssue[] = [];
  for (const [path, value] of plainFields) {
    try {
      assertPlainText(value);
    } catch (error) {
      if (error instanceof JournalMarkupError)
        markupIssues.push({ path, message: error.message });
      else throw error;
    }
  }
  if (markupIssues.length) fail("MARKUP_INVALID", markupIssues);

  // --- title and metadata ---------------------------------------------------
  const titleWords = wordsOf(c.title).length;
  if (
    c.title !== c.title.toUpperCase() ||
    titleWords < L.title_words[0] ||
    titleWords > L.title_words[1] ||
    /[.!]$/.test(c.title)
  )
    fail("TITLE_FORMAT", [
      {
        path: "title",
        message: `ALL CAPS, ${L.title_words[0]}–${L.title_words[1]} words, no closing period (got ${titleWords} words)`,
      },
    ]);
  if (c.meta_title.length < L.meta_title[0] || c.meta_title.length > L.meta_title[1])
    fail("META_TITLE_LENGTH", [
      {
        path: "meta_title",
        message: `${L.meta_title[0]}–${L.meta_title[1]} characters (got ${c.meta_title.length})`,
      },
    ]);
  const category = ctx.categories.find((entry) => entry.slug === c.category);
  if (!category)
    fail("CATEGORY_INVALID", [
      { path: "category", message: `one of ${ctx.categories.map((entry) => entry.slug).join(", ")}` },
    ]);
  if (c.topic.backlog_topic_id && !ctx.backlogTopicIds.includes(c.topic.backlog_topic_id))
    fail("TOPIC_INVALID", [
      { path: "topic.backlog_topic_id", message: "not an unused backlog topic from the claim; use null for your own topic" },
    ]);

  // --- structure --------------------------------------------------------------
  const structureIssues: JournalDraftIssue[] = [];
  const headings = body
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.type === "h2" || block.type === "h3");
  if (body[0].type !== "p")
    structureIssues.push({ path: "body.0", message: "open with a paragraph (the cold open)" });
  const last = body[body.length - 1];
  if (last.type !== "blockquote")
    structureIssues.push({ path: `body.${body.length - 1}`, message: "end on the one-line blockquote" });
  else {
    const closingWords = countPlainWords(rendered.plain[body.length - 1]);
    if (closingWords < 6 || closingWords > 16)
      structureIssues.push({
        path: `body.${body.length - 1}`,
        message: `the closing line is 6–16 words (got ${closingWords})`,
      });
  }
  if (body.filter((block) => block.type === "h2").length < 3)
    structureIssues.push({ path: "body", message: "use at least three h2 sections" });
  for (const { block, index } of headings) {
    const text = rendered.plain[index];
    if (isShouting(text) || isTitleCase(text))
      structureIssues.push({ path: `body.${index}`, message: "headings are sentence case" });
    const next = body[index + 1];
    if (!next || next.type === "h2" || next.type === "h3")
      structureIssues.push({ path: `body.${index}`, message: "every heading is followed by content" });
    if (block.type === "h2" && index === body.length - 1)
      structureIssues.push({ path: `body.${index}`, message: "do not end on a heading" });
  }
  if (body.filter((block) => block.type === "blockquote").length > 3)
    structureIssues.push({ path: "body", message: "at most three blockquotes, including the closing line" });
  if (body.filter((block) => block.type === "ul" || block.type === "ol").length > 3)
    structureIssues.push({ path: "body", message: "at most three lists" });
  if (structureIssues.length) fail("STRUCTURE", structureIssues);

  const wordCount = countJournalWords(rendered.html);
  if (wordCount < L.body_words[0] || wordCount > L.body_words[1])
    fail("WORD_COUNT", [
      { path: "body", message: `${L.body_words[0]}–${L.body_words[1]} words (got ${wordCount})` },
    ]);

  if (c.faqs.length < L.faqs[0] || c.faqs.length > L.faqs[1])
    fail("FAQ_COUNT", [{ path: "faqs", message: `${L.faqs[0]}–${L.faqs[1]} FAQs (got ${c.faqs.length})` }]);
  const faqIssues = c.faqs.flatMap((faq, index) => {
    const words = countPlainWords(faq.answer);
    return words < L.faq_answer_words[0] || words > L.faq_answer_words[1]
      ? [{ path: `faqs.${index}.answer`, message: `${L.faq_answer_words[0]}–${L.faq_answer_words[1]} words (got ${words})` }]
      : [];
  });
  if (faqIssues.length) fail("FAQ_LENGTH", faqIssues);
  const emailWords = countPlainWords(c.email_content);
  if (emailWords < L.email_words[0] || emailWords > L.email_words[1])
    fail("EMAIL_LENGTH", [
      { path: "email_content", message: `${L.email_words[0]}–${L.email_words[1]} words (got ${emailWords})` },
    ]);

  // --- voice ------------------------------------------------------------------
  const publicText: Array<[string, string]> = [
    ...plainFields,
    ...rendered.plain.map((value, index): [string, string] => [`body.${index}`, value]),
  ];
  const voiceIssues: JournalDraftIssue[] = [];
  for (const [path, value] of publicText) {
    const banned = BANNED_PATTERN.exec(value);
    if (banned) voiceIssues.push({ path, message: `banned word "${banned[0]}"` });
    if (CONTRACTOR.test(value))
      voiceIssues.push({ path, message: `"contractor" is banned; say subtrades, the trades, crews, owner-operators or business owners` });
    if (value.includes("!")) voiceIssues.push({ path, message: "no exclamation points" });
    if (EMOJI.test(value)) voiceIssues.push({ path, message: "no emoji" });
    if (HASHTAG.test(value)) voiceIssues.push({ path, message: "no hashtags" });
    const hedge = HEDGES.exec(value);
    if (hedge) voiceIssues.push({ path, message: `hedge "${hedge[0]}"` });
  }
  if (/^ai\b/i.test(c.title.trim()) || /^ai\b/i.test(rendered.plain[0].trim()))
    voiceIssues.push({ path: "title", message: "never lead with AI" });
  if (voiceIssues.length) fail("VOICE_REJECTED", voiceIssues);

  const staleIssues = publicText.flatMap(([path, value]) => {
    const match = STALE.exec(value);
    return match ? [{ path, message: `"${match[0]}" goes stale; use a date or cut it` }] : [];
  });
  if (staleIssues.length) fail("STALE_FRAMING", staleIssues);

  // --- originality ------------------------------------------------------------
  const liveSlugs = new Set(ctx.livePosts.map((post) => post.slug));
  if (liveSlugs.has(c.slug))
    fail("SLUG_TAKEN", [{ path: "slug", message: "a live post already uses this slug" }]);
  const yearAgo = ctx.now.getTime() - 365 * 86400000;
  const recentTitles = ctx.livePosts
    .filter((post) => Date.parse(post.published_at) >= yearAgo)
    .map((post) => post.title);
  if (isDuplicate(c.title, recentTitles))
    fail("DUPLICATE_TOPIC", [{ path: "title", message: "too close to a live post from the last year" }]);

  // --- citations and evidence ---------------------------------------------------
  const sourcesById = new Map(ctx.sources.map((source) => [source.id, source]));
  const citationIssues: JournalDraftIssue[] = [];
  const cited = new Set<string>();
  c.citations.forEach((citation, index) => {
    if (!sourcesById.has(citation.source_id))
      citationIssues.push({ path: `citations.${index}`, message: "not a source OPS fetched for this assignment" });
    if (cited.has(citation.source_id))
      citationIssues.push({ path: `citations.${index}`, message: "cited twice" });
    cited.add(citation.source_id);
  });
  if (cited.size < L.citations[0])
    citationIssues.push({ path: "citations", message: `cite at least ${L.citations[0]} sources` });
  for (const id of cited)
    if (!c.evidence.some((entry) => entry.source_id === id))
      citationIssues.push({ path: "citations", message: `source ${id} is cited but backs no evidence entry` });
  if (citationIssues.length) fail("CITATION_INVALID", citationIssues);

  const evidenceIssues: JournalDraftIssue[] = [];
  c.evidence.forEach((entry, index) => {
    const source = sourcesById.get(entry.source_id);
    if (!source || !cited.has(entry.source_id)) {
      evidenceIssues.push({ path: `evidence.${index}`, message: "the source is not in citations" });
      return;
    }
    if (!normalizeForMatch(source.text).includes(normalizeForMatch(entry.quote)))
      evidenceIssues.push({
        path: `evidence.${index}.quote`,
        message: "not found verbatim in the page OPS fetched; copy it character for character",
      });
  });
  if (evidenceIssues.length) fail("EVIDENCE_INVALID", evidenceIssues);

  // --- links --------------------------------------------------------------------
  const sourceUrls = new Set(
    [...cited].flatMap((id) => {
      const source = sourcesById.get(id)!;
      return [normalizeUrl(source.url), normalizeUrl(source.final_url)].filter(
        (value): value is string => Boolean(value)
      );
    })
  );
  const industry = new Set(ctx.industrySlugs);
  const internal: string[] = [];
  const linkIssues: JournalDraftIssue[] = [];
  rendered.links.forEach((link: InlineLink, index) => {
    const journal = /^\/journal\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(link.url);
    const industryPage = /^\/industries\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(link.url);
    if (journal) {
      if (liveSlugs.has(journal[1])) internal.push(`/journal/${journal[1]}`);
      else linkIssues.push({ path: `links.${index}`, message: `${link.url} is not a live post` });
      return;
    }
    if (industryPage) {
      if (industry.has(industryPage[1])) internal.push(`/industries/${industryPage[1]}`);
      else linkIssues.push({ path: `links.${index}`, message: `${link.url} is not an industry page` });
      return;
    }
    const external = link.url.startsWith("https://") ? normalizeUrl(link.url) : null;
    if (!external || !sourceUrls.has(external))
      linkIssues.push({
        path: `links.${index}`,
        message: `${link.url} is neither a cited source, a live post nor an industry page`,
      });
  });
  if (linkIssues.length) fail("LINK_REJECTED", linkIssues);
  if (internal.length < L.internal_links[0] || internal.length > L.internal_links[1])
    fail("INTERNAL_LINKS", [
      {
        path: "body",
        message: `${L.internal_links[0]}–${L.internal_links[1]} links to /journal/ and /industries/ pages (got ${internal.length})`,
      },
    ]);

  // --- numbers --------------------------------------------------------------------
  const bodyText = rendered.plain.join("\n");
  const exampleIssues: JournalDraftIssue[] = [];
  c.worked_examples.forEach((sentence, index) => {
    if (!bodyText.includes(sentence))
      exampleIssues.push({ path: `worked_examples.${index}`, message: "not found word for word in the body" });
    else if (!/\d/.test(sentence) || !ILLUSTRATION_CUE.test(sentence))
      exampleIssues.push({
        path: `worked_examples.${index}`,
        message: "a worked example contains a number and reads as hypothetical (say, for example, imagine, call it, if you…)",
      });
  });
  if (exampleIssues.length) fail("WORKED_EXAMPLE_INVALID", exampleIssues);

  const supported = new Set<string>([
    ...[...cited].flatMap((id) => numbersIn(sourcesById.get(id)!.text)),
    ...numbersIn(ctx.productFacts),
  ]);
  const numberIssues: JournalDraftIssue[] = [];
  for (const [path, value] of publicText) {
    let text = value;
    if (path.startsWith("body.")) for (const sentence of c.worked_examples) text = text.split(sentence).join(" ");
    for (const token of numbersIn(text))
      if (!supported.has(token))
        numberIssues.push({ path, message: `${token} is not in any cited source; cite it, mark a worked example, or cut it` });
  }
  if (numberIssues.length) fail("UNSUPPORTED_NUMBER", numberIssues);

  // --- render -----------------------------------------------------------------------
  const citations = c.citations
    .slice()
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1))
    .map((citation) => {
      const source = sourcesById.get(citation.source_id)!;
      return {
        source_id: citation.source_id,
        role: citation.role,
        url: source.url,
        final_url: source.final_url,
        title: source.title,
        site_name: source.site_name,
      };
    });
  const html = sanitizeJournalHtml(`${rendered.html}\n\n${renderSourcesSection(citations)}`);

  return {
    article: {
      title: c.title,
      subtitle: c.subtitle,
      slug: c.slug,
      meta_title: c.meta_title,
      summary: c.summary,
      teaser: c.teaser,
      category: c.category,
      topic: c.topic,
      hero_line: c.hero_line,
      faqs: c.faqs,
      email_content: renderEmailContent(c.email_content),
    },
    html,
    word_count: wordCount,
    category_id: category!.id,
    citations,
    evidence: c.evidence,
    worked_examples: c.worked_examples,
    internal_links: internal,
  };
}
