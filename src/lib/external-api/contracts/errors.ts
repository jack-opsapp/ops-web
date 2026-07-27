import { z } from "zod";

export const externalApiErrorCodeSchema = z.enum([
  "invalid_credentials",
  "credential_expired",
  "credential_revoked",
  "insufficient_scope",
  "source_not_allowed",
  "form_not_allowed",
  "invalid_request",
  "idempotency_conflict",
  "external_submission_conflict",
  "submission_not_found",
  "upload_not_found",
  "upload_expired",
  "upload_batch_expired",
  "upload_rejected",
  "rate_limited",
  "rate_limit_unavailable",
  "cursor_invalid",
  "sync_checkpoint_expired",
  "range_too_large",
  "date_alignment_required",
  "definition_version_unsupported",
  "temporarily_unavailable",
  "internal_error",
]);

export type ExternalApiErrorCode = z.infer<typeof externalApiErrorCodeSchema>;

type ErrorDefinition = Readonly<{
  status: number;
  message: string;
}>;

export const externalApiErrorDefinitions = {
  invalid_credentials: {
    status: 401,
    message: "The supplied credentials are invalid.",
  },
  credential_expired: {
    status: 401,
    message: "The supplied credential has expired.",
  },
  credential_revoked: {
    status: 401,
    message: "The supplied credential has been revoked.",
  },
  insufficient_scope: {
    status: 403,
    message: "The credential does not grant this capability.",
  },
  source_not_allowed: {
    status: 403,
    message: "The source is not available to this credential.",
  },
  form_not_allowed: {
    status: 403,
    message: "The form is not available to this credential.",
  },
  invalid_request: {
    status: 400,
    message: "The request is invalid.",
  },
  idempotency_conflict: {
    status: 409,
    message: "The idempotency key was already used for a different request.",
  },
  external_submission_conflict: {
    status: 409,
    message:
      "The external submission identifier was already used for different content.",
  },
  submission_not_found: {
    status: 404,
    message: "The submission was not found.",
  },
  upload_not_found: {
    status: 404,
    message: "The upload was not found.",
  },
  upload_expired: {
    status: 410,
    message: "The upload has expired.",
  },
  upload_batch_expired: {
    status: 410,
    message: "The upload batch has expired.",
  },
  upload_rejected: {
    status: 422,
    message: "The upload was rejected.",
  },
  rate_limited: {
    status: 429,
    message: "The request rate is too high.",
  },
  rate_limit_unavailable: {
    status: 503,
    message: "Request admission is temporarily unavailable.",
  },
  cursor_invalid: {
    status: 400,
    message: "The cursor is invalid or expired.",
  },
  sync_checkpoint_expired: {
    status: 410,
    message: "The sync checkpoint has expired.",
  },
  range_too_large: {
    status: 422,
    message: "The requested range is too large.",
  },
  date_alignment_required: {
    status: 422,
    message: "The requested dates must align to company-local midnight.",
  },
  definition_version_unsupported: {
    status: 422,
    message: "The requested metric definition version is not supported.",
  },
  temporarily_unavailable: {
    status: 503,
    message: "The service is temporarily unavailable.",
  },
  internal_error: {
    status: 500,
    message: "The request could not be completed.",
  },
} as const satisfies Record<ExternalApiErrorCode, ErrorDefinition>;

export function getExternalApiErrorStatus(code: ExternalApiErrorCode): number {
  return externalApiErrorDefinitions[code].status;
}

export class ExternalApiSafeError extends Error {
  readonly status: number;

  constructor(readonly code: ExternalApiErrorCode) {
    super(code);
    this.name = "ExternalApiSafeError";
    this.status = getExternalApiErrorStatus(code);
  }
}
