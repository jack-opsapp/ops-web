import type { EditorialOperator } from "../../social/editorial/worker";
import type { JournalMode, JournalPackage } from "./handoff";
import type { RenderedJournalHero } from "./hero";
import type { JournalHeroAsset } from "./hero-store";

export interface JournalWorkerRow {
  id: string;
  identity: string;
  state: string;
  mode: "prepare" | "publish" | null;
  slot_at: string;
  publish_at: string | null;
  drafted_at: string | null;
  published_at: string | null;
  title: string | null;
  last_code: string | null;
  package: JournalPackage | null;
  attempt_log: unknown[];
  notified_state: string | null;
  blog_id: string | null;
  newsletter_state: string | null;
}

export type JournalPublishResult =
  | { state: "published"; blog_id: string; replay?: boolean }
  | { code: string; state?: string };

export interface JournalDelivery {
  id: string;
  state: string;
  title: string | null;
  body: string | null;
  persistent: boolean;
  actionUrl: string;
  actionLabel: string;
  dedupeKey: string;
  resolvePrefix: string | null;
}

export interface JournalStallCopy {
  title: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
}

export interface JournalWorkerRepository {
  recover(): Promise<number>;
  discover(now: Date): Promise<{ created: number; missed: number }>;
  readMode(): Promise<JournalMode>;
  readMinVetoMinutes(): Promise<number>;
  listDrafted(limit: number): Promise<JournalWorkerRow[]>;
  listDue(now: Date, limit: number): Promise<JournalWorkerRow[]>;
  schedule(id: string, preview: JournalHeroAsset, publishAt: Date): Promise<string | null>;
  annotate(id: string, detail: Record<string, unknown>): Promise<boolean>;
  block(id: string, code: string): Promise<string | null>;
  publish(id: string, manual: boolean, actor: string): Promise<JournalPublishResult>;
  listUndelivered(limit: number): Promise<JournalWorkerRow[]>;
  deliver(operator: EditorialOperator, delivery: JournalDelivery): Promise<boolean>;
  checkStall(operator: EditorialOperator, copy: JournalStallCopy, hours: number): Promise<boolean>;
  resolveStall(operator: EditorialOperator, hours: number): Promise<number>;
  newsletterEnabled(): Promise<boolean>;
  listNewsletterCandidates(since: Date): Promise<JournalWorkerRow[]>;
  claimNewsletter(id: string, token: string): Promise<boolean>;
  finishNewsletter(id: string, token: string, state: "sent" | "skipped"): Promise<boolean>;
}

export interface JournalTickDependencies {
  now: () => Date;
  operator: EditorialOperator | null;
  repository: JournalWorkerRepository;
  renderHero: (heroLine: string) => Promise<RenderedJournalHero>;
  storeHero: (identity: string, hero: RenderedJournalHero) => Promise<JournalHeroAsset>;
  /** The public URL answers 200 with an image before a preview is promised. */
  heroReadable: (url: string) => Promise<boolean>;
  sendNewsletter: (blogId: string) => Promise<{ sent: number; failed: number }>;
  newToken: () => string;
}

// Vancouver adopted permanent UTC-7 in March 2026, so the offset is a constant
// rather than a lookup. https://news.gov.bc.ca/releases/2026AG0013-000209
const VANCOUVER_OFFSET_MS = 7 * 3600000;
const LIVE_WINDOW_OPEN_HOUR = 6;
const LIVE_WINDOW_CLOSE_HOUR = 20;
const NEWSLETTER_WEEKDAY = 2; // Tuesday
const NEWSLETTER_HOUR = 10;
const PROMOTION_LIMIT = 2;
const PUBLISH_LIMIT = 2;
const MAX_PROMOTION_FAILURES = 3;
export const JOURNAL_STALL_HOURS = 12;
export const JOURNAL_SYSTEM_ACTOR = "system:journal-editorial";

/** Nothing goes live overnight in Vancouver: early waits for 06:00, late for 06:00 tomorrow. */
export function clampToLiveWindow(date: Date): Date {
  const local = new Date(date.getTime() - VANCOUVER_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= LIVE_WINDOW_OPEN_HOUR && hour < LIVE_WINDOW_CLOSE_HOUR) return date;
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const next = hour >= LIVE_WINDOW_CLOSE_HOUR ? day + 86400000 : day;
  return new Date(next + LIVE_WINDOW_OPEN_HOUR * 3600000 + VANCOUVER_OFFSET_MS);
}

