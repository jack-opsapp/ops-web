import { JournalFeedError, readJournalFeed, type JournalTrendSignalInput } from "./feeds";
import { JOURNAL_RADAR_SOURCES, type JournalRadarSource, type JournalRadarSphere } from "./watchlist";

/** How long a scan stays current. The hourly tick scans when the last one is older. */
export const JOURNAL_RADAR_INTERVAL_MINUTES = 360;
const SCAN_CONCURRENCY = 6;

export type JournalFeedFetchCode =
  | "FEED_BLOCKED"
  | "FEED_NOT_FOUND"
  | "FEED_TIMEOUT"
  | "FEED_TOO_LARGE"
  | "FEED_NOT_A_FEED"
  | "FEED_FETCH_FAILED";

export class JournalFeedFetchError extends Error {
  constructor(public readonly code: JournalFeedFetchCode) {
    super(code);
    this.name = "JournalFeedFetchError";
  }
}

/** Fetches one feed's XML, or throws JournalFeedFetchError. */
export type JournalFeedFetcher = (url: string) => Promise<string>;

export interface JournalRadarSourceStatus {
  key: string;
  name: string;
  sphere: JournalRadarSphere;
  ok: boolean;
  /** Items from the radar window this scan kept. */
  items: number;
  code: string | null;
}

export interface JournalRadarScan {
  signals: JournalTrendSignalInput[];
  sources: JournalRadarSourceStatus[];
}

/** Fewer than half the feeds answering means the writer is working half blind. */
export function isJournalRadarDegraded(sources: readonly JournalRadarSourceStatus[]): boolean {
  if (!sources.length) return true;
  return sources.filter((source) => source.ok).length * 2 < sources.length;
}

function failureCode(error: unknown): string {
  if (error instanceof JournalFeedFetchError || error instanceof JournalFeedError) return error.code;
  return "FEED_FETCH_FAILED";
}

async function readSource(
  source: JournalRadarSource,
  fetchFeed: JournalFeedFetcher,
  now: Date
): Promise<{ status: JournalRadarSourceStatus; signals: JournalTrendSignalInput[] }> {
  const base = { key: source.key, name: source.name, sphere: source.sphere };
  try {
    const signals = readJournalFeed(await fetchFeed(source.url), source, now);
    return { status: { ...base, ok: true, items: signals.length, code: null }, signals };
  } catch (error) {
    return { status: { ...base, ok: false, items: 0, code: failureCode(error) }, signals: [] };
  }
}

/**
 * Reads every watchlist feed, a few at a time. One feed failing never stops
 * the others; its failure is recorded against it instead.
 */
export async function scanJournalRadar(
  fetchFeed: JournalFeedFetcher,
  now: Date,
  sources: readonly JournalRadarSource[] = JOURNAL_RADAR_SOURCES
): Promise<JournalRadarScan> {
  const results: Array<Awaited<ReturnType<typeof readSource>>> = new Array(sources.length);
  let next = 0;
  async function worker() {
    while (next < sources.length) {
      const index = next;
      next += 1;
      results[index] = await readSource(sources[index], fetchFeed, now);
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, sources.length) }, worker));
  return {
    signals: results.flatMap((result) => result.signals),
    sources: results.map((result) => result.status),
  };
}
