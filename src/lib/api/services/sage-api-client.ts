import "server-only";

import { SAGE_API_BASE } from "./sage-config";
import type {
  SageIdempotencyKey,
  SageIdempotentResource,
} from "./sage-idempotency";

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface SageApiClientOptions {
  businessId: string;
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
  onDisconnect: () => Promise<void>;
  fetchFn?: FetchFn;
  now?: () => Date;
  baseUrl?: string;
}

export interface SageListOptions {
  updatedOrCreatedSince?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface SageAcceptedWrite<T = unknown> {
  data: T;
  evidence: {
    requestId?: string;
    status: number;
    acceptedAt: string;
  };
}

export interface SageReadClient {
  get<T = unknown>(resource: string, id: string): Promise<T | undefined>;
  list<T extends Record<string, unknown> = Record<string, unknown>>(
    resource: string,
    options?: SageListOptions
  ): Promise<T[]>;
}

export interface SageWriteClient extends SageReadClient {
  create<T = unknown>(
    resource: SageIdempotentResource,
    payload: Record<string, unknown>,
    idempotency: SageIdempotencyKey
  ): Promise<SageAcceptedWrite<T>>;
  update<T = unknown>(
    resource: SageIdempotentResource,
    id: string,
    payload: Record<string, unknown>,
    idempotency: SageIdempotencyKey
  ): Promise<SageAcceptedWrite<T>>;
  voidOrDelete(
    resource: string,
    id: string
  ): Promise<SageAcceptedWrite<undefined>>;
}

export class SageApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retryable = false,
    readonly retryAfterMs?: number,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "SageApiError";
  }
}

const ENVELOPE_BY_RESOURCE: Record<SageIdempotentResource, string> = {
  contacts: "contact",
  contact_payments: "contact_payment",
  purchase_invoices: "purchase_invoice",
  sales_estimates: "sales_estimate",
  sales_invoices: "sales_invoice",
  sales_quotes: "sales_quote",
};

function assertResource(resource: string): string {
  const trimmed = resource.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
    throw new Error("A valid Sage resource is required.");
  }
  return trimmed;
}

function assertId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("A Sage entity id is required.");
  return trimmed;
}

function safeRequestId(response: Response): string | undefined {
  const value = response.headers.get("x-request-id")?.trim();
  if (!value) return undefined;
  const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128);
  return sanitized || undefined;
}

class SageApiClient implements SageWriteClient {
  private readonly businessId: string;
  private readonly fetchFn: FetchFn;
  private readonly now: () => Date;
  private readonly baseUrl: URL;

  constructor(private readonly options: SageApiClientOptions) {
    this.businessId = options.businessId.trim();
    if (!this.businessId) throw new Error("Sage business id is required.");
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.baseUrl = new URL(
      `${(options.baseUrl ?? SAGE_API_BASE).replace(/\/$/, "")}/`
    );
  }

