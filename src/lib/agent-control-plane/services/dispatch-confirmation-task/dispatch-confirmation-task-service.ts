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
  PrepareDispatchConfirmationTaskInputSchema,
  type DispatchConfirmationTaskResult,
  type PrepareDispatchConfirmationTaskInput,
} from "@/lib/agent-control-plane/contracts/dispatch-confirmation-task";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION,
  resolveDispatchConfirmationTaskCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  DispatchConfirmationTaskRepositoryError,
  isTrustedDispatchConfirmationTaskRepository,
  type DispatchConfirmationTaskRepository,
} from "./dispatch-confirmation-task-repository";

const CAPABILITY_ID = "prepare_dispatch_confirmation_task" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

export class DispatchConfirmationTaskPrepareError extends Error {
  readonly code:
    | "CONFLICT"
    | "INVALID_ARGUMENT"
    | "POLICY_UNAVAILABLE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  constructor(input: {
    code: DispatchConfirmationTaskPrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      CONFLICT: "That request key is already bound to different evidence.",
      INVALID_ARGUMENT: "The dispatch task request is invalid.",
      POLICY_UNAVAILABLE: "The exact company dispatch policy is not available.",
      STALE_CONTEXT:
        "The dispatch, policy, or authority changed. Review the control room again.",
      TEMPORARILY_UNAVAILABLE:
        "The dispatch task proposal is temporarily unavailable.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "DispatchConfirmationTaskPrepareError";
    this.code = input.code;
    this.requestId = input.requestId;
  }

  toAgentError() {
    if (this.code === "INVALID_ARGUMENT" || this.code === "CONFLICT") {
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
                  ? "DISPATCH_CONFIRMATION_IDEMPOTENCY_CONFLICT"
                  : "DISPATCH_CONFIRMATION_INPUT_INVALID",
              message: this.message,
            },
          ],
        },
      });
    }
    return toP2ReadAgentError({
      // The database intentionally does not disclose current schedule, policy,
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

export interface DispatchConfirmationTaskService {
  prepareDispatchConfirmationTask(
    actorContext: ActorContext,
    input: PrepareDispatchConfirmationTaskInput,
    options?: { signal?: AbortSignal }
  ): Promise<DispatchConfirmationTaskResult>;
}

function authorize(
  actorContext: ActorContext,
  input: PrepareDispatchConfirmationTaskInput
) {
  const resolved = resolveDispatchConfirmationTaskCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1)
    throw authorizationInternal(
      actorContext.requestId,
      "dispatch_confirmation_authorization_variant_invalid"
    );
  authorizeCapability({ actorContext, policy: resolved.variants[0]!.policy });
}

export function createDispatchConfirmationTaskService(input: {
  repository: DispatchConfirmationTaskRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): DispatchConfirmationTaskService {
  if (!isTrustedDispatchConfirmationTaskRepository(input.repository))
    throw new TypeError(
      "A trusted dispatch confirmation task repository is required"
    );
  if (!input.authorityRepository)
    throw new TypeError(
      "A dispatch confirmation authority repository is required"
    );
  const now = input.now ?? (() => new Date());
  if (typeof now !== "function")
    throw new TypeError("A valid clock is required");

  const service: DispatchConfirmationTaskService = {
    async prepareDispatchConfirmationTask(actorContext, rawInput, options) {
      if (!isActorContext(actorContext))
        throw authorizationInternal(
          "unknown-request",
          "dispatch_confirmation_actor_untrusted"
        );
      let request: PrepareDispatchConfirmationTaskInput;
      try {
        request = PrepareDispatchConfirmationTaskInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new DispatchConfirmationTaskPrepareError({
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
            DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION,
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
          error instanceof DispatchConfirmationTaskPrepareError
        )
          throw error;
        if (error instanceof DispatchConfirmationTaskRepositoryError) {
          const code =
            error.code === "CONFLICT"
              ? "CONFLICT"
              : error.code === "POLICY"
                ? "POLICY_UNAVAILABLE"
                : error.code === "STALE"
                  ? "STALE_CONTEXT"
                  : "TEMPORARILY_UNAVAILABLE";
          throw new DispatchConfirmationTaskPrepareError({
            code,
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new DispatchConfirmationTaskPrepareError({
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

export function isTrustedDispatchConfirmationTaskService(
  value: unknown
): value is DispatchConfirmationTaskService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
