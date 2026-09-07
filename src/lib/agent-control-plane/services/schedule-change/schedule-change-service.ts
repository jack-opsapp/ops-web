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
  PrepareScheduleChangeInputSchema,
  type ScheduleChangeResult,
  type PrepareScheduleChangeInput,
} from "@/lib/agent-control-plane/contracts/schedule-change";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  SCHEDULE_CHANGE_CAPABILITY_MANIFEST_REVISION,
  resolveScheduleChangeCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  ScheduleChangeRepositoryError,
  isTrustedScheduleChangeRepository,
  type ScheduleChangeRepository,
} from "./schedule-change-repository";

const CAPABILITY_ID = "prepare_schedule_change" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

export class ScheduleChangePrepareError extends Error {
  readonly code:
    | "CONFLICT"
    | "INVALID_ARGUMENT"
    | "NO_CHANGE"
    | "POLICY_UNAVAILABLE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  constructor(input: {
    code: ScheduleChangePrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      CONFLICT: "That request key is already bound to different evidence.",
      INVALID_ARGUMENT: "The schedule change request is invalid.",
      NO_CHANGE:
        "The requested values already match this record. No proposal was created.",
      POLICY_UNAVAILABLE:
        "The exact company schedule change policy is not available.",
      STALE_CONTEXT:
        "The record, policy, or authority changed. Review the control room again.",
      TEMPORARILY_UNAVAILABLE:
        "The schedule change proposal is temporarily unavailable.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "ScheduleChangePrepareError";
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
                  ? "SCHEDULE_CHANGE_IDEMPOTENCY_CONFLICT"
                  : this.code === "NO_CHANGE"
                    ? "SCHEDULE_CHANGE_NO_CHANGE"
                    : "SCHEDULE_CHANGE_INPUT_INVALID",
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

export interface ScheduleChangeService {
  prepareScheduleChange(
    actorContext: ActorContext,
    input: PrepareScheduleChangeInput,
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleChangeResult>;
}

function authorize(
  actorContext: ActorContext,
  input: PrepareScheduleChangeInput
) {
  const resolved = resolveScheduleChangeCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1)
    throw authorizationInternal(
      actorContext.requestId,
      "schedule_change_authorization_variant_invalid"
    );
  authorizeCapability({ actorContext, policy: resolved.variants[0]!.policy });
}

export function createScheduleChangeService(input: {
  repository: ScheduleChangeRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): ScheduleChangeService {
  if (!isTrustedScheduleChangeRepository(input.repository))
    throw new TypeError("A trusted schedule change repository is required");
  if (!input.authorityRepository)
    throw new TypeError("A schedule change authority repository is required");
  const now = input.now ?? (() => new Date());
  if (typeof now !== "function")
    throw new TypeError("A valid clock is required");

  const service: ScheduleChangeService = {
    async prepareScheduleChange(actorContext, rawInput, options) {
      if (!isActorContext(actorContext))
        throw authorizationInternal(
          "unknown-request",
          "schedule_change_actor_untrusted"
        );
      let request: PrepareScheduleChangeInput;
      try {
        request = PrepareScheduleChangeInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new ScheduleChangePrepareError({
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
            SCHEDULE_CHANGE_CAPABILITY_MANIFEST_REVISION,
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
          error instanceof ScheduleChangePrepareError
        )
          throw error;
        if (error instanceof ScheduleChangeRepositoryError) {
          const code =
            error.code === "CONFLICT" || error.code === "NO_CHANGE"
              ? error.code
              : error.code === "POLICY"
                ? "POLICY_UNAVAILABLE"
                : error.code === "STALE"
                  ? "STALE_CONTEXT"
                  : "TEMPORARILY_UNAVAILABLE";
          throw new ScheduleChangePrepareError({
            code,
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new ScheduleChangePrepareError({
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

export function isTrustedScheduleChangeService(
  value: unknown
): value is ScheduleChangeService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
