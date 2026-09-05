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
  PrepareCustomerUpdateInputSchema,
  type CustomerUpdateResult,
  type PrepareCustomerUpdateInput,
} from "@/lib/agent-control-plane/contracts/customer-update";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION,
  resolveCustomerUpdateCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  CustomerUpdateRepositoryError,
  isTrustedCustomerUpdateRepository,
  type CustomerUpdateRepository,
} from "./customer-update-repository";

const CAPABILITY_ID = "prepare_customer_update" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

export class CustomerUpdatePrepareError extends Error {
  readonly code:
    | "CONFLICT"
    | "INVALID_ARGUMENT"
    | "POLICY_UNAVAILABLE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  constructor(input: {
    code: CustomerUpdatePrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      CONFLICT: "That request key is already bound to different evidence.",
      INVALID_ARGUMENT: "The customer update request is invalid.",
      POLICY_UNAVAILABLE:
        "The exact company customer update policy is not available.",
      STALE_CONTEXT:
        "The record, policy, or authority changed. Review the control room again.",
      TEMPORARILY_UNAVAILABLE:
        "The customer update proposal is temporarily unavailable.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "CustomerUpdatePrepareError";
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
                  ? "CUSTOMER_UPDATE_IDEMPOTENCY_CONFLICT"
                  : "CUSTOMER_UPDATE_INPUT_INVALID",
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

export interface CustomerUpdateService {
  prepareCustomerUpdate(
    actorContext: ActorContext,
    input: PrepareCustomerUpdateInput,
    options?: { signal?: AbortSignal }
  ): Promise<CustomerUpdateResult>;
}

function authorize(
  actorContext: ActorContext,
  input: PrepareCustomerUpdateInput
) {
  const resolved = resolveCustomerUpdateCapabilityAuthorization(
    CAPABILITY_ID,
    input
  );
  if (resolved.variants.length !== 1)
    throw authorizationInternal(
      actorContext.requestId,
      "customer_update_authorization_variant_invalid"
    );
  authorizeCapability({ actorContext, policy: resolved.variants[0]!.policy });
}

export function createCustomerUpdateService(input: {
  repository: CustomerUpdateRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): CustomerUpdateService {
  if (!isTrustedCustomerUpdateRepository(input.repository))
    throw new TypeError("A trusted customer update repository is required");
  if (!input.authorityRepository)
    throw new TypeError("A customer update authority repository is required");
  const now = input.now ?? (() => new Date());
  if (typeof now !== "function")
    throw new TypeError("A valid clock is required");

  const service: CustomerUpdateService = {
    async prepareCustomerUpdate(actorContext, rawInput, options) {
      if (!isActorContext(actorContext))
        throw authorizationInternal(
          "unknown-request",
          "customer_update_actor_untrusted"
        );
      let request: PrepareCustomerUpdateInput;
      try {
        request = PrepareCustomerUpdateInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new CustomerUpdatePrepareError({
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
            CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION,
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
          error instanceof CustomerUpdatePrepareError
        )
          throw error;
        if (error instanceof CustomerUpdateRepositoryError) {
          const code =
            error.code === "CONFLICT"
              ? "CONFLICT"
              : error.code === "POLICY"
                ? "POLICY_UNAVAILABLE"
                : error.code === "STALE"
                  ? "STALE_CONTEXT"
                  : "TEMPORARILY_UNAVAILABLE";
          throw new CustomerUpdatePrepareError({
            code,
            requestId: actorContext.requestId,
            cause: error,
          });
        }
        throw new CustomerUpdatePrepareError({
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

export function isTrustedCustomerUpdateService(
  value: unknown
): value is CustomerUpdateService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
