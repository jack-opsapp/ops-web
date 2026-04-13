import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getBlogPostById } from "@/lib/admin/blog-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  sendBlogNewsletter,
  type BlogNewsletterRecipient,
} from "@/lib/email/sendgrid";

const BLOG_API_KEY = process.env.BLOG_API_KEY;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (BLOG_API_KEY && authHeader === `Bearer ${BLOG_API_KEY}`) return true;
  const user = await verifyAdminAuth(req);
  return !!user?.email && (await isAdminEmail(user.email));
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { post_id, test_email } = body as {
      post_id?: string;
      test_email?: string;
    };

    if (!post_id || typeof post_id !== "string") {
      return NextResponse.json(
        { error: "post_id is required" },
        { status: 400 }
      );
    }

    const post = await getBlogPostById(post_id);
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const db = getAdminSupabase();

    // Kill switch — test_email bypasses it
    if (!test_email) {
      const { data: setting } = await db
        .from("app_settings")
        .select("value")
        .eq("key", "blog_newsletter_enabled")
        .maybeSingle();
      const enabled = setting?.value === true;
      if (!enabled) {
        return NextResponse.json({
          skipped: true,
          reason: "blog_newsletter_enabled is false",
        });
      }
    }

    // Resolve recipients
    let recipients: BlogNewsletterRecipient[];
    if (test_email) {
      recipients = [{ email: test_email, first_name: null }];
    } else {
      const { data: subs, error: subsError } = await db
        .from("newsletter_subscribers")
        .select("email, first_name")
        .eq("is_active", true);
      if (subsError) throw subsError;
      recipients = ((subs ?? []) as Array<{
        email: string;
        first_name: string | null;
      }>).map((s) => ({ email: s.email, first_name: s.first_name }));
    }

    if (recipients.length === 0) {
      return NextResponse.json({
        sent: 0,
        failed: 0,
        errors: ["No active subscribers"],
      });
    }

    const result = await sendBlogNewsletter({
      post: {
        id: post.id,
        title: post.title,
        slug: post.slug,
        teaser: post.teaser,
        thumbnail_url: post.thumbnail_url,
        email_content: post.email_content,
        content: post.content,
      },
      recipients,
    });

    // Log each outcome to email_log
    const emailType = test_email ? "blog_newsletter_test" : "blog_newsletter";
    const subject = post.title;
    const logRows = result.results.map((r) => ({
      email_type: emailType,
      recipient_email: r.email,
      subject,
      status: r.status,
      error_message: r.error ?? null,
      metadata: {
        post_id: post.id,
        post_slug: post.slug,
      },
    }));
    if (logRows.length > 0) {
      // Best-effort logging — don't fail the request if logging fails
      await db
        .from("email_log")
        .insert(logRows)
        .then(({ error }) => {
          if (error) console.error("email_log insert failed:", error.message);
        });
    }

    return NextResponse.json({
      sent: result.sent,
      failed: result.failed,
      errors: result.errors,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to send newsletter",
      },
      { status: 500 }
    );
  }
}
