import { z } from "zod-v4";

import {
  ContractCodeSchema,
  MAX_SOURCE_VERSIONS,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
} from "./common";
import { SourceVersionSchema } from "./evidence";
import { ContractVersionSchema } from "./version";

export const AGENT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INSUFFICIENT_SCOPE",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_ARGUMENT",
  "AMBIGUOUS",
  "STALE_CONTEXT",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "TEMPORARILY_UNAVAILABLE",
  "INTERNAL",
] as const;

export const AgentErrorCodeSchema = z.enum(AGENT_ERROR_CODES);

export const AgentFieldIssueSchema = z
  .object({
    path: z.array(
      z.union([z.string().min(1).max(128), z.number().int().nonnegative()])
    ),
    code: ContractCodeSchema,
    message: z.string().min(1).max(1_000),
  })
  .strict();

const UnauthenticatedErrorDetailsSchema = z
  .object({
    www_authenticate: z.string().min(1).max(2_048).optional(),
  })
  .strict();

const InsufficientScopeErrorDetailsSchema = z
  .object({
    required_scope: z.string().min(1).max(256),
    www_authenticate: z.string().min(1).max(2_048).optional(),
  })
  .strict();

const InvalidArgumentErrorDetailsSchema = z
  .object({
    field_issues: z.array(AgentFieldIssueSchema).min(1).max(50),
  })
  .strict();

const AmbiguousErrorDetailsSchema = z
  .object({
    candidate_count: z.number().int().positive().max(50),
    resolution_hint: z.string().min(1).max(500).optional(),
  })
  .strict();

const StaleContextErrorDetailsSchema = z
  .object({
    current_source_versions: z
      .array(SourceVersionSchema)
      .max(MAX_SOURCE_VERSIONS)
      .optional(),
    current_memory_version: z.number().int().nonnegative().optional(),
    current_turn_high_watermark_id: OpaqueIdSchema.optional(),
  })
  .strict()
  .superRefine((details, context) => {
    if (
      (details.current_source_versions?.length ?? 0) === 0 &&
      details.current_memory_version === undefined &&
      details.current_turn_high_watermark_id === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Stale context requires a current version marker",
      });
    }
  });

const ConfirmationRequiredErrorDetailsSchema = z
  .object({
    confirmation_request_id: OpaqueIdSchema,
    expires_at: Rfc3339UtcTimestampSchema,
  })
  .strict();

const ConfirmationExpiredErrorDetailsSchema = z
  .object({
    confirmation_request_id: OpaqueIdSchema,
  })
  .strict();

const IdempotencyConflictErrorDetailsSchema = z
  .object({
    idempotency_key: OpaqueIdSchema,
  })
  .strict();

const RateLimitedErrorDetailsSchema = z
  .object({
    retry_after_seconds: z.number().int().nonnegative(),
  })
  .strict();

const TemporarilyUnavailableErrorDetailsSchema = z
  .object({
    retry_after_seconds: z.number().int().nonnegative().optional(),
  })
  .strict();

const InternalErrorDetailsSchema = z
  .object({
    incident_id: OpaqueIdSchema.optional(),
  })
  .strict();

export const AgentErrorDetailsSchema = z.union([
  UnauthenticatedErrorDetailsSchema,
  InsufficientScopeErrorDetailsSchema,
  InvalidArgumentErrorDetailsSchema,
  AmbiguousErrorDetailsSchema,
  StaleContextErrorDetailsSchema,
  ConfirmationRequiredErrorDetailsSchema,
  ConfirmationExpiredErrorDetailsSchema,
  IdempotencyConflictErrorDetailsSchema,
  RateLimitedErrorDetailsSchema,
  TemporarilyUnavailableErrorDetailsSchema,
  InternalErrorDetailsSchema,
]);

const AgentErrorBaseSchema = z.object({
  contract_version: ContractVersionSchema,
  request_id: OpaqueIdSchema,
  message: z.string().min(1).max(1_000),
  retryable: z.boolean(),
});

const UnauthenticatedErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("UNAUTHENTICATED"),
  details: UnauthenticatedErrorDetailsSchema.optional(),
}).strict();

const InsufficientScopeErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("INSUFFICIENT_SCOPE"),
  details: InsufficientScopeErrorDetailsSchema,
}).strict();

const ForbiddenErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("FORBIDDEN"),
  details: z.never().optional(),
}).strict();

const NotFoundErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("NOT_FOUND"),
  details: z.never().optional(),
}).strict();

const InvalidArgumentErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("INVALID_ARGUMENT"),
  details: InvalidArgumentErrorDetailsSchema,
}).strict();

const AmbiguousErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("AMBIGUOUS"),
  details: AmbiguousErrorDetailsSchema,
}).strict();

const StaleContextErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("STALE_CONTEXT"),
  details: StaleContextErrorDetailsSchema,
}).strict();

const ConfirmationRequiredErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("CONFIRMATION_REQUIRED"),
  details: ConfirmationRequiredErrorDetailsSchema,
}).strict();

const ConfirmationExpiredErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("CONFIRMATION_EXPIRED"),
  details: ConfirmationExpiredErrorDetailsSchema,
}).strict();

const IdempotencyConflictErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("IDEMPOTENCY_CONFLICT"),
  details: IdempotencyConflictErrorDetailsSchema,
}).strict();

const RateLimitedErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("RATE_LIMITED"),
  details: RateLimitedErrorDetailsSchema,
}).strict();

const TemporarilyUnavailableErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("TEMPORARILY_UNAVAILABLE"),
  details: TemporarilyUnavailableErrorDetailsSchema.optional(),
}).strict();

const InternalErrorSchema = AgentErrorBaseSchema.extend({
  code: z.literal("INTERNAL"),
  details: InternalErrorDetailsSchema.optional(),
}).strict();

export const AgentErrorSchema = z.discriminatedUnion("code", [
  UnauthenticatedErrorSchema,
  InsufficientScopeErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  InvalidArgumentErrorSchema,
  AmbiguousErrorSchema,
  StaleContextErrorSchema,
  ConfirmationRequiredErrorSchema,
  ConfirmationExpiredErrorSchema,
  IdempotencyConflictErrorSchema,
  RateLimitedErrorSchema,
  TemporarilyUnavailableErrorSchema,
  InternalErrorSchema,
]);

export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;
export type AgentFieldIssue = z.infer<typeof AgentFieldIssueSchema>;
export type AgentError = z.infer<typeof AgentErrorSchema>;
export type AgentErrorDetails = Exclude<AgentError["details"], undefined>;
