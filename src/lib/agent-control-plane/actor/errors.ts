import type {
  AgentError,
  AgentErrorCode,
  AgentFieldIssue,
} from "@/lib/agent-control-plane/contracts";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts";

export type ActorAccessErrorCode = Extract<
  AgentErrorCode,
  | "INSUFFICIENT_SCOPE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "TEMPORARILY_UNAVAILABLE"
  | "INTERNAL"
>;

interface ActorAccessErrorOptions {
  requestId: string;
  code: ActorAccessErrorCode;
  message: string;
  retryable: boolean;
  auditReason: string;
  requiredScope?: string;
  wwwAuthenticate?: string;
  fieldIssues?: readonly AgentFieldIssue[];
}

/** Safe external error plus a non-serializable internal audit reason. */
export class ActorAccessError extends Error {
  readonly requestId: string;
  readonly code: ActorAccessErrorCode;
  readonly retryable: boolean;
  readonly requiredScope?: string;
  readonly wwwAuthenticate?: string;
  readonly fieldIssues?: readonly AgentFieldIssue[];
  readonly #auditReason: string;

  constructor(options: ActorAccessErrorOptions) {
    super(options.message);
    this.name = "ActorAccessError";
    this.requestId = options.requestId;
    this.code = options.code;
    this.retryable = options.retryable;
    this.requiredScope = options.requiredScope;
    this.wwwAuthenticate = options.wwwAuthenticate;
    this.fieldIssues = options.fieldIssues
      ? Object.freeze([...options.fieldIssues])
      : undefined;
    this.#auditReason = options.auditReason;
  }

  auditReasonForLog(): string {
    return this.#auditReason;
  }

  toAgentError(): AgentError {
    const base = {
      contract_version: CONTRACT_VERSION,
      request_id: this.requestId,
      message: this.message,
      retryable: this.retryable,
    } as const;

    switch (this.code) {
      case "INSUFFICIENT_SCOPE":
        return {
          ...base,
          code: "INSUFFICIENT_SCOPE",
          details: {
            required_scope: this.requiredScope ?? "unknown",
            ...(this.wwwAuthenticate
              ? { www_authenticate: this.wwwAuthenticate }
              : {}),
          },
        };
      case "INVALID_ARGUMENT":
        return {
          ...base,
          code: "INVALID_ARGUMENT",
          details: {
            field_issues: this.fieldIssues?.length
              ? [...this.fieldIssues]
              : [
                  {
                    path: ["input"],
                    code: "INVALID_ARGUMENT",
                    message: "The input is invalid.",
                  },
                ],
          },
        };
      case "TEMPORARILY_UNAVAILABLE":
        return { ...base, code: "TEMPORARILY_UNAVAILABLE" };
      case "INTERNAL":
        return { ...base, code: "INTERNAL" };
      case "FORBIDDEN":
        return { ...base, code: "FORBIDDEN" };
      case "NOT_FOUND":
        return { ...base, code: "NOT_FOUND" };
    }
  }
}

export function actorForbidden(
  requestId: string,
  auditReason: string
): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "FORBIDDEN",
    message: "Access is not available.",
    retryable: false,
    auditReason,
  });
}

export function authorizationUnavailable(
  requestId: string,
  auditReason: string
): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "TEMPORARILY_UNAVAILABLE",
    message: "Authorization is temporarily unavailable.",
    retryable: true,
    auditReason,
  });
}

export function insufficientOAuthScope(
  requestId: string,
  requiredScope: string,
  wwwAuthenticate: string
): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "INSUFFICIENT_SCOPE",
    message: "Additional authorization is required.",
    retryable: false,
    auditReason: "oauth_scope_ceiling",
    requiredScope,
    wwwAuthenticate,
  });
}

export function authorizationInternal(
  requestId: string,
  auditReason: string
): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "INTERNAL",
    message: "Authorization could not be evaluated.",
    retryable: false,
    auditReason,
  });
}

export function entityNotFound(
  requestId: string,
  auditReason: string
): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "NOT_FOUND",
    message: "Resource is not available.",
    retryable: false,
    auditReason,
  });
}

export function invalidEntityArgument(
  requestId: string,
  path: readonly string[]
): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "INVALID_ARGUMENT",
    message: "The entity reference is invalid.",
    retryable: false,
    auditReason: "invalid_entity_authorization_input",
    fieldIssues: [
      {
        path: [...path],
        code: "INVALID_ENTITY_REFERENCE",
        message: "Provide a valid entity reference and action.",
      },
    ],
  });
}
