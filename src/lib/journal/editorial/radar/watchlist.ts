/**
 * The trend radar's watchlist: the public feeds OPS reads to see what the
 * trades, and the voices around the OPS ethos, are talking about.
 *
 * Every entry was fetched and parsed on 2026-09-16 and returned items from the
 * last two weeks (except where noted). Publishers that refuse automated
 * readers (JLC, ProRemodeler, ForConstructionPros, Builder, LBM Journal, HBS
 * Dealer, Equipment World, ACHR News, Contractor, EC&M) are left out rather
 * than retried; Reddit requires an approved commercial API contract and X a
 * paid API, so the writer reaches both through search instead.
 */

export const JOURNAL_RADAR_SPHERES = ["leadership", "business", "trades", "industry", "forum"] as const;
export type JournalRadarSphere = (typeof JOURNAL_RADAR_SPHERES)[number];

export type JournalRadarKind = "video" | "article" | "thread";

export interface JournalRadarSource {
  key: string;
  name: string;
  sphere: JournalRadarSphere;
  format: "youtube" | "rss";
  kind: JournalRadarKind;
  url: string;
}

/** What each sphere stands for, sent with the claim so the writer weighs it right. */
export const JOURNAL_RADAR_SPHERE_NOTES: Record<JournalRadarSphere, string> = {
  leadership: "Ownership, discipline and leading people: the voices closest to the OPS ethos.",
  business: "Owners building, buying and running businesses: money, sales, hiring, systems.",
  trades: "Trades business owners and builders talking shop: crews, customers, pricing, the work itself.",
  industry: "Construction and housing news: costs, rates, labour, rules, the market owners bid into.",
  forum: "Owners and crews arguing it out in their own words. Reply counts show what struck a nerve.",
};

const youtube = (key: string, name: string, sphere: JournalRadarSphere, channelId: string): JournalRadarSource => ({
  key,
  name,
  sphere,
  format: "youtube",
  kind: "video",
  url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
});

const rss = (
  key: string,
  name: string,
  sphere: JournalRadarSphere,
  url: string,
  kind: JournalRadarKind = "article"
): JournalRadarSource => ({ key, name, sphere, format: "rss", kind, url });

export const JOURNAL_RADAR_SOURCES: readonly JournalRadarSource[] = [
  // Leadership
  youtube("jocko-podcast", "Jocko Podcast", "leadership", "UCkqcY4CAuBFNFho6JgygCnA"),
  youtube("echelon-front", "Echelon Front", "leadership", "UCNrp1IS3h3jeo3zymgPahQA"),
  youtube("simon-sinek", "Simon Sinek", "leadership", "UCPmfPl-BsCd3wmE8i45LAoA"),
  youtube("daily-stoic", "Daily Stoic", "leadership", "UCkUaT0T03TJvafYkfATM2Ag"),
  rss("seth-godin", "Seth Godin", "leadership", "https://seths.blog/feed/"),
  rss("farnam-street", "Farnam Street", "leadership", "https://fs.blog/feed/"),
  // Business
  youtube("alex-hormozi", "Alex Hormozi", "business", "UCUyDOdBWhC1MCxEjC46d-zw"),
  youtube("my-first-million", "My First Million", "business", "UCyaN6mg5u8Cjy2ZI4ikWaug"),
  youtube("codie-sanchez", "Codie Sanchez", "business", "UC5fI3kxC-ewZ6ZXEYgznM7g"),
  youtube("diary-of-a-ceo", "The Diary Of A CEO", "business", "UCGq-a57w-aPwyi3pW7XLiHw"),
  // Trades
  youtube("tommy-mello", "Tommy Mello", "trades", "UCHIBAP5yf14AFfhrC8BQGkA"),
  youtube("breakthrough-academy", "Breakthrough Academy", "trades", "UCyO0SohM01jMTGFHj5eKv_Q"),
  youtube("contractor-fight", "Contractor Fight TV", "trades", "UCEWHDzg1Tnogow9uAL3YESw"),
  youtube("roofing-insights", "Roofing Insights", "trades", "UCnmkHtZ2BKVutgi2Ogk9RIQ"),
  youtube("mike-rowe", "Mike Rowe", "trades", "UCKQGbLqpXP7f074dydjZrEg"),
  youtube("essential-craftsman", "Essential Craftsman", "trades", "UCzr30osBdTmuFUS8IfXtXmg"),
  youtube("build-show", "Build Show Network", "trades", "UCsJ0zEQQV-FHEmltf062IGQ"),
  youtube("honest-carpenter", "The Honest Carpenter", "trades", "UCDLxnaDQzo8YolFqsBAHVLQ"),
  // Industry
  rss("construction-dive", "Construction Dive", "industry", "https://www.constructiondive.com/feeds/news/"),
  rss("nahb-now", "NAHB Now", "industry", "https://nahbnow.com/feed/"),
  rss("eye-on-housing", "Eye on Housing", "industry", "https://eyeonhousing.org/feed/"),
  rss("canadian-contractor", "Canadian Contractor", "industry", "https://www.canadiancontractor.ca/feed/"),
  rss("on-site", "On-Site", "industry", "https://www.on-sitemag.com/feed/"),
  rss("daily-commercial-news", "Daily Commercial News", "industry", "https://canada.constructconnect.com/dcn/feed"),
  rss("fine-homebuilding", "Fine Homebuilding", "industry", "https://www.finehomebuilding.com/feed"),
  // Forum
  rss("contractortalk", "ContractorTalk", "forum", "https://www.contractortalk.com/forums/-/index.rss", "thread"),
];

export function journalRadarSource(key: string): JournalRadarSource | null {
  return JOURNAL_RADAR_SOURCES.find((source) => source.key === key) ?? null;
}
