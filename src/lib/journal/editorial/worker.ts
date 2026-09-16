import type { EditorialOperator } from "../../social/editorial/worker";
import type { JournalMode, JournalPackage } from "./handoff";
import type { GeneratedJournalImage } from "./image";
import type { JournalImageAsset } from "./image-store";
import type { JournalTrendSignalInput } from "./radar/feeds";
import {
  isJournalRadarDegraded,
  JOURNAL_RADAR_INTERVAL_MINUTES,
  type JournalRadarScan,
  type JournalRadarSourceStatus,
} from "./radar/scan";

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
  image_requested_at: string | null;
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

export interface JournalImageFailedCopy {
  title: string;
  body: string;
}

export interface JournalRadarCopy {
  title: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
}

export type JournalImageResult =
  | { state: "scheduled" | "published"; url: string }
  | { code: string; retry: boolean };

export interface JournalWorkerRepository {
  recover(): Promise<number>;
  discover(now: Date): Promise<{ created: number; missed: number }>;
  readMode(): Promise<JournalMode>;
  readMinVetoMinutes(): Promise<number>;
  listDrafted(limit: number): Promise<JournalWorkerRow[]>;
  listDue(now: Date, limit: number): Promise<JournalWorkerRow[]>;
  schedule(id: string, preview: JournalImageAsset, publishAt: Date): Promise<string | null>;
  annotate(id: string, detail: Record<string, unknown>): Promise<boolean>;
  block(id: string, code: string): Promise<string | null>;
  publish(id: string, manual: boolean, actor: string): Promise<JournalPublishResult>;
  listUndelivered(limit: number): Promise<JournalWorkerRow[]>;
  deliver(operator: EditorialOperator, delivery: JournalDelivery): Promise<boolean>;
  checkStall(operator: EditorialOperator, copy: JournalStallCopy, hours: number): Promise<boolean>;
  resolveStall(operator: EditorialOperator, hours: number): Promise<number>;
  listImageRequests(limit: number): Promise<JournalWorkerRow[]>;
  replaceImage(id: string, preview: JournalImageAsset): Promise<string | null>;
  failImage(
    id: string,
    code: string,
    operator: EditorialOperator | null,
    copy: JournalImageFailedCopy
  ): Promise<"retry" | "dropped" | null>;
  beginRadarScan(intervalMinutes: number): Promise<boolean>;
  recordRadarScan(
    signals: JournalTrendSignalInput[],
    sources: JournalRadarSourceStatus[]
  ): Promise<{ stored: number; pruned: number }>;
  notifyRadar(operator: EditorialOperator, degraded: boolean, copy: JournalRadarCopy): Promise<string>;
  newsletterEnabled(): Promise<boolean>;
  listNewsletterCandidates(since: Date): Promise<JournalWorkerRow[]>;
  claimNewsletter(id: string, token: string): Promise<boolean>;
  finishNewsletter(id: string, token: string, state: "sent" | "skipped"): Promise<boolean>;
}

export interface JournalTickDependencies {
  now: () => Date;
  operator: EditorialOperator | null;
  repository: JournalWorkerRepository;
  /** One photograph from the writer's art direction; OPS adds the house style. */
  generateImage: (artDirection: string) => Promise<GeneratedJournalImage>;
  storeImage: (identity: string, image: GeneratedJournalImage) => Promise<JournalImageAsset>;
  /** The public URL answers 200 with an image before anyone is shown it. */
  imageReadable: (url: string) => Promise<boolean>;
  sendNewsletter: (blogId: string) => Promise<{ sent: number; failed: number }>;
  newToken: () => string;
  /** Reads the trend radar's watchlist feeds. */
  scanRadar: (now: Date) => Promise<JournalRadarScan>;
}

// Vancouver adopted permanent UTC-7 in March 2026, so the offset is a constant
// rather than a lookup. https://news.gov.bc.ca/releases/2026AG0013-000209
const VANCOUVER_OFFSET_MS = 7 * 3600000;
const LIVE_WINDOW_OPEN_HOUR = 6;
const LIVE_WINDOW_CLOSE_HOUR = 20;
const NEWSLETTER_WEEKDAY = 2; // Tuesday
const NEWSLETTER_HOUR = 10;
// One photograph per tick: a generation can take two minutes, and the tick has five.
const IMAGE_WORK_LIMIT = 1;
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
  IMAGE_FAILED: "The header photo failed three times. Nothing went live.",
  IMAGE_REFUSED: "OpenAI refused the photo brief three times. Write another from the Blog hub.",
  IMAGE_NOT_AUTHORIZED: "OpenAI blocked image generation for the OPS account. Nothing went live.",
  IMAGE_NOT_CONFIGURED: "Image generation has no OpenAI key. Nothing went live.",
  IMAGE_INVALID: "The header photo came back unreadable three times. Nothing went live.",
  IMAGE_UNREADABLE: "The header photo never became public. Nothing went live.",
  PACKAGE_MISSING: "The draft was incomplete. Nothing went live.",
};
const BLOCKED_FALLBACK = "The post stopped before going live. Open the Blog hub for the reason.";

export const JOURNAL_STALL_COPY: JournalStallCopy = {
  title: "JOURNAL WRITER STALLED",
  body: "Monday's post has no draft yet. Check the OPS Journal routine at claude.ai.",
  actionUrl: "/admin/blog",
  actionLabel: "OPEN BLOG",
};

export const JOURNAL_RADAR_COPY: JournalRadarCopy = {
  title: "JOURNAL RADAR DEGRADED",
  body: "Fewer than half the trend feeds answered. The writer picks topics from search until they recover.",
  actionUrl: "/admin/blog",
  actionLabel: "OPEN BLOG",
};

