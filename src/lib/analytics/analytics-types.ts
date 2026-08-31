export type AnalyticsEventType =
  | "screen_view"
  | "action"
  | "feature_use"
  | "lifecycle"
  | "error";

export type AnalyticsEnvironment =
  | "production"
  | "preview"
  | "development"
  | "test";

export type AnalyticsPropertyValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;

/** Browser-authored fields. Identity and platform are deliberately absent. */
export interface AnalyticsClientEvent {
  id: string;
  event_type: AnalyticsEventType;
  event_name: string;
  app_version: string | null;
  device_type: string | null;
  os_version: string | null;
  session_id: string;
  properties: Record<string, AnalyticsPropertyValue>;
  duration_ms: number | null;
  schema_version: number;
  environment: AnalyticsEnvironment;
  created_at: string;
}

export interface AnalyticsStoredEvent extends AnalyticsClientEvent {
  user_id: string;
  company_id: string | null;
  role: string | null;
  plan: string | null;
  platform: "web";
}
