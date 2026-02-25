"use client";

import { StatCard } from "../../_components/stat-card";
import { BlogCharts } from "./blog-charts";
import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { BlogPost } from "@/lib/admin/types";

interface BlogDashboardProps {
  counts: { total: number; live: number; draft: number };
  posts: (BlogPost & { ga4_views: number })[];
  unusedTopics: number;
  ga4Views: number;
  ga4Timeline: { dimension: string; count: number }[];
  ga4ByPost: { dimension: string; count: number }[];
}

export function BlogDashboard({
  counts,
  posts,
  unusedTopics,
  ga4Views,
  ga4Timeline,
  ga4ByPost,
}: BlogDashboardProps) {
  const sort = useSortState("ga4_views");

  // Only live posts for the content performance table
  const livePosts = sort.sorted(
    posts.filter((p) => p.is_live)
  );

  const avgViews =
    livePosts.length > 0
      ? Math.round(
          livePosts.reduce((sum, p) => sum + p.ga4_views, 0) / livePosts.length
        )
      : 0;

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-6 gap-4">
        <StatCard label="Total Posts" value={counts.total} />
        <StatCard label="Live" value={counts.live} accent />
        <StatCard label="Drafts" value={counts.draft} />
        <StatCard
          label="GA4 Views 30d"
          value={ga4Views.toLocaleString()}
          caption="last 30 days"
        />
        <StatCard label="Avg Views/Post" value={avgViews.toLocaleString()} />
        <StatCard label="Topic Ideas" value={unusedTopics} caption="unused" />
      </div>

      {/* Charts */}
      <BlogCharts ga4Timeline={ga4Timeline} ga4ByPost={ga4ByPost} />

      {/* Content Performance Table */}
      <div>
        <h2 className="font-mohave text-[15px] uppercase tracking-widest text-[#A7A7A7] mb-4">
          Content Performance
        </h2>
        <div className="border border-white/[0.08] rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <SortableTableHeader
                columns={[
                  { key: "title", label: "Title" },
                  { key: "category_id", label: "Category" },
                  { key: "ga4_views", label: "GA4 Views" },
                  { key: "display_views", label: "Display Views" },
                  { key: "word_count", label: "Words" },
                  { key: "published_at", label: "Published" },
                ]}
                sort={sort.sort}
                onSort={sort.toggle}
                className="px-4"
              />
            </thead>
            <tbody>
              {livePosts.map((post) => (
                <tr
                  key={post.id}
                  className="border-t border-white/[0.05] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="font-kosugi text-[13px] text-[#E5E5E5] px-4 py-3 max-w-[280px] truncate">
                    {post.title}
                  </td>
                  <td className="font-mono text-[12px] text-[#6B6B6B] px-4 py-3">
                    {post.category_id ?? "—"}
                  </td>
                  <td
                    className={`font-mono text-[13px] px-4 py-3 text-right ${
                      post.ga4_views >= avgViews
                        ? "text-[#A5B368]"
                        : "text-[#93321A]"
                    }`}
                  >
                    {post.ga4_views.toLocaleString()}
                  </td>
                  <td className="font-mono text-[13px] text-[#A7A7A7] px-4 py-3 text-right">
                    {post.display_views.toLocaleString()}
                  </td>
                  <td className="font-mono text-[13px] text-[#A7A7A7] px-4 py-3 text-right">
                    {post.word_count.toLocaleString()}
                  </td>
                  <td className="font-mono text-[12px] text-[#6B6B6B] px-4 py-3 text-right whitespace-nowrap">
                    {post.published_at
                      ? new Date(post.published_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
              {livePosts.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="font-kosugi text-[13px] text-[#6B6B6B] px-4 py-8 text-center"
                  >
                    No live posts yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
