import { AdminPageHeader } from "../../_components/admin-page-header";
import { getBlogCategories } from "@/lib/admin/blog-queries";
import { BlogPostEditor } from "../_components/blog-post-editor";

export default async function NewBlogPostPage() {
  const categories = await getBlogCategories();
  return (
    <div>
      <AdminPageHeader title="New Post" caption="blog editor" />
      <div className="p-8">
        <BlogPostEditor categories={categories} isNew />
      </div>
    </div>
  );
}
