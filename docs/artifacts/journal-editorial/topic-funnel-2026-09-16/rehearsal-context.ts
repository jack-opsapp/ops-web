import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { JOURNAL_LIMITS, JOURNAL_PITCH_LIMITS } from "@/lib/journal/editorial/brief";
import { JOURNAL_RADAR_SPHERE_NOTES } from "@/lib/journal/editorial/radar/watchlist";

// Builds the files a claim would hand the routine, from the live radar scan and
// the production journal (read only), for a local rehearsal of the funnel.
async function main() {
  const [scanFile, outDir] = process.argv.slice(2);
  const env = Object.fromEntries(
    readFileSync("../ops-web/.env.local", "utf8").split("\n").flatMap((line) => {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      return match ? [[match[1], match[2].replace(/^"|"$/g, "").replace(/\\n$/, "").trim()]] : [];
    })
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const [posts, cats, topics] = await Promise.all([
    db.from("blog_posts").select("slug,title,published_at,summary,category_id").eq("is_live", true).lte("published_at", new Date().toISOString()).order("published_at", { ascending: false }).limit(40),
    db.from("blog_categories").select("id,slug,name").order("name"),
    db.from("blog_topics").select("id,topic").eq("used", false).order("created_at").limit(50),
  ]);
  for (const result of [posts, cats, topics]) if (result.error) throw result.error;
  const slugOf = new Map((cats.data ?? []).map((row) => [row.id, row.slug]));
  const scan = JSON.parse(readFileSync(scanFile, "utf8"));
  writeFileSync(`${outDir}/radar.json`, JSON.stringify({ radar: { scanned_at: scan.scanned_at, spheres: JOURNAL_RADAR_SPHERE_NOTES, feeds: scan.sources }, trend_signals: scan.claim }, null, 2));
  writeFileSync(`${outDir}/context.json`, JSON.stringify({
    identity: "weekly:2026-09-21",
    publishes_at: "2026-09-21T13:00:00.000Z",
    current_time: new Date().toISOString(),
    limits: JOURNAL_LIMITS,
    pitch_limits: JOURNAL_PITCH_LIMITS,
    categories: (cats.data ?? []).map(({ slug, name }) => ({ slug, name })),
    recent_posts: (posts.data ?? []).map((row) => ({ slug: row.slug, title: row.title, published_at: row.published_at, summary: row.summary, category: slugOf.get(row.category_id) ?? null })),
    backlog_topics: topics.data,
  }, null, 2));
  console.log(`radar ${scan.claim.length} signals, ${posts.data?.length} recent posts, ${topics.data?.length} backlog topics`);
}
main().catch((error) => { console.error(error); process.exit(1); });
