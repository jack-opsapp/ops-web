import type { SocialSubmission } from "../contract";
import type { RenderedSocialAsset } from "../types";
import type { EditorialKind, EditorialSource } from "./policy";

export interface EditorialPackage {
  submission: SocialSubmission;
  evidence: unknown[];
  review: Record<string, unknown>;
  usage: unknown[];
  references?: Array<{ path: string; sha256: string }>;
  brief_version?: string;
  preview?: RenderedSocialAsset[];
}

export interface EditorialAssignmentRow {
  id: string;
  identity: string;
  kind: EditorialKind;
  mode: "prepare" | "publish" | null;
  state: string;
  attempts: number;
  source_snapshot: EditorialSource | null;
  package: EditorialPackage | null;
  attempt_log: unknown[];
}

export interface EditorialOperator {
  userId: string;
  companyId: string;
}

export type EditorialPromotionState =
  | "prepared"
  | "submitted"
  | "queued"
  | "blocked";

export interface EditorialWorkerRepository {
  recover(): Promise<number>;
  discover(
    localDate: string,
    weekday: string
  ): Promise<{ blogs: number; recurring: number }>;
  readSettings(): Promise<{
    mode: "off" | "prepare" | "publish";
    delivery_gap_minutes: number;
  }>;
  listDrafted(limit: number): Promise<EditorialAssignmentRow[]>;
  sourceStillCurrent(source: EditorialSource): Promise<boolean>;
  findLiveBlogSource(id: string): Promise<EditorialSource | null>;
  annotateAssignment(
    id: string,
    detail: Record<string, unknown> | null,
    source: EditorialSource | null,
    pack: EditorialPackage | null
  ): Promise<boolean>;
  promote(
    id: string,
    state: EditorialPromotionState,
    code: string | null,
    preview: RenderedSocialAsset[] | null,
    postId: string | null,
    source: EditorialSource | null
  ): Promise<string | null>;
  lastScheduledPublishAt(): Promise<Date | null>;
  findPost(key: string): Promise<{ id: string; status: string } | null>;
  notify(operator: EditorialOperator): Promise<number>;
  checkAuthoringStall(
    operator: EditorialOperator,
    staleHours: number
  ): Promise<boolean>;
}

export interface EditorialTickDependencies {
  now: () => Date;
  operator: EditorialOperator | null;
  repository: EditorialWorkerRepository;
  preview: (
    pack: EditorialPackage,
    identity: string
  ) => Promise<RenderedSocialAsset[]>;
  submit: (input: {
    idempotencyKey: string;
    submission: SocialSubmission;
  }) => Promise<{ post: { id: string; status: string } }>;
}

// Vancouver adopted permanent UTC-7 in March 2026, so the offset is a constant
// rather than a lookup. https://news.gov.bc.ca/releases/2026AG0013-000209
const VANCOUVER_OFFSET_MS = 7 * 3600000;
const WINDOW_OPEN_HOUR = 10;
const WINDOW_CLOSE_HOUR = 20;
// The submission service already holds every post for ten minutes of veto; one
// extra minute keeps the requested time strictly later than that floor.
const MINIMUM_REVIEW_MINUTES = 11;
const PROMOTION_LIMIT = 3;
const MAX_ATTEMPTS = 3;
export const AUTHORING_STALE_HOURS = 26;
export const EDITORIAL_IDEMPOTENCY_PREFIX = "cloud-editorial-v2:";
const DELIVERED_STATUSES = ["review", "publishing", "published"];

const vancouverFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Etc/GMT+7",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

export function vancouverDay(now: Date): { date: string; weekday: string } {
  const parts = Object.fromEntries(
    vancouverFormat.formatToParts(now).map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
  };
}

