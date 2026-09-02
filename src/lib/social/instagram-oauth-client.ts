import "server-only";

import { getAppUrl } from "@/lib/utils/app-url";

export const INSTAGRAM_REQUIRED_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
] as const;

type InstagramRequiredScope = (typeof INSTAGRAM_REQUIRED_SCOPES)[number];

interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  apiVersion: string;
  authorizationOrigin?: string;
  tokenOrigin?: string;
  graphOrigin?: string;
}

interface InstagramOAuthDependencies {
  fetcher: typeof fetch;
  now: () => Date;
  requestTimeoutMs: number;
}

export interface InstagramOAuthConnectionResult {
  accessToken: string;
  instagramUserId: string;
  username: string;
  scopes: InstagramRequiredScope[];
  issuedAt: string;
  expiresAt: string;
}

export interface InstagramOAuthRefreshResult {
  accessToken: string;
  issuedAt: string;
  expiresAt: string;
}

export class InstagramOAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "InstagramOAuthError";
  }
}

const defaults: InstagramOAuthDependencies = {
  fetcher: fetch,
  now: () => new Date(),
  requestTimeoutMs: 12_000,
};

function safeOrigin(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InstagramOAuthError(
      "INSTAGRAM_OAUTH_NOT_CONFIGURED",
      `${label} must be a valid HTTPS origin`,
      false
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new InstagramOAuthError(
      "INSTAGRAM_OAUTH_NOT_CONFIGURED",
      `${label} must be a valid HTTPS origin`,
      false
    );
  }
  return url.origin;
}

function validatedConfig(config: InstagramOAuthConfig) {
  const missing = [
    ["INSTAGRAM_APP_ID", config.appId],
    ["INSTAGRAM_APP_SECRET", config.appSecret],
    ["Instagram OAuth redirect URI", config.redirectUri],
    ["INSTAGRAM_API_VERSION", config.apiVersion],
  ].filter(([, value]) => !value?.trim());
  if (missing.length > 0) {
    throw new InstagramOAuthError(
      "INSTAGRAM_OAUTH_NOT_CONFIGURED",
      `Missing ${missing.map(([name]) => name).join(", ")}`,
      false
    );
  }

  let redirect: URL;
  try {
    redirect = new URL(config.redirectUri);
  } catch {
    throw new InstagramOAuthError(
      "INSTAGRAM_OAUTH_NOT_CONFIGURED",
      "Instagram OAuth redirect URI is invalid",
      false
    );
  }
  if (!['https:', 'http:'].includes(redirect.protocol) || redirect.username || redirect.password) {
    throw new InstagramOAuthError(
      "INSTAGRAM_OAUTH_NOT_CONFIGURED",
      "Instagram OAuth redirect URI is invalid",
      false
    );
  }

  return {
    appId: config.appId.trim(),
    appSecret: config.appSecret.trim(),
    redirectUri: redirect.toString(),
    apiVersion: config.apiVersion.trim().replace(/^\/+|\/+$/g, ""),
    authorizationOrigin: safeOrigin(
      config.authorizationOrigin ?? "https://www.instagram.com",
      "Instagram authorization origin"
    ),
    tokenOrigin: safeOrigin(
      config.tokenOrigin ?? "https://api.instagram.com",
      "Instagram token origin"
    ),
    graphOrigin: safeOrigin(
      config.graphOrigin ?? "https://graph.instagram.com",
      "Instagram Graph origin"
    ),
  };
}

function tokenLifetime(payload: unknown): { accessToken: string; expiresIn: number } {
  if (!payload || typeof payload !== "object") {
    throw new InstagramOAuthError(
      "INSTAGRAM_OAUTH_RESPONSE_INVALID",
      "Meta returned an invalid long-lived token response",
      true
    );
  }
  const token = (payload as { access_token?: unknown }).access_token;
  const expiresIn = Number((payload as { expires_in?: unknown }).expires_in);
  if (
    typeof token !== "string" ||
    !token.trim() ||
    !Number.isFinite(expiresIn) ||
    expiresIn < 60
  ) {
    throw new InstagramOAuthError(
      "INSTAGRAM_OAUTH_RESPONSE_INVALID",
      "Meta returned an invalid long-lived token response",
      true
    );
  }
  return { accessToken: token.trim(), expiresIn };
}

