import "server-only";

import type { ExternalApiNetworkFingerprint } from "./network-fingerprint";

const MAX_REDACTION_DEPTH = 6;
const MAX_OBJECT_ENTRIES = 64;
const MAX_ARRAY_ITEMS = 32;
const MAX_SAFE_STRING_LENGTH = 512;
const AUDIT_BASE_BRAND: unique symbol = Symbol("external-api-audit-base");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sensitiveKeyPattern =
  /(?:authorization|cookie|credential|secret|token|api.?key|idempotency.?key|contact|message|answers?|filename|storage|signed.?url|request.?body|payload|email|phone|address|full.?name)/i;
const genericKeyPattern = /(?:^|[_-])key$|Key$/;
const sensitiveStringPattern =
  /(?:\bBearer\s+\S+|opsx_[1-9][0-9]{0,4}_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{20,})/i;
const emailPattern =
  /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,128}@[A-Z0-9-]{1,63}(?:\.[A-Z0-9-]{1,63})+/i;
const phonePattern =
  /(?:^|[^\w])(?:\+[0-9][0-9 ().-]{7,24}|[0-9]{3}[-. ()][0-9][0-9 ().-]{5,20})(?:$|[^\w])/;
const safeTokenPattern = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export type ExternalApiAuditOutcome =
  | "accepted"
  | "rejected"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "error";

export type ExternalApiRateLimitAuditResult =
  "allowed" | "denied" | "unavailable" | "not_applicable";

export type ExternalApiIdempotencyAuditResult =
  "new" | "replay" | "conflict" | "expired" | "not_applicable";

export type ExternalApiCacheAuditResult =
  "hit" | "miss" | "bypass" | "not_applicable";

export type ExternalApiAuditBaseEvidence = Readonly<{
  requestId: string;
  [AUDIT_BASE_BRAND]: true;
}>;

export interface ExternalApiAuditRpcClient {
  rpc(
    name: "record_external_api_request_audit_as_system",
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ExternalApiAuditRecorder {
  recordPreAuth(input: {
    requestId: string;
    route: string;
    method: string;
    requestReceivedAt: Date;
    outcome: Exclude<ExternalApiAuditOutcome, "accepted" | "conflict">;
    errorCode: string | null;
    responseClass: 2 | 3 | 4 | 5;
    durationMs: number;
    rateLimitResult: ExternalApiRateLimitAuditResult;
    networkFingerprint?: ExternalApiNetworkFingerprint;
  }): Promise<void>;
  finalizeAuthenticated(input: {
    base: ExternalApiAuditBaseEvidence;
    outcome: ExternalApiAuditOutcome;
    errorCode: string | null;
    responseClass: 2 | 3 | 4 | 5;
    durationMs: number;
    rateLimitResult: ExternalApiRateLimitAuditResult;
    idempotencyResult: ExternalApiIdempotencyAuditResult;
    cacheResult: ExternalApiCacheAuditResult;
    metricSet: readonly string[];
    grouping: readonly string[];
    resultSize: number | null;
  }): Promise<void>;
}

function sanitizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function redactValue(
  input: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : "[REDACTED]";
  }
  if (typeof input === "bigint") return input.toString();
  if (typeof input === "undefined") return null;
  if (typeof input === "function" || typeof input === "symbol") {
    return "[REDACTED]";
  }
  if (typeof input === "string") {
    if (
      sensitiveStringPattern.test(input) ||
      emailPattern.test(input) ||
      phonePattern.test(input)
    ) {
      return "[REDACTED]";
    }
    const sanitizedUrl = sanitizeUrl(input);
    if (sanitizedUrl !== null) return sanitizedUrl;
    if (input.length > MAX_SAFE_STRING_LENGTH) {
      return `${input.slice(0, MAX_SAFE_STRING_LENGTH)}[TRUNCATED]`;
    }
    return input;
  }
  if (depth >= MAX_REDACTION_DEPTH) return "[REDACTED]";
  if (typeof input !== "object") return "[REDACTED]";
  if (seen.has(input)) return "[REDACTED]";
  seen.add(input);

  if (
    input instanceof Uint8Array ||
    input instanceof ArrayBuffer ||
    input instanceof Blob
  ) {
    return "[REDACTED]";
  }
  if (input instanceof Date) return input.toISOString();
  if (Array.isArray(input)) {
    const output = input
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactValue(item, depth + 1, seen));
    if (input.length > MAX_ARRAY_ITEMS) output.push("[TRUNCATED]");
    return output;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(input as Record<string, unknown>);
  for (const [key, value] of entries.slice(0, MAX_OBJECT_ENTRIES)) {
    output[key] =
      sensitiveKeyPattern.test(key) || genericKeyPattern.test(key)
        ? "[REDACTED]"
        : redactValue(value, depth + 1, seen);
  }
  if (entries.length > MAX_OBJECT_ENTRIES) {
    output.__truncated__ = "[TRUNCATED]";
  }
  return output;
}

export function redactExternalApiAuditValue(input: unknown): unknown {
  return redactValue(input, 0, new WeakSet<object>());
}

export function commitExternalApiAuditBase(
  requestId: string
): ExternalApiAuditBaseEvidence {
  if (!uuidPattern.test(requestId)) {
    throw new Error("external API audit request ID is invalid");
  }
  return Object.freeze({
    requestId,
    [AUDIT_BASE_BRAND]: true as const,
  });
}

export function isExternalApiAuditBaseFor(
  input: ExternalApiAuditBaseEvidence,
  requestId: string
): boolean {
  return input?.[AUDIT_BASE_BRAND] === true && input.requestId === requestId;
}

function byteaHex(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(3_600_000, Math.round(value)));
}

