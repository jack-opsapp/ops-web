/**
 * OPS Admin — Blog Supabase Queries
 *
 * SERVER ONLY. All functions use getAdminSupabase() (service role, bypasses RLS).
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { BlogCategory, BlogTopic, BlogPost } from "./types";

const db = () => getAdminSupabase();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ");
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// ─── Category Queries ─────────────────────────────────────────────────────────

export async function getBlogCategories(): Promise<BlogCategory[]> {
  const { data } = await db()
    .from("blog_categories")
    .select("id, name, slug")
    .order("name");
  return (data ?? []) as BlogCategory[];
}

// ─── Topic Queries ────────────────────────────────────────────────────────────

export async function getBlogTopics(): Promise<BlogTopic[]> {
  const { data } = await db()
    .from("blog_topics")
    .select("id, topic, author, image_url, used, created_at, updated_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as BlogTopic[];
}

export async function getUnusedTopicCount(): Promise<number> {
  const { count } = await db()
    .from("blog_topics")
    .select("*", { count: "exact", head: true })
    .eq("used", false);
  return count ?? 0;
}

export async function createBlogTopic(
  topic: string,
  author?: string
): Promise<BlogTopic> {
  const { data, error } = await db()
    .from("blog_topics")
    .insert({ topic, author: author ?? "OPS Team" })
    .select()
    .single();
  if (error) throw error;
  return data as BlogTopic;
}

export async function updateBlogTopic(
  id: string,
  updates: Partial<Pick<BlogTopic, "topic" | "author" | "used" | "image_url">>
): Promise<void> {
  const { error } = await db()
    .from("blog_topics")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBlogTopic(id: string): Promise<void> {
  const { error } = await db()
    .from("blog_topics")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ─── Post Queries ─────────────────────────────────────────────────────────────

export async function getBlogPostCount(): Promise<{
  total: number;
  live: number;
  draft: number;
}> {
  const [{ count: total }, { count: live }] = await Promise.all([
    db().from("blog_posts").select("*", { count: "exact", head: true }),
    db()
      .from("blog_posts")
      .select("*", { count: "exact", head: true })
      .eq("is_live", true),
  ]);
  const t = total ?? 0;
  const l = live ?? 0;
  return { total: t, live: l, draft: t - l };
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  const { data } = await db()
    .from("blog_posts")
    .select("*")
    .order("published_at", { ascending: false });
  return (data ?? []) as BlogPost[];
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data } = await db()
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as BlogPost) ?? null;
}

export async function getBlogPostById(id: string): Promise<BlogPost | null> {
  const { data } = await db()
    .from("blog_posts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as BlogPost) ?? null;
}

export async function getLiveBlogPosts(): Promise<BlogPost[]> {
  const { data } = await db()
    .from("blog_posts")
    .select("*")
    .eq("is_live", true)
    .order("published_at", { ascending: false });
  return (data ?? []) as BlogPost[];
}

export async function createBlogPost(
  input: Partial<BlogPost> & { title: string }
): Promise<BlogPost> {
  // Strip read-only fields
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = input as Record<string, unknown>;

  const row: Record<string, unknown> = {
    ...rest,
    slug: slugify(input.title),
    word_count: input.content ? countWords(input.content) : 0,
    published_at: input.is_live
      ? new Date().toISOString()
      : input.published_at || null,
  };

  // Convert empty strings to null for nullable columns
  const nullableFields = [
    "category_id",
    "category2_id",
    "published_at",
    "subtitle",
    "author",
    "summary",
    "teaser",
    "meta_title",
    "thumbnail_url",
  ];
  for (const field of nullableFields) {
    if (row[field] === "") {
      row[field] = null;
    }
  }

  const { data, error } = await db()
    .from("blog_posts")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as BlogPost;
}

export async function updateBlogPost(
  id: string,
  input: Partial<BlogPost>
): Promise<BlogPost> {
  // Strip read-only / server-managed fields
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, created_at: _ca, updated_at: _ua, word_count: _wc, ...rest } = input as Record<string, unknown>;

  const updates: Record<string, unknown> = {
    ...rest,
    updated_at: new Date().toISOString(),
  };

  // Convert empty strings to null for nullable UUID and timestamp columns
  const nullableFields = [
    "category_id",
    "category2_id",
    "published_at",
    "subtitle",
    "author",
    "summary",
    "teaser",
    "meta_title",
    "thumbnail_url",
  ];
  for (const field of nullableFields) {
    if (updates[field] === "") {
      updates[field] = null;
    }
  }

  // Recalculate word_count when content changes
  if (typeof updates.content === "string") {
    updates.word_count = countWords(updates.content as string);
  }

  // Auto-set published_at on first publish
  if (updates.is_live) {
    const existing = await getBlogPostById(id);
    if (existing && !existing.published_at) {
      updates.published_at = new Date().toISOString();
    }
  }

  const { data, error } = await db()
    .from("blog_posts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as BlogPost;
}

export async function deleteBlogPost(id: string): Promise<void> {
  const { error } = await db()
    .from("blog_posts")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
