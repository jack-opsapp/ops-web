import "server-only";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type {
  JournalAssignmentRecord,
  JournalHandoffRepository,
  JournalMode,
  JournalSourceRecord,
} from "./handoff";
import type { JournalRadarSourceStatus } from "./radar/scan";
import {
  RADAR_CLAIM_WINDOW_DAYS,
  RADAR_PITCH_WINDOW_DAYS,
  selectClaimSignals,
  trendSignalRow,
} from "./radar/signals";

const assignmentFields =
  "id,identity,slot_date,slot_at,mode,state,attempts,submissions,claim_token,lease_until,title,package,pitch,pitch_claim_token";
const signalFields =
  "id,source_key,sphere,kind,url,title,summary,published_at,views,baseline_views,momentum,comments";
const DAY_MS = 86400000;
const sourceFields =
  "id,url,final_url,content_type,title,site_name,published_hint,modified_hint,text,truncated,fetched_at";

function sourceRecord(row: Record<string, unknown>): JournalSourceRecord {
  return {
    id: String(row.id),
    url: String(row.url),
    final_url: String(row.final_url),
    content_type: String(row.content_type),
    title: typeof row.title === "string" ? row.title : null,
    site_name: typeof row.site_name === "string" ? row.site_name : null,
    published_hint: typeof row.published_hint === "string" ? row.published_hint : null,
    modified_hint: typeof row.modified_hint === "string" ? row.modified_hint : null,
    text: String(row.text),
    truncated: row.truncated === true,
    fetched_at: String(row.fetched_at),
  };
}

