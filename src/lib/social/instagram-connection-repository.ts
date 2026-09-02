import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { InstagramOAuthStateStore } from "./instagram-oauth-state";

export interface InstagramConnectionRecord {
  instagramUserId: string;
  username: string;
  accountType: string | null;
  accessTokenCiphertext: string;
  requiredScopes: string[];
  tokenIssuedAt: string;
  tokenExpiresAt: string;
  lastRefreshedAt: string | null;
  lastRefreshErrorCode: string | null;
  connectedByEmail: string;
  connectedAt: string;
}

export interface InstagramRefreshClaim {
  instagramUserId: string;
  username: string;
  accessTokenCiphertext: string;
  tokenIssuedAt: string;
  tokenExpiresAt: string;
}

export interface InstagramConnectionRepository extends InstagramOAuthStateStore {
  getConnection(): Promise<InstagramConnectionRecord | null>;
  upsertConnection(input: {
    instagramUserId: string;
    username: string;
    accountType: string | null;
    accessTokenCiphertext: string;
    requiredScopes: string[];
    tokenIssuedAt: string;
    tokenExpiresAt: string;
    connectedByEmail: string;
  }): Promise<void>;
  disconnect(): Promise<void>;
  claimRefresh(
    claimToken: string,
    claimTtlSeconds: number
  ): Promise<InstagramRefreshClaim | null>;
  completeRefresh(input: {
    claimToken: string;
    accessTokenCiphertext: string;
    tokenIssuedAt: string;
    tokenExpiresAt: string;
  }): Promise<boolean>;
  releaseRefresh(input: {
    claimToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<boolean>;
}

function operationFailed(
  operation: string,
  error: { message?: string }
): Error {
  return new Error(
    `${operation} failed: ${error.message ?? "unknown database error"}`
  );
}

function connectionRecord(
  row: Record<string, unknown>
): InstagramConnectionRecord | null {
  if (
    typeof row.instagram_user_id !== "string" ||
    typeof row.username !== "string" ||
    typeof row.access_token_ciphertext !== "string" ||
    !Array.isArray(row.required_scopes) ||
    !row.required_scopes.every((scope) => typeof scope === "string") ||
    typeof row.token_issued_at !== "string" ||
    typeof row.token_expires_at !== "string" ||
    typeof row.connected_by_email !== "string" ||
    typeof row.connected_at !== "string"
  ) {
    return null;
  }
  return {
    instagramUserId: row.instagram_user_id,
    username: row.username,
    accountType: typeof row.account_type === "string" ? row.account_type : null,
    accessTokenCiphertext: row.access_token_ciphertext,
    requiredScopes: row.required_scopes,
    tokenIssuedAt: row.token_issued_at,
    tokenExpiresAt: row.token_expires_at,
    lastRefreshedAt:
      typeof row.last_refreshed_at === "string" ? row.last_refreshed_at : null,
    lastRefreshErrorCode:
      typeof row.last_refresh_error_code === "string"
        ? row.last_refresh_error_code
        : null,
    connectedByEmail: row.connected_by_email,
    connectedAt: row.connected_at,
  };
}

export function createInstagramConnectionRepository(
  supabase: SupabaseClient = getServiceRoleClient()
): InstagramConnectionRepository {
  return {
    async pruneExpired(now) {
      const { error } = await supabase
        .from("social_instagram_oauth_states")
        .delete()
        .lt("expires_at", now);
      if (error) throw operationFailed("Instagram OAuth state cleanup", error);
    },

    async insert(input) {
      const { error } = await supabase
        .from("social_instagram_oauth_states")
        .insert({
          nonce_hash: input.nonceHash,
          admin_email: input.adminEmail,
          expires_at: input.expiresAt,
        });
      if (error) throw operationFailed("Instagram OAuth state creation", error);
    },

    async consume(nonceHash) {
      const { data, error } = await supabase.rpc(
        "consume_social_instagram_oauth_state",
        { p_nonce_hash: nonceHash }
      );
      if (error)
        throw operationFailed("Instagram OAuth state consumption", error);
      const row = Array.isArray(data) ? data[0] : null;
      return row && typeof row.admin_email === "string"
        ? row.admin_email
        : null;
    },

    async getConnection() {
      const { data, error } = await supabase
        .from("social_instagram_connections")
        .select(
          "instagram_user_id, username, account_type, access_token_ciphertext, required_scopes, token_issued_at, token_expires_at, last_refreshed_at, last_refresh_error_code, connected_by_email, connected_at"
        )
        .eq("id", 1)
        .maybeSingle();
      if (error) throw operationFailed("Instagram connection lookup", error);
      if (!data) return null;
      const parsed = connectionRecord(data as Record<string, unknown>);
      if (!parsed) throw new Error("Instagram connection record is invalid");
      return parsed;
    },

    async upsertConnection(input) {
      const { error } = await supabase
        .from("social_instagram_connections")
        .upsert(
          {
            id: 1,
            instagram_user_id: input.instagramUserId,
            username: input.username,
            account_type: input.accountType,
            access_token_ciphertext: input.accessTokenCiphertext,
            required_scopes: input.requiredScopes,
            token_issued_at: input.tokenIssuedAt,
            token_expires_at: input.tokenExpiresAt,
            last_refreshed_at: null,
            refresh_claim_token: null,
            refresh_claim_expires_at: null,
            last_refresh_error_code: null,
            last_refresh_error_message: null,
            last_refresh_error_at: null,
            connected_by_email: input.connectedByEmail,
            connected_at: input.tokenIssuedAt,
          },
          { onConflict: "id" }
        );
      if (error) throw operationFailed("Instagram connection storage", error);
    },

    async disconnect() {
      const { error } = await supabase
        .from("social_instagram_connections")
        .delete()
        .eq("id", 1);
      if (error) throw operationFailed("Instagram disconnect", error);
    },

    async claimRefresh(claimToken, claimTtlSeconds) {
      const { data, error } = await supabase.rpc(
        "claim_social_instagram_refresh",
        {
          p_claim_token: claimToken,
          p_claim_ttl_seconds: claimTtlSeconds,
        }
      );
      if (error) throw operationFailed("Instagram refresh claim", error);
      const row = Array.isArray(data) ? data[0] : null;
      if (
        !row ||
        typeof row.instagram_user_id !== "string" ||
        typeof row.username !== "string" ||
        typeof row.access_token_ciphertext !== "string" ||
        typeof row.token_issued_at !== "string" ||
        typeof row.token_expires_at !== "string"
      ) {
        return null;
      }
      return {
        instagramUserId: row.instagram_user_id,
        username: row.username,
        accessTokenCiphertext: row.access_token_ciphertext,
        tokenIssuedAt: row.token_issued_at,
        tokenExpiresAt: row.token_expires_at,
      };
    },

    async completeRefresh(input) {
      const { data, error } = await supabase.rpc(
        "complete_social_instagram_refresh",
        {
          p_claim_token: input.claimToken,
          p_access_token_ciphertext: input.accessTokenCiphertext,
          p_token_issued_at: input.tokenIssuedAt,
          p_token_expires_at: input.tokenExpiresAt,
        }
      );
      if (error) throw operationFailed("Instagram refresh completion", error);
      return data === true;
    },

    async releaseRefresh(input) {
      const { data, error } = await supabase.rpc(
        "release_social_instagram_refresh",
        {
          p_claim_token: input.claimToken,
          p_error_code: input.errorCode,
          p_error_message: input.errorMessage,
        }
      );
      if (error) throw operationFailed("Instagram refresh release", error);
      return data === true;
    },
  };
}
