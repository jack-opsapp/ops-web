import {
  analyticsUtf8ByteLength,
  ANALYTICS_ENVIRONMENTS,
  ANALYTICS_EVENT_NAME_PATTERN,
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_FUTURE_SKEW_MS,
  ANALYTICS_MAX_CONTEXT_LENGTH,
  ANALYTICS_MAX_DURATION_MS,
  ANALYTICS_MAX_EVENT_NAME_LENGTH,
  ANALYTICS_MAX_PROPERTIES_BYTES,
  ANALYTICS_MAX_PROPERTY_ARRAY_LENGTH,
  ANALYTICS_MAX_PROPERTY_COUNT,
  ANALYTICS_MAX_PROPERTY_STRING_LENGTH,
  ANALYTICS_PROPERTY_KEY_PATTERN,
  ANALYTICS_QUEUE_TTL_MS,
  ANALYTICS_SCHEMA_VERSION,
} from "./event-contract";
import type {
  AnalyticsClientEvent,
  AnalyticsEnvironment,
  AnalyticsEventType,
  AnalyticsPropertyValue,
} from "./analytics-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/i;
const SENSITIVE_PROPERTY_KEY_PATTERN =
  /(^|_)(email|phone|name|first_name|last_name|full_name|address|token|secret|password|message|description|note|title|client_id|customer_id|contact_id|user_id|company_id|project_id|task_id|opportunity_id|invoice_id|estimate_id|file_name)($|_)/i;

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 && /[+() .-]/.test(value);
}

function sanitizeString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    EMAIL_PATTERN.test(trimmed) ||
    URL_PATTERN.test(trimmed) ||
    UUID_ANYWHERE_PATTERN.test(trimmed) ||
    looksLikePhone(trimmed)
  ) {
    return null;
  }
  return trimmed.slice(0, ANALYTICS_MAX_PROPERTY_STRING_LENGTH);
}

function sanitizePrimitive(
  value: unknown
): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return sanitizeString(value) ?? undefined;
  return undefined;
}

export function sanitizeAnalyticsProperties(
  input: unknown
): Record<string, AnalyticsPropertyValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const sanitized: Record<string, AnalyticsPropertyValue> = {};
  for (const [key, rawValue] of Object.entries(input).slice(
    0,
    ANALYTICS_MAX_PROPERTY_COUNT
  )) {
    if (
      key.length > 64 ||
      !ANALYTICS_PROPERTY_KEY_PATTERN.test(key) ||
      SENSITIVE_PROPERTY_KEY_PATTERN.test(key)
    ) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      const values = rawValue
        .slice(0, ANALYTICS_MAX_PROPERTY_ARRAY_LENGTH)
        .map(sanitizePrimitive)
        .filter(
          (value): value is string | number | boolean | null =>
            value !== undefined
        );
      if (values.length > 0) sanitized[key] = values;
      continue;
    }

    const value = sanitizePrimitive(rawValue);
    if (value !== undefined) sanitized[key] = value;
  }
  return sanitized;
}

function optionalBoundedString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length <= ANALYTICS_MAX_CONTEXT_LENGTH ? trimmed || null : undefined;
}

export function isAnalyticsUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function templateAnalyticsPathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  return path
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id"
    )
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

export function sanitizeClientAnalyticsEvent(
  input: unknown,
  nowMs = Date.now()
): AnalyticsClientEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const event = input as Record<string, unknown>;

  if (!isAnalyticsUuid(event.id) || !isAnalyticsUuid(event.session_id)) return null;
  if (
    typeof event.event_type !== "string" ||
    !ANALYTICS_EVENT_TYPES.has(event.event_type as AnalyticsEventType)
  ) {
    return null;
  }
  if (
    typeof event.event_name !== "string" ||
    event.event_name.length > ANALYTICS_MAX_EVENT_NAME_LENGTH ||
    !ANALYTICS_EVENT_NAME_PATTERN.test(event.event_name)
  ) {
    return null;
  }
  if (
    typeof event.environment !== "string" ||
    !ANALYTICS_ENVIRONMENTS.has(event.environment as AnalyticsEnvironment)
  ) {
    return null;
  }
  if (event.schema_version !== ANALYTICS_SCHEMA_VERSION) return null;

  const createdAtMs =
    typeof event.created_at === "string" ? Date.parse(event.created_at) : NaN;
  if (
    !Number.isFinite(createdAtMs) ||
    createdAtMs < nowMs - ANALYTICS_QUEUE_TTL_MS ||
    createdAtMs > nowMs + ANALYTICS_FUTURE_SKEW_MS
  ) {
    return null;
  }

  if (
    event.duration_ms !== null &&
    event.duration_ms !== undefined &&
    (typeof event.duration_ms !== "number" ||
      !Number.isInteger(event.duration_ms) ||
      event.duration_ms < 0 ||
      event.duration_ms > ANALYTICS_MAX_DURATION_MS)
  ) {
    return null;
  }

  const appVersion = optionalBoundedString(event.app_version);
  const deviceType = optionalBoundedString(event.device_type);
  const osVersion = optionalBoundedString(event.os_version);
  if (appVersion === undefined || deviceType === undefined || osVersion === undefined) {
    return null;
  }

  if (
    event.properties !== undefined &&
    analyticsUtf8ByteLength(JSON.stringify(event.properties)) >
      ANALYTICS_MAX_PROPERTIES_BYTES
  ) {
    return null;
  }
  if (
    event.properties &&
    typeof event.properties === "object" &&
    !Array.isArray(event.properties) &&
    Object.keys(event.properties).length > ANALYTICS_MAX_PROPERTY_COUNT
  ) {
    return null;
  }

  return {
    id: event.id,
    event_type: event.event_type as AnalyticsEventType,
    event_name: event.event_name,
    app_version: appVersion,
    device_type: deviceType,
    os_version: osVersion,
    session_id: event.session_id,
    properties: sanitizeAnalyticsProperties(event.properties),
    duration_ms: (event.duration_ms as number | null | undefined) ?? null,
    schema_version: ANALYTICS_SCHEMA_VERSION,
    environment: event.environment as AnalyticsEnvironment,
    created_at: new Date(createdAtMs).toISOString(),
  };
}
