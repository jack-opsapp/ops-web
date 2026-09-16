import { JSDOM } from "jsdom";
import type { JournalRadarKind, JournalRadarSource, JournalRadarSphere } from "./watchlist";

/**
 * Reads one watchlist feed into trend signals. Pure: the same XML and the same
 * clock always give the same signals, so the radar is provable offline.
 *
 * YouTube channel feeds (Atom + Media RSS) carry each video's view count, which
 * becomes momentum: views against the channel's own typical video. Forum feeds
 * (RSS + slash) carry reply counts. News and blog feeds carry no engagement
 * numbers; their weight is recency and how often a theme repeats across feeds.
 */

const ATOM = "http://www.w3.org/2005/Atom";
const MEDIA = "http://search.yahoo.com/mrss/";
const YOUTUBE = "http://www.youtube.com/xml/schemas/2015";
const SLASH = "http://purl.org/rss/1.0/modules/slash/";
const CONTENT = "http://purl.org/rss/1.0/modules/content/";

/** Items older than this are not kept: the radar is about what people discuss now. */
export const RADAR_ITEM_WINDOW_DAYS = 30;
/** A video younger than this is still gathering views, so it never sets the baseline. */
const BASELINE_MIN_AGE_DAYS = 3;
const BASELINE_MIN_ITEMS = 3;
/**
 * A forum's standing threads (a years-long photo thread, a hall of shame)
 * carry thousands of lifetime replies and resurface with every new post. They
 * are hangouts, not topics: dropped when far above the feed's typical thread.
 */
const STANDING_THREAD_MIN_REPLIES = 500;
const STANDING_THREAD_MULTIPLE = 25;
const MAX_TITLE = 300;
const MAX_SUMMARY = 600;
const SUMMARY_CHARS = 280;
/** Only the start of a long description is ever kept, so only the start is parsed. */
const DESCRIPTION_READ_CHARS = 6000;
const MAX_ITEM_KEY = 300;
const MAX_URL = 2048;
const DAY_MS = 86400000;

export interface JournalTrendSignalInput {
  source_key: string;
  sphere: JournalRadarSphere;
  kind: JournalRadarKind;
  item_key: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string;
  views: number | null;
  baseline_views: number | null;
  momentum: number | null;
  comments: number | null;
}

