import { z } from "zod";
import { isDuplicate } from "../../social/editorial/policy";
import { JournalMarkupError, assertPlainText } from "./article-html";
import { JOURNAL_PITCH_LIMITS } from "./brief";
import {
  journalStaleIssues,
  journalTitleIssue,
  journalVoiceIssues,
  normalizeForMatch,
  type JournalDraftIssue,
} from "./policy";
import { claimSignal, RADAR_PITCH_WINDOW_DAYS, type JournalClaimSignal, type JournalTrendSignalRow } from "./radar/signals";

/**
 * The pitch: what the week's post is about, why this week, the angle, and the
 * hook, decided before any writing. OPS checks it against what the radar
 * actually saw, keeps a snapshot of those signals, and the accepted draft
 * carries it, so the operator always sees why this topic and this hook.
 */

const P = JOURNAL_PITCH_LIMITS;
const DAY_MS = 86400000;

export const JOURNAL_PITCH_CODES = [
  "SCHEMA_INVALID",
  "MARKUP_INVALID",
  "TITLE_FORMAT",
  "VOICE_REJECTED",
  "STALE_FRAMING",
  "DUPLICATE_TOPIC",
  "PITCH_EVIDENCE",
  "PITCH_SIGNAL_UNKNOWN",
  "PITCH_HOOKS",
  "PITCH_RUNNERS_UP",
] as const;
export type JournalPitchCode = (typeof JOURNAL_PITCH_CODES)[number];

export class JournalPitchError extends Error {
  constructor(
    public readonly code: JournalPitchCode,
    public readonly issues: JournalDraftIssue[] = []
  ) {
    super(code);
    this.name = "JournalPitchError";
  }
}

const text = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "an https URL");

export const journalPitchSchema = z
  .object({
    topic: text(P.topic),
    reader: text(P.reader),
    why_now: text(P.why_now),
    signals: z.array(z.string().uuid()).max(P.signals[1]).default([]),
    chatter: z
      .array(z.object({ url: httpsUrl, shows: text(P.chatter_shows) }).strict())
      .max(P.chatter[1])
      .default([]),
    ethos: text(P.ethos),
    angle: text(P.angle),
    hook: text(P.hook),
    headline: text(P.headline),
    hooks_considered: z
      .array(z.object({ headline: text(P.headline), hook: text(P.hook), verdict: text(P.hook_verdict) }).strict())
      .min(P.hooks_considered[0])
      .max(P.hooks_considered[1]),
    runners_up: z
      .array(z.object({ topic: text(P.topic), why_not: text(P.runner_why_not) }).strict())
      .min(P.runners_up[0])
      .max(P.runners_up[1]),
  })
  .strict();
export type JournalPitchCandidate = z.infer<typeof journalPitchSchema>;

/** What OPS keeps: the writer's pitch with the radar signals it cited frozen as they were seen. */
export interface JournalPitch {
  topic: string;
  reader: string;
  why_now: string;
  ethos: string;
  angle: string;
  hook: string;
  headline: string;
  signals: JournalClaimSignal[];
  chatter: Array<{ url: string; shows: string }>;
  hooks_considered: Array<{ headline: string; hook: string; verdict: string }>;
  runners_up: Array<{ topic: string; why_not: string }>;
  radar_scanned_at: string | null;
}

export interface JournalPitchContext {
  /** Radar rows for the ids the pitch cites; unknown ids are simply absent. */
  signals: ReadonlyMap<string, JournalTrendSignalRow>;
  /** How many radar signals the claim window holds. With any, a pitch must cite the radar. */
  radarSignalsAvailable: number;
  radarScannedAt: string | null;
  /** Live post titles, for the one-year duplicate window. */
  livePosts: ReadonlyArray<{ title: string; published_at: string }>;
  now: Date;
}

function fail(code: JournalPitchCode, issues: JournalDraftIssue[]): never {
  throw new JournalPitchError(code, issues.slice(0, 20));
}

