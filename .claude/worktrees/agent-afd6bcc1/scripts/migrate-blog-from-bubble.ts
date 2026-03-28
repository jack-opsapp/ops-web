/**
 * One-time migration: Bubble blog posts → Supabase
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx npx tsx scripts/migrate-blog-from-bubble.ts
 */

import { createClient } from "@supabase/supabase-js";

const BUBBLE_API = "https://opsapp.co/api/1.1/obj/blog_post";
const LIMIT = 100;

// ─── Supabase ────────────────────────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}
const supabase = createClient(url, key);

// ─── Category mapping (Bubble name → Supabase UUID) ─────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  "Case Study": "8a4ceabe-15b2-407e-a61f-f64875b6d640",
  "Current Events": "41f21560-9520-4439-a878-9e2912525dda",
  Educational: "8149b04b-7828-482b-b46d-a5706f3700b3",
  "How-To": "45329a87-cb98-4f0f-b55e-7d9654c9cb32",
  Insightful: "f321ab86-51a7-427b-affd-b528b5220c82",
  Leadership: "c22da94d-3b71-493a-9d0a-b5a33c59ea62",
  Technology: "cc615e70-274c-461d-9e58-01e58018a254",
};

// ─── BBCode → HTML conversion ────────────────────────────────────────────────

function bbcodeToHtml(raw: string | undefined): string {
  if (!raw) return "";
  let html = raw;

  // Strip Bubble-specific wrappers
  html = html.replace(/\[font="[^"]*"\]/g, "");
  html = html.replace(/\[\/font\]/g, "");
  html = html.replace(/\[highlight=[^\]]*\]/g, "");
  html = html.replace(/\[\/highlight\]/g, "");
  html = html.replace(/\[ml\]/g, "");
  html = html.replace(/\[\/ml\]/g, "");

  // Headings
  html = html.replace(/\[h1\]/g, "<h1>");
  html = html.replace(/\[\/h1\]/g, "</h1>");
  html = html.replace(/\[h2\]/g, "<h2>");
  html = html.replace(/\[\/h2\]/g, "</h2>");
  html = html.replace(/\[h3\]/g, "<h3>");
  html = html.replace(/\[\/h3\]/g, "</h3>");
  html = html.replace(/\[h4\]/g, "<h4>");
  html = html.replace(/\[\/h4\]/g, "</h4>");

  // Inline formatting
  html = html.replace(/\[b\]/g, "<strong>");
  html = html.replace(/\[\/b\]/g, "</strong>");
  html = html.replace(/\[i\]/g, "<em>");
  html = html.replace(/\[\/i\]/g, "</em>");

  // Links: [url=https://...]text[/url]
  html = html.replace(
    /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/g,
    '<a href="$1" target="_blank" rel="noopener">$2</a>'
  );

  // Lists
  html = html.replace(/\[ul\]/g, "<ul>");
  html = html.replace(/\[\/ul\]/g, "</ul>");
  html = html.replace(/\[ol\]/g, "<ol>");
  html = html.replace(/\[\/ol\]/g, "</ol>");
  html = html.replace(/\[li[^\]]*\]/g, "<li>");
  html = html.replace(/\[\/li\]/g, "</li>");

  // Blockquote
  html = html.replace(/\[blockquote\]/g, "<blockquote>");
  html = html.replace(/\[\/blockquote\]/g, "</blockquote>");

  // Remove zero-width characters
  html = html.replace(/\uFEFF/g, "");
  html = html.replace(/\u200B/g, "");

  // Handle >> as blockquote indicator
  html = html.replace(/^>>/gm, "");

  // Convert double newlines to paragraph breaks
  // First, normalize newlines
  html = html.replace(/\r\n/g, "\n");

  // Wrap loose text blocks in <p> tags
  // Split by double newlines, wrap non-block-level content in <p>
  const blocks = html.split(/\n\n+/);
  const blockTags = /^<(h[1-4]|ul|ol|li|blockquote|p|div|section|article)/i;

  html = blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (blockTags.test(trimmed)) return trimmed;
      // Single newlines within a block → <br>
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  // Clean up empty tags
  html = html.replace(/<(strong|em|p|h[1-4])>\s*<\/\1>/g, "");
  html = html.replace(/<p>\s*<\/p>/g, "");

  // Clean up whitespace
  html = html.replace(/\n{3,}/g, "\n\n");

  return html.trim();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ");
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function fixThumbnail(url: string | undefined): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

// ─── Fetch from Bubble ───────────────────────────────────────────────────────

interface BubblePost {
  _id: string;
  Title: string;
  Subtitle?: string;
  Author?: string;
  Content: string;
  Views?: number;
  Date?: string;
  Live?: boolean;
  Slug?: string;
  Thumbnail?: string;
  "Category 1"?: string;
  "Category 2"?: string;
  Categories?: string[];
  Teaser?: string;
  Summary?: string;
  "Meta Title"?: string;
  "Created Date": string;
  "Modified Date": string;
}

async function fetchAllPosts(): Promise<BubblePost[]> {
  const allPosts: BubblePost[] = [];
  let cursor = 0;
  let remaining = 1;

  while (remaining > 0) {
    const url = `${BUBBLE_API}?limit=${LIMIT}&cursor=${cursor}`;
    console.log(`Fetching posts (cursor=${cursor})...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bubble API error: ${res.status}`);
    const data = await res.json();
    allPosts.push(...data.response.results);
    remaining = data.response.remaining;
    cursor += data.response.results.length;
  }

  return allPosts;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching blog posts from Bubble...");
  const posts = await fetchAllPosts();
  console.log(`Fetched ${posts.length} posts.\n`);

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const bp of posts) {
    const slug = bp.Slug || slugify(bp.Title);
    const content = bbcodeToHtml(bp.Content);
    const cat1 = bp["Category 1"] ? CATEGORY_MAP[bp["Category 1"]] : null;
    const cat2 = bp["Category 2"] ? CATEGORY_MAP[bp["Category 2"]] : null;

    const row = {
      title: bp.Title,
      subtitle: bp.Subtitle || null,
      slug,
      author: bp.Author || "Ops Team",
      content,
      summary: bp.Summary || null,
      teaser: bp.Teaser || null,
      meta_title: bp["Meta Title"] || null,
      thumbnail_url: fixThumbnail(bp.Thumbnail),
      category_id: cat1 || null,
      category2_id: cat2 || null,
      is_live: bp.Live ?? false,
      display_views: bp.Views ?? 0,
      word_count: countWords(content),
      faqs: JSON.stringify([]),
      published_at: bp.Date || null,
      created_at: bp["Created Date"],
      updated_at: bp["Modified Date"],
    };

    // Check if slug already exists
    const { data: existing } = await supabase
      .from("blog_posts")
      .select("id")
      .eq("slug", row.slug)
      .maybeSingle();

    if (existing) {
      console.log(`  SKIP (exists): ${row.title}`);
      skipped++;
      continue;
    }

    const { error } = await supabase.from("blog_posts").insert(row);

    if (error) {
      console.error(`  ERROR: ${row.title} → ${error.message}`);
      errors.push(`${row.title}: ${error.message}`);
    } else {
      console.log(`  OK: ${row.title} (${row.is_live ? "LIVE" : "draft"})`);
      inserted++;
    }
  }

  console.log(`\n─── Migration Complete ───`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Errors:   ${errors.length}`);
  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach((e) => console.log(`  - ${e}`));
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
