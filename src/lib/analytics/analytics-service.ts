/**
 * OPS Web — Unified Analytics Service
 *
 * CLIENT SIDE ONLY (browser). Singleton that buffers analytics events in memory
 * and flushes them to Supabase via a server action every 5 seconds.
 *
 * Identity (user_id, company_id, role, plan) is set externally by calling
 * setIdentity() — typically from the auth store after login.
 *
 * Session ID is generated once per browser session (stored in sessionStorage).
 *
 * Usage:
 *   import { analyticsService } from "@/lib/analytics/analytics-service";
 *   analyticsService.track("action", "task_created", { task_type: "maintenance" });
 */
import type {
  AnalyticsEvent,
  AnalyticsEventType,
  AnalyticsIdentity,
} from "./analytics-types";
import { flushAnalyticsEvents } from "./analytics-actions";

// ─── Constants ───────────────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 50;
const SESSION_KEY = "ops_analytics_session_id";

// ─── Singleton ───────────────────────────────────────────────────────────────

class AnalyticsService {
  private buffer: AnalyticsEvent[] = [];
  private identity: AnalyticsIdentity = {
    userId: null,
    companyId: null,
    role: null,
    plan: null,
  };
  private sessionId: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();
    this.startFlushTimer();
    this.registerBeforeUnload();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Set the identity context. Call this after login and whenever
   * role/plan changes. Call with nulls on logout.
   */
  setIdentity(identity: AnalyticsIdentity): void {
    this.identity = identity;
  }

  /**
   * Clear identity (on logout).
   */
  clearIdentity(): void {
    this.identity = {
      userId: null,
      companyId: null,
      role: null,
      plan: null,
    };
  }

  /**
   * Track an analytics event. The event is buffered and flushed
   * asynchronously every 5 seconds (or on page unload).
   */
  track(
    eventType: AnalyticsEventType,
    eventName: string,
    properties: Record<string, unknown> = {},
    durationMs: number | null = null
  ): void {
    if (typeof window === "undefined") return;

    const event: AnalyticsEvent = {
      // Identity
      user_id: this.identity.userId,
      company_id: this.identity.companyId,
      role: this.identity.role,
      plan: this.identity.plan,
      // Event
      event_type: eventType,
      event_name: eventName,
      // Context
      platform: "web",
      app_version: null,
      device_type: this.getDeviceType(),
      os_version: this.getOsVersion(),
      // Session
      session_id: this.sessionId,
      // Data
      properties,
      duration_ms: durationMs,
      // Timestamp
      created_at: new Date().toISOString(),
    };

    this.buffer.push(event);
  }

  /**
   * Force an immediate flush (used by useScreenView on unmount
   * and by beforeunload). Returns only after the flush completes
   * or fails.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing) return;

    this.isFlushing = true;
    try {
      // Drain in batches of 50
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, MAX_BATCH_SIZE);
        const result = await flushAnalyticsEvents(batch);

        if (!result.success) {
          // Re-queue failed events at the front so they retry next flush
          this.buffer.unshift(...batch);
          break;
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private getOrCreateSessionId(): string {
    if (typeof window === "undefined") return crypto.randomUUID();

    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    return sessionId;
  }

  private startFlushTimer(): void {
    if (typeof window === "undefined") return;
    this.flushTimer = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private registerBeforeUnload(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("beforeunload", () => {
      // Use sendBeacon for reliable delivery on page close.
      // Fall back to synchronous flush if no events buffered.
      if (this.buffer.length === 0) return;

      // We can't call the server action in beforeunload (async),
      // so we do a best-effort navigator.sendBeacon to an API route.
      const payload = JSON.stringify(this.buffer.splice(0, MAX_BATCH_SIZE));
      navigator.sendBeacon("/api/analytics/flush", payload);
    });
  }

  private getDeviceType(): string {
    if (typeof navigator === "undefined") return "unknown";
    return /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)
      ? "mobile"
      : "desktop";
  }

  private getOsVersion(): string {
    if (typeof navigator === "undefined") return "unknown";
    const ua = navigator.userAgent;
    // Extract OS from UA string
    const match =
      ua.match(/\(([^)]+)\)/) ?? [];
    return match[1]?.split(";")[0]?.trim() ?? "unknown";
  }
}

// ─── Export Singleton ────────────────────────────────────────────────────────

export const analyticsService =
  typeof window !== "undefined" ? new AnalyticsService() : (null as unknown as AnalyticsService);