export class InstagramOAuthClient {
  private readonly config: ReturnType<typeof validatedConfig>;
  private readonly dependencies: InstagramOAuthDependencies;

  constructor(
    config: InstagramOAuthConfig,
    dependencies: Partial<InstagramOAuthDependencies> = {}
  ) {
    this.config = validatedConfig(config);
    this.dependencies = { ...defaults, ...dependencies };
  }

  authorizationUrl(state: string): URL {
    if (!state || state.length > 512) {
      throw new InstagramOAuthError(
        "INSTAGRAM_OAUTH_STATE_INVALID",
        "Instagram OAuth state is invalid",
        false
      );
    }
    const url = new URL("/oauth/authorize", this.config.authorizationOrigin);
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", INSTAGRAM_REQUIRED_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url;
  }

  private async requestJson(
    url: URL,
    init: RequestInit,
    _secrets: string[]
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.dependencies.fetcher(url, {
        ...init,
        headers: { Accept: "application/json", ...init.headers },
        signal: AbortSignal.timeout(this.dependencies.requestTimeoutMs),
      });
    } catch {
      throw new InstagramOAuthError(
        "INSTAGRAM_OAUTH_UNREACHABLE",
        "Meta could not be reached",
        true
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InstagramOAuthError(
        "INSTAGRAM_OAUTH_RESPONSE_INVALID",
        `Meta returned an invalid response (HTTP ${response.status})`,
        response.status === 429 || response.status >= 500,
        response.status
      );
    }
    if (!response.ok || (payload && typeof payload === "object" && "error" in payload)) {
      throw new InstagramOAuthError(
        "INSTAGRAM_OAUTH_REJECTED",
        `Meta rejected the Instagram connection request (HTTP ${response.status})`,
        response.status === 429 || response.status >= 500,
        response.status
      );
    }
    return payload;
  }

