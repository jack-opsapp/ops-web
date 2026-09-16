import { journalRadarSource, type JournalRadarKind, type JournalRadarSphere, JOURNAL_RADAR_SPHERES } from "./watchlist";

/** What the claim offers the writer: the last two weeks, strongest first within each feed. */
export const RADAR_CLAIM_WINDOW_DAYS = 14;
export const RADAR_CLAIM_PER_SOURCE = 6;
export const RADAR_CLAIM_MAX = 150;
/** A pitch may cite a signal the radar saw in the last three weeks. */
export const RADAR_PITCH_WINDOW_DAYS = 21;
const DAY_MS = 86400000;

export interface JournalTrendSignalRow {
  id: string;
  source_key: string;
  sphere: JournalRadarSphere;
  kind: JournalRadarKind;
  url: string;
  title: string;
  summary: string | null;
  published_at: string;
  views: number | null;
  baseline_views: number | null;
  momentum: number | null;
  comments: number | null;
}

export interface JournalClaimSignal {
  id: string;
  sphere: JournalRadarSphere;
  source: string;
  kind: JournalRadarKind;
  title: string;
  url: string;
  summary: string | null;
  published_at: string;
  age_days: number;
  views: number | null;
  typical_views: number | null;
  momentum: number | null;
  replies: number | null;
}

/** The strongest items in one feed: momentum for video, replies for threads, recency for writing. */
function strength(row: JournalTrendSignalRow): [number, number] {
  const recency = Date.parse(row.published_at);
  if (row.kind === "video") return [row.momentum ?? -1, recency];
  if (row.kind === "thread") return [row.comments ?? -1, recency];
  return [recency, 0];
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalises a database row (bigint and numeric arrive as strings or numbers). */
export function trendSignalRow(row: Record<string, unknown>): JournalTrendSignalRow {
  return {
    id: String(row.id),
    source_key: String(row.source_key),
    sphere: row.sphere as JournalRadarSphere,
    kind: row.kind as JournalRadarKind,
    url: String(row.url),
    title: String(row.title),
    summary: typeof row.summary === "string" ? row.summary : null,
    published_at: new Date(String(row.published_at)).toISOString(),
    views: numeric(row.views),
    baseline_views: numeric(row.baseline_views),
    momentum: numeric(row.momentum),
    comments: numeric(row.comments),
  };
}

export function claimSignal(row: JournalTrendSignalRow, now: Date): JournalClaimSignal {
  return {
    id: row.id,
    sphere: row.sphere,
    source: journalRadarSource(row.source_key)?.name ?? row.source_key,
    kind: row.kind,
    title: row.title,
    url: row.url,
    summary: row.summary,
    published_at: row.published_at,
    age_days: Math.max(0, Math.round(((now.getTime() - Date.parse(row.published_at)) / DAY_MS) * 10) / 10),
    views: row.views,
    typical_views: row.baseline_views,
    momentum: row.momentum,
    replies: row.comments,
  };
}

/**
 * The signals a claim carries, ordered by sphere (the order the brief weighs
 * them in) and by strength within each feed, capped per feed so one prolific
 * channel cannot drown the rest.
 */
export function selectClaimSignals(rows: readonly JournalTrendSignalRow[], now: Date): JournalClaimSignal[] {
  const cutoff = now.getTime() - RADAR_CLAIM_WINDOW_DAYS * DAY_MS;
  const bySource = new Map<string, JournalTrendSignalRow[]>();
  for (const row of rows) {
    if (Date.parse(row.published_at) < cutoff) continue;
    bySource.set(row.source_key, [...(bySource.get(row.source_key) ?? []), row]);
  }
  const kept: JournalTrendSignalRow[] = [];
  for (const entries of bySource.values()) {
    entries.sort((a, b) => {
      const [a1, a2] = strength(a);
      const [b1, b2] = strength(b);
      return b1 - a1 || b2 - a2 || a.id.localeCompare(b.id);
    });
    kept.push(...entries.slice(0, RADAR_CLAIM_PER_SOURCE));
  }
  const sphereRank = new Map(JOURNAL_RADAR_SPHERES.map((sphere, index) => [sphere, index]));
  kept.sort((a, b) => {
    const sphere = (sphereRank.get(a.sphere) ?? 99) - (sphereRank.get(b.sphere) ?? 99);
    if (sphere) return sphere;
    if (a.source_key !== b.source_key) return a.source_key.localeCompare(b.source_key);
    const [a1, a2] = strength(a);
    const [b1, b2] = strength(b);
    return b1 - a1 || b2 - a2 || a.id.localeCompare(b.id);
  });
  return kept.slice(0, RADAR_CLAIM_MAX).map((row) => claimSignal(row, now));
}
