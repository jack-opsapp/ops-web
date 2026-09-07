import "server-only";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { EditorialKind, EditorialSource } from "./policy";
import type {
  EditorialAssignmentRecord,
  EditorialHandoffRepository,
} from "./handoff";
import type { EditorialRepository, EditorialRun } from "./worker";
const fields = "id,title,slug,content,published_at,is_live,thumbnail_url";
const assignmentFields =
  "id,identity,kind,mode,state,attempts,submissions,claim_token,lease_until,blog_id,slot_date,source_snapshot,package";

// Sources an assignment, a legacy run or a queued post already used stay out of
// rotation; their hooks stay in it, because near-duplicate hooks are the
// failure a writer working from one article cannot see.
function historyOf(
  rows: Array<{ id?: unknown; hook?: unknown }>
): { ids: string[]; hooks: string[] } {
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
export function createEditorialRepository(): EditorialRepository &
  EditorialHandoffRepository {
  const db = getServiceRoleClient();
  return {
    async claim(date, kind, token) {
      const { data, error } = await db.rpc("claim_social_editorial", {
        p_date: date,
        p_kind: kind,
        p_token: token,
      });
      if (error) throw error;
      return (data?.[0] as EditorialRun) ?? null;
    },
    async context() {
      const since = new Date(Date.now() - 180 * 86400000).toISOString();
      const results = await Promise.all([
        db
          .from("blog_posts")
          .select(fields)
          .eq("is_live", true)
          .gte("published_at", since)
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
          .limit(100),
        db
          .from("social_editorial_runs")
          .select("source_id,package")
          .gte(
            "slot_date",
            new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
          )
          .not("source_id", "is", null)
          .order("slot_date", { ascending: false })
          .limit(60),
        db
          .from("social_posts")
          .select("source_id,content")
          .gte("created_at", new Date(Date.now() - 60 * 86400000).toISOString())
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      for (const result of results) if (result.error) throw result.error;
      const [blogs, runs, posts] = results;
      const history = [
        ...(runs.data ?? []).map((r) => ({
          id: r.source_id,
          hook: r.package?.submission?.content?.hook,
        })),
        ...(posts.data ?? []).map((r) => ({
          id: r.source_id,
          hook: r.content?.hook,
        })),
      ];
      return {
        sources: (blogs.data ?? []).map(source),
        usedSourceIds: history
          .map((h) => h.id)
          .filter((s): s is string => typeof s === "string"),
        recentHooks: history
          .map((h) => h.hook)
          .filter((s): s is string => typeof s === "string")
          .slice(0, 30),
      };
    },
    async checkpoint(run, s, pack) {
      const { data, error } = await db.rpc("checkpoint_social_editorial", {
        p_date: run.slot_date,
        p_token: run.claim_token,
        p_source: s,
        p_package: pack,
      });
      if (error) throw error;
      return data === true;
    },
    async finish(run, state, code, postId) {
      const { data, error } = await db.rpc("finish_social_editorial", {
        p_date: run.slot_date,
        p_token: run.claim_token,
        p_state: state,
        p_code: code,
        p_post_id: postId ?? null,
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    async deliveryAllowed(run) {
      const [settings, ownership] = await Promise.all([
        db
          .from("social_editorial_settings")
          .select("mode")
          .eq("id", true)
          .single(),
        db
          .from("social_editorial_runs")
          .select("claim_token,lease_until,state,mode")
          .eq("slot_date", run.slot_date)
          .single(),
      ]);
      if (settings.error) throw settings.error;
      if (ownership.error) throw ownership.error;
      return (
        settings.data.mode === "publish" &&
        ownership.data.mode === "publish" &&
        ownership.data.state === "working" &&
        ownership.data.claim_token === run.claim_token &&
        Date.parse(ownership.data.lease_until) > Date.now() + 30000
      );
    },
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
    async recordAttempt(run, detail) {
      const { error } = await db.rpc("record_social_editorial_attempt", {
        p_date: run.slot_date,
        p_token: run.claim_token,
        p_detail: detail,
      });
      if (error) throw error;
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
        db
          .from("social_editorial_assignments")
          .select("source_id,blog_id,package")
          .gte("created_at", sixtyDays.toISOString())
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
