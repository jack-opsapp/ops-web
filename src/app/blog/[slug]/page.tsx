import { notFound } from "next/navigation";
import {
  getLiveBlogPosts,
  getBlogPostBySlug,
  getBlogCategories,
} from "@/lib/admin/blog-queries";
import type { Metadata } from "next";

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ slug: string }>;
}

// ─── generateStaticParams ─────────────────────────────────────────────────────

export async function generateStaticParams() {
  const posts = await getLiveBlogPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

// ─── generateMetadata ─────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);

  if (!post) {
    return { title: "Post Not Found | OPS" };
  }

  const title = post.meta_title || post.title;
  const description = post.summary || post.teaser || "";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: post.published_at ?? undefined,
      authors: [post.author || "The Ops Team"],
      images: post.thumbnail_url ? [post.thumbnail_url] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: post.thumbnail_url ? [post.thumbnail_url] : undefined,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPublishedDate(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date
    .toLocaleDateString("en-US", { weekday: "long" })
    .toUpperCase();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `POSTED AT ${day} ${time}`;
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;

  const [post, categories] = await Promise.all([
    getBlogPostBySlug(slug),
    getBlogCategories(),
  ]);

  if (!post || !post.is_live) {
    notFound();
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const category = post.category_id
    ? categoryMap.get(post.category_id)
    : null;

  // ── JSON-LD: Article ───────────────────────────────────────────────────────

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.summary || post.teaser || "",
    author: {
      "@type": "Person" as const,
      name: post.author || "The Ops Team",
    },
    datePublished: post.published_at,
    dateModified: post.updated_at,
    image: post.thumbnail_url,
    publisher: {
      "@type": "Organization" as const,
      name: "OPS",
      url: "https://opsapp.co",
    },
    mainEntityOfPage: {
      "@type": "WebPage" as const,
      "@id": `https://opsapp.co/blog/${slug}`,
    },
  };

  // ── JSON-LD: FAQ ───────────────────────────────────────────────────────────

  const faqJsonLd =
    post.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faqs.map((faq) => ({
            "@type": "Question" as const,
            name: faq.question,
            acceptedAnswer: {
              "@type": "Answer" as const,
              text: faq.answer,
            },
          })),
        }
      : null;

  return (
    <>
      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleJsonLd),
        }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqJsonLd),
          }}
        />
      )}

      <article className="max-w-3xl mx-auto px-6 py-16">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="mb-10">
          {category && (
            <span className="inline-block text-xs font-medium uppercase tracking-wider text-[#597794] mb-3">
              {category.name}
            </span>
          )}

          <h1 className="font-mohave text-4xl md:text-5xl font-bold text-[#E5E5E5] leading-tight">
            {post.title}
          </h1>

          {post.subtitle && (
            <p className="mt-3 text-lg text-[#A7A7A7]">{post.subtitle}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-[#666]">
            <span>{post.author || "The Ops Team"}</span>
            {post.published_at && (
              <span>{formatPublishedDate(post.published_at)}</span>
            )}
            {post.display_views > 0 && (
              <span>
                {post.display_views.toLocaleString()} views
              </span>
            )}
          </div>
        </header>

        {/* ── Hero Image ──────────────────────────────────────────────────── */}
        {post.thumbnail_url && (
          <div className="mb-10 rounded-xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.thumbnail_url}
              alt={post.title}
              className="w-full object-cover"
            />
          </div>
        )}

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <section
          className={[
            "text-[#CFCFCF] leading-relaxed",
            "[&_h2]:font-mohave [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-[#E5E5E5] [&_h2]:mt-10 [&_h2]:mb-4",
            "[&_h3]:font-mohave [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-[#E5E5E5] [&_h3]:mt-8 [&_h3]:mb-3",
            "[&_p]:mb-5",
            "[&_a]:text-[#597794] [&_a]:underline [&_a]:hover:text-[#8AAFC4]",
            "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-5",
            "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-5",
            "[&_li]:mb-2",
            "[&_blockquote]:border-l-2 [&_blockquote]:border-[#597794] [&_blockquote]:pl-5 [&_blockquote]:italic [&_blockquote]:text-[#A7A7A7] [&_blockquote]:my-6",
            "[&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-6",
            "[&_strong]:font-semibold [&_strong]:text-[#E5E5E5]",
          ].join(" ")}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />

        {/* ── FAQs ────────────────────────────────────────────────────────── */}
        {post.faqs.length > 0 && (
          <section className="mt-16 border-t border-white/[0.08] pt-10">
            <h2 className="font-mohave text-2xl font-semibold text-[#E5E5E5] mb-6">
              Frequently Asked Questions
            </h2>

            <div className="space-y-4">
              {post.faqs.map((faq, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5"
                >
                  <h3 className="font-mohave text-lg font-semibold text-[#E5E5E5] mb-2">
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
      </article>
    </>
  );
}
