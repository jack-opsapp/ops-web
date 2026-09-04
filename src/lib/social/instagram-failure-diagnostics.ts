import "server-only";

export type InstagramFailureStage =
  | "state_validation"
  | "admin_validation"
  | "oauth_exchange"
  | "code_exchange"
  | "token_upgrade"
  | "profile_lookup"
  | "token_encryption"
  | "connection_storage";

export type InstagramResponseShape =
  | "unavailable"
  | "null"
  | "array"
  | "object"
  | "data_array"
  | "data_object"
  | "primitive";

const LOCAL_ERROR_CODES = new Set([
  "INSTAGRAM_OAUTH_NOT_CONFIGURED",
  "INSTAGRAM_OAUTH_STATE_INVALID",
  "INSTAGRAM_OAUTH_ADMIN_REVOKED",
  "INSTAGRAM_OAUTH_CODE_INVALID",
  "INSTAGRAM_OAUTH_UNREACHABLE",
  "INSTAGRAM_OAUTH_RESPONSE_INVALID",
  "INSTAGRAM_OAUTH_REJECTED",
  "INSTAGRAM_SCOPE_MISSING",
  "INSTAGRAM_PROFILE_INVALID",
]);

export interface InstagramProviderFailureDetails {
  providerCode?: number;
  providerSubcode?: number;
}

export interface InstagramFailureDiagnostic extends InstagramProviderFailureDetails {
  stage: InstagramFailureStage;
  code: string;
  httpStatus?: number;
  responseShape?: InstagramResponseShape;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numericCode(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Only numeric provider codes are retained; never messages, traces, or bodies. */
export function instagramProviderFailureDetails(
  payload: unknown
): InstagramProviderFailureDetails {
  const body = record(payload);
  const error = body.error ? record(body.error) : body;
  const providerCode = numericCode(error.code);
  const providerSubcode = numericCode(error.error_subcode);
  return {
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerSubcode !== undefined ? { providerSubcode } : {}),
  };
}

/** Output is deliberately independent of arbitrary error messages and properties. */
export function instagramFailureDiagnostic(
  stage: InstagramFailureStage,
  failure: unknown
): InstagramFailureDiagnostic {
  const error = record(failure);
  const details = record(error.details);
  const code =
    typeof error.code === "string" && LOCAL_ERROR_CODES.has(error.code)
      ? error.code
      : "INSTAGRAM_CONNECTION_FAILED";
  const httpStatus = numericCode(error.httpStatus);
  const providerCode = numericCode(details.providerCode);
  const providerSubcode = numericCode(details.providerSubcode);
  return {
    stage,
    code,
    ...(httpStatus !== undefined && httpStatus >= 100 && httpStatus <= 599
      ? { httpStatus }
      : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerSubcode !== undefined ? { providerSubcode } : {}),
  };
}

/** Fixed labels only: no keys, values, IDs, or response fragments. */
export function instagramResponseShape(
  payload: unknown
): InstagramResponseShape {
  if (payload === undefined) return "unavailable";
  if (payload === null) return "null";
  if (Array.isArray(payload)) return "array";
  if (typeof payload !== "object") return "primitive";
  const data = record(payload).data;
  if (Array.isArray(data)) return "data_array";
  if (data !== null && typeof data === "object") return "data_object";
  return "object";
}
