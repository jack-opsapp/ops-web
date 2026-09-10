import "server-only";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { JournalMode } from "./handoff";
import type {
  JournalPublishResult,
  JournalWorkerRepository,
  JournalWorkerRow,
} from "./worker";

const rowFields =
  "id,identity,state,mode,slot_at,publish_at,drafted_at,published_at,title,last_code,package,attempt_log,notified_state,blog_id,newsletter_state";
const DELIVERABLE_STATES = ["scheduled", "published", "blocked", "cancelled"];

export function createJournalWorkerRepository(): JournalWorkerRepository {
  const db = getServiceRoleClient();

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data as T;
  }

  async function settings() {
    const { data, error } = await db
      .from("journal_editorial_settings")
      .select("mode,min_veto_minutes")
      .eq("id", true)
      .single();
    if (error) throw error;
    return data as { mode: JournalMode; min_veto_minutes: number };
  }

  return {
    async recover() {
      return Number((await rpc<number>("recover_journal_editorial_assignments", {})) ?? 0);
    },

    async discover(now) {
      const result = await rpc<{ created?: number; missed?: number }>(
        "discover_journal_editorial_assignment",
        { p_now: now.toISOString() }
      );
      return { created: result?.created ?? 0, missed: result?.missed ?? 0 };
    },

    async readMode() {
      return (await settings()).mode;
    },

    async readMinVetoMinutes() {
      return Number((await settings()).min_veto_minutes);
    },

    async listDrafted(limit) {
      const { data, error } = await db
        .from("journal_editorial_assignments")
        .select(rowFields)
        .eq("state", "drafted")
        .order("drafted_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as JournalWorkerRow[];
    },

    async listDue(now, limit) {
      const { data, error } = await db
        .from("journal_editorial_assignments")
        .select(rowFields)
        .eq("state", "scheduled")
        .lte("publish_at", now.toISOString())
        .order("publish_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as JournalWorkerRow[];
    },

    async schedule(id, preview, publishAt) {
      const state = await rpc<string | null>("schedule_journal_editorial_assignment", {
        p_id: id,
        p_preview: preview,
        p_publish_at: publishAt.toISOString(),
      });
      return typeof state === "string" ? state : null;
    },

    async annotate(id, detail) {
      return (await rpc<boolean>("annotate_journal_editorial_assignment", { p_id: id, p_detail: detail })) === true;
    },

    async block(id, code) {
      const state = await rpc<string | null>("block_journal_editorial_assignment", { p_id: id, p_code: code });
      return typeof state === "string" ? state : null;
    },

    async publish(id, manual, actor) {
      return await rpc<JournalPublishResult>("publish_journal_editorial_assignment", {
        p_id: id,
        p_manual: manual,
        p_actor: actor,
      });
    },

    // PostgREST cannot compare two columns, so the outbox reads the recent
    // deliverable rows and keeps those whose state has not been delivered.
    async listUndelivered(limit) {
      const { data, error } = await db
        .from("journal_editorial_assignments")
        .select(rowFields)
        .in("state", DELIVERABLE_STATES)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as unknown as JournalWorkerRow[])
        .filter((row) => row.notified_state !== row.state)
        .slice(0, limit);
    },

    async deliver(operator, delivery) {
      return (
        (await rpc<boolean>("deliver_journal_editorial_notification", {
          p_id: delivery.id,
          p_state: delivery.state,
          p_user_id: operator.userId,
          p_company_id: operator.companyId,
          p_title: delivery.title,
          p_body: delivery.body,
          p_persistent: delivery.persistent,
          p_action_url: delivery.actionUrl,
          p_action_label: delivery.actionLabel,
          p_dedupe_key: delivery.dedupeKey,
          p_resolve_prefix: delivery.resolvePrefix,
        })) === true
      );
    },

    async checkStall(operator, copy, hours) {
      return (
        (await rpc<boolean>("check_journal_editorial_authoring", {
          p_user_id: operator.userId,
          p_company_id: operator.companyId,
          p_title: copy.title,
          p_body: copy.body,
          p_action_url: copy.actionUrl,
          p_action_label: copy.actionLabel,
          p_hours: hours,
        })) === true
      );
    },

    async resolveStall(operator, hours) {
      return Number(
        (await rpc<number>("resolve_journal_editorial_stall", {
          p_user_id: operator.userId,
          p_company_id: operator.companyId,
          p_hours: hours,
        })) ?? 0
      );
    },

    async newsletterEnabled() {
      const { data, error } = await db
        .from("app_settings")
        .select("value")
        .eq("key", "blog_newsletter_enabled")
        .maybeSingle();
      if (error) throw error;
      return data?.value === true;
    },

    async listNewsletterCandidates(since) {
      const { data, error } = await db
        .from("journal_editorial_assignments")
        .select(rowFields)
        .eq("state", "published")
        .is("newsletter_state", null)
        .gte("published_at", since.toISOString())
        .order("published_at", { ascending: true })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as JournalWorkerRow[];
    },

    async claimNewsletter(id, token) {
      return (await rpc<boolean>("claim_journal_editorial_newsletter", { p_id: id, p_token: token })) === true;
    },

    async finishNewsletter(id, token, state) {
      return (
        (await rpc<boolean>("finish_journal_editorial_newsletter", { p_id: id, p_token: token, p_state: state })) === true
      );
    },
  };
}
