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

const PROVIDER_HINT_RULES = [
  ["appsecret_proof", /\bapp[_ -]?secret[_ -]?proof\b/i],
  ["client_secret", /\b(?:client|app)[_ -]?secret\b(?![_ -]?proof)/i],
  ["access_token", /\baccess[_ -]?token\b/i],
  ["client_id", /\b(?:client|app|application)[_ -]?id\b/i],
  ["grant_type", /\bgrant[_ -]?type\b/i],
  ["redirect_uri", /\bredirect[_ -]?(?:uri|url)\b/i],
  [
    "invalid",
    /\binvalid\b|\bmalformed\b|\bcannot parse\b|\bnot valid\b|\berror validating\b/i,
  ],
  ["missing", /\bmissing\b|\bis required\b|\bmust be provided\b/i],
  ["expired", /\bexpired\b|\bexpiration\b/i],
  [
    "unsupported_request",
    /\bunsupported (?:get |post )?request\b|\bunknown path\b/i,
  ],
  ["permission", /\bpermissions?\b|\bnot authorized\b|\baccess denied\b/i],
  ["rate_limit", /\brate limit\b|\btoo many requests\b/i],
] as const;

type InstagramProviderHint = (typeof PROVIDER_HINT_RULES)[number][0];

export interface InstagramProviderFailureDetails {
  providerCode?: number;
  providerSubcode?: number;
  providerHints?: InstagramProviderHint[];
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

/** Only numeric codes and source-defined hints survive; never provider text. */
export function instagramProviderFailureDetails(
  payload: unknown,
  secrets: readonly string[] = []
): InstagramProviderFailureDetails {
  const body = record(payload);
  const error = body.error ? record(body.error) : body;
  const providerCode = numericCode(error.code);
  const providerSubcode = numericCode(error.error_subcode);
  const rawMessage = error.message ?? error.error_message;
  let message = typeof rawMessage === "string" ? rawMessage : "";
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  const providerHints = PROVIDER_HINT_RULES.filter(([, pattern]) =>
    pattern.test(message.slice(0, 8192))
  ).map(([hint]) => hint);
  return {
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerSubcode !== undefined ? { providerSubcode } : {}),
    ...(providerHints.length > 0 ? { providerHints } : {}),
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
  const providerHints = PROVIDER_HINT_RULES.map(([hint]) => hint).filter(
    (hint) =>
      Array.isArray(details.providerHints) &&
      details.providerHints.includes(hint)
  );
  return {
    stage,
    code,
    ...(httpStatus !== undefined && httpStatus >= 100 && httpStatus <= 599
      ? { httpStatus }
      : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerSubcode !== undefined ? { providerSubcode } : {}),
    ...(providerHints.length > 0 ? { providerHints } : {}),
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