export const JOURNAL_IMAGE_FAILED_COPY: JournalImageFailedCopy = {
  title: "JOURNAL PHOTO FAILED",
  body: "The new header photo failed three times. The current photo stays.",
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

async function makeImage(
  d: Pick<JournalTickDependencies, "generateImage" | "storeImage" | "imageReadable">,
  row: JournalWorkerRow,
  artDirection: string
) {
  const image = await d.generateImage(artDirection);
  const asset = await d.storeImage(row.identity, image);
  if (!(await d.imageReadable(asset.url))) throw new Error("IMAGE_UNREADABLE");
  return asset;
}

async function promote(d: JournalTickDependencies, row: JournalWorkerRow, minVeto: number, now: Date) {
  const artDirection = row.package?.article?.image_prompt;
  if (!artDirection) {
    await d.repository.block(row.id, "PACKAGE_MISSING");
    return false;
  }
  try {
    const asset = await makeImage(d, row, artDirection);
    const publishAt = computeJournalPublishAt(new Date(row.slot_at), now, minVeto);
    return (await d.repository.schedule(row.id, asset, publishAt)) === "scheduled";
  } catch (error) {
    const code = codeOf(error, "IMAGE_FAILED");
    await d.repository.annotate(row.id, { event: "promotion_failed", code, at: now.toISOString() });
    if (promotionFailures(row) + 1 >= MAX_PROMOTION_FAILURES) await d.repository.block(row.id, code);
    return false;
  }
}

/**
 * Fulfils one open photograph request: a new preview, or a new photograph on a
 * post that is already live. A failure keeps the request for the next tick; the
 * ledger closes it after the third and the current photograph stays.
 */
export async function fulfilJournalImageRequest(
  d: Pick<JournalTickDependencies, "repository" | "generateImage" | "storeImage" | "imageReadable" | "operator">,
  row: JournalWorkerRow
): Promise<JournalImageResult> {
  const artDirection = row.package?.article?.image_prompt;
  try {
    if (!artDirection) throw new Error("NO_IMAGE_PROMPT");
    const asset = await makeImage(d, row, artDirection);
    const state = await d.repository.replaceImage(row.id, asset);
    if (state === "scheduled" || state === "published") return { state, url: asset.url };
    return { code: "NOT_ELIGIBLE", retry: false };
  } catch (error) {
    const code = codeOf(error, "IMAGE_FAILED");
    const outcome = await d.repository.failImage(row.id, code, d.operator, JOURNAL_IMAGE_FAILED_COPY);
    return { code, retry: outcome === "retry" };
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

export type JournalRadarLaneResult =
  | { state: "current" }
  | { state: "scanned"; ok: number; total: number; stored: number; degraded: boolean }
  | { state: "failed"; code: string };

/**
 * Keeps the trend radar current: at most one scan per interval, never when
 * the pipeline is off. A failed scan is left for the next tick; it never fails
 * the tick itself, because publishing and photographs matter more.
 */
export async function runJournalRadarLane(
  d: Pick<JournalTickDependencies, "repository" | "scanRadar" | "operator">,
  now: Date
): Promise<JournalRadarLaneResult> {
  try {
    if (!(await d.repository.beginRadarScan(JOURNAL_RADAR_INTERVAL_MINUTES))) return { state: "current" };
    const scan = await d.scanRadar(now);
    const recorded = await d.repository.recordRadarScan(scan.signals, scan.sources);
    const degraded = isJournalRadarDegraded(scan.sources);
    if (d.operator) await d.repository.notifyRadar(d.operator, degraded, JOURNAL_RADAR_COPY);
    return {
      state: "scanned",
      ok: scan.sources.filter((source) => source.ok).length,
      total: scan.sources.length,
      stored: recorded.stored,
      degraded,
    };
  } catch (error) {
    return { state: "failed", code: codeOf(error, "RADAR_FAILED") };
  }
}

export async function runJournalTick(d: JournalTickDependencies) {
  const now = d.now();
  await d.repository.recover();
  const discovery = await d.repository.discover(now);
  const mode = await d.repository.readMode();

  // A new draft's first photograph comes before a replacement for one that exists.
  let promoted = 0;
  let imageWork = 0;
  const drafted = await d.repository.listDrafted(IMAGE_WORK_LIMIT);
  if (drafted.length) {
    const minVeto = await d.repository.readMinVetoMinutes();
    for (const row of drafted) {
      imageWork += 1;
      if (await promote(d, row, minVeto, now)) promoted += 1;
    }
  }
  const images = { replaced: 0, failed: 0 };
  if (imageWork < IMAGE_WORK_LIMIT) {
    for (const row of await d.repository.listImageRequests(IMAGE_WORK_LIMIT - imageWork)) {
      const result = await fulfilJournalImageRequest(d, row);
      if ("state" in result) images.replaced += 1;
      else images.failed += 1;
    }
  }

  const published: string[] = [];
  const held: Array<{ id: string; code: string }> = [];
  for (const row of await d.repository.listDue(now, PUBLISH_LIMIT)) {
    const result = await d.repository.publish(row.id, false, JOURNAL_SYSTEM_ACTOR);
    if ("state" in result && result.state === "published") published.push(row.id);
    else if ("code" in result) held.push({ id: row.id, code: result.code });
  }

  const newsletter = await newsletterLane(d, now);

  // The radar waits for a quiet tick: a photograph can take two minutes of the five.
  const radar: JournalRadarLaneResult | { state: "deferred" } =
    drafted.length + images.replaced + images.failed === 0 ? await runJournalRadarLane(d, now) : { state: "deferred" };

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
    images,
    published,
    held,
    newsletter,
    radar,
    notified,
  };
}