  async exchangeAuthorizationCode(code: string): Promise<InstagramOAuthConnectionResult> {
    const normalizedCode = code.trim();
    if (!normalizedCode || normalizedCode.length > 2048) {
      throw new InstagramOAuthError(
        "INSTAGRAM_OAUTH_CODE_INVALID",
        "Instagram authorization code is invalid",
        false
      );
    }

    const form = new FormData();
    form.set("client_id", this.config.appId);
    form.set("client_secret", this.config.appSecret);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", this.config.redirectUri);
    form.set("code", normalizedCode);
    const shortPayload = await this.requestJson(
      new URL("/oauth/access_token", this.config.tokenOrigin),
      { method: "POST", body: form },
      [normalizedCode]
    );
    const shortRow =
      shortPayload &&
      typeof shortPayload === "object" &&
      Array.isArray((shortPayload as { data?: unknown }).data)
        ? (shortPayload as { data: unknown[] }).data[0]
        : null;
    if (!shortRow || typeof shortRow !== "object") {
      throw new InstagramOAuthError(
        "INSTAGRAM_OAUTH_RESPONSE_INVALID",
        "Meta returned an invalid short-lived token response",
        true
      );
    }
    const shortToken = (shortRow as { access_token?: unknown }).access_token;
    const rawPermissions = (shortRow as { permissions?: unknown }).permissions;
    const permissions = Array.isArray(rawPermissions)
      ? rawPermissions.filter((value): value is string => typeof value === "string")
      : typeof rawPermissions === "string"
        ? rawPermissions.split(",").map((value) => value.trim()).filter(Boolean)
        : [];
    if (typeof shortToken !== "string" || !shortToken.trim()) {
      throw new InstagramOAuthError(
        "INSTAGRAM_OAUTH_RESPONSE_INVALID",
        "Meta returned an invalid short-lived token response",
        true
      );
    }
    const missingScope = INSTAGRAM_REQUIRED_SCOPES.find(
      (scope) => !permissions.includes(scope)
    );
    if (missingScope) {
      throw new InstagramOAuthError(
        "INSTAGRAM_SCOPE_MISSING",
        "Instagram publishing permission was not granted",
        false
      );
    }

    const longUrl = new URL("/access_token", this.config.graphOrigin);
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", this.config.appSecret);
    longUrl.searchParams.set("access_token", shortToken.trim());
    const longPayload = await this.requestJson(longUrl, { method: "GET" }, [shortToken.trim()]);
    const longToken = tokenLifetime(longPayload);

    const profileUrl = new URL(
      `/${this.config.apiVersion}/me`,
      this.config.graphOrigin
    );
    profileUrl.searchParams.set("fields", "user_id,username");
    profileUrl.searchParams.set("access_token", longToken.accessToken);
    const profilePayload = await this.requestJson(
      profileUrl,
      { method: "GET" },
      [shortToken.trim(), longToken.accessToken]
    );
    const profileRow =
      profilePayload &&
      typeof profilePayload === "object" &&
      Array.isArray((profilePayload as { data?: unknown }).data)
        ? (profilePayload as { data: unknown[] }).data[0]
        : null;
    const userId =
      profileRow && typeof profileRow === "object"
        ? (profileRow as { user_id?: unknown }).user_id
        : null;
    const username =
      profileRow && typeof profileRow === "object"
        ? (profileRow as { username?: unknown }).username
        : null;
    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      typeof username !== "string" ||
      !username.trim()
    ) {
      throw new InstagramOAuthError(
        "INSTAGRAM_PROFILE_INVALID",
        "Meta did not return a valid Instagram professional account",
        false
      );
    }

    const issuedAt = this.dependencies.now();
    return {
      accessToken: longToken.accessToken,
      instagramUserId: userId.trim(),
      username: username.trim(),
      scopes: [...INSTAGRAM_REQUIRED_SCOPES],
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(
        issuedAt.getTime() + longToken.expiresIn * 1000
      ).toISOString(),
    };
  }

  async refreshLongLivedToken(accessToken: string): Promise<InstagramOAuthRefreshResult> {
    const normalizedToken = accessToken.trim();
    if (!normalizedToken) {
      throw new InstagramOAuthError(
        "INSTAGRAM_TOKEN_INVALID",
        "Instagram access token is empty",
        false
      );
    }
    const url = new URL("/refresh_access_token", this.config.graphOrigin);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", normalizedToken);
    const payload = await this.requestJson(url, { method: "GET" }, [normalizedToken]);
    const refreshed = tokenLifetime(payload);
    const issuedAt = this.dependencies.now();
    return {
      accessToken: refreshed.accessToken,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(
        issuedAt.getTime() + refreshed.expiresIn * 1000
      ).toISOString(),
    };
  }
}

export function createInstagramOAuthClientFromEnv(): InstagramOAuthClient {
  return new InstagramOAuthClient({
    appId: process.env.INSTAGRAM_APP_ID ?? "",
    appSecret: process.env.INSTAGRAM_APP_SECRET ?? "",
    redirectUri: `${getAppUrl()}/api/admin/social/instagram/callback`,
    apiVersion: process.env.INSTAGRAM_API_VERSION?.trim() || "v25.0",
    authorizationOrigin: process.env.INSTAGRAM_AUTHORIZATION_ORIGIN,
    tokenOrigin: process.env.INSTAGRAM_TOKEN_ORIGIN,
    graphOrigin: process.env.INSTAGRAM_GRAPH_ORIGIN,
  });
}
