/**
 * OPS Web - Portal Auth Service
 *
 * Magic link token management and session creation for the client portal.
 * Uses service role key since portal users have no Firebase auth.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type { PortalToken, PortalSession } from "@/lib/types/portal";

// ─── Database Mapping ────────────────────────────────────────────────────────

function mapTokenFromDb(row: Record<string, unknown>): PortalToken {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    clientId: row.client_id as string,
    email: row.email as string,
    token: row.token as string,
    expiresAt: parseDateRequired(row.expires_at),
    verifiedAt: parseDate(row.verified_at),
    createdAt: parseDateRequired(row.created_at),
    revokedAt: parseDate(row.revoked_at),
  };
}

function mapSessionFromDb(row: Record<string, unknown>): PortalSession {
  return {
    id: row.id as string,
    portalTokenId: row.portal_token_id as string,
    sessionToken: row.session_token as string,
    email: row.email as string,
    companyId: row.company_id as string,
    clientId: row.client_id as string,
    expiresAt: parseDateRequired(row.expires_at),
    createdAt: parseDateRequired(row.created_at),
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const PortalAuthService = {
  /**
   * Create a magic link token for a client.
   */
  async createPortalToken(
    companyId: string,
    clientId: string,
    email: string
  ): Promise<PortalToken> {
    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("portal_tokens")
      .insert({
        company_id: companyId,
        client_id: clientId,
        email: email.toLowerCase().trim(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create portal token: ${error.message}`);
    return mapTokenFromDb(data);
  },

  /**
   * Look up a token by its hex value. Returns null if not found.
   */
  async getTokenByValue(token: string): Promise<PortalToken | null> {
    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("portal_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error) throw new Error(`Failed to look up token: ${error.message}`);
    if (!data) return null;
    return mapTokenFromDb(data);
  },

  /**
   * Validate token and create a session. Returns the session or throws.
   *
   * Validates:
   * - Token exists and is not expired
   * - Token is not revoked
   * - Email matches (case-insensitive)
   */
  async verifyAndCreateSession(
    token: string,
    email: string
  ): Promise<PortalSession> {
    const supabase = getServiceRoleClient();
    const normalizedEmail = email.toLowerCase().trim();

    // Look up token
    const portalToken = await this.getTokenByValue(token);
    if (!portalToken) {
      throw new Error("Invalid or expired link");
    }

    // Check expiration
    if (new Date() > portalToken.expiresAt) {
      throw new Error("This link has expired");
    }

    // Check revocation
    if (portalToken.revokedAt) {
      throw new Error("This link has been revoked");
    }

    // Check email match
    if (portalToken.email.toLowerCase() !== normalizedEmail) {
      throw new Error("Email does not match");
    }

    // Mark token as verified
    await supabase
      .from("portal_tokens")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", portalToken.id);

    // Create session
    const { data, error } = await supabase
      .from("portal_sessions")
      .insert({
        portal_token_id: portalToken.id,
        email: normalizedEmail,
        company_id: portalToken.companyId,
        client_id: portalToken.clientId,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create session: ${error.message}`);
    return mapSessionFromDb(data);
  },

  /**
   * Load a session from its cookie value. Returns null if expired or not found.
   */
  async getSessionFromCookie(
    sessionToken: string
  ): Promise<PortalSession | null> {
    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("portal_sessions")
      .select("*")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (error) throw new Error(`Failed to look up session: ${error.message}`);
    if (!data) return null;

    const session = mapSessionFromDb(data);

    // Check expiration
    if (new Date() > session.expiresAt) return null;

    return session;
  },

  /**
   * Soft-revoke a token (prevents future use).
   */
  async revokeToken(tokenId: string): Promise<void> {
    const supabase = getServiceRoleClient();

    const { error } = await supabase
      .from("portal_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId);

    if (error) throw new Error(`Failed to revoke token: ${error.message}`);
  },
};