/**
 * A draft that arrives in time launches at its slot. A late draft still gets
 * the minimum veto window before it can go live, and never goes live at night.
 */
export function computeJournalPublishAt(slotAt: Date, now: Date, minVetoMinutes: number): Date {
  const earliest = new Date(now.getTime() + minVetoMinutes * 60000);
  return clampToLiveWindow(earliest > slotAt ? earliest : slotAt);
}

/** The first Tuesday 10:00 Vancouver strictly after publication. */
export function newsletterSendAt(publishedAt: Date): Date {
  const local = new Date(publishedAt.getTime() - VANCOUVER_OFFSET_MS);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const offset = (NEWSLETTER_WEEKDAY - local.getUTCDay() + 7) % 7;
  let at = day + offset * 86400000 + NEWSLETTER_HOUR * 3600000 + VANCOUVER_OFFSET_MS;
  if (at <= publishedAt.getTime()) at += 7 * 86400000;
  return new Date(at);
}

const launchFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Etc/GMT+7",
  weekday: "short",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `Mon Sep 14 · 06:00` */
export function launchLabel(iso: string): string {
  const parts = Object.fromEntries(
    launchFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value])
  );
  return `${parts.weekday} ${parts.month} ${parts.day} · ${parts.hour}:${parts.minute}`;
}

// Product-register copy (ops-copywriter): terse, declarative, one next move.
const BLOCKED_COPY: Record<string, string> = {
  SLOT_MISSED: "No draft arrived in time. Nothing went live this week.",
  ATTEMPTS_EXHAUSTED: "The writer failed three times. Open the Blog hub for the reason.",
  UNSUPPORTED_TOPIC: "The writer found no topic it could source. Nothing went live.",
  STALE_DRAFT: "The draft sat more than a week. It will not publish.",
  SLUG_TAKEN: "Another post took this address first. Write another from the Blog hub.",
  WEEKLY_ALREADY_LIVE:
    "Another weekly post already went live this week. Publish anyway from the Blog hub, or let it go.",
  HERO_FAILED: "The header image failed three times. Nothing went live.",
  HERO_UNREADABLE: "The header image never became public. Nothing went live.",
  PACKAGE_MISSING: "The draft was incomplete. Nothing went live.",
};
const BLOCKED_FALLBACK = "The post stopped before going live. Open the Blog hub for the reason.";

export const JOURNAL_STALL_COPY: JournalStallCopy = {
  title: "JOURNAL WRITER STALLED",
  body: "Monday's post has no draft yet. Check the OPS Journal routine at claude.ai.",
  actionUrl: "/admin/blog",
  actionLabel: "OPEN BLOG",
};

function postTitle(row: JournalWorkerRow): string {
  return row.package?.article.title ?? row.title ?? "This week's post";
}

/** One rail item per state the operator needs to see; cancellation only clears. */
export function journalDelivery(row: JournalWorkerRow, accountMode: JournalMode): JournalDelivery | null {
  const actionUrl = `/admin/blog?journal=${row.id}`;
  const prefix = `journal:${row.identity}:`;
  if (row.state === "scheduled") {
    const autoPublishes = accountMode === "publish" && row.mode === "publish" && row.publish_at;
    return {
      id: row.id,
      state: row.state,
      title: "JOURNAL POST READY",
      body: autoPublishes
        ? `${postTitle(row)} goes live ${launchLabel(row.publish_at!)} unless you stop it.`
        : `${postTitle(row)} is ready. It waits for your go.`,
      persistent: true,
      actionUrl,
      actionLabel: "PREVIEW",
      dedupeKey: `${prefix}ready`,
      resolvePrefix: `${prefix}blocked`,
    };
  }
  if (row.state === "published")
    return {
      id: row.id,
      state: row.state,
      title: "JOURNAL POST LIVE",
      body: `${postTitle(row)} is live on the journal.`,
      persistent: false,
      actionUrl,
      actionLabel: "VIEW",
      dedupeKey: `${prefix}live`,
      resolvePrefix: prefix,
    };
  if (row.state === "blocked")
    return {
      id: row.id,
      state: row.state,
      title: "JOURNAL POST BLOCKED",
      body: BLOCKED_COPY[row.last_code ?? ""] ?? BLOCKED_FALLBACK,
      persistent: true,
      actionUrl,
      actionLabel: "OPEN",
      dedupeKey: `${prefix}blocked`,
      resolvePrefix: `${prefix}ready`,
    };
  if (row.state === "cancelled")
    return {
      id: row.id,
      state: row.state,
      title: null,
      body: null,
      persistent: false,
      actionUrl,
      actionLabel: "OPEN",
      dedupeKey: `${prefix}cancelled`,
      resolvePrefix: prefix,
    };
  return null;
}

