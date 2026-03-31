/**
 * OPS Web — Unified Analytics Types
 *
 * Mirrors the analytics_events Supabase table schema.
 * Shared across analytics-service.ts, analytics-actions.ts, and useScreenView.ts.
 */

// ─── Event Types ─────────────────────────────────────────────────────────────

export type AnalyticsEventType =
  | "screen_view"
  | "action"
  | "feature_use"
  | "lifecycle"
  | "error";

// ─── Analytics Event (matches analytics_events table columns) ────────────────

export interface AnalyticsEvent {
  // Identity (auto-attached by AnalyticsService)
  user_id: string | null;
  company_id: string | null;
  role: string | null;
  plan: string | null;
  // Event
  event_type: AnalyticsEventType;
  event_name: string;
  // Context
  platform: "web";
  app_version: string | null;
  device_type: string | null;
  os_version: string | null;
  // Session
  session_id: string;
  // Data
  properties: Record<string, unknown>;
  duration_ms: number | null;
  // Timestamp
  created_at: string;
}

// ─── Identity (cached from auth store) ───────────────────────────────────────

export interface AnalyticsIdentity {
  userId: string | null;
  companyId: string | null;
  role: string | null;
  plan: string | null;
}
