import "server-only";

import type { RenderedSocialAsset, SocialPostFormat } from "./types";
import { InstagramGraphError } from "./instagram-errors";

interface InstagramClientConfig {
  origin: string;
  apiVersion: string;
  userId: string;
  accessToken: string;
}

interface InstagramClientDependencies {
  fetcher: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  maxPollAttempts: number;
  pollDelayMs: number;
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
}

export interface InstagramPublishingQuota {
  used: number;
  total: number;
  durationSeconds: number;
}

export interface InstagramPublishResult {
  mediaId: string;
  permalink: string | null;
  quota: InstagramPublishingQuota;
}

const defaultDependencies: InstagramClientDependencies = {
  fetcher: fetch,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxPollAttempts: 30,
  pollDelayMs: 2_000,
};

function sanitizedMessage(raw: string | undefined, token: string): string {
  const message = raw?.trim() || "Instagram Graph API request failed";
  return message.split(token).join("[redacted]");
}

function validateConfig(config: InstagramClientConfig): InstagramClientConfig {
  const missing = [
    ["INSTAGRAM_ACCESS_TOKEN", config.accessToken],
    ["INSTAGRAM_USER_ID", config.userId],
    ["INSTAGRAM_API_VERSION", config.apiVersion],
  ].filter(([, value]) => !value?.trim());
  if (missing.length > 0) {
    throw new InstagramGraphError(
      "INSTAGRAM_NOT_CONFIGURED",
      `Missing ${missing.map(([name]) => name).join(", ")}`,
      false
    );
  }

  let origin: URL;
  try {
    origin = new URL(config.origin);
  } catch {
    throw new InstagramGraphError("INSTAGRAM_NOT_CONFIGURED", "Invalid INSTAGRAM_API_ORIGIN", false);
  }
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new InstagramGraphError(
      "INSTAGRAM_NOT_CONFIGURED",
      "INSTAGRAM_API_ORIGIN must be a public HTTPS origin",
      false
    );
  }

  return {
    ...config,
    origin: origin.origin,
    apiVersion: config.apiVersion.replace(/^\/+|\/+$/g, ""),
    userId: config.userId.trim(),
    accessToken: config.accessToken.trim(),
  };
}

function validatePublishInput({
  format,
  assets,
  caption,
}: {
  format: SocialPostFormat;
  assets: RenderedSocialAsset[];
  caption: string;
}): void {
  const expectedCount = format === "single" ? assets.length === 1 : assets.length >= 2 && assets.length <= 10;
  const mediaValid = assets.every((asset, index) => {
    try {
      const url = new URL(asset.url);
      return (
        asset.order === index + 1 &&
        asset.content_type === "image/jpeg" &&
        asset.width === 1080 &&
        asset.height === 1350 &&
        url.protocol === "https:"
      );
    } catch {
      return false;
    }
  });

  if (!expectedCount || !mediaValid || caption.trim().length < 1 || caption.length > 2200) {
    throw new InstagramGraphError(
      "INVALID_MEDIA",
      "Instagram package must contain ordered public 1080 × 1350 JPEG assets and a valid caption",
      false
    );
  }
}

export class InstagramGraphClient {
  private readonly config: InstagramClientConfig;
  private readonly dependencies: InstagramClientDependencies;

  constructor(
    config: InstagramClientConfig,
    dependencies: Partial<InstagramClientDependencies> = {}
  ) {
    this.config = validateConfig(config);
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  private url(path: string, query?: Record<string, string>): URL {
    const url = new URL(
      `${this.config.origin}/${this.config.apiVersion}/${path.replace(/^\/+/, "")}`
    );
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return url;
  }

  private async request<T>({
    path,
    method = "GET",
    query,
    body,
  }: {
    path: string;
    method?: "GET" | "POST";
    query?: Record<string, string>;
    body?: Record<string, string>;
  }): Promise<T> {
    const url = this.url(path, query);
    const form = method === "POST" ? new URLSearchParams(body) : undefined;
    if (form) form.set("access_token", this.config.accessToken);

    let response: Response;
    try {
      response = await this.dependencies.fetcher(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: form,
      });
    } catch {
      throw new InstagramGraphError(
        "INSTAGRAM_UNREACHABLE",
        "Instagram Graph API could not be reached",
        true
      );
    }

    let payload: (T & GraphErrorBody) | GraphErrorBody;
    try {
      payload = (await response.json()) as T & GraphErrorBody;
    } catch {
      throw new InstagramGraphError(
        "INVALID_GRAPH_RESPONSE",
        `Instagram returned an invalid response (HTTP ${response.status})`,
        response.status === 429 || response.status >= 500,
        undefined,
        undefined,
        response.status
      );
    }

    if (!response.ok || payload.error) {
      const graph = payload.error;
      const retryable =
        response.status === 429 || response.status >= 500 || graph?.is_transient === true;
      throw new InstagramGraphError(
        "INSTAGRAM_GRAPH_ERROR",
        sanitizedMessage(graph?.message, this.config.accessToken),
        retryable,
        graph?.code,
        graph?.error_subcode,
        response.status
      );
    }

    return payload as T;
  }

