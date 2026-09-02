import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { RecentSocialPost } from "./template-selector";
import type {
  RenderedSocialAsset,
  SocialAuditEvent,
  SocialPostFormat,
  SocialPostRecord,
  SocialPostStatus,
  SocialStoryType,
  SocialVisualTreatment,
} from "./types";
import type { SocialContent } from "./contract";

export interface AdminSocialRepository {
  list(input: { statuses: SocialPostStatus[]; limit: number }): Promise<SocialPostRecord[]>;
  getById(id: string): Promise<SocialPostRecord | null>;
  listRecentPosts(limit: number): Promise<RecentSocialPost[]>;
  beginEdit(
    id: string,
    update: {
      content: SocialContent;
      caption: string;
      alt_text: string;
      story_type: SocialStoryType;
      visual_treatment: SocialVisualTreatment;
      post_format: SocialPostFormat;
      selection_metadata: Record<string, unknown>;
      selector_version: string;
      render_version: string;
      audit_log: SocialAuditEvent[];
      updated_by: string;
    }
  ): Promise<SocialPostRecord>;
  completeEdit(
    id: string,
    update: {
      rendered_assets: RenderedSocialAsset[];
      rendered_at: string;
      publish_after: string;
      audit_log: SocialAuditEvent[];
      updated_by: string;
    }
  ): Promise<SocialPostRecord>;
  failEdit(
    id: string,
    update: {
      message: string;
      actor: string;
      auditLog: SocialAuditEvent[];
      priorAssets: RenderedSocialAsset[];
    }
  ): Promise<void>;
  cancel(
    id: string,
    update: { cancelled_at: string; audit_log: SocialAuditEvent[]; updated_by: string }
  ): Promise<SocialPostRecord>;
  recordPublishRequest(id: string, update: { audit_log: SocialAuditEvent[]; updated_by: string }): Promise<void>;
  resetForRetry(
    id: string,
    update: {
      attempt_count: number;
      max_attempts: number;
      publish_after: string;
      audit_log: SocialAuditEvent[];
      updated_by: string;
    }
  ): Promise<SocialPostRecord>;
}

function row(value: unknown): SocialPostRecord {
  return value as SocialPostRecord;
}

export function createAdminSocialRepository(): AdminSocialRepository {
  const db = getServiceRoleClient();
  return {
    async list({ statuses, limit }) {
      const { data, error } = await db
        .from("social_posts")
        .select("*")
        .in("status", statuses)
        .order("created_at", { ascending: false })
        .limit(Math.max(1, Math.min(limit, 100)));
      if (error) throw error;
      return (data ?? []).map(row);
    },

    async getById(id) {
      const { data, error } = await db
        .from("social_posts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? row(data) : null;
    },

    async listRecentPosts(limit) {
      const { data, error } = await db
        .from("social_posts")
        .select("visual_treatment,post_format")
        .in("status", ["review", "publishing", "published"])
        .order("created_at", { ascending: false })
        .limit(Math.max(1, Math.min(limit, 12)));
      if (error) throw error;
      return (data ?? []).map((item) => ({
        visualTreatment: item.visual_treatment as SocialVisualTreatment,
        postFormat: item.post_format as SocialPostFormat,
      }));
    },

    async beginEdit(id, update) {
      const { data, error } = await db
        .from("social_posts")
        .update({ ...update, status: "rendering", claim_token: null, claim_expires_at: null })
        .eq("id", id)
        .in("status", ["review", "failed"])
        .is("claim_token", null)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Social post changed before edit could begin");
      return row(data);
    },

    async completeEdit(id, update) {
      const { data, error } = await db
        .from("social_posts")
        .update({
          ...update,
          status: "review",
          attempt_count: 0,
          max_attempts: 3,
          next_attempt_at: null,
          last_error_code: null,
          last_error_message: null,
          last_error_retryable: null,
        })
        .eq("id", id)
        .eq("status", "rendering")
        .select("*")
        .single();
      if (error) throw error;
      return row(data);
    },

    async failEdit(id, update) {
      const { error } = await db
        .from("social_posts")
        .update({
          status: "failed",
          rendered_assets: update.priorAssets,
          last_error_code: "SOCIAL_EDIT_RENDER_FAILED",
          last_error_message: update.message,
          last_error_retryable: false,
          next_attempt_at: null,
          audit_log: update.auditLog,
          updated_by: update.actor,
        })
        .eq("id", id)
        .eq("status", "rendering");
      if (error) throw error;
    },

    async cancel(id, update) {
      const { data, error } = await db
        .from("social_posts")
        .update({
          ...update,
          status: "cancelled",
          claim_token: null,
          claim_expires_at: null,
          next_attempt_at: null,
        })
        .eq("id", id)
        .in("status", ["review", "failed"])
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Social post is no longer cancellable");
      return row(data);
    },

    async recordPublishRequest(id, update) {
      const { data, error } = await db
        .from("social_posts")
        .update(update)
        .eq("id", id)
        .in("status", ["review", "failed"])
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Social post is no longer publishable");
    },

    async resetForRetry(id, update) {
      const { data, error } = await db
        .from("social_posts")
        .update({
          ...update,
          status: "review",
          next_attempt_at: null,
          last_error_code: null,
          last_error_message: null,
          last_error_retryable: null,
          claim_token: null,
          claim_expires_at: null,
        })
        .eq("id", id)
        .eq("status", "failed")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Social post is no longer retryable");
      return row(data);
    },
  };
}
