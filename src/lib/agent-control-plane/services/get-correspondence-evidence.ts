import "server-only";

import {
  CONTRACT_VERSION,
  type AgentError,
} from "@/lib/agent-control-plane/contracts";
import {
  CorrespondenceEvidenceResultSchema,
  JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE,
  MAX_JOB_CATALOG_OUTPUT_CHARACTERS,
  type CorrespondenceEvidenceResult,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  isAuthorizedCorrespondenceEvidencePageRead,
  type AuthorizedCorrespondenceEvidencePageRead,
} from "./correspondence-evidence-page-authorization";
import {
  CorrespondenceEvidencePageRepositoryError,
  isTrustedCorrespondenceEvidencePageRepository,
  type CorrespondenceEvidencePageRepository,
  type CorrespondenceEvidenceSnapshot,
} from "./correspondence-evidence-page-repository";

function safeGeneratedAt(now?: () => Date): string | null {
  try {
    return (now?.() ?? new Date()).toISOString();
  } catch {
    return null;
  }
}

function safeMessage(code: CorrespondenceEvidenceReadError["code"]): string {
  if (code === "NOT_FOUND") return "Correspondence evidence was not found.";
  if (code === "INVALID_ARGUMENT") {
    return "Requested evidence is too large.";
  }
  if (code === "TEMPORARILY_UNAVAILABLE") {
    return "Correspondence evidence is temporarily unavailable.";
  }
  return "Correspondence evidence could not be read.";
}

export class CorrespondenceEvidenceReadError extends Error {
  readonly code:
    "NOT_FOUND" | "INVALID_ARGUMENT" | "TEMPORARILY_UNAVAILABLE" | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: CorrespondenceEvidenceReadError["code"];
    requestId: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(safeMessage(input.code), { cause: input.cause });
    this.name = "CorrespondenceEvidenceReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
  }

  toAgentError(): AgentError {
    const base = {
      contract_version: CONTRACT_VERSION,
      request_id: this.requestId,
      message: this.message,
      retryable: this.retryable,
    } as const;
    if (this.code === "NOT_FOUND") return { ...base, code: "NOT_FOUND" };
    if (this.code === "INVALID_ARGUMENT") {
      return {
        ...base,
        code: "INVALID_ARGUMENT",
        details: {
          field_issues: [
            {
              path: ["evidence_ids"],
              code: "PROMPT_BUDGET_EXCEEDED",
              message: "Request fewer evidence items or use excerpt mode.",
            },
          ],
        },
      };
    }
    if (this.code === "TEMPORARILY_UNAVAILABLE") {
      return { ...base, code: "TEMPORARILY_UNAVAILABLE" };
    }
    return { ...base, code: "INTERNAL" };
  }
}

function mapRepositoryError(
  error: unknown,
  authorization: AuthorizedCorrespondenceEvidencePageRead
): never {
  if (error instanceof CorrespondenceEvidencePageRepositoryError) {
    if (error.code === "CORRESPONDENCE_EVIDENCE_NOT_FOUND") {
      throw new CorrespondenceEvidenceReadError({
        code: "NOT_FOUND",
        requestId: authorization.actorContext.requestId,
        retryable: false,
        cause: error,
      });
    }
    if (error.code === "CORRESPONDENCE_EVIDENCE_TOO_LARGE") {
      throw new CorrespondenceEvidenceReadError({
        code: "INVALID_ARGUMENT",
        requestId: authorization.actorContext.requestId,
        retryable: false,
        cause: error,
      });
    }
    if (error.code === "CORRESPONDENCE_EVIDENCE_READ_FAILED") {
      throw new CorrespondenceEvidenceReadError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        cause: error,
      });
    }
  }
  throw new CorrespondenceEvidenceReadError({
    code: "INTERNAL",
    requestId: authorization.actorContext.requestId,
    retryable: false,
    cause: error,
  });
}

function buildResult(input: {
  authorization: AuthorizedCorrespondenceEvidencePageRead;
  snapshot: CorrespondenceEvidenceSnapshot;
  generatedAt: string;
}): CorrespondenceEvidenceResult {
  return {
    contract_version: CONTRACT_VERSION,
    request_id: input.authorization.actorContext.requestId,
    generated_at: input.generatedAt,
    company_id: input.snapshot.company_id,
    actor: {
      user_id: input.authorization.actorContext.actorUserId,
      permission_snapshot_revision:
        input.authorization.actorContext.permissionSnapshotRevision,
    },
    freshness: {
      read_at: input.snapshot.read_at,
      source_versions: [
        input.snapshot.history_fence,
        input.snapshot.collection_claim.source_version,
        ...input.snapshot.evidence_claims.map((claim) => claim.source_version),
      ],
      stale_after: null,
    },
    data: {
      requested_job: input.snapshot.requested_job,
      prompt_safety_directive: JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE,
      mode: input.authorization.query.mode,
      items: input.snapshot.evidence_claims.map((claim) => claim.raw),
      returned_evidence_count: input.snapshot.evidence_claims.length,
    },
    evidence: [
      ...input.snapshot.collection_claim.evidence,
      ...input.snapshot.evidence_claims.flatMap((claim) => claim.evidence),
    ],
    warnings: [],
  } as CorrespondenceEvidenceResult;
}

export async function getCorrespondenceEvidence(input: {
  readonly authorization: AuthorizedCorrespondenceEvidencePageRead;
  readonly repository: CorrespondenceEvidencePageRepository;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<CorrespondenceEvidenceResult> {
  const authorization = input.authorization;
  if (!isAuthorizedCorrespondenceEvidencePageRead(authorization)) {
    throw new CorrespondenceEvidenceReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
      retryable: false,
    });
  }
  const repository = input.repository;
  if (!isTrustedCorrespondenceEvidencePageRepository(repository)) {
    throw new CorrespondenceEvidenceReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const generatedAt = safeGeneratedAt(input.now);
  if (generatedAt === null) {
    throw new CorrespondenceEvidenceReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const signal = input.signal;
  let snapshot: CorrespondenceEvidenceSnapshot;
  try {
    snapshot = await repository.read({
      authorization,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    mapRepositoryError(error, authorization);
  }
  try {
    const result = buildResult({
      authorization,
      snapshot: snapshot!,
      generatedAt,
    });
    if (JSON.stringify(result).length > MAX_JOB_CATALOG_OUTPUT_CHARACTERS) {
      throw new CorrespondenceEvidenceReadError({
        code: "INVALID_ARGUMENT",
        requestId: authorization.actorContext.requestId,
        retryable: false,
      });
    }
    return CorrespondenceEvidenceResultSchema.parse(result);
  } catch (error) {
    if (error instanceof CorrespondenceEvidenceReadError) throw error;
    throw new CorrespondenceEvidenceReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
      cause: error,
    });
  }
}
