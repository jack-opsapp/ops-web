import "server-only";

import { z } from "zod-v4";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  ActorAccessError,
  authorizationInternal,
} from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  AgentErrorSchema,
  CONTRACT_VERSION,
} from "@/lib/agent-control-plane/contracts";
import {
  PrepareFinancialDocumentInputSchema,
  InspectFinancialDocumentInputSchema,
  FinancialDocumentContextSchema,
  type FinancialDocumentResult,
  type PrepareFinancialDocumentInput,
} from "@/lib/agent-control-plane/contracts/financial-document";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  FINANCIAL_DOCUMENT_CAPABILITY_MANIFEST_REVISION,
  resolveFinancialDocumentCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  FinancialDocumentRepositoryError,
  isTrustedFinancialDocumentRepository,
  type FinancialDocumentRepository,
} from "./financial-document-repository";

const CAPABILITY_ID = "prepare_financial_document" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

export class FinancialDocumentPrepareError extends Error {
  readonly code:
    | "CONFLICT"
    | "INVALID_ARGUMENT"
    | "NO_CHANGE"
    | "POLICY_UNAVAILABLE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  constructor(input: {
    code: FinancialDocumentPrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      CONFLICT: "That request key is already bound to different evidence.",
      INVALID_ARGUMENT: "The financial document request is invalid.",
      NO_CHANGE:
        "The requested values already match this record. No proposal was created.",
      POLICY_UNAVAILABLE:
        "The exact company financial document policy is not available.",
      STALE_CONTEXT:
        "The record, policy, or authority changed. Review the control room again.",
      TEMPORARILY_UNAVAILABLE:
        "The financial document proposal is temporarily unavailable.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "FinancialDocumentPrepareError";
    this.code = input.code;
    this.requestId = input.requestId;
  }

  toAgentError() {
    if (
      this.code === "INVALID_ARGUMENT" ||
      this.code === "CONFLICT" ||
      this.code === "NO_CHANGE"
    ) {
      return AgentErrorSchema.parse({
        contract_version: CONTRACT_VERSION,
        code: "INVALID_ARGUMENT",
        request_id: this.requestId,
        message: this.message,
        retryable: false,
        details: {
          field_issues: [
            {
              path: ["input"],
              code:
                this.code === "CONFLICT"
                  ? "FINANCIAL_DOCUMENT_IDEMPOTENCY_CONFLICT"
                  : this.code === "NO_CHANGE"
                    ? "FINANCIAL_DOCUMENT_NO_CHANGE"
                    : "FINANCIAL_DOCUMENT_INPUT_INVALID",
              message: this.message,
            },
          ],
        },
      });
    }
    return toP2ReadAgentError({
      // The database intentionally does not disclose current record, policy,
      // or grant revisions through this write-preparation boundary. Without an
      // authentic current version marker, the shared transport safely projects
      // stale/policy failures to TEMPORARILY_UNAVAILABLE rather than fabricating
      // STALE_CONTEXT details.
      code:
        this.code === "STALE_CONTEXT" || this.code === "POLICY_UNAVAILABLE"
          ? "STALE_CONTEXT"
          : "TEMPORARILY_UNAVAILABLE",
      requestId: this.requestId,
      message: this.message,
      retryable: true,
    });
  }
}

export interface FinancialDocumentService {
  inspectFinancialDocument(
    actorContext: ActorContext,
    input: z.infer<typeof InspectFinancialDocumentInputSchema>,
    options?: { signal?: AbortSignal }
  ): Promise<z.infer<typeof FinancialDocumentContextSchema>>;
  prepareFinancialDocument(
    actorContext: ActorContext,
    input: PrepareFinancialDocumentInput,
    options?: { signal?: AbortSignal }
  ): Promise<FinancialDocumentResult>;
}

function authorize(
  actorContext: ActorContext,
  input: PrepareFinancialDocumentInput
) {
  const resolved = resolveFinancialDocumentCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1)
    throw authorizationInternal(
      actorContext.requestId,
      "financial_document_authorization_variant_invalid"
    );
  authorizeCapability({ actorContext, policy: resolved.variants[0]!.policy });
}

export function createFinancialDocumentService(input: {
  repository: FinancialDocumentRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): FinancialDocumentService {
  if (!isTrustedFinancialDocumentRepository(input.repository))
    throw new TypeError("A trusted financial document repository is required");
  if (!input.authorityRepository)
    throw new TypeError(
      "A financial document authority repository is required"
    );
  const now = input.now ?? (() => new Date());
  if (typeof now !== "function")
    throw new TypeError("A valid clock is required");

  const service: FinancialDocumentService = {
    async inspectFinancialDocument(actorContext, rawInput, options) {
      if (!isActorContext(actorContext))
        throw authorizationInternal(
          "unknown-request",
          "financial_document_actor_untrusted"
        );
      const request = InspectFinancialDocumentInputSchema.parse(rawInput);
      const current = await reauthorizeResolvedMcpActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        capabilityManifestRevision:
          FINANCIAL_DOCUMENT_CAPABILITY_MANIFEST_REVISION,
        signal: options?.signal,
      });
      const resolved = resolveFinancialDocumentCapabilityAuthorization(
        "inspect_financial_document",
        request
      );
      authorizeCapability({
        actorContext: current,
        policy: resolved.variants[0]!.policy,
      });
      return input.repository.inspect(current, request, options?.signal);
    },
    async prepareFinancialDocument(actorContext, rawInput, options) {
      if (!isActorContext(actorContext))
        throw authorizationInternal(
          "unknown-request",
          "financial_document_actor_untrusted"
        );
      let request: PrepareFinancialDocumentInput;
      try {
        request = PrepareFinancialDocumentInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new FinancialDocumentPrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        throw error;
      }
      authorize(actorContext, request);
      try {
        const current = await reauthorizeResolvedMcpActor({
          actorContext,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            FINANCIAL_DOCUMENT_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorize(current, request);
        const observedAt = now();
        if (Number.isNaN(observedAt.getTime()))
          throw new Error("Invalid clock");
        return await input.repository.prepare({
          actorContext: current,
          request,
          observedAt: observedAt.toISOString(),
          signal: options?.signal,
        });
      } catch (error) {
        if (
          error instanceof ActorAccessError ||
          error instanceof FinancialDocumentPrepareError
        )
          throw error;
        if (error instanceof FinancialDocumentRepositoryError) {
          const code =
            error.code === "CONFLICT" || error.code === "NO_CHANGE"
              ? error.code
              : error.code === "POLICY"
                ? "POLICY_UNAVAILABLE"
                : error.code === "STALE"
                  ? "STALE_CONTEXT"
                  : "TEMPORARILY_UNAVAILABLE";
          throw new FinancialDocumentPrepareError({
            code,
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new FinancialDocumentPrepareError({
          code: "TEMPORARILY_UNAVAILABLE",
          requestId: actorContext.requestId,
          cause: error,
        });
      }
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedFinancialDocumentService(
  value: unknown
): value is FinancialDocumentService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
