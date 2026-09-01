/** Durable, authenticated browser analytics queue. */
import type {
  AnalyticsClientEvent,
  AnalyticsEnvironment,
  AnalyticsEventType,
} from "./analytics-types";
import {
  analyticsUtf8ByteLength,
  ANALYTICS_BATCH_SIZE,
  ANALYTICS_KEEPALIVE_MAX_PAYLOAD_BYTES,
  ANALYTICS_MAX_PAYLOAD_BYTES,
  ANALYTICS_QUEUE_CAP,
  ANALYTICS_SCHEMA_VERSION,
} from "./event-contract";
import {
  isAnalyticsUuid,
  sanitizeAnalyticsProperties,
  sanitizeClientAnalyticsEvent,
} from "./event-sanitizer";

const FLUSH_INTERVAL_MS = 5_000;
const SESSION_KEY = "ops_analytics_session_id";
export const ANALYTICS_QUEUE_STORAGE_KEY = "ops_analytics_queue_v1";

interface FlushResponse {
  success: boolean;
  acceptedIds?: string[];
  rejectedIds?: string[];
}

interface AnalyticsServiceOptions {
  autoStart?: boolean;
  now?: () => number;
  randomUUID?: () => string;
  getIdToken?: (forceRefresh?: boolean) => Promise<string | null>;
  fetch?: typeof fetch;
  storage?: Storage | null;
  sessionStorage?: Storage | null;
  environment?: AnalyticsEnvironment;
}

function availableStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window[kind];
  } catch {
    return null;
  }
}

function resolveEnvironment(): AnalyticsEnvironment {
  if (process.env.NODE_ENV === "test") return "test";
  if (typeof window === "undefined") return "development";
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "development";
  }
  if (hostname.endsWith(".vercel.app")) return "preview";
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export class AnalyticsService {
  private queue: AnalyticsClientEvent[] = [];
  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly randomUUID: () => string;
  private readonly tokenProvider: (forceRefresh?: boolean) => Promise<string | null>;
  private readonly fetcher: typeof fetch;
  private readonly storage: Storage | null;
  private readonly environment: AnalyticsEnvironment;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor(options: AnalyticsServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.tokenProvider =
      options.getIdToken ??
      (async (forceRefresh) => {
        const { getIdToken } = await import("@/lib/firebase/auth");
        return getIdToken(forceRefresh);
      });
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.storage = options.storage === undefined
      ? availableStorage("localStorage")
      : options.storage;
    this.environment = options.environment ?? resolveEnvironment();
    const sessionStore = options.sessionStorage === undefined
      ? availableStorage("sessionStorage")
      : options.sessionStorage;
    this.sessionId = this.getOrCreateSessionId(sessionStore);
    this.queue = this.loadQueue();
    this.persistQueue();

    if (options.autoStart !== false && typeof window !== "undefined") {
      this.start();
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  track(
    eventType: AnalyticsEventType,
    eventName: string,
    properties: Record<string, unknown> = {},
    durationMs: number | null = null
  ): void {
    if (typeof window === "undefined") return;
    if (this.environment === "test" || this.environment === "development") return;

    const event = sanitizeClientAnalyticsEvent(
      {
        id: this.randomUUID(),
        event_type: eventType,
        event_name: eventName,
        app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
        device_type: this.getDeviceType(),
        os_version: this.getOsVersion(),
        session_id: this.sessionId,
        properties: sanitizeAnalyticsProperties(properties),
        duration_ms: durationMs,
        schema_version: ANALYTICS_SCHEMA_VERSION,
        environment: this.environment,
        created_at: new Date(this.now()).toISOString(),
      },
      this.now()
    );
    if (!event) return;

    this.queue.push(event);
    if (this.queue.length > ANALYTICS_QUEUE_CAP) {
      this.queue.splice(0, this.queue.length - ANALYTICS_QUEUE_CAP);
    }
    this.persistQueue();
  }

  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.queue.length === 0 || this.isFlushing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    this.isFlushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.nextBatch(options.keepalive === true);
        let token = await this.tokenProvider(false);
        if (!token) return;

        let response = await this.send(batch, token, options.keepalive === true);
        if (response.status === 401) {
          token = await this.tokenProvider(true);
          if (!token) return;
          response = await this.send(batch, token, options.keepalive === true);
        }

        let result: FlushResponse | null = null;
        try {
          result = (await response.json()) as FlushResponse;
        } catch {
          result = null;
        }
        const completed = new Set([
          ...(result?.acceptedIds ?? []),
          ...(result?.rejectedIds ?? []),
        ]);
        if (completed.size > 0) {
          this.queue = this.queue.filter((event) => !completed.has(event.id));
          this.persistQueue();
        }
        if (!response.ok || completed.size === 0) return;
      }
    } catch {
      // Network failure: the durable queue remains intact for the next attempt.
    } finally {
      this.isFlushing = false;
    }
  }

  private start(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("pagehide", this.handlePageHide);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  destroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("pagehide", this.handlePageHide);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private readonly handleOnline = () => {
    void this.flush();
  };

  private readonly handlePageHide = () => {
    void this.flush({ keepalive: true });
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      void this.flush({ keepalive: true });
    }
  };

  private async send(
    batch: AnalyticsClientEvent[],
    token: string,
    keepalive: boolean
  ): Promise<Response> {
    return this.fetcher("/api/analytics/flush", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
      keepalive,
    });
  }

  private nextBatch(keepalive: boolean): AnalyticsClientEvent[] {
    const byteLimit = keepalive
      ? ANALYTICS_KEEPALIVE_MAX_PAYLOAD_BYTES
      : ANALYTICS_MAX_PAYLOAD_BYTES;
    const batch: AnalyticsClientEvent[] = [];

    for (const event of this.queue.slice(0, ANALYTICS_BATCH_SIZE)) {
      const candidate = [...batch, event];
      if (analyticsUtf8ByteLength(JSON.stringify(candidate)) > byteLimit) break;
      batch.push(event);
    }

    // Each event is independently bounded well below either request limit.
    return batch.length > 0 ? batch : this.queue.slice(0, 1);
  }

  private loadQueue(): AnalyticsClientEvent[] {
    if (!this.storage) return [];
    try {
      const parsed = JSON.parse(
        this.storage.getItem(ANALYTICS_QUEUE_STORAGE_KEY) ?? "[]"
      );
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((event) => sanitizeClientAnalyticsEvent(event, this.now()))
        .filter((event): event is AnalyticsClientEvent => event !== null)
        .slice(-ANALYTICS_QUEUE_CAP);
    } catch {
      return [];
    }
  }

  private persistQueue(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(ANALYTICS_QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // Storage denial must not affect product behavior.
    }
  }

  private getOrCreateSessionId(storage: Storage | null): string {
    if (!storage) return this.randomUUID();
    try {
      const existing = storage.getItem(SESSION_KEY);
      if (isAnalyticsUuid(existing)) return existing;
      const created = this.randomUUID();
      storage.setItem(SESSION_KEY, created);
      return created;
    } catch {
      return this.randomUUID();
    }
  }

  private getDeviceType(): string {
    if (typeof navigator === "undefined") return "unknown";
    return /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)
      ? "mobile"
      : "desktop";
  }

  private getOsVersion(): string {
    if (typeof navigator === "undefined") return "unknown";
    const match = navigator.userAgent.match(/\(([^)]+)\)/);
    return match?.[1]?.split(";")[0]?.trim() ?? "unknown";
  }
}

export const analyticsService: AnalyticsService =
  typeof window !== "undefined"
    ? new AnalyticsService()
    : (null as unknown as AnalyticsService);
