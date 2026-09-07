// Exports three live public blog articles from the production database into a
// local fixture for the rehearsal stack. Reads the primary checkout's .env.local
// for the Supabase URL and service-role key; never prints either value.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/private/tmp/ops-instagram-diagnostics-release-20260904/package.json");
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  readFileSync("/Users/jacksonsweet/Projects/OPS/ops-web/.env.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_0-9]+=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
    })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase env in primary .env.local");
if (!url.includes("ijeekuhbatykdomumfjx")) throw new Error("Unexpected Supabase project");

const slugs = [
  "claude-fable-5-1-first-test-gpt-5-7-astra",
  "word-of-mouth-isnt-a-marketing-plan",
  "western-cape-breton-flood-emergency-trades-dispatch-september-6-2026",
  "great-hands-dont-make-great-bosses",
];
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db
  .from("blog_posts")
  .select("id,title,subtitle,slug,content,published_at,is_live,thumbnail_url,source,updated_at")
  .in("slug", slugs);
if (error) throw error;
const out = process.argv[2];
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`fixture rows=${data.length} bytes=${JSON.stringify(data).length} -> ${out}`);
