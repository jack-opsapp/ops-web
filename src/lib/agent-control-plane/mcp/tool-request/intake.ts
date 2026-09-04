import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const STORAGE_ID_PREFIX = "mcp-tool:";
const MAX_RETRY_AFTER_SECONDS = 86_400;
const HMAC_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const emailSchema = z.string().trim().toLowerCase().max(254).email();

function normalizedDetails(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

const submissionSchema = z
  .object({
    submissionId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    email: emailSchema,
    details: z
      .string()
      .transform(normalizedDetails)
      .refine((value) => unicodeLength(value) >= 20)
      .refine((value) => unicodeLength(value) <= 4_000),
    website: z.string().max(2_048),
  })
  .strict();

const identitySchema = z
  .object({
    networkIdentity: z.string().regex(HMAC_IDENTITY_PATTERN),
    emailIdentity: z.string().regex(HMAC_IDENTITY_PATTERN),
  })
  .strict()
  .refine(
    (identities) => identities.networkIdentity !== identities.emailIdentity,
    { path: ["emailIdentity"] }
  );

const atomicRpcRowSchema = z
  .object({
    outcome: z.enum(["created", "replayed", "rate_limited"]),
    submission_id: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    feature_request_id: z.string().nullable(),
    retry_after_seconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_RETRY_AFTER_SECONDS)
      .nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.outcome === "rate_limited") {
      if (row.feature_request_id !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["feature_request_id"],
          message: "Rate-limited outcomes cannot identify a stored request",
        });
      }
      if (row.retry_after_seconds === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["retry_after_seconds"],
          message: "Rate-limited outcomes require a retry delay",
        });
      }
      return;
    }

    if (row.feature_request_id !== `${STORAGE_ID_PREFIX}${row.submission_id}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["feature_request_id"],
        message: "Stored request id does not match the submission id",
      });
    }
    if (row.retry_after_seconds !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retry_after_seconds"],
        message: "Successful outcomes cannot require a retry delay",
      });
    }
  });

const atomicRpcResultSchema = z.tuple([atomicRpcRowSchema]);

type NormalizedMcpToolRequestSubmission = z.output<typeof submissionSchema>;

export type McpToolRequestIdentities = Readonly<{
  networkIdentity: string;
  emailIdentity: string;
}>;

export type McpToolRequestAtomicInput = Readonly<{
  submissionId: string;
  requesterEmail: string;
  details: string;
  networkIdentity: string;
  emailIdentity: string;
  activeExposureRevision: string;
}>;

export type McpToolRequestAtomicResult =
  | Readonly<{
      outcome: "created" | "replayed";
      submissionId: string;
      featureRequestId: string;
      retryAfterSeconds: null;
    }>
  | Readonly<{
      outcome: "rate_limited";
      submissionId: string;
      featureRequestId: null;
      retryAfterSeconds: number;
    }>;

export type McpToolRequestNotification = Readonly<{
  requesterEmail: string;
  details: string;
  submissionId: string;
}>;

export interface McpToolRequestStore {
  submitAtomic(
    input: McpToolRequestAtomicInput
  ): Promise<McpToolRequestAtomicResult>;
}

export type McpToolRequestSubmitResult = Readonly<{
  submissionId: string;
  created: boolean;
  replayed: boolean;
  suppressed: boolean;
}>;

export type McpToolRequestErrorCode =
  | "invalid_request"
  | "submission_conflict"
  | "rate_limited"
  | "request_failed";

export class McpToolRequestError extends Error {
  constructor(
    readonly code: McpToolRequestErrorCode,
    readonly status: 400 | 409 | 429 | 500,
    readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = "McpToolRequestError";
  }
}

function invalidRequest(): McpToolRequestError {
  return new McpToolRequestError("invalid_request", 400);
}

function requestFailed(): McpToolRequestError {
  return new McpToolRequestError("request_failed", 500);
}

function parseSubmission(input: unknown): NormalizedMcpToolRequestSubmission {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function parseIdentities(input: unknown): McpToolRequestIdentities {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw requestFailed();
  return parsed.data;
}

/**
 * Returns the canonical email used to derive the private submission identity.
 * Full submission validation remains inside `submit`, so this helper cannot
 * weaken the public payload contract.
 */
export function normalizeMcpToolRequestEmail(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidRequest();
  }
  const parsed = emailSchema.safeParse(
    (input as Record<string, unknown>).email
  );
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function replayResult(submissionId: string): McpToolRequestSubmitResult {
  return Object.freeze({
    submissionId,
    created: false,
    replayed: true,
    suppressed: false,
  });
}

export function createMcpToolRequestIntake(config: {
  store: McpToolRequestStore;
  scheduleNotification(notification: McpToolRequestNotification): void;
  activeExposureRevision: string;
}): Readonly<{
  submit(
    input: unknown,
    identities: McpToolRequestIdentities
  ): Promise<McpToolRequestSubmitResult>;
}> {
  return Object.freeze({
    async submit(
      input: unknown,
      identitiesInput: McpToolRequestIdentities
    ): Promise<McpToolRequestSubmitResult> {
      const submission = parseSubmission(input);

      // A bot gets the same public success shape as a new request, without a
      // durable row or operator side effect.
      if (submission.website.length > 0) {
        return Object.freeze({
          submissionId: submission.submissionId,
          created: false,
          replayed: false,
          suppressed: true,
        });
      }

      const identities = parseIdentities(identitiesInput);
      let atomicResult: McpToolRequestAtomicResult;
      try {
        atomicResult = await config.store.submitAtomic({
          submissionId: submission.submissionId,
          requesterEmail: submission.email,
          details: submission.details,
          networkIdentity: identities.networkIdentity,
          emailIdentity: identities.emailIdentity,
          activeExposureRevision: config.activeExposureRevision,
        });
      } catch (error) {
        if (error instanceof McpToolRequestError) throw error;
        throw requestFailed();
      }

      if (atomicResult.outcome === "rate_limited") {
        throw new McpToolRequestError(
          "rate_limited",
          429,
          atomicResult.retryAfterSeconds
        );
      }

      if (atomicResult.outcome === "replayed") {
        return replayResult(atomicResult.submissionId);
      }

      try {
        config.scheduleNotification({
          requesterEmail: submission.email,
          details: submission.details,
          submissionId: atomicResult.featureRequestId,
        });
      } catch {
        console.error("mcp_tool_request_notification_failed");
      }

      return Object.freeze({
        submissionId: atomicResult.submissionId,
        created: true,
        replayed: false,
        suppressed: false,
      });
    },
  });
}

function storageFailure(): Error {
  return new Error("tool_request_submission_failed");
}

function readRpcError(error: unknown): { code?: string; message?: string } {
  if (typeof error !== "object" || error === null) return {};
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message:
      typeof candidate.message === "string" ? candidate.message : undefined,
  };
}

export function createSupabaseMcpToolRequestStore(
  client: SupabaseClient
): McpToolRequestStore {
  return Object.freeze({
    async submitAtomic(input: McpToolRequestAtomicInput) {
      let response: { data: unknown; error: unknown };
      try {
        response = await client.rpc(
          "submit_public_mcp_tool_request_as_system",
          {
            p_submission_id: input.submissionId,
            p_requester_email: input.requesterEmail,
            p_details: input.details,
            p_network_identity: input.networkIdentity,
            p_email_identity: input.emailIdentity,
            p_active_exposure_revision: input.activeExposureRevision,
          }
        );
      } catch {
        throw storageFailure();
      }

      if (response.error) {
        const error = readRpcError(response.error);
        if (
          error.code === "23505" &&
          error.message === "mcp_tool_request_id_conflict"
        ) {
          throw new McpToolRequestError("submission_conflict", 409);
        }
        if (error.code === "22023") {
          throw invalidRequest();
        }
        throw storageFailure();
      }

      const parsed = atomicRpcResultSchema.safeParse(response.data);
      if (!parsed.success) throw storageFailure();
      const row = parsed.data[0];
      if (row.submission_id !== input.submissionId.toLowerCase()) {
        throw storageFailure();
      }

      if (row.outcome === "rate_limited") {
        return Object.freeze({
          outcome: row.outcome,
          submissionId: row.submission_id,
          featureRequestId: null,
          retryAfterSeconds: row.retry_after_seconds as number,
        });
      }

      return Object.freeze({
        outcome: row.outcome,
        submissionId: row.submission_id,
        featureRequestId: row.feature_request_id as string,
        retryAfterSeconds: null,
      });
    },
  });
}
