/**
 * Fix migration: fetch Blog Post Sections from Bubble, assemble content,
 * update posts that have empty content, fix faqs type, recalculate word_count.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx npx tsx scripts/fix-blog-sections.ts
 */

import { createClient } from "@supabase/supabase-js";

const BUBBLE_POSTS = "https://opsapp.co/api/1.1/obj/blog_post";
const BUBBLE_SECTIONS = "https://opsapp.co/api/1.1/obj/blogpostsection";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

// ─── BBCode → HTML ───────────────────────────────────────────────────────────

function bbcodeToHtml(raw: string | undefined): string {
  if (!raw) return "";
  let html = raw;

  html = html.replace(/\[font="[^"]*"\]/g, "");
  html = html.replace(/\[\/font\]/g, "");
  html = html.replace(/\[highlight=[^\]]*\]/g, "");
  html = html.replace(/\[\/highlight\]/g, "");
  html = html.replace(/\[ml\]/g, "");
  html = html.replace(/\[\/ml\]/g, "");

  html = html.replace(/\[h1\]/g, "<h1>");
  html = html.replace(/\[\/h1\]/g, "</h1>");
  html = html.replace(/\[h2\]/g, "<h2>");
  html = html.replace(/\[\/h2\]/g, "</h2>");
  html = html.replace(/\[h3\]/g, "<h3>");
  html = html.replace(/\[\/h3\]/g, "</h3>");
  html = html.replace(/\[h4\]/g, "<h4>");
  html = html.replace(/\[\/h4\]/g, "</h4>");

  html = html.replace(/\[b\]/g, "<strong>");
  html = html.replace(/\[\/b\]/g, "</strong>");
  html = html.replace(/\[i\]/g, "<em>");
  html = html.replace(/\[\/i\]/g, "</em>");

  html = html.replace(
    /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/g,
    '<a href="$1" target="_blank" rel="noopener">$2</a>'
  );

  html = html.replace(/\[ul\]/g, "<ul>");
  html = html.replace(/\[\/ul\]/g, "</ul>");
  html = html.replace(/\[ol\]/g, "<ol>");
  html = html.replace(/\[\/ol\]/g, "</ol>");
  html = html.replace(/\[li[^\]]*\]/g, "<li>");
  html = html.replace(/\[\/li\]/g, "</li>");

  html = html.replace(/\[blockquote\]/g, "<blockquote>");
  html = html.replace(/\[\/blockquote\]/g, "</blockquote>");

  html = html.replace(/\uFEFF/g, "");
  html = html.replace(/\u200B/g, "");
  html = html.replace(/^>>/gm, "");

  html = html.replace(/\r\n/g, "\n");

  const blocks = html.split(/\n\n+/);
  const blockTags = /^<(h[1-4]|ul|ol|li|blockquote|p|div|section|article)/i;

  html = blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (blockTags.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  html = html.replace(/<(strong|em|p|h[1-4])>\s*<\/\1>/g, "");
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/\n{3,}/g, "\n\n");

  return html.trim();
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ");
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

interface BubbleSection {
  _id: string;
  "Parent Blog Post": string;
  "Section Number": number;
  Heading?: string;
  body?: string;
}

interface BubblePost {
  _id: string;
  Sections?: string[];
  Slug?: string;
  Title: string;
}

