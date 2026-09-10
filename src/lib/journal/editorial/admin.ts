import "server-only";
import { z } from "zod";
import { sendBlogNewsletter } from "@/lib/email/sendgrid";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { JournalPackage } from "./handoff";

const assignmentFields =
  "id,identity,state,mode,slot_at,publish_at,drafted_at,published_at,cancelled_at,title,slug,last_code,preview,package,blog_id,newsletter_state,attempt_log";

export const journalAdminActionSchema = z
  .object({ action: z.enum(["stop", "publish_now", "write_another", "send_test"]) })
  .strict();
export type JournalAdminAction = z.infer<typeof journalAdminActionSchema>["action"];

export interface JournalAdminResult {
  status: number;
  body: Record<string, unknown>;
}

function article(pack: JournalPackage | null) {
  if (!pack) return null;
  return {
    article: pack.article,
    html: pack.html,
    word_count: pack.word_count,
    citations: pack.citations.map(({ role, title, site_name, final_url }) => ({
      role,
      title,
      site_name,
      final_url,
    })),
    internal_links: pack.internal_links.length,
    evidence: pack.evidence.length,
    editor_notes: typeof pack.review?.notes === "string" ? pack.review.notes : null,
  };
}

/** The Blog hub's weekly strip: the newest slots, their previews and the switches. */
export async function readJournalEditorial() {
  const db = getServiceRoleClient();
  const [settings, assignments, newsletter] = await Promise.all([
    db
      .from("journal_editorial_settings")
      .select("mode,authoring_heartbeat_at,publish_weekday,publish_hour")
      .eq("id", true)
      .single(),
    db
      .from("journal_editorial_assignments")
      .select(assignmentFields)
      .order("slot_at", { ascending: false })
      .limit(6),
    db.from("app_settings").select("value").eq("key", "blog_newsletter_enabled").maybeSingle(),
  ]);
  for (const result of [settings, assignments, newsletter]) if (result.error) throw result.error;
  return {
    settings: settings.data,
    newsletter_enabled: newsletter.data?.value === true,
    assignments: (assignments.data ?? []).map((row) => ({
      ...row,
      package: article(row.package as JournalPackage | null),
      attempt_log: Array.isArray(row.attempt_log) ? row.attempt_log.slice(-6) : [],
    })),
  };
}

/**
 * The operator's three decisions plus a test send. Every change goes through
 * the ledger's own guarded functions; a manual publish skips only the clock
 * and the mode, never the slug or freshness checks.
 */
export async function actOnJournalAssignment(
  id: string,
  action: JournalAdminAction,
  actorEmail: string
): Promise<JournalAdminResult> {
  const db = getServiceRoleClient();
  const actor = `admin:${actorEmail}`.slice(0, 200);

  if (action === "stop") {
    const { data, error } = await db.rpc("cancel_journal_editorial_assignment", { p_id: id, p_actor: actor });
    if (error) throw error;
    return data === "cancelled"
      ? { status: 200, body: { state: "cancelled" } }
      : { status: 409, body: { code: "NOT_STOPPABLE" } };
  }

  if (action === "publish_now") {
    const { data, error } = await db.rpc("publish_journal_editorial_assignment", {
      p_id: id,
      p_manual: true,
      p_actor: actor,
    });
    if (error) throw error;
    const result = (data ?? {}) as { state?: string; code?: string; blog_id?: string };
    return result.state === "published"
      ? { status: 200, body: { state: "published", blog_id: result.blog_id } }
      : { status: 409, body: { code: result.code ?? "NOT_PUBLISHABLE", state: result.state ?? null } };
  }

  if (action === "write_another") {
    const { data, error } = await db.rpc("requeue_journal_editorial_assignment", { p_id: id, p_actor: actor });
    if (error) throw error;
    return data === "queued"
      ? { status: 200, body: { state: "queued" } }
      : { status: 409, body: { code: "SLOT_PASSED" } };
  }

  // send_test: the operator reads the newsletter exactly as subscribers would,
  // before the switch is ever turned on. Only the operator is mailed.
  const { data: row, error } = await db
    .from("journal_editorial_assignments")
    .select("id,slug,package,preview")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const pack = row?.package as JournalPackage | null;
  if (!row || !pack || !row.slug) return { status: 409, body: { code: "NO_DRAFT" } };
  const preview = row.preview as { url?: string } | null;
  const result = await sendBlogNewsletter({
    post: {
      id: row.id,
      title: pack.article.title,
      slug: row.slug,
      teaser: pack.article.teaser,
      thumbnail_url: preview?.url ?? null,
      email_content: pack.article.email_content,
      content: pack.html,
    },
    recipients: [{ email: actorEmail, first_name: null }],
  });
  await db.from("email_log").insert(
    result.results.map((entry) => ({
      email_type: "blog_newsletter_test",
      recipient_email: entry.email,
      subject: pack.article.title,
      status: entry.status,
      error_message: entry.error ?? null,
      metadata: { journal_assignment_id: row.id, post_slug: row.slug },
    }))
  );
  return result.sent === 1
    ? { status: 200, body: { sent: 1, to: actorEmail } }
    : { status: 502, body: { code: "TEST_SEND_FAILED" } };
}