// Nothing is delivered outside daylight in Vancouver: an early slot waits for
// ten, an evening slot waits for ten tomorrow.
export function clampToVancouverWindow(date: Date): Date {
  const local = new Date(date.getTime() - VANCOUVER_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= WINDOW_OPEN_HOUR && hour < WINDOW_CLOSE_HOUR) return date;
  const day = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  );
  if (hour >= WINDOW_CLOSE_HOUR) day.setUTCDate(day.getUTCDate() + 1);
  return new Date(
    day.getTime() + WINDOW_OPEN_HOUR * 3600000 + VANCOUVER_OFFSET_MS
  );
}

export function computePublishAt(
  now: Date,
  lastScheduled: Date | null,
  gapMinutes: number
): Date {
  const earliest = new Date(now.getTime() + MINIMUM_REVIEW_MINUTES * 60000);
  const paced = lastScheduled
    ? new Date(lastScheduled.getTime() + gapMinutes * 60000)
    : null;
  return clampToVancouverWindow(paced && paced > earliest ? paced : earliest);
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

function sameSource(a: EditorialSource, b: EditorialSource): boolean {
  return (Object.keys(a) as Array<keyof EditorialSource>).every(
    (key) => a[key] === b[key]
  );
}

// An edited article is only recoverable when the sentences the draft quoted
// still exist word for word and the article still lives at the same address.
function quotesSurvive(pack: EditorialPackage, current: EditorialSource) {
  const text = normalize(current.text);
  return pack.evidence.every((entry) => {
    const quote = (entry as { quote?: unknown }).quote;
    return typeof quote === "string" && text.includes(normalize(quote));
  });
}

function refreshPackage(
  pack: EditorialPackage,
  current: EditorialSource
): EditorialPackage {
  const content = pack.submission.content;
  const thumbnail = current.thumbnail_url ?? undefined;
  return {
    ...pack,
    submission: {
      ...pack.submission,
      source: {
        ...pack.submission.source,
        url: `https://opsapp.co/journal/${current.slug}`,
        published_at: new Date(current.published_at).toISOString(),
      },
      content: {
        ...content,
        ...(content.subtitle ? { subtitle: current.title.slice(0, 160) } : {}),
        slides: content.slides.map((slide, index) =>
          index === 0 && slide.image_url
            ? { ...slide, image_url: thumbnail }
            : slide
        ),
      },
      ...(pack.submission.media && thumbnail
        ? {
            media: pack.submission.media.map((item, index) =>
              index === 0 ? { ...item, url: thumbnail } : item
            ),
          }
        : {}),
    },
  };
}

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z_]{1,80}$/.test(message) ? message : "PROMOTION_FAILED";
}

const MAX_PROMOTION_FAILURES = 3;

function promotionFailures(assignment: EditorialAssignmentRow): number {
  return (assignment.attempt_log ?? []).filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { event?: unknown }).event === "promotion_failed"
  ).length;
}