export function prepareJournalPitch(raw: unknown, ctx: JournalPitchContext): JournalPitch {
  const parsed = journalPitchSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      "SCHEMA_INVALID",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    );
  const p = parsed.data;

  // --- plain text ---------------------------------------------------------------
  const fields: Array<[string, string]> = [
    ["topic", p.topic],
    ["reader", p.reader],
    ["why_now", p.why_now],
    ["ethos", p.ethos],
    ["angle", p.angle],
    ["hook", p.hook],
    ["headline", p.headline],
    ...p.chatter.map((entry, index): [string, string] => [`chatter.${index}.shows`, entry.shows]),
    ...p.hooks_considered.flatMap((entry, index): Array<[string, string]> => [
      [`hooks_considered.${index}.headline`, entry.headline],
      [`hooks_considered.${index}.hook`, entry.hook],
      [`hooks_considered.${index}.verdict`, entry.verdict],
    ]),
    ...p.runners_up.flatMap((entry, index): Array<[string, string]> => [
      [`runners_up.${index}.topic`, entry.topic],
      [`runners_up.${index}.why_not`, entry.why_not],
    ]),
  ];
  const markupIssues: JournalDraftIssue[] = [];
  for (const [path, value] of fields) {
    try {
      assertPlainText(value);
    } catch (error) {
      if (error instanceof JournalMarkupError) markupIssues.push({ path, message: error.message });
      else throw error;
    }
    if (/https?:\/\//i.test(value))
      markupIssues.push({ path, message: "plain sentences only; put the page in chatter or signals" });
  }
  if (markupIssues.length) fail("MARKUP_INVALID", markupIssues);

  // --- the headline and the hook are public copy ----------------------------------
  const titleIssue = journalTitleIssue("headline", p.headline);
  if (titleIssue) fail("TITLE_FORMAT", [titleIssue]);
  const publicCopy: Array<[string, string]> = [
    ["headline", p.headline],
    ["hook", p.hook],
    ["angle", p.angle],
  ];
  const voiceIssues = journalVoiceIssues(publicCopy);
  if (/^ai\b/i.test(p.headline.trim())) voiceIssues.push({ path: "headline", message: "never lead with AI" });
  if (voiceIssues.length) fail("VOICE_REJECTED", voiceIssues);
  const staleIssues = journalStaleIssues(publicCopy);
  if (staleIssues.length) fail("STALE_FRAMING", staleIssues);

  // --- the heat is observed, not asserted -------------------------------------------
  const signalIds = [...new Set(p.signals)];
  const chatter = p.chatter.filter(
    (entry, index) => p.chatter.findIndex((other) => other.url === entry.url) === index
  );
  const windowStart = ctx.now.getTime() - RADAR_PITCH_WINDOW_DAYS * DAY_MS;
  const unknown = signalIds.flatMap((id) => {
    const row = ctx.signals.get(id);
    return row && Date.parse(row.published_at) >= windowStart
      ? []
      : [{ path: `signals.${p.signals.indexOf(id)}`, message: `${id} is not a radar signal from the last ${RADAR_PITCH_WINDOW_DAYS} days` }];
  });
  if (unknown.length) fail("PITCH_SIGNAL_UNKNOWN", unknown);
  if (ctx.radarSignalsAvailable > 0 && signalIds.length === 0)
    fail("PITCH_EVIDENCE", [{ path: "signals", message: "cite at least one trend_signals id from the claim" }]);
  if (signalIds.length + chatter.length < P.evidence_min)
    fail("PITCH_EVIDENCE", [
      {
        path: "signals",
        message: `show the heat with at least ${P.evidence_min} distinct radar signals and search results (got ${signalIds.length + chatter.length})`,
      },
    ]);

  // --- the hook room weighed real alternatives ----------------------------------------
  const distinctHooks = new Set(p.hooks_considered.map((entry) => normalizeForMatch(entry.headline)));
  if (distinctHooks.size < P.hooks_considered[0])
    fail("PITCH_HOOKS", [
      {
        path: "hooks_considered",
        message: `at least ${P.hooks_considered[0]} different headlines were weighed (got ${distinctHooks.size})`,
      },
    ]);
  const chosenTopic = normalizeForMatch(p.topic);
  const runnerTopics = p.runners_up.map((entry) => normalizeForMatch(entry.topic));
  const runnerIssues = runnerTopics.flatMap((topic, index) =>
    topic === chosenTopic || runnerTopics.indexOf(topic) !== index
      ? [{ path: `runners_up.${index}.topic`, message: "a runner-up is a different topic from the pick and from each other" }]
      : []
  );
  if (runnerIssues.length) fail("PITCH_RUNNERS_UP", runnerIssues);

  // --- not a repeat -------------------------------------------------------------------
  const yearAgo = ctx.now.getTime() - 365 * DAY_MS;
  const recentTitles = ctx.livePosts
    .filter((post) => Date.parse(post.published_at) >= yearAgo)
    .map((post) => post.title);
  if (isDuplicate(p.headline, recentTitles))
    fail("DUPLICATE_TOPIC", [{ path: "headline", message: "too close to a live post from the last year" }]);

  return {
    topic: p.topic,
    reader: p.reader,
    why_now: p.why_now,
    ethos: p.ethos,
    angle: p.angle,
    hook: p.hook,
    headline: p.headline,
    signals: signalIds.map((id) => claimSignal(ctx.signals.get(id) as JournalTrendSignalRow, ctx.now)),
    chatter,
    hooks_considered: p.hooks_considered,
    runners_up: p.runners_up,
    radar_scanned_at: ctx.radarScannedAt,
  };
}
