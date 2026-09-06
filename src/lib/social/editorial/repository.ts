import "server-only";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { EditorialSource } from "./policy";
import type { EditorialRepository, EditorialRun } from "./worker";
const fields = "id,title,slug,content,published_at,is_live,thumbnail_url";
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
export function createEditorialRepository(): EditorialRepository {
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
  };
}
