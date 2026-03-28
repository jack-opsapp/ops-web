import { notFound } from "next/navigation";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { getBlogPostById, getBlogCategories } from "@/lib/admin/blog-queries";
import { BlogPostEditor } from "../../_components/blog-post-editor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditBlogPostPage({ params }: PageProps) {
  const { id } = await params;
  const [post, categories] = await Promise.all([
    getBlogPostById(id),
    getBlogCategories(),
  ]);
  if (!post) notFound();

  return (
    <div>
      <AdminPageHeader title="Edit Post" caption={post.title} />
      <div className="p-8">
        <BlogPostEditor
          initialData={{
            id: post.id,
            title: post.title,
            subtitle: post.subtitle ?? "",
            slug: post.slug,
            author: post.author ?? "",
            content: post.content,
            summary: post.summary ?? "",
            teaser: post.teaser ?? "",
            meta_title: post.meta_title ?? "",
            thumbnail_url: post.thumbnail_url ?? "",
            category_id: post.category_id ?? "",
            category2_id: post.category2_id ?? "",
            is_live: post.is_live,
            display_views: post.display_views,
            faqs: post.faqs ?? [],
            published_at: post.published_at ?? "",
          }}
          categories={categories}
          isNew={false}
        />
      </div>
    </div>
  );
}
