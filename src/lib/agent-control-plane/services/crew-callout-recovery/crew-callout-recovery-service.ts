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
  CREW_CALLOUT_RECOVERY_MAX_OUTPUT_CHARACTERS,
  CrewCalloutRecoveryContractError,
  PrepareCrewCalloutRecoveryInputSchema,
  prepareCrewCalloutRecoveryPreview,
  type CrewCalloutRecoveryResult,
  type PrepareCrewCalloutRecoveryInput,
} from "@/lib/agent-control-plane/contracts/crew-callout-recovery";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION,
  resolveCrewCalloutRecoveryCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";
import {
  CrewCalloutRecoveryRepositoryAmbiguityError,
  CrewCalloutRecoveryRepositoryAuthorityError,
  CrewCalloutRecoveryRepositoryBoundError,
  CrewCalloutRecoveryRepositoryInputError,
  CrewCalloutRecoveryRepositoryStaleError,
  CrewCalloutRecoveryRepositoryUnavailableError,
  isTrustedCrewCalloutRecoveryRepository,
  type CrewCalloutRecoveryRepository,
} from "./crew-callout-recovery-repository";

const CAPABILITY_ID = "prepare_crew_callout_recovery" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

export class CrewCalloutRecoveryPrepareError extends Error {
  readonly code:
    | "AMBIGUOUS"
    | "INTERNAL"
    | "INVALID_ARGUMENT"
    | "RESULT_TOO_LARGE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: CrewCalloutRecoveryPrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      AMBIGUOUS: "That crew member is not an exact, unique match.",
      INTERNAL: "The crew recovery preview could not be prepared.",
      INVALID_ARGUMENT:
        "Enter one current crew name and one current or upcoming date.",
      RESULT_TOO_LARGE:
        "The crew recovery preview exceeds a safe processing limit.",
      STALE_CONTEXT:
        "The crew, schedule, recipient, or authority changed. Prepare the recovery again.",
      TEMPORARILY_UNAVAILABLE:
        "The crew recovery preview is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "CrewCalloutRecoveryPrepareError";
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
              path: ["crew_member_name", "target_date"],
              code: "CREW_CALLOUT_INPUT_INVALID",
              message: this.message,
            },
          ],
        },
      });
    }
    if (this.code === "AMBIGUOUS") {
      return AgentErrorSchema.parse({
        contract_version: CONTRACT_VERSION,
        code: "AMBIGUOUS",
        request_id: this.requestId,
        message: this.message,
        retryable: false,
        details: {
          candidate_count: 2,
          resolution_hint: "Use the crew member's exact full name.",
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

export interface CrewCalloutRecoveryService {
  prepareCrewCalloutRecovery(
    actorContext: ActorContext,
    input: PrepareCrewCalloutRecoveryInput,
    options?: { signal?: AbortSignal }
  ): Promise<CrewCalloutRecoveryResult>;
}

function authorizeCrewCalloutRecovery(
  actorContext: ActorContext,
  input: PrepareCrewCalloutRecoveryInput
): void {
  const resolved = resolveCrewCalloutRecoveryCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1) {
    throw authorizationInternal(
      actorContext.requestId,
      "crew_callout_recovery_authorization_variant_invalid"
    );
  }
  authorizeCapability({ actorContext, policy: resolved.variants[0]!.policy });
}

export function createCrewCalloutRecoveryService(input: {
  repository: CrewCalloutRecoveryRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
  maxOutputCharacters?: number;
}): CrewCalloutRecoveryService {
  if (!isTrustedCrewCalloutRecoveryRepository(input.repository)) {
    throw new TypeError(
      "A trusted crew call-out recovery repository is required"
    );
  }
  if (!input.authorityRepository) {
    throw new TypeError(
      "A crew call-out recovery authority repository is required"
    );
  }
  const now = input.now ?? (() => new Date());
  const maxOutputCharacters =
    input.maxOutputCharacters ?? CREW_CALLOUT_RECOVERY_MAX_OUTPUT_CHARACTERS;
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(maxOutputCharacters) ||
    maxOutputCharacters <= 0 ||
    maxOutputCharacters > CREW_CALLOUT_RECOVERY_MAX_OUTPUT_CHARACTERS
  ) {
    throw new TypeError("Crew call-out recovery service options are invalid");
  }

  const service: CrewCalloutRecoveryService = {
    async prepareCrewCalloutRecovery(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "crew_callout_actor_context_untrusted"
        );
      }
      let parsedInput: PrepareCrewCalloutRecoveryInput;
      try {
        parsedInput = PrepareCrewCalloutRecoveryInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new CrewCalloutRecoveryPrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw error;
      }
      authorizeCrewCalloutRecovery(actorContext, parsedInput);
      try {
        const currentActor = await reauthorizeResolvedMcpActor({
          actorContext,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizeCrewCalloutRecovery(currentActor, parsedInput);
        const observedAt = now();
        if (Number.isNaN(observedAt.getTime()))
          throw new Error("Invalid server clock");
        const observedAtText = observedAt.toISOString();
        const snapshot = await input.repository.readSourceSnapshot({
          actorContext: currentActor,
          observedAt: observedAtText,
          input: parsedInput,
          signal: options?.signal,
        });
        const result = prepareCrewCalloutRecoveryPreview({
          requestId: currentActor.requestId,
          input: parsedInput,
          snapshot,
        });
        if (serializeUntrustedPromptData(result).length > maxOutputCharacters) {
          throw new CrewCalloutRecoveryPrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: currentActor.requestId,
          });
        }
        const finalActor = await reauthorizeResolvedMcpActor({
          actorContext: currentActor,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizeCrewCalloutRecovery(finalActor, parsedInput);
        await input.repository.assertCurrentAuthority({
          actorContext: finalActor,
          observedAt: observedAtText,
          input: parsedInput,
          expectedSourceRevision: snapshot.source_revision,
          signal: options?.signal,
        });
        return result;
      } catch (error) {
        if (
          error instanceof CrewCalloutRecoveryPrepareError ||
          error instanceof ActorAccessError
        ) {
          throw error;
        }
        if (error instanceof CrewCalloutRecoveryContractError) {
          throw new CrewCalloutRecoveryPrepareError({
            code: error.code,
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof CrewCalloutRecoveryRepositoryAmbiguityError) {
          throw new CrewCalloutRecoveryPrepareError({
            code: "AMBIGUOUS",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (
          error instanceof CrewCalloutRecoveryRepositoryAuthorityError ||
          error instanceof CrewCalloutRecoveryRepositoryStaleError
        ) {
          throw new CrewCalloutRecoveryPrepareError({
            code: "STALE_CONTEXT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof CrewCalloutRecoveryRepositoryInputError) {
          throw new CrewCalloutRecoveryPrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof CrewCalloutRecoveryRepositoryBoundError) {
          throw new CrewCalloutRecoveryPrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof CrewCalloutRecoveryRepositoryUnavailableError) {
          throw new CrewCalloutRecoveryPrepareError({
            code: "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new CrewCalloutRecoveryPrepareError({
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

export function isTrustedCrewCalloutRecoveryService(
  value: unknown
): value is CrewCalloutRecoveryService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
