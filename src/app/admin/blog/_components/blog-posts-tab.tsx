"use client";

import { useState, useMemo } from "react";
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
            <Link
              href={`/admin/blog/${post.id}/edit`}
              className="font-mohave text-[14px] text-[#E5E5E5] hover:text-[#C4A868] max-w-[300px] truncate"
            >
              {post.title}
            </Link>

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
    </div>
  );
}
