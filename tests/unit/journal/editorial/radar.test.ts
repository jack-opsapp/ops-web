import { describe, expect, it, vi } from "vitest";
import { JournalFeedError, readJournalFeed } from "@/lib/journal/editorial/radar/feeds";
import {
  JournalFeedFetchError,
  isJournalRadarDegraded,
  scanJournalRadar,
} from "@/lib/journal/editorial/radar/scan";
import { selectClaimSignals, trendSignalRow } from "@/lib/journal/editorial/radar/signals";
import {
  JOURNAL_RADAR_SOURCES,
  journalRadarSource,
  type JournalRadarSource,
} from "@/lib/journal/editorial/radar/watchlist";
import { signalRow } from "./fixtures";

const NOW = new Date("2026-09-16T18:00:00Z");
const channel = journalRadarSource("essential-craftsman") as JournalRadarSource;
const blog = journalRadarSource("farnam-street") as JournalRadarSource;
const forum = journalRadarSource("contractortalk") as JournalRadarSource;

function video(id: string, published: string, views: number, title = `Video ${id}`) {
  return `
 <entry>
  <id>yt:video:${id}</id>
  <yt:videoId>${id}</yt:videoId>
  <title>${title}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
  <published>${published}</published>
  <media:group>
   <media:title>${title}</media:title>
   <media:description>Scott builds a &amp; b. &lt;b&gt;Join&lt;/b&gt; the academy.</media:description>
   <media:community>
    <media:starRating count="120" average="5.00" min="1" max="5"/>
    <media:statistics views="${views}"/>
   </media:community>
  </media:group>
 </entry>`;
}

const youtubeFeed = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UCzr30osBdTmuFUS8IfXtXmg"/>
 <title>Essential Craftsman</title>
${entries}
</feed>`;

const rssFeed = (items: string) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/"
 xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
 <title>Feed</title>
 <image><url>https://example.com/logo.png</url><title>Feed</title><link>https://example.com/</link></image>
 ${items}
</channel></rss>`;

