"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { BlogCategory } from "@/lib/admin/types";
import { RichTextEditor } from "./rich-text-editor";
import { FaqEditor } from "./faq-editor";

interface PostData {
  id?: string;
  title: string;
  subtitle: string;
  slug: string;
  author: string;
  content: string;
  summary: string;
  teaser: string;
  meta_title: string;
  thumbnail_url: string;
  category_id: string;
  category2_id: string;
  is_live: boolean;
  display_views: number;
  faqs: { question: string; answer: string }[];
  published_at: string;
}

interface BlogPostEditorProps {
  initialData?: PostData;
  categories: BlogCategory[];
  isNew: boolean;
}

const DEFAULT_POST: PostData = {
  title: "",
  subtitle: "",
  slug: "",
  author: "",
  content: "",
  summary: "",
  teaser: "",
  meta_title: "",
  thumbnail_url: "",
  category_id: "",
  category2_id: "",
  is_live: false,
  display_views: 0,
  faqs: [],
  published_at: "",
};

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

export function BlogPostEditor({
  initialData,
  categories,
  isNew,
}: BlogPostEditorProps) {
  const router = useRouter();
  const [post, setPost] = useState<PostData>(initialData ?? DEFAULT_POST);
  const [saving, setSaving] = useState(false);
  const [slugManual, setSlugManual] = useState(false);

  const update = useCallback(
    <K extends keyof PostData>(key: K, value: PostData[K]) => {
      setPost((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // Auto-generate slug from title
  useEffect(() => {
    if (!slugManual && post.title) {
      setPost((prev) => ({ ...prev, slug: slugify(prev.title) }));
    }
  }, [post.title, slugManual]);

  async function handleSave() {
    if (!post.title.trim() || saving) return;
    setSaving(true);

    try {
      const method = isNew ? "POST" : "PUT";
      const url = isNew
        ? "/api/blog/posts"
        : `/api/blog/posts/${post.id}`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post),
      });

      const data = await res.json();

      if (!res.ok) {
        alert("Save failed: " + data.error);
        return;
      }

      if (isNew) {
        router.push(`/admin/blog/${data.id}/edit`);
      } else {
        setPost((prev) => ({ ...prev, ...data }));
      }
    } catch (err: unknown) {
      alert("Save failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!post.id) return;
    const confirmed = confirm("Are you sure you want to delete this post?");
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/blog/posts/${post.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        alert("Delete failed: " + data.error);
        return;
      }
      router.push("/admin/blog");
    } catch (err: unknown) {
      alert("Delete failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  }

  const publishedLocal = post.published_at
    ? new Date(post.published_at).toISOString().slice(0, 16)
    : "";

  const wordCount = countWords(post.content);

  const labelClass =
    "font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B] block mb-1";
  const inputClass =
    "w-full bg-white/[0.05] border border-white/[0.1] rounded px-3 py-1.5 font-kosugi text-[12px] text-[#E5E5E5] focus:outline-none focus:border-white/[0.2]";

  return (
    <div className="flex gap-6 min-h-[calc(100vh-100px)]">
      {/* Left — Content */}
      <div className="flex-1 space-y-4">
        {/* Title */}
        <input
          type="text"
          placeholder="Post title..."
          value={post.title}
          onChange={(e) => update("title", e.target.value)}
          className="w-full bg-transparent text-3xl font-mohave font-semibold text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none"
        />

        {/* Subtitle */}
        <input
          type="text"
          placeholder="Subtitle..."
          value={post.subtitle}
          onChange={(e) => update("subtitle", e.target.value)}
          className="w-full bg-transparent text-lg font-mohave text-[#A7A7A7] placeholder:text-[#6B6B6B] focus:outline-none"
        />

        {/* Rich Text Editor */}
        <RichTextEditor
          value={post.content}
          onChange={(html) => update("content", html)}
        />

        {/* FAQ Editor */}
        <FaqEditor
          faqs={post.faqs}
          onChange={(faqs) => update("faqs", faqs)}
        />
      </div>

      {/* Right — Sidebar */}
      <div className="w-[320px] flex-shrink-0 space-y-4">
        {/* Card 1 — Status / Save / Delete */}
        <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02] space-y-3">
          {/* Status toggle */}
          <button
            type="button"
            onClick={() => update("is_live", !post.is_live)}
            className={[
              "w-full py-2 rounded font-mohave text-[13px] uppercase tracking-wider transition-colors",
              post.is_live
                ? "bg-[#A5B368]/20 text-[#A5B368] border border-[#A5B368]/30"
                : "bg-white/[0.05] text-[#6B6B6B] border border-white/[0.1]",
            ].join(" ")}
          >
            {post.is_live ? "Live" : "Draft"}
          </button>

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!post.title.trim() || saving}
            className="w-full py-2 bg-[#597794] hover:bg-[#6B8AA6] rounded font-mohave text-[13px] uppercase tracking-wider text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save"}
          </button>

          {/* Delete (edit mode only) */}
          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              className="w-full py-2 rounded font-mohave text-[13px] uppercase tracking-wider border border-[#93321A]/30 text-[#93321A] hover:text-[#B5432A] hover:border-[#B5432A]/30 transition-colors"
            >
              Delete
            </button>
          )}
        </div>

        {/* Card 2 — Metadata */}
        <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02] space-y-4">
          {/* Thumbnail URL */}
          <div>
            <label className={labelClass}>Thumbnail URL</label>
            <input
              type="text"
              placeholder="https://..."
              value={post.thumbnail_url}
              onChange={(e) => update("thumbnail_url", e.target.value)}
              className={inputClass}
            />
            {post.thumbnail_url && (
              <img
                src={post.thumbnail_url}
                alt="Thumbnail preview"
                className="mt-2 w-full rounded border border-white/[0.08]"
              />
            )}
          </div>

          {/* Author */}
          <div>
            <label className={labelClass}>Author</label>
            <input
              type="text"
              placeholder="Author name"
              value={post.author}
              onChange={(e) => update("author", e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Category 1 */}
          <div>
            <label className={labelClass}>Category</label>
            <select
              value={post.category_id}
              onChange={(e) => update("category_id", e.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category 2 */}
          <div>
            <label className={labelClass}>Category 2 (optional)</label>
            <select
              value={post.category2_id}
              onChange={(e) => update("category2_id", e.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Meta Title */}
          <div>
            <label className={labelClass}>
              Meta Title ({post.meta_title.length}/60)
            </label>
            <input
              type="text"
              placeholder="SEO title"
              value={post.meta_title}
              onChange={(e) => update("meta_title", e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Summary */}
          <div>
            <label className={labelClass}>Summary</label>
            <textarea
              rows={2}
              placeholder="Brief summary..."
              value={post.summary}
              onChange={(e) => update("summary", e.target.value)}
              className={inputClass + " resize-y"}
            />
          </div>

          {/* Teaser */}
          <div>
            <label className={labelClass}>Teaser</label>
            <textarea
              rows={2}
              placeholder="Short teaser..."
              value={post.teaser}
              onChange={(e) => update("teaser", e.target.value)}
              className={inputClass + " resize-y"}
            />
          </div>

          {/* Slug */}
          <div>
            <label className={labelClass}>Slug</label>
            <input
              type="text"
              placeholder="post-slug"
              value={post.slug}
              onChange={(e) => {
                setSlugManual(true);
                update("slug", e.target.value);
              }}
              className={inputClass}
            />
          </div>

          {/* Published Date */}
          <div>
            <label className={labelClass}>Published Date</label>
            <input
              type="datetime-local"
              value={publishedLocal}
              onChange={(e) => {
                const val = e.target.value;
                update(
                  "published_at",
                  val ? new Date(val).toISOString() : ""
                );
              }}
              className={inputClass + " [color-scheme:dark]"}
            />
          </div>

          {/* Display Views */}
          <div>
            <label className={labelClass}>Display Views</label>
            <input
              type="number"
              value={post.display_views}
              onChange={(e) =>
                update("display_views", parseInt(e.target.value, 10) || 0)
              }
              className={inputClass}
            />
          </div>

          {/* Word Count */}
          <div>
            <label className={labelClass}>Word Count</label>
            <p className="font-kosugi text-[12px] text-[#A7A7A7]">
              {wordCount.toLocaleString()} words
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
