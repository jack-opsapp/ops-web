import Link from "next/link";
import {
  getLiveBlogPosts,
  getBlogCategories,
} from "@/lib/admin/blog-queries";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog | OPS",
  description:
    "Insights, guides, and strategies for trade businesses — scheduling, invoicing, CRM, and more.",
  openGraph: {
    title: "OPS Blog",
    description:
      "Insights, guides, and strategies for trade businesses.",
    type: "website",
  },
};

export const revalidate = 300;

export default async function BlogIndexPage() {
  const [posts, categories] = await Promise.all([
    getLiveBlogPosts(),
    getBlogCategories(),
  ]);

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  return (
    <main className="max-w-6xl mx-auto px-6 py-16">
      {/* Header */}
      <header className="mb-12">
        <h1 className="font-mohave text-4xl font-bold text-[#E5E5E5] uppercase">
          OPS Blog
        </h1>
        <p className="mt-3 text-[#A7A7A7] text-lg max-w-2xl">
          Insights, guides, and strategies for trade businesses &mdash;
          scheduling, invoicing, CRM, and more.
        </p>
      </header>

      {/* Posts grid */}
      {posts.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-[#A7A7A7] text-lg">
            No posts yet. Check back soon!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => {
            const category = post.category_id
              ? categoryMap.get(post.category_id)
              : null;

            return (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden transition-colors hover:border-white/[0.15]"
              >
                {/* Thumbnail */}
                {post.thumbnail_url && (
                  <div className="aspect-video overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.thumbnail_url}
                      alt={post.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                )}

                <div className="p-5">
                  {/* Category badge */}
                  {category && (
                    <span className="inline-block text-xs font-medium uppercase tracking-wider text-[#597794] mb-2">
                      {category.name}
                    </span>
                  )}

                  {/* Title */}
                  <h2 className="font-mohave text-xl font-semibold text-[#E5E5E5] group-hover:text-[#C4A868] transition-colors leading-tight">
                    {post.title}
                  </h2>

                  {/* Teaser */}
                  {post.teaser && (
                    <p className="mt-2 text-sm text-[#A7A7A7] line-clamp-3">
                      {post.teaser}
                    </p>
                  )}

                  {/* Date + Views */}
                  <div className="mt-4 flex items-center gap-3 text-xs text-[#666]">
                    {post.published_at && (
                      <time dateTime={post.published_at}>
                        {new Date(post.published_at).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </time>
                    )}
                    {post.display_views > 0 && (
                      <span>
                        {post.display_views.toLocaleString()} views
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