export class JournalFeedError extends Error {
  constructor(public readonly code: "FEED_UNREADABLE" | "FEED_EMPTY") {
    super(code);
    this.name = "JournalFeedError";
  }
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

type TextOf = (value: string | null | undefined) => string;

/**
 * Feed titles and descriptions are often HTML; the radar keeps only their
 * words. One inert HTML document per feed does the decoding: markup assigned
 * to a detached element is parsed, never rendered or run.
 */
function textReader(document: Document): TextOf {
  const scratch = document.implementation.createHTMLDocument("").createElement("div");
  return (value) => {
    const raw = (value ?? "").slice(0, DESCRIPTION_READ_CHARS);
    if (!/[<&]/.test(raw)) return clean(raw);
    scratch.innerHTML = raw;
    const words = clean(scratch.textContent);
    scratch.textContent = "";
    return words;
  };
}

function httpsUrl(raw: string | null | undefined): string | null {
  try {
    const url = new URL(clean(raw));
    if (url.protocol !== "https:") return null;
    url.hash = "";
    const value = url.toString();
    return value.length <= MAX_URL ? value : null;
  } catch {
    return null;
  }
}

function count(raw: string | null | undefined): number | null {
  const value = clean(raw);
  if (!/^\d{1,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function instant(raw: string | null | undefined, now: Date): string | null {
  const value = clean(raw);
  if (!value) return null;
  const parsed = Date.parse(value);
  // A date a day ahead of the clock is a publisher error, not a signal.
  if (!Number.isFinite(parsed) || parsed > now.getTime() + DAY_MS) return null;
  return new Date(parsed).toISOString();
}

/** A direct child by name. `null` means RSS's own un-namespaced element, falling back to any namespace. */
function firstChild(parent: Element, namespace: string | null, name: string): Element | null {
  const children = Array.from(parent.children).filter((child) => child.localName === name);
  if (namespace !== null) return children.find((child) => child.namespaceURI === namespace) ?? null;
  return children.find((child) => child.namespaceURI === null) ?? children[0] ?? null;
}

function parseXml(xml: string): Document {
  try {
    const document = new JSDOM(xml, { contentType: "application/xml" }).window.document;
    if (document.getElementsByTagName("parsererror").length) throw new Error("parsererror");
    // Well-formed but not a feed: a block page or a maintenance notice.
    if (!["rss", "feed", "RDF"].includes(document.documentElement?.localName ?? "")) throw new Error("not a feed");
    return document;
  } catch {
    throw new JournalFeedError("FEED_UNREADABLE");
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

interface RawItem {
  item_key: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string;
  views: number | null;
  comments: number | null;
}

function youtubeItems(document: Document, now: Date, plainText: TextOf): RawItem[] {
  return Array.from(document.getElementsByTagNameNS(ATOM, "entry")).flatMap((entry) => {
    const videoId = clean(firstChild(entry, YOUTUBE, "videoId")?.textContent);
    const title = clean(firstChild(entry, ATOM, "title")?.textContent);
    const published = instant(firstChild(entry, ATOM, "published")?.textContent, now);
    const alternate = Array.from(entry.getElementsByTagNameNS(ATOM, "link")).find(
      (link) => (link.getAttribute("rel") ?? "alternate") === "alternate"
    );
    const url = httpsUrl(alternate?.getAttribute("href")) ?? (videoId ? httpsUrl(`https://www.youtube.com/watch?v=${videoId}`) : null);
    const group = firstChild(entry, MEDIA, "group");
    const statistics = group?.getElementsByTagNameNS(MEDIA, "statistics")[0] ?? null;
    const description = group ? firstChild(group, MEDIA, "description")?.textContent : null;
    if (!videoId || !title || !published || !url) return [];
    return [
      {
        item_key: `yt:${videoId}`.slice(0, MAX_ITEM_KEY),
        url,
        title,
        summary: plainText(description) || null,
        published_at: published,
        views: count(statistics?.getAttribute("views")),
        comments: null,
      },
    ];
  });
}

function rssItems(document: Document, now: Date, plainText: TextOf, kind: JournalRadarKind): RawItem[] {
  const items = Array.from(document.getElementsByTagName("item"));
  if (items.length) {
    return items.flatMap((item) => {
      const title = plainText(firstChild(item, null, "title")?.textContent);
      const url = httpsUrl(firstChild(item, null, "link")?.textContent);
      const guid = clean(firstChild(item, null, "guid")?.textContent);
      const published =
        instant(firstChild(item, null, "pubDate")?.textContent, now) ??
        instant(firstChild(item, null, "date")?.textContent, now);
      const description =
        plainText(firstChild(item, null, "description")?.textContent) ||
        plainText(firstChild(item, CONTENT, "encoded")?.textContent);
      // A forum names the board a thread lives in; the writer needs to tell
      // the business board from the break room.
      const board = kind === "thread" ? plainText(firstChild(item, null, "category")?.textContent) : "";
      if (!title || !url || !published) return [];
      return [
        {
          item_key: (guid || url).slice(0, MAX_ITEM_KEY),
          url,
          title,
          summary: [board, description].filter(Boolean).join(" · ") || null,
          published_at: published,
          views: null,
          comments: count(firstChild(item, SLASH, "comments")?.textContent),
        },
      ];
    });
  }
  // Some blogs publish Atom instead of RSS.
  return Array.from(document.getElementsByTagNameNS(ATOM, "entry")).flatMap((entry) => {
    const title = plainText(firstChild(entry, ATOM, "title")?.textContent);
    const link = Array.from(entry.getElementsByTagNameNS(ATOM, "link")).find(
      (candidate) => (candidate.getAttribute("rel") ?? "alternate") === "alternate"
    );
    const url = httpsUrl(link?.getAttribute("href"));
    const id = clean(firstChild(entry, ATOM, "id")?.textContent);
    const published =
      instant(firstChild(entry, ATOM, "published")?.textContent, now) ??
      instant(firstChild(entry, ATOM, "updated")?.textContent, now);
    const summary = firstChild(entry, ATOM, "summary")?.textContent;
    if (!title || !url || !published) return [];
    return [
      {
        item_key: (id || url).slice(0, MAX_ITEM_KEY),
        url,
        title,
        summary: plainText(summary) || null,
        published_at: published,
        views: null,
        comments: null,
      },
    ];
  });
}

/**
 * One feed's recent items as signals. Throws FEED_UNREADABLE for anything that
 * is not a parseable feed and FEED_EMPTY when it parses but holds no usable item.
 */
export function readJournalFeed(xml: string, source: JournalRadarSource, now: Date): JournalTrendSignalInput[] {
  const document = parseXml(xml);
  const plainText = textReader(document);
  const items =
    source.format === "youtube" ? youtubeItems(document, now, plainText) : rssItems(document, now, plainText, source.kind);
  const typicalReplies = median(items.flatMap((item) => (item.comments === null ? [] : [item.comments])));
  const raw = items.filter(
    (item) =>
      item.comments === null ||
      item.comments < STANDING_THREAD_MIN_REPLIES ||
      item.comments < STANDING_THREAD_MULTIPLE * Math.max(1, typicalReplies ?? 1)
  );
  if (!raw.length) throw new JournalFeedError("FEED_EMPTY");

  // The channel's typical video: settled videos only, when there are enough.
  const settled = raw.filter(
    (item) => item.views !== null && now.getTime() - Date.parse(item.published_at) >= BASELINE_MIN_AGE_DAYS * DAY_MS
  );
  const viewed = raw.filter((item) => item.views !== null);
  const baseline = median(
    (settled.length >= BASELINE_MIN_ITEMS ? settled : viewed).map((item) => item.views as number)
  );

  const cutoff = now.getTime() - RADAR_ITEM_WINDOW_DAYS * DAY_MS;
  const seen = new Set<string>();
  return raw
    .filter((item) => Date.parse(item.published_at) >= cutoff)
    .filter((item) => (seen.has(item.item_key) ? false : (seen.add(item.item_key), true)))
    .map((item) => {
      const summary = item.summary ? clip(item.summary, SUMMARY_CHARS) : null;
      return {
        source_key: source.key,
        sphere: source.sphere,
        kind: source.kind,
        item_key: item.item_key,
        url: item.url,
        title: clip(item.title, MAX_TITLE),
        summary: summary && summary.length <= MAX_SUMMARY ? summary : null,
        published_at: item.published_at,
        views: item.views,
        baseline_views: item.views !== null ? baseline : null,
        momentum:
          item.views !== null && baseline !== null && baseline > 0
            ? Math.round((item.views / baseline) * 100) / 100
            : null,
        comments: item.comments,
      };
    });
}
