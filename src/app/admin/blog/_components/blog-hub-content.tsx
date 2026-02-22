"use client";

import { SubTabs } from "../../_components/sub-tabs";
import { BlogDashboard } from "./blog-dashboard";
import { BlogPostsTab } from "./blog-posts-tab";
import { BlogTopicsTab } from "./blog-topics-tab";
import type { BlogPost, BlogCategory } from "@/lib/admin/types";

interface BlogHubContentProps {
  counts: { total: number; live: number; draft: number };
  posts: (BlogPost & { ga4_views: number })[];
  categories: BlogCategory[];
  unusedTopics: number;
  ga4Views: number;
  ga4Timeline: { dimension: string; count: number }[];
  ga4ByPost: { dimension: string; count: number }[];
}

export function BlogHubContent(props: BlogHubContentProps) {
  return (
    <SubTabs tabs={["Dashboard", "Posts", "Topics"]}>
      {(activeTab) => {
        if (activeTab === "Dashboard") {
          return (
            <BlogDashboard
              counts={props.counts}
              posts={props.posts}
              unusedTopics={props.unusedTopics}
              ga4Views={props.ga4Views}
              ga4Timeline={props.ga4Timeline}
              ga4ByPost={props.ga4ByPost}
            />
          );
        }
        if (activeTab === "Posts")
          return <BlogPostsTab posts={props.posts} categories={props.categories} />;
        if (activeTab === "Topics")
          return <BlogTopicsTab />;
        return null;
      }}
    </SubTabs>
  );
}