export function createJournalRepository(): JournalHandoffRepository {
  const db = getServiceRoleClient();

  async function categories() {
    const { data, error } = await db
      .from("blog_categories")
      .select("id,slug,name")
      .order("name");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
    }));
  }

  async function backlog() {
    const { data, error } = await db
      .from("blog_topics")
      .select("id,topic")
      .eq("used", false)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map((row) => ({ id: String(row.id), topic: String(row.topic) }));
  }

  async function radarSettings() {
    const { data, error } = await db
      .from("journal_editorial_settings")
      .select("radar_scanned_at,radar_sources")
      .eq("id", true)
      .single();
    if (error) throw error;
    return {
      scanned_at: typeof data.radar_scanned_at === "string" ? new Date(data.radar_scanned_at).toISOString() : null,
      sources: (Array.isArray(data.radar_sources) ? data.radar_sources : []) as JournalRadarSourceStatus[],
    };
  }

  async function maxSources() {
    const { data, error } = await db
      .from("journal_editorial_settings")
      .select("max_sources")
      .eq("id", true)
      .single();
    if (error) throw error;
    return Number(data.max_sources);
  }

  return {
    async claimAssignment(token, worker) {
      const { data, error } = await db.rpc("claim_journal_editorial_assignment", {
        p_token: token,
        p_worker: worker,
      });
      if (error) throw error;
      return ((data as JournalAssignmentRecord[] | null)?.[0] as JournalAssignmentRecord) ?? null;
    },

    async readMode() {
      const { data, error } = await db
        .from("journal_editorial_settings")
        .select("mode")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data.mode as JournalMode;
    },

    async findAssignment(id) {
      const { data, error } = await db
        .from("journal_editorial_assignments")
        .select(assignmentFields)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as JournalAssignmentRecord | null) ?? null;
    },

    async claimContext(assignmentId) {
      const now = new Date();
      const [live, cats, topics, fetched, max, radar, signals] = await Promise.all([
        db
          .from("blog_posts")
          .select("slug,title,published_at,summary,category_id,image_prompt")
          .eq("is_live", true)
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
          .limit(40),
        categories(),
        backlog(),
        db
          .from("journal_editorial_sources")
          .select("id,url,title")
          .eq("assignment_id", assignmentId)
          .order("fetched_at", { ascending: true }),
        maxSources(),
        radarSettings(),
        db
          .from("journal_trend_signals")
          .select(signalFields)
          .gte("published_at", new Date(now.getTime() - RADAR_CLAIM_WINDOW_DAYS * DAY_MS).toISOString())
          .order("published_at", { ascending: false })
          .limit(1000),
      ]);
      if (live.error) throw live.error;
      if (fetched.error) throw fetched.error;
      if (signals.error) throw signals.error;
      const bySlug = new Map(cats.map((category) => [category.id, category.slug]));
      return {
        recentPosts: (live.data ?? []).map((row) => ({
          slug: String(row.slug),
          title: String(row.title),
          published_at: String(row.published_at),
          summary: typeof row.summary === "string" ? row.summary : null,
          category: row.category_id ? (bySlug.get(String(row.category_id)) ?? null) : null,
        })),
        backlogTopics: topics,
        recentImages: (live.data ?? [])
          .filter((row) => typeof row.image_prompt === "string" && row.image_prompt.trim().length > 0)
          .slice(0, 8)
          .map((row) => ({
            title: String(row.title),
            image_prompt: String(row.image_prompt).replace(/\s+/g, " ").trim().slice(0, 400),
          })),
        categories: cats,
        fetchedSources: (fetched.data ?? []).map((row) => ({
          id: String(row.id),
          url: String(row.url),
          title: typeof row.title === "string" ? row.title : null,
        })),
        maxSources: max,
        trendSignals: selectClaimSignals(
          (signals.data ?? []).map((row) => trendSignalRow(row as Record<string, unknown>)),
          now
        ),
        radar,
      };
    },

    async pitchContext(signalIds) {
      const now = new Date();
      const [cited, available, radar, posts] = await Promise.all([
        signalIds.length
          ? db.from("journal_trend_signals").select(signalFields).in("id", signalIds)
          : Promise.resolve({ data: [], error: null }),
        db
          .from("journal_trend_signals")
          .select("id", { count: "exact", head: true })
          .gte("published_at", new Date(now.getTime() - RADAR_PITCH_WINDOW_DAYS * DAY_MS).toISOString()),
        radarSettings(),
        db
          .from("blog_posts")
          .select("title,published_at")
          .eq("is_live", true)
          .gte("published_at", new Date(now.getTime() - 366 * DAY_MS).toISOString())
          .lte("published_at", now.toISOString())
          .limit(1000),
      ]);
      for (const result of [cited, available, posts]) if (result.error) throw result.error;
      return {
        signals: new Map(
          (cited.data ?? []).map((row) => {
            const signal = trendSignalRow(row as Record<string, unknown>);
            return [signal.id, signal] as const;
          })
        ),
        radarSignalsAvailable: available.count ?? 0,
        radarScannedAt: radar.scanned_at,
        livePosts: (posts.data ?? []).map((row) => ({
          title: String(row.title),
          published_at: String(row.published_at),
        })),
      };
    },

    async storePitch(id, token, pitch) {
      const { data, error } = await db.rpc("pitch_journal_editorial_assignment", {
        p_id: id,
        p_token: token,
        p_pitch: pitch,
      });
      if (error) throw error;
      const result = (data ?? {}) as { state?: string; lease_until?: string; code?: string };
      if (result.state === "pitched" && result.lease_until)
        return { state: "pitched", lease_until: new Date(result.lease_until).toISOString() };
      return { code: result.code ?? "CLAIM_NOT_OWNED" };
    },

    async policyContext(assignmentId) {
      const [sources, posts, reserved, cats, topics] = await Promise.all([
        db
          .from("journal_editorial_sources")
          .select("id,url,final_url,title,site_name,text")
          .eq("assignment_id", assignmentId),
        db.from("blog_posts").select("slug,title,published_at,is_live").limit(5000),
        db
          .from("journal_editorial_assignments")
          .select("slug")
          .neq("id", assignmentId)
          .in("state", ["drafted", "scheduled", "published"])
          .not("slug", "is", null),
        categories(),
        backlog(),
      ]);
      for (const result of [sources, posts, reserved]) if (result.error) throw result.error;
      const now = Date.now();
      return {
        sources: (sources.data ?? []).map((row) => ({
          id: String(row.id),
          url: String(row.url),
          final_url: String(row.final_url),
          title: typeof row.title === "string" ? row.title : null,
          site_name: typeof row.site_name === "string" ? row.site_name : null,
          text: String(row.text),
        })),
        livePosts: (posts.data ?? [])
          .filter(
            (row) =>
              row.is_live === true &&
              typeof row.published_at === "string" &&
              Date.parse(row.published_at) <= now
          )
          .map((row) => ({
            slug: String(row.slug),
            title: String(row.title),
            published_at: String(row.published_at),
          })),
        takenSlugs: [
          ...(posts.data ?? []).map((row) => String(row.slug)),
          ...(reserved.data ?? []).map((row) => String(row.slug)),
        ],
        categories: cats.map(({ id, slug }) => ({ id, slug })),
        backlogTopicIds: topics.map((topic) => topic.id),
      };
    },

    async findSource(assignmentId, url) {
      const { data, error } = await db
        .from("journal_editorial_sources")
        .select(sourceFields)
        .eq("assignment_id", assignmentId)
        .eq("url", url)
        .maybeSingle();
      if (error) throw error;
      return data ? sourceRecord(data as Record<string, unknown>) : null;
    },

    async countClaimSources(assignmentId, token) {
      const { count, error } = await db
        .from("journal_editorial_sources")
        .select("id", { count: "exact", head: true })
        .eq("assignment_id", assignmentId)
        .eq("claim_token", token);
      if (error) throw error;
      return count ?? 0;
    },

    maxSources,

    async storeSource(assignmentId, token, snapshot) {
      const { data, error } = await db.rpc("store_journal_editorial_source", {
        p_id: assignmentId,
        p_token: token,
        p_source: snapshot,
      });
      if (error) throw error;
      const result = (data ?? {}) as { id?: string; existing?: boolean; code?: string };
      if (result.code) return { code: result.code };
      return { id: String(result.id), existing: result.existing === true };
    },

    async recordAttempt(id, token, detail) {
      const { data, error } = await db.rpc("record_journal_editorial_attempt", {
        p_id: id,
        p_token: token,
        p_detail: detail,
      });
      if (error) throw error;
      return data === true;
    },

    async finishAssignment(id, token, state, code, pack, slug, title) {
      const { data, error } = await db.rpc("finish_journal_editorial_assignment", {
        p_id: id,
        p_token: token,
        p_state: state,
        p_code: code,
        p_package: pack,
        p_slug: slug,
        p_title: title,
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
  };
}
