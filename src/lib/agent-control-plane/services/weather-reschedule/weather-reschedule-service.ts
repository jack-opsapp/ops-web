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
import { AgentErrorSchema, CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts";
import {
  PrepareWeatherRescheduleInputSchema,
  WEATHER_RESCHEDULE_MAX_OUTPUT_CHARACTERS,
  WeatherRescheduleContractError,
  prepareWeatherReschedulePreview,
  type PrepareWeatherRescheduleInput,
  type WeatherRescheduleResult,
} from "@/lib/agent-control-plane/contracts/weather-reschedule";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION,
  resolveWeatherRescheduleCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";
import {
  WeatherRescheduleRepositoryAuthorityError,
  WeatherRescheduleRepositoryBoundError,
  WeatherRescheduleRepositoryInputError,
  WeatherRescheduleRepositoryStaleError,
  WeatherRescheduleRepositoryUnavailableError,
  isTrustedWeatherRescheduleRepository,
  type WeatherRescheduleRepository,
} from "./weather-reschedule-repository";

const CAPABILITY_ID = "prepare_weather_reschedule" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

export class WeatherReschedulePrepareError extends Error {
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
    code: WeatherReschedulePrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      AMBIGUOUS:
        "The schedule cannot be changed safely from the available facts.",
      INTERNAL: "The weather reschedule preview could not be prepared.",
      INVALID_ARGUMENT: "Choose one current or upcoming schedule date.",
      RESULT_TOO_LARGE:
        "The weather reschedule preview exceeds a safe processing limit.",
      STALE_CONTEXT:
        "The schedule, forecast, recipient, or authority changed. Prepare the update again.",
      TEMPORARILY_UNAVAILABLE:
        "The weather reschedule preview is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "WeatherReschedulePrepareError";
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
              path: ["target_date"],
              code: "WEATHER_RESCHEDULE_INPUT_INVALID",
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
          candidate_count: 1,
          resolution_hint:
            "Review the schedule, crew, weather, and recipient details before preparing this update again.",
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

export interface WeatherRescheduleService {
  prepareWeatherReschedule(
    actorContext: ActorContext,
    input: PrepareWeatherRescheduleInput,
    options?: { signal?: AbortSignal }
  ): Promise<WeatherRescheduleResult>;
}

function authorizeWeatherReschedule(
  actorContext: ActorContext,
  input: PrepareWeatherRescheduleInput
): void {
  const resolved = resolveWeatherRescheduleCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1) {
    throw authorizationInternal(
      actorContext.requestId,
      "weather_reschedule_authorization_variant_invalid"
    );
  }
  authorizeCapability({
    actorContext,
    policy: resolved.variants[0]!.policy,
  });
}

export function createWeatherRescheduleService(input: {
  repository: WeatherRescheduleRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
  maxOutputCharacters?: number;
}): WeatherRescheduleService {
  if (!isTrustedWeatherRescheduleRepository(input.repository)) {
    throw new TypeError("A trusted weather reschedule repository is required");
  }
  if (!input.authorityRepository) {
    throw new TypeError("A weather reschedule authority repository is required");
  }
  const now = input.now ?? (() => new Date());
  const maxOutputCharacters =
    input.maxOutputCharacters ?? WEATHER_RESCHEDULE_MAX_OUTPUT_CHARACTERS;
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(maxOutputCharacters) ||
    maxOutputCharacters <= 0 ||
    maxOutputCharacters > WEATHER_RESCHEDULE_MAX_OUTPUT_CHARACTERS
  ) {
    throw new TypeError("Weather reschedule service options are invalid");
  }

  const service: WeatherRescheduleService = {
    async prepareWeatherReschedule(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "weather_reschedule_actor_context_untrusted"
        );
      }
      let parsedInput: PrepareWeatherRescheduleInput;
      try {
        parsedInput = PrepareWeatherRescheduleInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new WeatherReschedulePrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw error;
      }

      authorizeWeatherReschedule(actorContext, parsedInput);
      try {
        const currentActor = await reauthorizeResolvedMcpActor({
          actorContext,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizeWeatherReschedule(currentActor, parsedInput);

        const observedAt = now();
        if (Number.isNaN(observedAt.getTime())) {
          throw new Error("Invalid server clock");
        }
        const observedAtText = observedAt.toISOString();
        const snapshot = await input.repository.readSourceSnapshot({
          actorContext: currentActor,
          observedAt: observedAtText,
          input: parsedInput,
          signal: options?.signal,
        });
        const result = prepareWeatherReschedulePreview({
          requestId: currentActor.requestId,
          input: parsedInput,
          snapshot,
        });
        if (serializeUntrustedPromptData(result).length > maxOutputCharacters) {
          throw new WeatherReschedulePrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: currentActor.requestId,
          });
        }

        const finalActor = await reauthorizeResolvedMcpActor({
          actorContext: currentActor,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizeWeatherReschedule(finalActor, parsedInput);
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
          error instanceof WeatherReschedulePrepareError ||
          error instanceof ActorAccessError
        ) {
          throw error;
        }
        if (error instanceof WeatherRescheduleContractError) {
          throw new WeatherReschedulePrepareError({
            code: error.code,
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (
          error instanceof WeatherRescheduleRepositoryAuthorityError ||
          error instanceof WeatherRescheduleRepositoryStaleError
        ) {
          throw new WeatherReschedulePrepareError({
            code: "STALE_CONTEXT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof WeatherRescheduleRepositoryInputError) {
          throw new WeatherReschedulePrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof WeatherRescheduleRepositoryBoundError) {
          throw new WeatherReschedulePrepareError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof WeatherRescheduleRepositoryUnavailableError) {
          throw new WeatherReschedulePrepareError({
            code: "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new WeatherReschedulePrepareError({
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

export function isTrustedWeatherRescheduleService(
  value: unknown
): value is WeatherRescheduleService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