  async getPublishingQuota(): Promise<InstagramPublishingQuota> {
    const payload = await this.request<{
      data?: Array<{
        quota_usage?: number;
        config?: { quota_total?: number; quota_duration?: number };
      }>;
    }>({
      path: `${this.config.userId}/content_publishing_limit`,
      query: { fields: "quota_usage,config" },
    });
    const row = payload.data?.[0];
    const used = Number(row?.quota_usage);
    const total = Number(row?.config?.quota_total);
    const durationSeconds = Number(row?.config?.quota_duration);
    if (![used, total, durationSeconds].every(Number.isFinite) || total < 1) {
      throw new InstagramGraphError(
        "INVALID_QUOTA_RESPONSE",
        "Instagram publishing quota could not be verified",
        true
      );
    }
    return { used, total, durationSeconds };
  }

  private async createImageContainer(
    asset: RenderedSocialAsset,
    options: { carouselItem: boolean; caption?: string }
  ): Promise<string> {
    const payload = await this.request<{ id?: string }>({
      path: `${this.config.userId}/media`,
      method: "POST",
      body: {
        image_url: asset.url,
        ...(options.carouselItem ? { is_carousel_item: "true" } : {}),
        ...(options.caption ? { caption: options.caption } : {}),
      },
    });
    if (!payload.id) {
      throw new InstagramGraphError(
        "INVALID_CONTAINER_RESPONSE",
        "Instagram did not return a media container ID",
        true
      );
    }
    return payload.id;
  }

  private async waitForContainer(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < this.dependencies.maxPollAttempts; attempt += 1) {
      const payload = await this.request<{ status_code?: string }>({
        path: containerId,
        query: { fields: "status_code" },
      });
      if (payload.status_code === "FINISHED") return;
      if (payload.status_code === "ERROR" || payload.status_code === "EXPIRED") {
        throw new InstagramGraphError(
          "CONTAINER_FAILED",
          `Instagram container entered ${payload.status_code.toLowerCase()} state`,
          false
        );
      }
      if (attempt < this.dependencies.maxPollAttempts - 1) {
        await this.dependencies.sleep(this.dependencies.pollDelayMs);
      }
    }
    throw new InstagramGraphError(
      "CONTAINER_TIMEOUT",
      "Instagram container did not finish processing in time",
      true
    );
  }

  private async createCarouselContainer(children: string[], caption: string): Promise<string> {
    const payload = await this.request<{ id?: string }>({
      path: `${this.config.userId}/media`,
      method: "POST",
      body: { media_type: "CAROUSEL", children: children.join(","), caption },
    });
    if (!payload.id) {
      throw new InstagramGraphError(
        "INVALID_CONTAINER_RESPONSE",
        "Instagram did not return a carousel container ID",
        true
      );
    }
    return payload.id;
  }

  private async publishContainer(containerId: string): Promise<string> {
    let payload: { id?: string };
    try {
      payload = await this.request<{ id?: string }>({
        path: `${this.config.userId}/media_publish`,
        method: "POST",
        body: { creation_id: containerId },
      });
    } catch (error) {
      if (
        error instanceof InstagramGraphError &&
        (error.code === "INSTAGRAM_UNREACHABLE" ||
          error.code === "INVALID_GRAPH_RESPONSE" ||
          (error.httpStatus !== undefined && error.httpStatus >= 500))
      ) {
        throw new InstagramGraphError(
          "PUBLISH_OUTCOME_UNKNOWN",
          "Instagram publish response was uncertain; reconcile the account before retrying",
          false,
          error.graphCode,
          error.graphSubcode,
          error.httpStatus
        );
      }
      throw error;
    }
    if (!payload.id) {
      throw new InstagramGraphError(
        "INVALID_PUBLISH_RESPONSE",
        "Instagram did not return a published media ID",
        true
      );
    }
    return payload.id;
  }

  private async readPermalink(mediaId: string): Promise<string | null> {
    try {
      const payload = await this.request<{ permalink?: string }>({
        path: mediaId,
        query: { fields: "id,permalink" },
      });
      return payload.permalink ?? null;
    } catch {
      // Publishing already succeeded. A missing enrichment must never trigger
      // a second media_publish call and duplicate the post.
      return null;
    }
  }

  async publish({
    format,
    assets,
    caption,
  }: {
    format: SocialPostFormat;
    assets: RenderedSocialAsset[];
    caption: string;
  }): Promise<InstagramPublishResult> {
    validatePublishInput({ format, assets, caption });
    const quota = await this.getPublishingQuota();
    if (quota.used >= quota.total) {
      throw new InstagramGraphError(
        "PUBLISHING_QUOTA_EXHAUSTED",
        "Instagram publishing quota is exhausted for the current window",
        true,
        undefined,
        undefined,
        undefined,
        Math.min(quota.durationSeconds * 1000, 60 * 60 * 1000)
      );
    }

    let containerId: string;
    if (format === "single") {
      containerId = await this.createImageContainer(assets[0], {
        carouselItem: false,
        caption,
      });
      await this.waitForContainer(containerId);
    } else {
      const childIds = await Promise.all(
        assets.map((asset) => this.createImageContainer(asset, { carouselItem: true }))
      );
      await Promise.all(childIds.map((childId) => this.waitForContainer(childId)));
      containerId = await this.createCarouselContainer(childIds, caption);
      await this.waitForContainer(containerId);
    }

    const mediaId = await this.publishContainer(containerId);
    const permalink = await this.readPermalink(mediaId);
    return { mediaId, permalink, quota };
  }
}

export function createInstagramClientFromEnv(): InstagramGraphClient {
  return new InstagramGraphClient({
    origin: process.env.INSTAGRAM_API_ORIGIN ?? "https://graph.facebook.com",
    apiVersion: process.env.INSTAGRAM_API_VERSION ?? "",
    userId: process.env.INSTAGRAM_USER_ID ?? "",
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
  });
}
