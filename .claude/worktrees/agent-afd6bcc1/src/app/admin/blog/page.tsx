import { AdminPageHeader } from "../_components/admin-page-header";
import {
  getBlogPostCount,
  getBlogPosts,
  getBlogCategories,
  getUnusedTopicCount,
} from "@/lib/admin/blog-queries";
import {
  getBlogPageViews,
  getBlogViewsByPost,
  getBlogViewsTimeline,
} from "@/lib/analytics/ga4-client";
import { BlogHubContent } from "./_components/blog-hub-content";

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export default async function BlogPage() {
  const [counts, posts, categories, unusedTopics, ga4Views, ga4ByPost, ga4Timeline] =
    await Promise.all([
      safe(getBlogPostCount(), { total: 0, live: 0, draft: 0 }),
      safe(getBlogPosts(), []),
      safe(getBlogCategories(), []),
      safe(getUnusedTopicCount(), 0),
      safe(getBlogPageViews(30), 0),
      safe(getBlogViewsByPost(30), []),
      safe(getBlogViewsTimeline(30), []),
    ]);

  // Map GA4 views onto posts by matching slug
  const postsWithViews = posts.map((post) => {
    const match = ga4ByPost.find(
      (g) =>
        g.dimension === `/blog/${post.slug}` ||
        g.dimension === `/blog/${post.slug}/`
    );
    return { ...post, ga4_views: match?.count ?? 0 };
  });

  return (
    <div>
      <AdminPageHeader title="Blog" caption="content hub + analytics" />
      <div className="p-8">
        <BlogHubContent
          counts={counts}
          posts={postsWithViews}
          categories={categories}
          unusedTopics={unusedTopics}
          ga4Views={ga4Views}
          ga4Timeline={ga4Timeline}
          ga4ByPost={ga4ByPost}
        />
      </div>
    </div>
  );
}