function codeOf(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z_]{1,80}$/.test(message) ? message : fallback;
}

function promotionFailures(row: JournalWorkerRow): number {
  return (row.attempt_log ?? []).filter(
    (entry) => typeof entry === "object" && entry !== null && (entry as { event?: unknown }).event === "promotion_failed"
  ).length;
}

async function promote(d: JournalTickDependencies, row: JournalWorkerRow, minVeto: number, now: Date) {
  if (!row.package?.article?.hero_line) {
    await d.repository.block(row.id, "PACKAGE_MISSING");
    return false;
  }
  try {
    const hero = await d.renderHero(row.package.article.hero_line);
    const asset = await d.storeHero(row.identity, hero);
    if (!(await d.heroReadable(asset.url))) throw new Error("HERO_UNREADABLE");
    const publishAt = computeJournalPublishAt(new Date(row.slot_at), now, minVeto);
    return (await d.repository.schedule(row.id, asset, publishAt)) === "scheduled";
  } catch (error) {
    const code = codeOf(error, "HERO_FAILED");
    await d.repository.annotate(row.id, { event: "promotion_failed", code, at: now.toISOString() });
    if (promotionFailures(row) + 1 >= MAX_PROMOTION_FAILURES) await d.repository.block(row.id, code);
    return false;
  }
}

async function newsletterLane(d: JournalTickDependencies, now: Date) {
  let sent = 0;
  let skipped = 0;
  const candidates = await d.repository.listNewsletterCandidates(new Date(now.getTime() - 14 * 86400000));
  if (!candidates.length) return { sent, skipped };
  const enabled = await d.repository.newsletterEnabled();
  for (const row of candidates) {
    if (!row.published_at || !row.blog_id || row.newsletter_state) continue;
    if (now < newsletterSendAt(new Date(row.published_at))) continue;
    const token = d.newToken();
    if (!(await d.repository.claimNewsletter(row.id, token))) continue;
    // Switched off at the moment it would have gone: recorded as skipped, so
    // turning the newsletter on later never mails an old post.
    if (!enabled) {
      await d.repository.finishNewsletter(row.id, token, "skipped");
      skipped += 1;
      continue;
    }
    try {
      await d.sendNewsletter(row.blog_id);
      await d.repository.finishNewsletter(row.id, token, "sent");
      sent += 1;
    } catch (error) {
      // Left in 'sending' on purpose: at most once, never a second blast.
      await d.repository.annotate(row.id, {
        event: "newsletter_failed",
        code: codeOf(error, "NEWSLETTER_FAILED"),
        at: now.toISOString(),
      });
    }
  }
  return { sent, skipped };
}

export async function runJournalTick(d: JournalTickDependencies) {
  const now = d.now();
  await d.repository.recover();
  const discovery = await d.repository.discover(now);
  const mode = await d.repository.readMode();

  let promoted = 0;
  const drafted = await d.repository.listDrafted(PROMOTION_LIMIT);
  if (drafted.length) {
    const minVeto = await d.repository.readMinVetoMinutes();
    for (const row of drafted) if (await promote(d, row, minVeto, now)) promoted += 1;
  }

  const published: string[] = [];
  const held: Array<{ id: string; code: string }> = [];
  for (const row of await d.repository.listDue(now, PUBLISH_LIMIT)) {
    const result = await d.repository.publish(row.id, false, JOURNAL_SYSTEM_ACTOR);
    if ("state" in result && result.state === "published") published.push(row.id);
    else if ("code" in result) held.push({ id: row.id, code: result.code });
  }

  const newsletter = await newsletterLane(d, now);

  let notified = 0;
  if (d.operator) {
    for (const row of await d.repository.listUndelivered(10)) {
      const delivery = journalDelivery(row, mode);
      if (delivery && (await d.repository.deliver(d.operator, delivery))) notified += 1;
    }
    await d.repository.checkStall(d.operator, JOURNAL_STALL_COPY, JOURNAL_STALL_HOURS);
    await d.repository.resolveStall(d.operator, JOURNAL_STALL_HOURS);
  }

  return {
    state: published.length ? "published" : promoted ? "promoted" : discovery.created ? "discovered" : "idle",
    mode,
    created: discovery.created,
    missed: discovery.missed,
    promoted,
    published,
    held,
    newsletter,
    notified,
  };
}
