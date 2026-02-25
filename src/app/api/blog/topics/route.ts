import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getBlogTopics, createBlogTopic } from "@/lib/admin/blog-queries";

const ADMIN_EMAILS = ["jack@opsapp.co", "canprojack@gmail.com"];

export async function GET(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !ADMIN_EMAILS.includes(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const topics = await getBlogTopics();
    return NextResponse.json(topics);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch topics" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !ADMIN_EMAILS.includes(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (!body.topic) {
      return NextResponse.json(
        { error: "topic is required" },
        { status: 400 }
      );
    }
    const topic = await createBlogTopic(body.topic, body.author);
    return NextResponse.json(topic, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create topic" },
      { status: 500 }
    );
  }
}
