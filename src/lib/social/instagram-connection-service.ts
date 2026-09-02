import "server-only";

import { randomUUID } from "node:crypto";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import {
  createInstagramConnectionRepository,
  type InstagramConnectionRepository,
} from "./instagram-connection-repository";
import {
  createInstagramOAuthClientFromEnv,
  type InstagramOAuthConnectionResult,
  type InstagramOAuthRefreshResult,
} from "./instagram-oauth-client";
import {
  consumeInstagramOAuthState,
  createInstagramOAuthState,
} from "./instagram-oauth-state";
import {
  decryptInstagramToken,
  encryptInstagramToken,
} from "./token-cipher";

const REFRESH_CLAIM_TTL_SECONDS = 180;

interface OAuthClient {
  authorizationUrl(state: string): URL;
  exchangeAuthorizationCode(code: string): Promise<InstagramOAuthConnectionResult>;
  refreshLongLivedToken(accessToken: string): Promise<InstagramOAuthRefreshResult>;
}

interface InstagramConnectionDependencies {
  repository: InstagramConnectionRepository;
  oauth: OAuthClient;
  encryptToken: (token: string) => string;
  decryptToken: (ciphertext: string) => string;
  isAdminEmail: (email: string) => Promise<boolean>;
  createClaimToken: () => string;
  now: () => Date;
}

export type InstagramConnectionStatus =
  | {
      connected: false;
      username?: string;
      reason: "not_connected" | "expired";
      needsReconnect: boolean;
    }
  | {
      connected: true;
      username: string;
      connectedAt: string;
      tokenExpiresAt: string;
      lastRefreshedAt: string | null;
      needsReconnect: false;
    };

export interface InstagramPublishingCredentials {
  userId: string;
  username: string;
  accessToken: string;
}

export class InstagramConnectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "InstagramConnectionError";
  }
}

function defaults(): InstagramConnectionDependencies {
  return {
    repository: createInstagramConnectionRepository(),
    oauth: createInstagramOAuthClientFromEnv(),
    encryptToken: encryptInstagramToken,
    decryptToken: decryptInstagramToken,
    isAdminEmail,
    createClaimToken: randomUUID,
    now: () => new Date(),
  };
}

export class InstagramConnectionService {
  private readonly dependencies: InstagramConnectionDependencies;

  constructor(dependencies: InstagramConnectionDependencies = defaults()) {
    this.dependencies = dependencies;
  }

  async createAuthorizationUrl(adminEmail: string): Promise<URL> {
    const state = await createInstagramOAuthState(
      this.dependencies.repository,
      adminEmail,
      this.dependencies.now()
    );
    return this.dependencies.oauth.authorizationUrl(state);
  }

  async completeAuthorization(
    state: string,
    code: string
  ): Promise<InstagramConnectionStatus> {
    const adminEmail = await consumeInstagramOAuthState(
      this.dependencies.repository,
      state
    );
    if (!adminEmail) {
      throw new InstagramConnectionError(
        "INSTAGRAM_OAUTH_STATE_INVALID",
        "Instagram login expired or was already used",
        false
      );
    }
    if (!(await this.dependencies.isAdminEmail(adminEmail))) {
      throw new InstagramConnectionError(
        "INSTAGRAM_OAUTH_ADMIN_REVOKED",
        "The admin who started this connection no longer has access",
        false
      );
    }

    const connected = await this.dependencies.oauth.exchangeAuthorizationCode(code);
    await this.dependencies.repository.upsertConnection({
      instagramUserId: connected.instagramUserId,
      username: connected.username,
      accountType: null,
      accessTokenCiphertext: this.dependencies.encryptToken(connected.accessToken),
      requiredScopes: connected.scopes,
      tokenIssuedAt: connected.issuedAt,
      tokenExpiresAt: connected.expiresAt,
      connectedByEmail: adminEmail,
    });
    return {
      connected: true,
      username: connected.username,
      connectedAt: connected.issuedAt,
      tokenExpiresAt: connected.expiresAt,
      lastRefreshedAt: null,
      needsReconnect: false,
    };
  }

  async getPublicStatus(): Promise<InstagramConnectionStatus> {
    const connection = await this.dependencies.repository.getConnection();
    if (!connection) {
      return {
        connected: false,
        reason: "not_connected",
        needsReconnect: false,
      };
    }
    const expiry = new Date(connection.tokenExpiresAt).getTime();
    if (!Number.isFinite(expiry) || expiry <= this.dependencies.now().getTime()) {
      return {
        connected: false,
        username: connection.username,
        reason: "expired",
        needsReconnect: true,
      };
    }
    return {
      connected: true,
      username: connection.username,
      connectedAt: connection.connectedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastRefreshedAt: connection.lastRefreshedAt,
      needsReconnect: false,
    };
  }

  async disconnect(): Promise<void> {
    await this.dependencies.repository.disconnect();
  }

  async refreshIfDue(): Promise<boolean> {
    const claimToken = this.dependencies.createClaimToken();
    const claimed = await this.dependencies.repository.claimRefresh(
      claimToken,
      REFRESH_CLAIM_TTL_SECONDS
    );
    if (!claimed) return false;

    try {
      const currentToken = this.dependencies.decryptToken(
        claimed.accessTokenCiphertext
      );
      const refreshed = await this.dependencies.oauth.refreshLongLivedToken(
        currentToken
      );
      const completed = await this.dependencies.repository.completeRefresh({
        claimToken,
        accessTokenCiphertext: this.dependencies.encryptToken(
          refreshed.accessToken
        ),
        tokenIssuedAt: refreshed.issuedAt,
        tokenExpiresAt: refreshed.expiresAt,
      });
      if (!completed) {
        throw new InstagramConnectionError(
          "INSTAGRAM_REFRESH_LEASE_LOST",
          "Instagram refresh lease expired before completion",
          true
        );
      }
      return true;
    } catch (error) {
      try {
        await this.dependencies.repository.releaseRefresh({
          claimToken,
          errorCode: "INSTAGRAM_REFRESH_FAILED",
          errorMessage: "Instagram credential refresh failed",
        });
      } catch {
        // The original refresh error remains authoritative. The lease expires
        // automatically if the database cannot record this failure.
      }
      throw error;
    }
  }

  async getPublishingCredentials(): Promise<InstagramPublishingCredentials> {
    try {
      await this.refreshIfDue();
    } catch {
      // A still-valid long-lived token remains usable when a proactive refresh
      // has a transient failure. The failure is recorded for admin visibility.
    }
    const connection = await this.dependencies.repository.getConnection();
    if (!connection) {
      throw new InstagramConnectionError(
        "INSTAGRAM_NOT_CONNECTED",
        "Instagram is not connected",
        false
      );
    }
    const expiry = new Date(connection.tokenExpiresAt).getTime();
    if (!Number.isFinite(expiry) || expiry <= this.dependencies.now().getTime()) {
      throw new InstagramConnectionError(
        "INSTAGRAM_CONNECTION_EXPIRED",
        "Instagram must be reconnected",
        false
      );
    }
    return {
      userId: connection.instagramUserId,
      username: connection.username,
      accessToken: this.dependencies.decryptToken(
        connection.accessTokenCiphertext
      ),
    };
  }
}

export function createInstagramConnectionService(): InstagramConnectionService {
  return new InstagramConnectionService();
}
