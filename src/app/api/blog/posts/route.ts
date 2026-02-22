import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getBlogPosts, createBlogPost } from "@/lib/admin/blog-queries";

const ADMIN_EMAIL = "jack@opsapp.co";
const BLOG_API_KEY = process.env.BLOG_API_KEY;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (BLOG_API_KEY && authHeader === `Bearer ${BLOG_API_KEY}`) return true;
  const user = await verifyAdminAuth(req);
  return user?.email === ADMIN_EMAIL;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const posts = await getBlogPosts();
    return NextResponse.json(posts);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch posts" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (!body.title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }
    const post = await createBlogPost(body);
    return NextResponse.json(post, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create post" },
      { status: 500 }
    );
  }
}
