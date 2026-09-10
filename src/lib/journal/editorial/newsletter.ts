import "server-only";
import { sendBlogNewsletter } from "@/lib/email/sendgrid";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

/**
 * Mails one live weekly post to the active subscribers and logs every outcome
 * to email_log, exactly like the existing /api/blog/newsletter route. The
 * worker calls it only after claiming the send, and only while
 * app_settings.blog_newsletter_enabled is true.
 */
export async function sendJournalNewsletter(blogId: string): Promise<{ sent: number; failed: number }> {
  const db = getServiceRoleClient();
  const { data: post, error } = await db
    .from("blog_posts")
    .select("id,title,slug,teaser,thumbnail_url,email_content,content,is_live")
    .eq("id", blogId)
    .maybeSingle();
  if (error) throw error;
  if (!post || post.is_live !== true) throw new Error("NEWSLETTER_POST_NOT_LIVE");

  const { data: subscribers, error: subscriberError } = await db
    .from("newsletter_subscribers")
    .select("email,first_name")
    .eq("is_active", true);
  if (subscriberError) throw subscriberError;
  const recipients = (subscribers ?? []).map((row) => ({
    email: String(row.email),
    first_name: typeof row.first_name === "string" ? row.first_name : null,
  }));
  if (!recipients.length) return { sent: 0, failed: 0 };

  const result = await sendBlogNewsletter({
    post: {
      id: String(post.id),
      title: String(post.title),
      slug: String(post.slug),
      teaser: typeof post.teaser === "string" ? post.teaser : null,
      thumbnail_url: typeof post.thumbnail_url === "string" ? post.thumbnail_url : null,
      email_content: typeof post.email_content === "string" ? post.email_content : null,
      content: String(post.content),
    },
    recipients,
  });

  const rows = result.results.map((entry) => ({
    email_type: "blog_newsletter",
    recipient_email: entry.email,
    subject: String(post.title),
    status: entry.status,
    error_message: entry.error ?? null,
    metadata: { post_id: post.id, post_slug: post.slug, source: "journal-editorial" },
  }));
  if (rows.length) {
    const { error: logError } = await db.from("email_log").insert(rows);
    if (logError) console.error("[journal-newsletter] email_log insert failed:", logError.message);
  }
  return { sent: result.sent, failed: result.failed };
}