function safeTokens(values: readonly string[], maximum: number): string[] {
  if (
    values.length > maximum ||
    values.some((value) => !safeTokenPattern.test(value))
  ) {
    throw new Error("external API audit tokens are invalid");
  }
  return [...values];
}

async function record(
  client: ExternalApiAuditRpcClient,
  args: Record<string, unknown>
): Promise<void> {
  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc(
      "record_external_api_request_audit_as_system",
      args
    );
  } catch {
    throw new Error("external API audit is unavailable");
  }
  if (result.error) {
    throw new Error("external API audit is unavailable");
  }
}

export function createSupabaseExternalApiAuditRecorder(
  client: ExternalApiAuditRpcClient
): ExternalApiAuditRecorder {
  const recorder: ExternalApiAuditRecorder = {
    async recordPreAuth(input) {
      await record(client, {
        p_phase: "pre_auth",
        p_request_id: input.requestId,
        p_route: input.route,
        p_method: input.method,
        p_request_received_at: input.requestReceivedAt.toISOString(),
        p_outcome: input.outcome,
        p_error_code: input.errorCode,
        p_response_class: input.responseClass,
        p_duration_ms: boundedDuration(input.durationMs),
        p_rate_limit_result: input.rateLimitResult,
        p_idempotency_result: "not_applicable",
        p_cache_result: "not_applicable",
        p_metric_set: null,
        p_grouping: null,
        p_result_size: null,
        p_fingerprint_version: input.networkFingerprint?.version ?? null,
        p_fingerprint_digest: input.networkFingerprint
          ? byteaHex(input.networkFingerprint.digest)
          : null,
        p_presented_prefix: input.networkFingerprint?.presentedPrefix ?? null,
      });
    },
    async finalizeAuthenticated(input) {
      await record(client, {
        p_phase: "finalize",
        p_request_id: input.base.requestId,
        p_route: null,
        p_method: null,
        p_request_received_at: null,
        p_outcome: input.outcome,
        p_error_code: input.errorCode,
        p_response_class: input.responseClass,
        p_duration_ms: boundedDuration(input.durationMs),
        p_rate_limit_result: input.rateLimitResult,
        p_idempotency_result: input.idempotencyResult,
        p_cache_result: input.cacheResult,
        p_metric_set: safeTokens(input.metricSet, 32),
        p_grouping: safeTokens(input.grouping, 8),
        p_result_size:
          input.resultSize === null
            ? null
            : Math.max(0, Math.trunc(input.resultSize)),
        p_fingerprint_version: null,
        p_fingerprint_digest: null,
        p_presented_prefix: null,
      });
    },
  };
  return Object.freeze(recorder);
}
