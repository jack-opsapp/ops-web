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
  calculateEstimateDraft,
  ESTIMATE_DRAFT_MAX_OUTPUT_CHARACTERS,
  PrepareEstimateFromPastJobInputSchema,
  type EstimateDraftResult,
  type PrepareEstimateFromPastJobInput,
} from "@/lib/agent-control-plane/contracts/estimate-draft";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
  resolveEstimateDraftCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";
import {
  EstimateDraftRepositoryAuthorityError,
  EstimateDraftRepositoryBoundError,
  EstimateDraftRepositoryInputError,
  EstimateDraftRepositoryStaleError,
  EstimateDraftRepositoryUnavailableError,
  isTrustedEstimateDraftRepository,
  type EstimateDraftRepository,
} from "./estimate-draft-repository";

const CAPABILITY_ID = "prepare_estimate_from_past_job" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

export class EstimateDraftPrepareError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_ARGUMENT"
    | "RESULT_TOO_LARGE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: EstimateDraftPrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      INTERNAL: "The estimate preview could not be prepared.",
      INVALID_ARGUMENT:
        "Choose one open lead, one approved past estimate, and a valid percentage.",
      RESULT_TOO_LARGE: "The estimate preview exceeds a safe processing limit.",
      STALE_CONTEXT:
        "The lead, source job, pricing, or authority changed. Prepare the estimate again.",
      TEMPORARILY_UNAVAILABLE:
        "The estimate preview is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "EstimateDraftPrepareError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.code === "TEMPORARILY_UNAVAILABLE";
  }

  toAgentError() {
    if (this.code === "INVALID_ARGUMENT") {
      return AgentErrorSchema.parse({
        contract_version: CONTRACT_VERSION,
        code: "INVALID_ARGUMENT",
        request_id: this.requestId,
        message: this.message,
        retryable: false,
        details: {
          field_issues: [
            {
              path: [],
              code: "ESTIMATE_DRAFT_INPUT_INVALID",
              message: this.message,
            },
          ],
        },
      });
    }
    return toP2ReadAgentError({
      code: this.code,
      requestId: this.requestId,
      message: this.message,
      retryable: this.retryable,
    });
  }
}

export interface EstimateDraftService {
  prepareEstimateFromPastJob(
    actorContext: ActorContext,
    input: PrepareEstimateFromPastJobInput,
    options?: { signal?: AbortSignal }
  ): Promise<EstimateDraftResult>;
}

function authorizeEstimateDraft(
  actorContext: ActorContext,
  input: PrepareEstimateFromPastJobInput
): void {
  const resolved = resolveEstimateDraftCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1) {
    throw authorizationInternal(
      actorContext.requestId,
      "estimate_draft_authorization_variant_invalid"
    );
  }
  authorizeCapability({
    actorContext,
    policy: resolved.variants[0]!.policy,
  });
}

export function createEstimateDraftService(input: {
  repository: EstimateDraftRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
  maxOutputCharacters?: number;
}): EstimateDraftService {
  if (!isTrustedEstimateDraftRepository(input.repository)) {
    throw new TypeError("A trusted estimate draft repository is required");
  }
  if (!input.authorityRepository) {
    throw new TypeError("An estimate draft authority repository is required");
  }
  const now = input.now ?? (() => new Date());
  const maxOutputCharacters =
    input.maxOutputCharacters ?? ESTIMATE_DRAFT_MAX_OUTPUT_CHARACTERS;
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(maxOutputCharacters) ||
    maxOutputCharacters <= 0 ||
    maxOutputCharacters > ESTIMATE_DRAFT_MAX_OUTPUT_CHARACTERS
  ) {
    throw new TypeError("Estimate draft service options are invalid");
  }

  const service: EstimateDraftService = {
    async prepareEstimateFromPastJob(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "estimate_draft_actor_context_untrusted"
        );
      }
      let parsedInput: PrepareEstimateFromPastJobInput;
      try {
        parsedInput = PrepareEstimateFromPastJobInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new EstimateDraftPrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw error;
      }

      authorizeEstimateDraft(actorContext, parsedInput);
      try {
        const currentActor = await reauthorizeResolvedMcpActor({
          actorContext,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizeEstimateDraft(currentActor, parsedInput);

        const observedAt = now();
        if (Number.isNaN(observedAt.getTime())) {
          throw new Error("Invalid server clock");
        }
        const snapshot = await input.repository.readSourceSnapshot({
          actorContext: currentActor,
          observedAt: observedAt.toISOString(),
          input: parsedInput,
          signal: options?.signal,
        });
        let result: EstimateDraftResult;
        try {
          result = calculateEstimateDraft({
            snapshot,
            input: parsedInput,
            requestId: currentActor.requestId,
          });
        } catch (error) {
          if (error instanceof TypeError || error instanceof z.ZodError) {
            throw new EstimateDraftRepositoryStaleError();
          }
          throw error;
        }
        if (serializeUntrustedPromptData(result).length > maxOutputCharacters) {
          throw new EstimateDraftPrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: currentActor.requestId,
          });
        }

        const finalActor = await reauthorizeResolvedMcpActor({
          actorContext: currentActor,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizeEstimateDraft(finalActor, parsedInput);
        await input.repository.assertCurrentAuthority({
          actorContext: finalActor,
          input: parsedInput,
          expectedSourceRevision: snapshot.source_revision,
          signal: options?.signal,
        });
        return result;
      } catch (error) {
        if (
          error instanceof EstimateDraftPrepareError ||
          error instanceof ActorAccessError
        ) {
          throw error;
        }
        if (
          error instanceof EstimateDraftRepositoryAuthorityError ||
          error instanceof EstimateDraftRepositoryStaleError
        ) {
          throw new EstimateDraftPrepareError({
            code: "STALE_CONTEXT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof EstimateDraftRepositoryInputError) {
          throw new EstimateDraftPrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof EstimateDraftRepositoryBoundError) {
          throw new EstimateDraftPrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof EstimateDraftRepositoryUnavailableError) {
          throw new EstimateDraftPrepareError({
            code: "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new EstimateDraftPrepareError({
          code: "INTERNAL",
          requestId: actorContext.requestId,
          cause: error,
        });
      }
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedEstimateDraftService(
  value: unknown
): value is EstimateDraftService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