  async get<T = unknown>(resource: string, id: string): Promise<T | undefined> {
    try {
      return await this.requestJson<T>(
        new URL(
          `${assertResource(resource)}/${encodeURIComponent(assertId(id))}`,
          this.baseUrl
        ),
        { method: "GET" }
      );
    } catch (error) {
      if (error instanceof SageApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  async list<T extends Record<string, unknown> = Record<string, unknown>>(
    resource: string,
    options: SageListOptions = {}
  ): Promise<T[]> {
    const normalizedResource = assertResource(resource);
    const first = new URL(normalizedResource, this.baseUrl);
    first.searchParams.set("items_per_page", "200");
    if (options.updatedOrCreatedSince) {
      first.searchParams.set(
        "updated_or_created_since",
        options.updatedOrCreatedSince
      );
    }
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) first.searchParams.set(key, String(value));
    }

    const seenCursors = new Set<string>([first.toString()]);
    const records = new Map<string, T>();
    let cursor = first;
    let page = 1;
    for (let traversed = 0; traversed < 1_000; traversed += 1) {
      const payload = await this.requestJson<unknown>(cursor, {
        method: "GET",
      });
      if (!payload || typeof payload !== "object") {
        throw new SageApiError(
          "Sage list response has an invalid shape",
          "invalid_response"
        );
      }
      const items = (payload as { $items?: unknown }).$items;
      if (!Array.isArray(items)) {
        throw new SageApiError(
          "Sage list response is missing $items",
          "invalid_response"
        );
      }
      for (const item of items) {
        if (!item || typeof item !== "object") {
          throw new SageApiError(
            "Sage list response contains an invalid item",
            "invalid_response"
          );
        }
        const typed = item as T;
        const id =
          typeof typed.id === "string" && typed.id.trim()
            ? `id:${typed.id.trim()}`
            : `json:${JSON.stringify(typed)}`;
        records.set(id, typed);
      }

      const providerNext = (payload as { $next?: unknown }).$next;
      let next: URL | null = null;
      if (typeof providerNext === "string" && providerNext.trim()) {
        next = new URL(providerNext, this.baseUrl);
        if (
          next.origin !== this.baseUrl.origin ||
          !next.pathname.startsWith(this.baseUrl.pathname)
        ) {
          throw new SageApiError(
            "Sage returned an unsafe pagination cursor",
            "invalid_response"
          );
        }
      } else if (items.length === 200) {
        page += 1;
        next = new URL(first);
        next.searchParams.set("page", String(page));
      }
      if (!next) return [...records.values()];
      const key = next.toString();
      if (seenCursors.has(key)) {
        throw new SageApiError(
          "Sage repeated a pagination cursor",
          "repeated_cursor"
        );
      }
      seenCursors.add(key);
      cursor = next;
    }
    throw new SageApiError(
      "Sage pagination exceeded the safety limit",
      "pagination_limit"
    );
  }

  create<T = unknown>(
    resource: SageIdempotentResource,
    payload: Record<string, unknown>,
    idempotency: SageIdempotencyKey
  ): Promise<SageAcceptedWrite<T>> {
    return this.write<T>("POST", resource, undefined, payload, idempotency);
  }

  update<T = unknown>(
    resource: SageIdempotentResource,
    id: string,
    payload: Record<string, unknown>,
    idempotency: SageIdempotencyKey
  ): Promise<SageAcceptedWrite<T>> {
    return this.write<T>("PUT", resource, assertId(id), payload, idempotency);
  }

  async voidOrDelete(
    resource: string,
    id: string
  ): Promise<SageAcceptedWrite<undefined>> {
    const response = await this.request(
      new URL(
        `${assertResource(resource)}/${encodeURIComponent(assertId(id))}`,
        this.baseUrl
      ),
      { method: "DELETE" }
    );
    await this.parseSuccess<undefined>(response);
    return {
      data: undefined,
      evidence: this.acceptedEvidence(response),
    };
  }

  private async write<T>(
    method: "POST" | "PUT",
    resource: SageIdempotentResource,
    id: string | undefined,
    payload: Record<string, unknown>,
    idempotency: SageIdempotencyKey
  ): Promise<SageAcceptedWrite<T>> {
    if (
      idempotency.resource !== resource ||
      !/^[a-f0-9]{32}$/.test(idempotency.id)
    ) {
      throw new Error(
        "Sage idempotency key does not match the write resource."
      );
    }
    const envelope = ENVELOPE_BY_RESOURCE[resource];
    if (!envelope)
      throw new Error(`Unsupported Sage write resource: ${resource}`);
    const suffix = id ? `/${encodeURIComponent(id)}` : "";
    const response = await this.request(
      new URL(`${resource}${suffix}`, this.baseUrl),
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [envelope]: { ...payload, idempotency_id: idempotency.id },
        }),
      }
    );
    return {
      data: (await this.parseSuccess<T>(response)) as T,
      evidence: this.acceptedEvidence(response),
    };
  }

  private acceptedEvidence(response: Response) {
    return {
      requestId: safeRequestId(response),
      status: response.status,
      acceptedAt: this.now().toISOString(),
    };
  }

  private async requestJson<T>(
    url: URL,
    init: RequestInit
  ): Promise<T | undefined> {
    return this.parseSuccess<T>(await this.request(url, init));
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let accessToken = await this.options.getAccessToken();
    let response = await this.fetchWithToken(url, init, accessToken);
    if (response.status === 401) {
      accessToken = await this.options.refreshAccessToken();
      response = await this.fetchWithToken(url, init, accessToken);
      if (response.status === 401) {
        await this.options.onDisconnect();
        throw this.httpError(response, "reconnect_required", false);
      }
    }
    if (response.status === 403) {
      await this.options.onDisconnect();
      throw this.httpError(response, "reconnect_required", false);
    }
    if (response.status === 429) {
      throw this.httpError(
        response,
        "rate_limited",
        true,
        this.retryAfter(response)
      );
    }
    if (
      response.status === 408 ||
      response.status === 425 ||
      response.status >= 500
    ) {
      throw this.httpError(response, "retryable_http", true);
    }
    if (!response.ok) {
      throw this.httpError(response, "validation_failed", false);
    }
    return response;
  }

  private fetchWithToken(
    url: URL,
    init: RequestInit,
    accessToken: string
  ): Promise<Response> {
    if (!accessToken.trim())
      throw new Error("Sage access token is unavailable.");
    return this.fetchFn(url.toString(), {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Business": this.businessId,
        ...init.headers,
      },
    });
  }

  private async parseSuccess<T>(response: Response): Promise<T | undefined> {
    if (response.status === 204) return undefined;
    try {
      return (await response.json()) as T;
    } catch {
      throw new SageApiError(
        "Sage returned invalid JSON",
        "invalid_response",
        response.status,
        false,
        undefined,
        safeRequestId(response)
      );
    }
  }

  private retryAfter(response: Response): number | undefined {
    const value = response.headers.get("retry-after")?.trim();
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    if (!Number.isFinite(date)) return undefined;
    return Math.max(0, date - this.now().getTime());
  }

  private httpError(
    response: Response,
    code: string,
    retryable: boolean,
    retryAfterMs?: number
  ) {
    return new SageApiError(
      `Sage API request failed (HTTP ${response.status})`,
      code,
      response.status,
      retryable,
      retryAfterMs,
      safeRequestId(response)
    );
  }
}

export function createSageReadClient(
  options: SageApiClientOptions
): SageReadClient {
  const client = new SageApiClient(options);
  return { get: client.get.bind(client), list: client.list.bind(client) };
}

export function createSageWriteClient(
  options: SageApiClientOptions
): SageWriteClient {
  return new SageApiClient(options);
}