async function fetchAll<T>(baseUrl: string): Promise<T[]> {
  const all: T[] = [];
  let cursor = 0;
  let remaining = 1;

  while (remaining > 0) {
    const res = await fetch(`${baseUrl}?limit=100&cursor=${cursor}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    all.push(...data.response.results);
    remaining = data.response.remaining;
    cursor += data.response.results.length;
    console.log(`  Fetched ${all.length} (${remaining} remaining)...`);
  }

  return all;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Step 1: Fix faqs type for ALL posts (string "[]" → array [])
  console.log("Step 1: Fixing faqs column type...");
  const { error: faqsError } = await supabase.rpc("exec_sql", {
    sql: `UPDATE blog_posts SET faqs = '[]'::jsonb WHERE jsonb_typeof(faqs) = 'string';`,
  });
  // If RPC doesn't exist, fall back to raw update
  if (faqsError) {
    console.log("  RPC not available, using direct update...");
    // Can't fix via Supabase JS client easily — we'll fix in the update loop below
  } else {
    console.log("  Done.");
  }

  // Step 2: Fetch sections from Bubble
  console.log("\nStep 2: Fetching Blog Post Sections from Bubble...");
  const sections = await fetchAll<BubbleSection>(BUBBLE_SECTIONS);
  console.log(`  Total sections: ${sections.length}`);

  // Step 3: Fetch posts from Bubble (to map Bubble _id → slug)
  console.log("\nStep 3: Fetching Blog Posts from Bubble (for ID mapping)...");
  const bubblePosts = await fetchAll<BubblePost>(BUBBLE_POSTS);
  console.log(`  Total posts: ${bubblePosts.length}`);

  // Build Bubble _id → slug map
  const idToSlug = new Map<string, string>();
  for (const bp of bubblePosts) {
    const slug =
      bp.Slug ||
      bp.Title.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    idToSlug.set(bp._id, slug);
  }

  // Group sections by parent post
  const sectionsByPost = new Map<string, BubbleSection[]>();
  for (const sec of sections) {
    const parentId = sec["Parent Blog Post"];
    if (!sectionsByPost.has(parentId)) {
      sectionsByPost.set(parentId, []);
    }
    sectionsByPost.get(parentId)!.push(sec);
  }

  // Sort each group by Section Number
  for (const [, secs] of sectionsByPost) {
    secs.sort((a, b) => (a["Section Number"] ?? 0) - (b["Section Number"] ?? 0));
  }

  // Step 4: Assemble content and update posts
  console.log("\nStep 4: Updating posts with section content...");
  let updated = 0;
  let skipped = 0;

  for (const [bubbleId, secs] of sectionsByPost) {
    const slug = idToSlug.get(bubbleId);
    if (!slug) {
      console.log(`  SKIP: No slug found for Bubble ID ${bubbleId}`);
      skipped++;
      continue;
    }

    // Assemble content from sections
    const contentParts: string[] = [];
    for (const sec of secs) {
      if (sec.Heading) {
        contentParts.push(`<h2>${sec.Heading}</h2>`);
      }
      if (sec.body) {
        contentParts.push(bbcodeToHtml(sec.body));
      }
    }
    const content = contentParts.join("\n");
    const wordCount = countWords(content);

    if (!content) {
      console.log(`  SKIP (no content): ${slug}`);
      skipped++;
      continue;
    }

    // Update in Supabase
    const { error } = await supabase
      .from("blog_posts")
      .update({
        content,
        word_count: wordCount,
        faqs: [],  // Fix: proper array, not string
      })
      .eq("slug", slug);

    if (error) {
      console.error(`  ERROR: ${slug} → ${error.message}`);
    } else {
      console.log(`  OK: ${slug} (${wordCount} words, ${secs.length} sections)`);
      updated++;
    }
  }

  // Step 5: Fix faqs + recalculate word_count for posts that already had content
  console.log("\nStep 5: Fixing faqs & word_count for posts with existing content...");
  const { data: existingPosts } = await supabase
    .from("blog_posts")
    .select("id, slug, content, word_count")
    .gt("word_count", 0);

  let fixedCount = 0;
  for (const post of existingPosts ?? []) {
    const wc = countWords(post.content);
    // Always fix faqs to proper array
    const { error } = await supabase
      .from("blog_posts")
      .update({ faqs: [], word_count: wc })
      .eq("id", post.id);

    if (error) {
      console.error(`  ERROR fixing ${post.slug}: ${error.message}`);
    } else {
      fixedCount++;
    }
  }
  console.log(`  Fixed ${fixedCount} posts.`);

  console.log(`\n─── Fix Complete ───`);
  console.log(`Updated with sections: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Fixed existing: ${fixedCount}`);
}

main().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});