async function promoteAssignment(
  d: EditorialTickDependencies,
  assignment: EditorialAssignmentRow,
  settings: {
    mode: "off" | "prepare" | "publish";
    delivery_gap_minutes: number;
  },
  now: Date
): Promise<boolean> {
  const snapshot = assignment.source_snapshot;
  if (!assignment.package || !snapshot) {
    await d.repository.promote(
      assignment.id,
      "blocked",
      "PACKAGE_MISSING",
      null,
      null,
      null
    );
    return true;
  }

  let pack = assignment.package;
  let refreshed: EditorialSource | null = null;
  if (!(await d.repository.sourceStillCurrent(snapshot))) {
    const current = await d.repository.findLiveBlogSource(snapshot.id);
    if (!current) {
      await d.repository.promote(
        assignment.id,
        "blocked",
        "SOURCE_WITHDRAWN",
        null,
        null,
        null
      );
      return true;
    }
    if (!sameSource(current, snapshot)) {
      if (current.slug === snapshot.slug && quotesSurvive(pack, current)) {
        pack = refreshPackage(pack, current);
        refreshed = current;
        await d.repository.annotateAssignment(
          assignment.id,
          { event: "source_refreshed", at: now.toISOString() },
          current,
          pack
        );
      } else {
        await d.repository.annotateAssignment(
          assignment.id,
          { event: "source_changed", at: now.toISOString() },
          null,
          null
        );
        await d.repository.promote(
          assignment.id,
          assignment.attempts >= MAX_ATTEMPTS ? "blocked" : "queued",
          "SOURCE_CHANGED",
          null,
          null,
          null
        );
        return true;
      }
    }
  }

  // Either control saying prepare holds the draft. Flipping the account to
  // publish must never release work that was written under a preview promise.
  if (settings.mode === "prepare" || assignment.mode === "prepare") {
    const preview = await d.preview(pack, assignment.identity);
    await d.repository.promote(
      assignment.id,
      "prepared",
      null,
      preview,
      null,
      refreshed
    );
    return true;
  }

  const key = `${EDITORIAL_IDEMPOTENCY_PREFIX}${assignment.identity}`;
  const existing = await d.repository.findPost(key);
  if (existing) {
    if (DELIVERED_STATUSES.includes(existing.status)) {
      await d.repository.promote(
        assignment.id,
        "submitted",
        null,
        null,
        existing.id,
        refreshed
      );
      return true;
    }
    // A reservation still rendering is finished by the render itself; the next
    // tick reconciles it rather than queueing a second post.
    if (existing.status === "rendering") return false;
    await d.repository.promote(
      assignment.id,
      "blocked",
      "DELIVERY_NEEDS_REVIEW",
      null,
      existing.id,
      null
    );
    return true;
  }

  const publishAt = computePublishAt(
    now,
    await d.repository.lastScheduledPublishAt(),
    settings.delivery_gap_minutes
  );
  const { post } = await d.submit({
    idempotencyKey: key,
    submission: { ...pack.submission, publish_at: publishAt.toISOString() },
  });
  if (DELIVERED_STATUSES.includes(post.status)) {
    await d.repository.promote(
      assignment.id,
      "submitted",
      null,
      null,
      post.id,
      refreshed
    );
    return true;
  }
  await d.repository.promote(
    assignment.id,
    "blocked",
    "DELIVERY_NEEDS_REVIEW",
    null,
    post.id,
    null
  );
  return true;
}

export async function runEditorialTick(d: EditorialTickDependencies): Promise<{
  state: string;
  discovered: number;
  promoted: number;
  notified: number;
}> {
  const now = d.now();
  const day = vancouverDay(now);
  await d.repository.recover();
  const discovery = await d.repository.discover(day.date, day.weekday);
  const discovered = discovery.blogs + discovery.recurring;

  let promoted = 0;
  const settings = await d.repository.readSettings();
  if (settings.mode !== "off") {
    for (const assignment of await d.repository.listDrafted(PROMOTION_LIMIT)) {
      try {
        if (await promoteAssignment(d, assignment, settings, now))
          promoted += 1;
      } catch (error) {
        // One article's failure never stops the rest of the queue, and a
        // permanently broken render stops itself after three tries instead of
        // retrying every tick forever.
        const code = codeOf(error);
        await d.repository.annotateAssignment(
          assignment.id,
          { event: "promotion_failed", code, at: now.toISOString() },
          null,
          null
        );
        if (promotionFailures(assignment) + 1 >= MAX_PROMOTION_FAILURES)
          await d.repository.promote(
            assignment.id,
            "blocked",
            code,
            null,
            null,
            null
          );
      }
    }
  }

  const notified = d.operator ? await d.repository.notify(d.operator) : 0;
  if (d.operator)
    await d.repository.checkAuthoringStall(d.operator, AUTHORING_STALE_HOURS);

  return {
    state: promoted > 0 ? "promoted" : discovered > 0 ? "discovered" : "idle",
    discovered,
    promoted,
    notified,
  };
}
