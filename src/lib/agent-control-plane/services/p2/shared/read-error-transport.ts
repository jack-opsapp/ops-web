import "server-only";

import {
  AgentErrorSchema,
  CONTRACT_VERSION,
  type AgentError,
  type SourceVersion,
} from "@/lib/agent-control-plane/contracts";

export type P2ReadErrorTransportCode =
  | "INTERNAL"
  | "INVALID_CURSOR"
  | "INVALID_GEOMETRY"
  | "NOT_FOUND"
  | "RESULT_TOO_LARGE"
  | "SOURCE_DATA_INVALID"
  | "STALE_CONTEXT"
  | "TEMPORARILY_UNAVAILABLE";

function contractSafe(candidate: AgentError): AgentError {
  return AgentErrorSchema.parse(candidate);
}

/**
 * Projects a nominal P2 read-domain failure into the public AgentError
 * contract. A stale error may remain STALE_CONTEXT only when its producer
 * supplies authentic current source versions; cursor-held historical
 * revisions and fabricated placeholders are intentionally forbidden.
 */
export function toP2ReadAgentError(input: {
  readonly code: P2ReadErrorTransportCode;
  readonly requestId: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly currentSourceVersions?: readonly SourceVersion[];
}): AgentError {
  const base = {
    contract_version: CONTRACT_VERSION,
    request_id: input.requestId,
    message: input.message,
    retryable: input.retryable,
  } as const;

  switch (input.code) {
    case "INVALID_CURSOR":
      return contractSafe({
        ...base,
        code: "INVALID_ARGUMENT",
        details: {
          field_issues: [
            {
              path: ["cursor"],
              code: "INVALID_CURSOR",
              message: input.message,
            },
          ],
        },
      });
    case "STALE_CONTEXT":
      if (input.currentSourceVersions?.length) {
        return contractSafe({
          ...base,
          code: "STALE_CONTEXT",
          retryable: true,
          details: {
            current_source_versions: input.currentSourceVersions.map(
              (version) => ({ ...version })
            ),
          },
        });
      }
      return contractSafe({
        ...base,
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      });
    case "INVALID_GEOMETRY":
    case "SOURCE_DATA_INVALID":
      return contractSafe({
        ...base,
        code: "TEMPORARILY_UNAVAILABLE",
      });
    case "NOT_FOUND":
      return contractSafe({ ...base, code: "NOT_FOUND" });
    case "RESULT_TOO_LARGE":
      return contractSafe({ ...base, code: "RESULT_TOO_LARGE" });
    case "TEMPORARILY_UNAVAILABLE":
      return contractSafe({ ...base, code: "TEMPORARILY_UNAVAILABLE" });
    case "INTERNAL":
      return contractSafe({ ...base, code: "INTERNAL" });
  }
}
