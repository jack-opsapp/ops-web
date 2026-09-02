import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { SocialAuditEvent, SocialPostRecord } from "./types";

export class SocialClaimLostError extends Error {
  constructor(message = "Social post claim is no longer owned by this worker") {
    super(message);
    this.name = "SocialClaimLostError";
  }
}

export interface PublisherSocialRepository {
  claimDue(claimToken: string, limit: number, ttlSeconds: number): Promise<SocialPostRecord[]>;
  claimById(postId: string, claimToken: string, ttlSeconds: number): Promise<SocialPostRecord | null>;
  markPublished(
    postId: string,
    claimToken: string | null,
    update: {
      mediaId: string;
      permalink: string | null;
      publishedAt: string;
      auditLog: SocialAuditEvent[];
    }
  ): Promise<void>;
  markFailed(
    postId: string,
    claimToken: string | null,
    update: {
      code: string;
      message: string;
      retryable: boolean;
      nextAttemptAt: string | null;
      auditLog: SocialAuditEvent[];
    }
  ): Promise<void>;
}

function mapRows(data: unknown): SocialPostRecord[] {
  return (Array.isArray(data) ? data : []) as SocialPostRecord[];
}

export function createPublisherSocialRepository(): PublisherSocialRepository {
  const db = getServiceRoleClient();

  return {
    async claimDue(claimToken, limit, ttlSeconds) {
      const { data, error } = await db.rpc("claim_due_social_posts", {
        p_claim_token: claimToken,
        p_limit: limit,
        p_claim_ttl_seconds: ttlSeconds,
      });
      if (error) throw error;
      return mapRows(data);
    },

    async claimById(postId, claimToken, ttlSeconds) {
      const { data, error } = await db.rpc("claim_social_post_by_id", {
        p_post_id: postId,
        p_claim_token: claimToken,
        p_claim_ttl_seconds: ttlSeconds,
      });
      if (error) throw error;
      return mapRows(data)[0] ?? null;
    },

    async markPublished(postId, claimToken, update) {
      if (!claimToken) throw new SocialClaimLostError();
      const { data, error } = await db
        .from("social_posts")
        .update({
          status: "published",
          instagram_media_id: update.mediaId,
          instagram_permalink: update.permalink,
          published_at: update.publishedAt,
          claim_token: null,
          claim_expires_at: null,
          next_attempt_at: null,
          last_error_code: null,
          last_error_message: null,
          last_error_retryable: null,
          updated_by: "system:publisher",
          audit_log: update.auditLog,
        })
        .eq("id", postId)
        .eq("status", "publishing")
        .eq("claim_token", claimToken)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new SocialClaimLostError();
    },

    async markFailed(postId, claimToken, update) {
      if (!claimToken) throw new SocialClaimLostError();
      const { data, error } = await db
        .from("social_posts")
        .update({
          status: "failed",
          last_error_code: update.code,
          last_error_message: update.message,
          last_error_retryable: update.retryable,
          next_attempt_at: update.nextAttemptAt,
          claim_token: null,
          claim_expires_at: null,
          updated_by: "system:publisher",
          audit_log: update.auditLog,
        })
        .eq("id", postId)
        .eq("status", "publishing")
        .eq("claim_token", claimToken)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new SocialClaimLostError();
    },
  };
}
