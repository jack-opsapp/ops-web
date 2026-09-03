import "server-only";

import { z } from "zod-v4";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  AnalyzeHiringBreakEvenInputSchema,
  HiringWhatIfHourlyCostPrecisionError,
  calculateHiringWhatIf,
  type AnalyzeHiringBreakEvenInput,
  type HiringWhatIfResult,
} from "@/lib/agent-control-plane/contracts/hiring-what-if";
import {
  AgentErrorSchema,
  CONTRACT_VERSION,
} from "@/lib/agent-control-plane/contracts";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
  HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
  resolveEstimateDraftCapabilityAuthorization,
  resolveHiringWhatIfCapabilityAuthorization,
  resolveRecurringServicePriceChangeCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  HiringWhatIfRepositoryUnavailableError,
  isTrustedHiringWhatIfRepository,
  type HiringWhatIfRepository,
} from "./hiring-what-if-repository";

const CAPABILITY_ID = "analyze_hiring_break_even" as const;
const DEFAULT_MAX_OUTPUT_CHARACTERS = 120_000;
const TRUSTED_SERVICES = new WeakSet<object>();

export class HiringWhatIfReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_ARGUMENT"
    | "RESULT_TOO_LARGE"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: HiringWhatIfReadError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      INTERNAL: "The hiring analysis could not be completed.",
      INVALID_ARGUMENT: "Enter one current role and an all-in hourly cost.",
      RESULT_TOO_LARGE: "The hiring analysis is too large to return.",
      TEMPORARILY_UNAVAILABLE:
        "The hiring analysis is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "HiringWhatIfReadError";
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
              path: ["role", "hourly_cost"],
              code: "INVALID_HIRING_SCENARIO",
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

export interface HiringWhatIfService {
  analyzeHiringBreakEven(
    actorContext: ActorContext,
    input: AnalyzeHiringBreakEvenInput,
    options?: { signal?: AbortSignal }
  ): Promise<HiringWhatIfResult>;
}

export function createHiringWhatIfService(input: {
  repository: HiringWhatIfRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
  maxOutputCharacters?: number;
}): HiringWhatIfService {
  if (!isTrustedHiringWhatIfRepository(input.repository)) {
    throw new TypeError("A trusted hiring analysis repository is required");
  }
  if (!input.authorityRepository) {
    throw new TypeError("A hiring analysis authority repository is required");
  }
  const now = input.now ?? (() => new Date());
  const maxOutputCharacters =
    input.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS;
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(maxOutputCharacters) ||
    maxOutputCharacters <= 0 ||
    maxOutputCharacters > DEFAULT_MAX_OUTPUT_CHARACTERS
  ) {
    throw new TypeError("Hiring analysis service options are invalid");
  }

  const service: HiringWhatIfService = {
    async analyzeHiringBreakEven(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "hiring_what_if_actor_context_untrusted"
        );
      }
      let parsedInput: z.infer<typeof AnalyzeHiringBreakEvenInputSchema>;
      try {
        parsedInput = AnalyzeHiringBreakEvenInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new HiringWhatIfReadError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw error;
      }

      const usesAdditiveV10Manifest =
        actorContext.capabilityManifestRevision ===
        ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION;
      const usesAdditiveV9Manifest =
        actorContext.capabilityManifestRevision ===
        RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION;
      const resolveAuthorization = usesAdditiveV10Manifest
        ? resolveEstimateDraftCapabilityAuthorization
        : usesAdditiveV9Manifest
          ? resolveRecurringServicePriceChangeCapabilityAuthorization
          : resolveHiringWhatIfCapabilityAuthorization;
      const authorizationManifestRevision = usesAdditiveV10Manifest
        ? ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION
        : usesAdditiveV9Manifest
          ? RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION
          : HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION;
      const initialAuthorization = resolveAuthorization(
        CAPABILITY_ID,
        parsedInput
      );
      if (initialAuthorization.variants.length !== 1) {
        throw authorizationInternal(
          actorContext.requestId,
          "hiring_what_if_authorization_variant_invalid"
        );
      }
      authorizeCapability({
        actorContext,
        policy: initialAuthorization.variants[0]!.policy,
      });
      const currentActor = await reauthorizeResolvedMcpActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        capabilityManifestRevision: authorizationManifestRevision,
        signal: options?.signal,
      });
      const currentAuthorization = resolveAuthorization(
        CAPABILITY_ID,
        parsedInput
      );
      authorizeCapability({
        actorContext: currentActor,
        policy: currentAuthorization.variants[0]!.policy,
      });

      try {
        const source = await input.repository.readSourceSnapshot({
          actorContext: currentActor,
          role: parsedInput.role,
          observedAt: now().toISOString(),
          signal: options?.signal,
        });
        const result = calculateHiringWhatIf(source, parsedInput);
        if (JSON.stringify(result).length > maxOutputCharacters) {
          throw new HiringWhatIfReadError({
            code: "RESULT_TOO_LARGE",
            requestId: actorContext.requestId,
          });
        }
        return result;
      } catch (error) {
        if (error instanceof HiringWhatIfReadError) throw error;
        if (error instanceof HiringWhatIfHourlyCostPrecisionError) {
          throw new HiringWhatIfReadError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        if (error instanceof HiringWhatIfRepositoryUnavailableError) {
          throw new HiringWhatIfReadError({
            code: "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new HiringWhatIfReadError({
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

export function isTrustedHiringWhatIfService(
  value: unknown
): value is HiringWhatIfService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
