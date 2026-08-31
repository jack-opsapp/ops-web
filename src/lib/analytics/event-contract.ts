import type {
  AnalyticsEnvironment,
  AnalyticsEventType,
} from "./analytics-types";

export const ANALYTICS_SCHEMA_VERSION = 1 as const;
export const ANALYTICS_BATCH_SIZE = 50;
export const ANALYTICS_QUEUE_CAP = 1_000;
export const ANALYTICS_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const ANALYTICS_MAX_PAYLOAD_BYTES = 256 * 1_024;
export const ANALYTICS_KEEPALIVE_MAX_PAYLOAD_BYTES = 60 * 1_024;
export const ANALYTICS_MAX_PROPERTIES_BYTES = 16 * 1_024;
export const ANALYTICS_MAX_PROPERTY_COUNT = 25;
export const ANALYTICS_MAX_PROPERTY_STRING_LENGTH = 256;
export const ANALYTICS_MAX_PROPERTY_ARRAY_LENGTH = 25;
export const ANALYTICS_MAX_EVENT_NAME_LENGTH = 80;
export const ANALYTICS_MAX_CONTEXT_LENGTH = 128;
export const ANALYTICS_MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
export const ANALYTICS_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export const ANALYTICS_EVENT_TYPES = new Set<AnalyticsEventType>([
  "screen_view",
  "action",
  "feature_use",
  "lifecycle",
  "error",
]);

export const ANALYTICS_ENVIRONMENTS = new Set<AnalyticsEnvironment>([
  "production",
  "preview",
  "development",
  "test",
]);

export const ANALYTICS_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ANALYTICS_PROPERTY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function analyticsUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
