"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import type { BlogPost, BlogCategory } from "@/lib/admin/types";

interface BlogPostsTabProps {
  posts: (BlogPost & { ga4_views: number })[];
  categories: BlogCategory[];
}

type SortKey = "published_at" | "ga4_views" | "display_views" | "word_count";
type SortDir = "asc" | "desc";

function getCategoryName(
  id: string | null,
  categories: BlogCategory[]
): string {
  if (!id) return "—";
  return categories.find((c) => c.id === id)?.name ?? "—";
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPublishedDate(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `POSTED AT ${day} ${time}`;
}

// ─── Preview Modal ───────────────────────────────────────────────────────────

function BlogPreviewModal({
  post,
  categories,
  onClose,
}: {
  post: BlogPost & { ga4_views: number };
  categories: BlogCategory[];
  onClose: () => void;
}) {
  const category = post.category_id
    ? categories.find((c) => c.id === post.category_id)
    : null;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  // Content is admin-authored and stored in our database, not user-submitted
  const contentHtml = { __html: post.content };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl bg-[#141414] border border-white/[0.1] rounded-xl shadow-2xl mx-4">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-[#141414] border-b border-white/[0.08] rounded-t-xl">
          <div className="flex items-center gap-3">
            {post.is_live ? (
              <span className="text-[11px] font-kosugi px-2 py-0.5 rounded bg-[#A5B368]/20 text-[#A5B368]">
                Live
              </span>
            ) : (
              <span className="text-[11px] font-kosugi px-2 py-0.5 rounded bg-white/[0.05] text-[#6B6B6B]">
                Draft
              </span>
            )}
            <span className="font-mono text-[11px] text-[#6B6B6B]">
              {post.word_count.toLocaleString()} words
            </span>
            <span className="font-mono text-[11px] text-[#6B6B6B]">
              {post.display_views.toLocaleString()} views
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/blog/${post.id}/edit`}
              className="px-3 py-1.5 bg-[#597794] hover:bg-[#6B8AA6] rounded font-mohave text-[12px] uppercase tracking-wider text-white transition-colors"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B] hover:text-[#E5E5E5] border border-white/[0.1] hover:border-white/[0.2] transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-8">
          {/* Header */}
          <header className="mb-8">
            {category && (
              <span className="inline-block text-xs font-medium uppercase tracking-wider text-[#597794] mb-3">
                {category.name}
              </span>
            )}
            <h1 className="font-mohave text-3xl font-bold text-[#E5E5E5] leading-tight">
              {post.title}
            </h1>
            {post.subtitle && (
              <p className="mt-2 text-lg text-[#A7A7A7]">{post.subtitle}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-[#666]">
              <span>{post.author || "The Ops Team"}</span>
              {post.published_at && (
                <span>{formatPublishedDate(post.published_at)}</span>
              )}
            </div>
          </header>

          {/* Thumbnail */}
          {post.thumbnail_url && (
            <div className="mb-8 rounded-xl overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.thumbnail_url}
                alt={post.title}
                className="w-full object-cover"
              />
            </div>
          )}

          {/* Body — admin-authored content from our database */}
          <section
            className={[
              "text-[#CFCFCF] leading-relaxed",
              "[&_h1]:font-mohave [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-[#E5E5E5] [&_h1]:mt-8 [&_h1]:mb-4",
              "[&_h2]:font-mohave [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-[#E5E5E5] [&_h2]:mt-8 [&_h2]:mb-4",
              "[&_h3]:font-mohave [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-[#E5E5E5] [&_h3]:mt-6 [&_h3]:mb-3",
              "[&_p]:mb-4",
              "[&_a]:text-[#597794] [&_a]:underline [&_a]:hover:text-[#8AAFC4]",
              "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4",
              "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4",
              "[&_li]:mb-2",
              "[&_blockquote]:border-l-2 [&_blockquote]:border-[#597794] [&_blockquote]:pl-5 [&_blockquote]:italic [&_blockquote]:text-[#A7A7A7] [&_blockquote]:my-5",
              "[&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-5",
              "[&_strong]:font-semibold [&_strong]:text-[#E5E5E5]",
            ].join(" ")}
            dangerouslySetInnerHTML={contentHtml}
          />

          {/* FAQs */}
          {post.faqs && post.faqs.length > 0 && (
            <section className="mt-12 border-t border-white/[0.08] pt-8">
              <h2 className="font-mohave text-2xl font-semibold text-[#E5E5E5] mb-5">
                Frequently Asked Questions
              </h2>
              <div className="space-y-3">
                {post.faqs.map((faq, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
                  >
                    <h3 className="font-mohave text-lg font-semibold text-[#E5E5E5] mb-1">
                      {faq.question}
                    </h3>
                    <p className="text-[#A7A7A7] text-sm leading-relaxed">
                      {faq.answer}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const COLUMNS: {
  label: string;
  key?: SortKey;
  align?: "right";
}[] = [
  { label: "Title" },
  { label: "Category" },
  { label: "Status" },
  { label: "Display Views", key: "display_views", align: "right" },
  { label: "GA4 Views", key: "ga4_views", align: "right" },
  { label: "Published", key: "published_at" },
  { label: "Word Count", key: "word_count", align: "right" },
];

export function BlogPostsTab({ posts, categories }: BlogPostsTabProps) {
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "draft">(
    "all"
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("published_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [previewPost, setPreviewPost] = useState<(BlogPost & { ga4_views: number }) | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filteredSorted = useMemo(() => {
    let result = posts;

    // Status filter
    if (statusFilter === "live") {
      result = result.filter((p) => p.is_live);
    } else if (statusFilter === "draft") {
      result = result.filter((p) => !p.is_live);
    }

    // Category filter
    if (categoryFilter !== "all") {
      result = result.filter(
        (p) => p.category_id === categoryFilter || p.category2_id === categoryFilter
      );
    }

    // Sort
    const sorted = [...result].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortKey) {
        case "published_at":
          aVal = a.published_at ? new Date(a.published_at).getTime() : 0;
          bVal = b.published_at ? new Date(b.published_at).getTime() : 0;
          break;
        case "ga4_views":
          aVal = a.ga4_views;
          bVal = b.ga4_views;
          break;
        case "display_views":
          aVal = a.display_views;
          bVal = b.display_views;
          break;
        case "word_count":
          aVal = a.word_count;
          bVal = b.word_count;
          break;
        default:
          return 0;
      }

      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [posts, statusFilter, categoryFilter, sortKey, sortDir]);

  return (
    <div className="space-y-4">
      {/* Filter Row */}
      <div className="flex items-center gap-4">
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "live" | "draft")
          }
          className="bg-white/[0.05] border border-white/[0.1] rounded px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5]"
        >
          <option value="all">All Status</option>
          <option value="live">Live</option>
          <option value="draft">Draft</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-white/[0.05] border border-white/[0.1] rounded px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5]"
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <Link
          href="/admin/blog/new"
          className="px-4 py-2 bg-[#597794] hover:bg-[#6B8AA6] rounded font-mohave text-[13px] uppercase tracking-wider text-white"
        >
          New Post
        </Link>
      </div>

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        {/* Header Row */}
        <div className="grid grid-cols-7 px-6 py-3 border-b border-white/[0.08] bg-white/[0.02]">
          {COLUMNS.map((col) => (
            <button
              key={col.label}
              type="button"
              onClick={col.key ? () => handleSort(col.key!) : undefined}
              className={[
                "font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B]",
                col.align === "right" ? "text-right" : "text-left",
                col.key ? "cursor-pointer hover:text-[#A0A0A0]" : "cursor-default",
              ].join(" ")}
            >
              {col.label}
              {col.key && sortKey === col.key && (
                <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body Rows */}
        {filteredSorted.map((post) => (
          <div
            key={post.id}
            className="grid grid-cols-7 px-6 items-center h-14 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors"
          >
            {/* Title */}
            <button
              type="button"
              onClick={() => setPreviewPost(post)}
              className="font-mohave text-[14px] text-[#E5E5E5] hover:text-[#C4A868] max-w-[300px] truncate text-left"
            >
              {post.title}
            </button>

            {/* Category */}
            <span className="text-[11px] font-kosugi px-2 py-0.5 rounded bg-[#597794]/20 text-[#8AAFC4] w-fit">
              {getCategoryName(post.category_id, categories)}
            </span>

            {/* Status */}
            <span>
              {post.is_live ? (
                <span className="text-[11px] font-kosugi px-2 py-0.5 rounded bg-[#A5B368]/20 text-[#A5B368]">
                  Live
                </span>
              ) : (
                <span className="text-[11px] font-kosugi px-2 py-0.5 rounded bg-white/[0.05] text-[#6B6B6B]">
                  Draft
                </span>
              )}
            </span>

            {/* Display Views */}
            <span className="font-mono text-[13px] text-[#A7A7A7] text-right">
              {post.display_views.toLocaleString()}
            </span>

            {/* GA4 Views */}
            <span className="font-mono text-[13px] text-[#A7A7A7] text-right">
              {post.ga4_views.toLocaleString()}
            </span>

            {/* Published */}
            <span className="font-kosugi text-[12px] text-[#6B6B6B]">
              {formatDate(post.published_at)}
            </span>

            {/* Word Count */}
            <span className="font-mono text-[13px] text-[#A7A7A7] text-right">
              {post.word_count.toLocaleString()}
            </span>
          </div>
        ))}

        {/* Empty State */}
        {filteredSorted.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-kosugi text-[13px] text-[#6B6B6B]">
              No posts found
            </p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewPost && (
        <BlogPreviewModal
          post={previewPost}
          categories={categories}
          onClose={() => setPreviewPost(null)}
        />
      )}
    </div>
  );
}
