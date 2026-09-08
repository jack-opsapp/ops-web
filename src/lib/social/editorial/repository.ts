import "server-only";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { EditorialKind, EditorialSource } from "./policy";
import type {
  EditorialAssignmentRecord,
  EditorialHandoffRepository,
} from "./handoff";
import type {
  EditorialAssignmentRow,
  EditorialWorkerRepository,
} from "./worker";
const fields = "id,title,slug,content,published_at,is_live,thumbnail_url";
const assignmentFields =
  "id,identity,kind,mode,state,attempts,submissions,claim_token,lease_until,blog_id,slot_date,source_snapshot,package,attempt_log";

// Sources an assignment, a legacy run or a queued post already used stay out of
// rotation; their hooks stay in it, because near-duplicate hooks are the
// failure a writer working from one article cannot see.
function historyOf(rows: Array<{ id?: unknown; hook?: unknown }>): {
  ids: string[];
  hooks: string[];
} {
  return {
    ids: rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string"),
    hooks: rows
      .map((row) => row.hook)
      .filter((hook): hook is string => typeof hook === "string"),
  };
}
function source(row: Record<string, unknown>): EditorialSource {
  return {
    id: String(row.id),
    title: String(row.title).slice(0, 200),
    slug: String(row.slug),
    published_at: String(row.published_at),
    is_live: row.is_live === true,
    thumbnail_url:
      typeof row.thumbnail_url === "string" &&
      row.thumbnail_url.startsWith("https://")
        ? row.thumbnail_url
        : null,
    text: String(row.content)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000),
  };
}
export function createEditorialRepository(): EditorialWorkerRepository &
  EditorialHandoffRepository {
  const db = getServiceRoleClient();
  return {
    async sourceStillCurrent(snapshot) {
      const { data, error } = await db
        .from("blog_posts")
        .select(fields)
        .eq("id", snapshot.id)
        .maybeSingle();
      if (error) throw error;
      const current = data ? source(data) : null;
      return (
        current?.is_live === true &&
        (Object.keys(current) as Array<keyof EditorialSource>).every(
          (key) => current[key] === snapshot[key]
        )
      );
    },
    async findPost(key) {
      const { data, error } = await db
        .from("social_posts")
        .select("id,status")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async recover() {
      const { data, error } = await db.rpc(
        "recover_social_editorial_assignments"
      );
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },

    async discover(localDate, weekday) {
      const { data, error } = await db.rpc(
        "discover_social_editorial_assignments",
        { p_local_date: localDate, p_weekday: weekday }
      );
      if (error) throw error;
      const counts = (data ?? {}) as { blogs?: number; recurring?: number };
      return { blogs: counts.blogs ?? 0, recurring: counts.recurring ?? 0 };
    },

    async readSettings() {
      const { data, error } = await db
        .from("social_editorial_settings")
        .select("mode,delivery_gap_minutes,authoring_heartbeat_at")
        .eq("id", true)
        .single();
      if (error) throw error;
      return {
        mode: data.mode as "off" | "prepare" | "publish",
        delivery_gap_minutes: Number(data.delivery_gap_minutes),
        authoring_heartbeat_at:
          typeof data.authoring_heartbeat_at === "string"
            ? data.authoring_heartbeat_at
            : null,
      };
    },

    async listDrafted(limit) {
      const { data, error } = await db
        .from("social_editorial_assignments")
        .select(assignmentFields)
        .eq("state", "drafted")
        .order("drafted_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as EditorialAssignmentRow[];
    },

    async annotateAssignment(id, detail, snapshot, pack) {
      const { data, error } = await db.rpc(
        "annotate_social_editorial_assignment",
        {
          p_id: id,
          p_detail: detail,
          p_source: snapshot,
          p_package: pack,
        }
      );
      if (error) throw error;
      return data === true;
    },

    async promote(id, state, code, preview, postId, snapshot) {
      const { data, error } = await db.rpc(
        "promote_social_editorial_assignment",
        {
          p_id: id,
          p_state: state,
          p_code: code,
          p_preview: preview,
          p_post_id: postId,
          p_source: snapshot,
        }
      );
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },

    // Pacing is measured against what the agent already put on the calendar,
    // not against what has published, so a queued backlog still spreads out.
    async lastScheduledPublishAt() {
      const { data, error } = await db
        .from("social_posts")
        .select("publish_after")
        .eq("created_by", "agent:social")
        .in("status", ["review", "publishing", "published"])
        .order("publish_after", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.publish_after ? new Date(data.publish_after) : null;
    },

    async notify(operator) {
      const { data, error } = await db.rpc("notify_social_editorial", {
        p_user_id: operator.userId,
        p_company_id: operator.companyId,
      });
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },

    async checkAuthoringStall(operator, staleHours) {
      const { data, error } = await db.rpc("check_social_editorial_authoring", {
        p_user_id: operator.userId,
        p_company_id: operator.companyId,
        p_stale_hours: staleHours,
      });
      if (error) throw error;
      return data === true;
    },

    async clearAuthoringStall(operator) {
      const { data, error } = await db
        .from("notifications")
        .update({ is_read: true, resolved_at: new Date().toISOString() })
        .eq("user_id", operator.userId)
        .eq("company_id", operator.companyId)
        .eq("type", "social_editorial")
        .like("dedupe_key", "editorial:authoring-stalled:%")
        .eq("is_read", false)
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },

    async claimAssignment(token, worker) {
      const { data, error } = await db.rpc(
        "claim_social_editorial_assignment",
        { p_token: token, p_worker: worker }
      );
      if (error) throw error;
      return (data?.[0] as EditorialAssignmentRecord) ?? null;
    },

    async readMode() {
      const { data, error } = await db
        .from("social_editorial_settings")
        .select("mode")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data.mode as "off" | "prepare" | "publish";
    },

    async findAssignment(id) {
      const { data, error } = await db
        .from("social_editorial_assignments")
        .select(assignmentFields)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as EditorialAssignmentRecord | null) ?? null;
    },

    async findLiveBlogSource(id) {
      const { data, error } = await db
        .from("blog_posts")
        .select(fields)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const current = source(data);
      return current.is_live ? current : null;
    },

    async assignmentContext(kind: EditorialKind) {
      const now = Date.now();
      const window = (kind === "blog" ? 30 : 180) * 86400000;
      const sixtyDays = new Date(now - 60 * 86400000);
      const results = await Promise.all([
        db
          .from("blog_posts")
          .select(fields)
          .eq("is_live", true)
          .gte("published_at", new Date(now - window).toISOString())
          .lte("published_at", new Date(now).toISOString())
          .order("published_at", { ascending: false })
          .limit(100),
        // A blocked assignment never produced a post, so its article stays
        // available to a later protocol or rotation instead of being burned.
        db
          .from("social_editorial_assignments")
          .select("source_id,blog_id,package")
          .gte("created_at", sixtyDays.toISOString())
          .neq("state", "blocked")
          .order("created_at", { ascending: false })
          .limit(100),
        db
          .from("social_editorial_runs")
          .select("source_id,package")
          .gte("slot_date", sixtyDays.toISOString().slice(0, 10))
          .not("source_id", "is", null)
          .order("slot_date", { ascending: false })
          .limit(60),
        db
          .from("social_posts")
          .select("source_id,content")
          .gte("created_at", sixtyDays.toISOString())
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      for (const result of results) if (result.error) throw result.error;
      const [blogs, assignments, runs, posts] = results;
      const history = historyOf([
        ...(assignments.data ?? []).flatMap((row) => [
          { id: row.source_id, hook: row.package?.submission?.content?.hook },
          { id: row.blog_id },
        ]),
        ...(runs.data ?? []).map((row) => ({
          id: row.source_id,
          hook: row.package?.submission?.content?.hook,
        })),
        ...(posts.data ?? []).map((row) => ({
          id: row.source_id,
          hook: row.content?.hook,
        })),
      ]);
      return {
        sources: (blogs.data ?? []).map(source),
        usedSourceIds: history.ids,
        recentHooks: history.hooks.slice(0, 30),
      };
    },

    async checkpointAssignment(id, token, snapshot, briefVersion, guideSha256) {
      const { data, error } = await db.rpc(
        "checkpoint_social_editorial_assignment",
        {
          p_id: id,
          p_token: token,
          p_source: snapshot,
          p_brief_version: briefVersion,
          p_guide_sha256: guideSha256,
        }
      );
      if (error) throw error;
      return data === true;
    },

    async recordAssignmentAttempt(id, token, detail) {
      const { data, error } = await db.rpc(
        "record_social_editorial_assignment_attempt",
        { p_id: id, p_token: token, p_detail: detail }
      );
      if (error) throw error;
      return data === true;
    },

    async finishAssignment(id, token, state, code, pack) {
      const { data, error } = await db.rpc(
        "finish_social_editorial_assignment",
        {
          p_id: id,
          p_token: token,
          p_state: state,
          p_code: code,
          p_package: pack,
        }
      );
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
  };
}