describe("journal radar watchlist", () => {
  it("names every feed once, over HTTPS, in a known sphere", () => {
    const keys = JOURNAL_RADAR_SOURCES.map((source) => source.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const source of JOURNAL_RADAR_SOURCES) {
      expect(source.url, source.key).toMatch(/^https:\/\//);
      expect(source.key, source.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      if (source.format === "youtube") expect(source.url).toMatch(/channel_id=UC[\w-]{22}$/);
    }
    expect(new Set(JOURNAL_RADAR_SOURCES.map((source) => source.sphere))).toEqual(
      new Set(["leadership", "business", "trades", "industry", "forum"])
    );
    expect(JOURNAL_RADAR_SOURCES.map((source) => source.format === "youtube")).toHaveLength(26);
    expect(JOURNAL_RADAR_SOURCES.filter((source) => source.format === "youtube")).toHaveLength(16);
    expect(JOURNAL_RADAR_SOURCES.filter((source) => source.kind === "thread")).toHaveLength(1);
    expect(journalRadarSource("jocko-podcast")?.name).toBe("Jocko Podcast");
    expect(journalRadarSource("missing")).toBeNull();
  });
});

describe("journal radar feeds", () => {
  it("reads a YouTube channel: views, the channel's typical video, and momentum against it", () => {
    const xml = youtubeFeed(
      [
        video("fresh1", "2026-09-15T12:00:00+00:00", 90000, "The one habit that keeps a crew"),
        video("old1", "2026-09-10T12:00:00+00:00", 10000),
        video("old2", "2026-09-08T12:00:00+00:00", 20000),
        video("old3", "2026-09-05T12:00:00+00:00", 30000),
        video("ancient", "2026-07-01T12:00:00+00:00", 5000),
      ].join("")
    );
    const signals = readJournalFeed(xml, channel, NOW);
    // The two-month-old video sets the baseline but is not a signal.
    expect(signals.map((signal) => signal.item_key)).toEqual(["yt:fresh1", "yt:old1", "yt:old2", "yt:old3"]);
    expect(signals[0]).toEqual({
      source_key: "essential-craftsman",
      sphere: "trades",
      kind: "video",
      item_key: "yt:fresh1",
      url: "https://www.youtube.com/watch?v=fresh1",
      title: "The one habit that keeps a crew",
      summary: "Scott builds a & b. Join the academy.",
      published_at: "2026-09-15T12:00:00.000Z",
      views: 90000,
      // Median of the settled videos: 5,000 / 10,000 / 20,000 / 30,000.
      baseline_views: 15000,
      momentum: 6,
      comments: null,
    });
    expect(signals[1].momentum).toBe(0.67);
  });

  it("uses every video for the baseline when too few have settled", () => {
    const xml = youtubeFeed(
      [video("a", "2026-09-16T01:00:00+00:00", 100), video("b", "2026-09-15T01:00:00+00:00", 300), video("c", "2026-09-12T01:00:00+00:00", 900)].join("")
    );
    const signals = readJournalFeed(xml, channel, NOW);
    expect(signals.map((signal) => [signal.baseline_views, signal.momentum])).toEqual([
      [300, 0.33],
      [300, 1],
      [300, 3],
    ]);
  });

  const thread = (id: number, replies: number, title = `Thread ${id}`) => `
 <item>
  <title>${title}</title>
  <pubDate>Wed, 16 Sep 2026 19:01:50 +0000</pubDate>
  <link>https://www.contractortalk.com/threads/thread.${id}/</link>
  <guid>https://www.contractortalk.com/threads/thread.${id}/</guid>
  <category domain="https://www.contractortalk.com/forums/contracting-business-forum.16/"><![CDATA[Contracting Business Forum]]></category>
  <comments>https://www.contractortalk.com/threads/thread.${id}/#comments</comments>
  <content:encoded><![CDATA[<div class="bbWrapper">where i live we get <b>real</b> winter<br/>so it can get slow<script>alert(1)</script></div>]]></content:encoded>
  <slash:comments>${replies}</slash:comments>
 </item>`;

  it("reads a forum thread's replies and board, keeping only words from HTML", () => {
    const [signal] = readJournalFeed(rssFeed(thread(464471, 8, "any t&amp;g'ers")), forum, new Date("2026-09-16T20:00:00Z"));
    expect(signal).toMatchObject({
      kind: "thread",
      sphere: "forum",
      title: "any t&g'ers",
      comments: 8,
      views: null,
      momentum: null,
      summary: "Contracting Business Forum · where i live we get real winterso it can get slowalert(1)",
    });
  });

  it("drops a forum's standing megathreads but keeps a busy real one", () => {
    const xml = rssFeed([thread(1, 12694), thread(2, 9213), thread(3, 14), thread(4, 12), thread(5, 109), thread(6, 44), thread(7, 8)].join(""));
    const signals = readJournalFeed(xml, forum, new Date("2026-09-16T20:00:00Z"));
    expect(signals.map((signal) => signal.comments)).toEqual([14, 12, 109, 44, 8]);
  });

  it("reads a blog's RSS, skips unusable items and repeats, and clips long text", () => {
    const long = "word ".repeat(200);
    const xml = rssFeed(`
 <item><title>Good post</title><link>https://fs.blog/good/</link><guid isPermaLink="false">https://fs.blog/?p=1</guid><pubDate>Thu, 10 Sep 2026 09:50:00 +0000</pubDate><description>${long}</description></item>
 <item><title>Good post again</title><link>https://fs.blog/good/</link><guid isPermaLink="false">https://fs.blog/?p=1</guid><pubDate>Thu, 10 Sep 2026 09:50:00 +0000</pubDate></item>
 <item><title>Plain http</title><link>http://fs.blog/insecure/</link><pubDate>Thu, 10 Sep 2026 09:50:00 +0000</pubDate></item>
 <item><title>No date</title><link>https://fs.blog/undated/</link></item>
 <item><title>From the future</title><link>https://fs.blog/future/</link><pubDate>Mon, 21 Sep 2026 09:50:00 +0000</pubDate></item>
 <item><title></title><link>https://fs.blog/untitled/</link><pubDate>Thu, 10 Sep 2026 09:50:00 +0000</pubDate></item>
 <item><title>Dated by dc</title><link>https://fs.blog/dc/</link><dc:date>2026-09-11T08:00:00Z</dc:date></item>`);
    const signals = readJournalFeed(xml, blog, NOW);
    expect(signals.map((signal) => signal.item_key)).toEqual(["https://fs.blog/?p=1", "https://fs.blog/dc/"]);
    expect(signals[0].summary?.length).toBeLessThanOrEqual(280);
    expect(signals[0].summary).toMatch(/…$/);
    expect(signals[1].published_at).toBe("2026-09-11T08:00:00.000Z");
  });

  it("reads a blog that publishes Atom", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>tag:blog,2026:1</id><title type="html">Ownership &lt;em&gt;first&lt;/em&gt;</title>
  <link rel="alternate" href="https://seths.blog/2026/09/ownership/"/><updated>2026-09-14T08:00:00Z</updated>
  <summary>Short.</summary></entry></feed>`;
    const [signal] = readJournalFeed(xml, blog, NOW);
    expect(signal).toMatchObject({ item_key: "tag:blog,2026:1", title: "Ownership first", published_at: "2026-09-14T08:00:00.000Z" });
  });

  it("names a page that is not a feed, and a feed with nothing usable", () => {
    expect(() => readJournalFeed("<html><body><p>Access denied</p></body>", blog, NOW)).toThrowError(
      expect.objectContaining({ code: "FEED_UNREADABLE" })
    );
    expect(() => readJournalFeed("not xml at all", blog, NOW)).toThrow(JournalFeedError);
    expect(() => readJournalFeed(rssFeed(""), blog, NOW)).toThrowError(expect.objectContaining({ code: "FEED_EMPTY" }));
  });
});

describe("journal radar scan", () => {
  const sources: JournalRadarSource[] = [channel, blog, forum];

  it("reads every feed, records each outcome, and never lets one failure stop the rest", async () => {
    const fetchFeed = vi.fn(async (url: string) => {
      if (url === blog.url) throw new JournalFeedFetchError("FEED_BLOCKED");
      if (url === forum.url) return "<html>maintenance</html>";
      return youtubeFeed(video("v1", "2026-09-15T12:00:00+00:00", 500));
    });
    const scan = await scanJournalRadar(fetchFeed, NOW, sources);
    expect(fetchFeed).toHaveBeenCalledTimes(3);
    expect(scan.signals.map((signal) => signal.item_key)).toEqual(["yt:v1"]);
    expect(scan.sources).toEqual([
      { key: "essential-craftsman", name: "Essential Craftsman", sphere: "trades", ok: true, items: 1, code: null },
      { key: "farnam-street", name: "Farnam Street", sphere: "leadership", ok: false, items: 0, code: "FEED_BLOCKED" },
      { key: "contractortalk", name: "ContractorTalk", sphere: "forum", ok: false, items: 0, code: "FEED_UNREADABLE" },
    ]);
    expect(isJournalRadarDegraded(scan.sources)).toBe(true);
  });

  it("reads at most six feeds at once", async () => {
    let open = 0;
    let peak = 0;
    const many = Array.from({ length: 14 }, (_, index) => ({ ...blog, key: `feed-${index}`, url: `https://example.com/${index}` }));
    await scanJournalRadar(
      async () => {
        open += 1;
        peak = Math.max(peak, open);
        await new Promise((resolve) => setTimeout(resolve, 5));
        open -= 1;
        throw new Error("network");
      },
      NOW,
      many
    );
    expect(peak).toBe(6);
  });

  it("calls the radar degraded only when fewer than half the feeds answer", () => {
    const status = (ok: boolean) => ({ key: "k", name: "n", sphere: "trades" as const, ok, items: 0, code: null });
    expect(isJournalRadarDegraded([status(true), status(false)])).toBe(false);
    expect(isJournalRadarDegraded([status(true), status(false), status(false)])).toBe(true);
    expect(isJournalRadarDegraded([])).toBe(true);
  });
});

describe("journal radar claim signals", () => {
  it("normalises database numbers that arrive as strings", () => {
    expect(
      trendSignalRow({
        id: "x",
        source_key: "tommy-mello",
        sphere: "trades",
        kind: "video",
        url: "https://www.youtube.com/watch?v=x",
        title: "T",
        summary: null,
        published_at: "2026-09-10T15:00:00+00:00",
        views: "48210",
        baseline_views: "9400",
        momentum: "5.13",
        comments: null,
      })
    ).toMatchObject({ views: 48210, baseline_views: 9400, momentum: 5.13, comments: null, published_at: "2026-09-10T15:00:00.000Z" });
  });

  it("keeps the last two weeks, the six strongest per feed, grouped by sphere", () => {
    const videos = Array.from({ length: 8 }, (_, index) =>
      signalRow({ id: `video-${index}`, momentum: index, published_at: "2026-09-12T00:00:00.000Z" })
    );
    const rows = [
      ...videos,
      signalRow({ id: "stale", momentum: 99, published_at: "2026-08-25T00:00:00.000Z" }),
      signalRow({ id: "thread-quiet", source_key: "contractortalk", sphere: "forum", kind: "thread", momentum: null, views: null, comments: 2 }),
      signalRow({ id: "thread-loud", source_key: "contractortalk", sphere: "forum", kind: "thread", momentum: null, views: null, comments: 60 }),
      signalRow({ id: "essay", source_key: "seth-godin", sphere: "leadership", kind: "article", momentum: null, views: null, published_at: "2026-09-15T00:00:00.000Z" }),
    ];
    const selected = selectClaimSignals(rows, NOW);
    expect(selected.map((signal) => signal.id)).toEqual([
      "essay",
      "video-7",
      "video-6",
      "video-5",
      "video-4",
      "video-3",
      "video-2",
      "thread-loud",
      "thread-quiet",
    ]);
    expect(selected[0]).toMatchObject({ source: "Seth Godin", age_days: 1.8, replies: null });
    expect(selected.at(-2)).toMatchObject({ source: "ContractorTalk", replies: 60 });
  });
});
