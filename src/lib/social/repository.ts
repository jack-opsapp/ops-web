import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { SocialSubmission } from "./contract";
import type { RecentSocialPost } from "./template-selector";
import type {
  RenderedSocialAsset,
  SocialAuditEvent,
  SocialPostFormat,
  SocialPostRecord,
  SocialSourceType,
  SocialStoryType,
  SocialVisualTreatment,
} from "./types";

export interface LiveBlogSource {
  id: string;
  title: string;
  slug: string;
  thumbnail_url: string | null;
  published_at: string | null;
  is_live: boolean;
}

export interface ReserveRenderingPostInput {
  id: string;
  idempotency_key: string;
  contract_version: string;
  source_type: SocialSourceType;
  source_id: string | null;
  source_url: string | null;
  story_type: SocialStoryType;
  visual_treatment: SocialVisualTreatment;
  post_format: SocialPostFormat;
  content: SocialSubmission["content"];
  caption: string;
  alt_text: string;
  agent_preferences: Record<string, unknown>;
  selection_metadata: Record<string, unknown>;
  rendered_assets: RenderedSocialAsset[];
  status: "rendering";
  publish_after: string;
  requested_publish_at: string | null;
  render_version: string;
  selector_version: string;
  voice_reference_version: string;
  created_by: string;
  updated_by: string;
  audit_log: SocialAuditEvent[];
}

export interface ReviewUpdates {
  rendered_assets: RenderedSocialAsset[];
  rendered_at: string;
  publish_after: string;
  audit_log: SocialAuditEvent[];
  updated_by: string;
}

export interface SubmissionSocialRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<SocialPostRecord | null>;
  findLiveBlogSource(id: string): Promise<LiveBlogSource | null>;
  listRecentPosts(limit: number): Promise<RecentSocialPost[]>;
  reserveRenderingPost(
    input: ReserveRenderingPostInput
  ): Promise<{ created: boolean; post: SocialPostRecord }>;
  markReview(id: string, updates: ReviewUpdates): Promise<SocialPostRecord>;
  markFailed(
    id: string,
    error: { code: string; message: string; retryable: boolean; actor: string }
  ): Promise<void>;
}

function mapSocialPost(row: Record<string, unknown>): SocialPostRecord {
  return row as unknown as SocialPostRecord;
}

export function createSubmissionSocialRepository(): SubmissionSocialRepository {
  const db = getServiceRoleClient();

  return {
    async findByIdempotencyKey(idempotencyKey) {
      const { data, error } = await db
        .from("social_posts")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw error;
      return data ? mapSocialPost(data as Record<string, unknown>) : null;
    },

    async findLiveBlogSource(id) {
      const { data, error } = await db
        .from("blog_posts")
        .select("id,title,slug,thumbnail_url,published_at,is_live")
        .eq("id", id)
        .eq("is_live", true)
        .maybeSingle();
      if (error) throw error;
      return (data as LiveBlogSource | null) ?? null;
    },

    async listRecentPosts(limit) {
      const { data, error } = await db
        .from("social_posts")
        .select("visual_treatment,post_format")
        .in("status", ["review", "publishing", "published"])
        .order("created_at", { ascending: false })
        .limit(Math.max(1, Math.min(limit, 12)));
      if (error) throw error;
      return (data ?? []).map((row) => ({
        visualTreatment: row.visual_treatment as SocialVisualTreatment,
        postFormat: row.post_format as SocialPostFormat,
      }));
    },

    async reserveRenderingPost(input) {
      const { data, error } = await db
        .from("social_posts")
        .insert(input)
        .select("*")
        .single();

      if (!error && data) {
        return { created: true, post: mapSocialPost(data as Record<string, unknown>) };
      }
      if (error?.code === "23505") {
        const existing = await this.findByIdempotencyKey(input.idempotency_key);
        if (existing) return { created: false, post: existing };
      }
      throw error ?? new Error("Social post reservation returned no row");
    },

    async markReview(id, updates) {
      const { data, error } = await db
        .from("social_posts")
        .update({
          ...updates,
          status: "review",
          last_error_code: null,
          last_error_message: null,
          last_error_retryable: null,
          claim_token: null,
          claim_expires_at: null,
        })
        .eq("id", id)
        .eq("status", "rendering")
        .select("*")
        .single();
      if (error) throw error;
      return mapSocialPost(data as Record<string, unknown>);
    },

    async markFailed(id, failure) {
      const { data: current, error: readError } = await db
        .from("social_posts")
        .select("status,audit_log")
        .eq("id", id)
        .single();
      if (readError) throw readError;
      const now = new Date().toISOString();
      const priorAudit = (current.audit_log ?? []) as SocialAuditEvent[];
      const { error } = await db
        .from("social_posts")
        .update({
          status: "failed",
          last_error_code: failure.code,
          last_error_message: failure.message,
          last_error_retryable: failure.retryable,
          next_attempt_at: null,
          claim_token: null,
          claim_expires_at: null,
          updated_by: failure.actor,
          audit_log: [
            ...priorAudit,
            {
              at: now,
              actor: failure.actor,
              from: current.status,
              to: "failed",
              event: "render_failed",
              metadata: { code: failure.code },
            },
          ],
        })
        .eq("id", id);
      if (error) throw error;
    },
  };
}
