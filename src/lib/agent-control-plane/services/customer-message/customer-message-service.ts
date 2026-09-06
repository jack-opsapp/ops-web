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
  CustomerMessagePrepareInputSchema,
  type CustomerMessagePrepareInput,
  type CustomerMessagePrepareResult,
} from "@/lib/agent-control-plane/contracts/customer-message";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  CUSTOMER_MESSAGE_CAPABILITY_MANIFEST_REVISION,
  resolveCustomerMessageCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  isTrustedCustomerMessageRepository,
  CustomerMessageRepositoryError,
  type CustomerMessageRepository,
} from "./customer-message-repository";

const TRUSTED_SERVICES = new WeakSet<object>();
export class CustomerMessagePrepareError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "CONFLICT"
    | "STALE_CONTEXT"
    | "POLICY_UNAVAILABLE"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  constructor(input: {
    code: CustomerMessagePrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const message =
      input.code === "INVALID_ARGUMENT"
        ? "The customer message request is invalid."
        : input.code === "CONFLICT"
          ? "That request key is already bound to another message."
          : input.code === "STALE_CONTEXT"
            ? "The correspondence, recipient, mailbox, or authority changed. Review the latest conversation again."
            : input.code === "POLICY_UNAVAILABLE"
              ? "The exact customer message policy is unavailable."
              : "The customer message proposal is temporarily unavailable.";
    super(message, { cause: input.cause });
    this.name = "CustomerMessagePrepareError";
    this.code = input.code;
    this.requestId = input.requestId;
  }
}
export interface CustomerMessageService {
  prepareCustomerMessage(
    actorContext: ActorContext,
    input: CustomerMessagePrepareInput,
    options?: { signal?: AbortSignal }
  ): Promise<CustomerMessagePrepareResult>;
}
export function createCustomerMessageService(input: {
  repository: CustomerMessageRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): CustomerMessageService {
  if (!isTrustedCustomerMessageRepository(input.repository))
    throw new TypeError("A trusted customer message repository is required");
  const now = input.now ?? (() => new Date());
  const service: CustomerMessageService = {
    async prepareCustomerMessage(actorContext, raw, options) {
      if (!isActorContext(actorContext))
        throw authorizationInternal(
          "unknown-request",
          "customer_message_actor_untrusted"
        );
      let request: CustomerMessagePrepareInput;
      try {
        request = CustomerMessagePrepareInputSchema.parse(raw);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new CustomerMessagePrepareError({
            code: "INVALID_ARGUMENT",
            requestId: actorContext.requestId,
            cause: error,
          });
        throw error;
      }
      const resolved = resolveCustomerMessageCapabilityAuthorization(
        "prepare_customer_message",
        request
      );
      if (resolved.variants.length !== 1)
        throw authorizationInternal(
          actorContext.requestId,
          "customer_message_authorization_variant_invalid"
        );
      authorizeCapability({
        actorContext,
        policy: resolved.variants[0]!.policy,
      });
      try {
        const current = await reauthorizeResolvedMcpActor({
          actorContext,
          authorityRepository: input.authorityRepository,
          capabilityManifestRevision:
            CUSTOMER_MESSAGE_CAPABILITY_MANIFEST_REVISION,
          signal: options?.signal,
        });
        authorizeCapability({
          actorContext: current,
          policy: resolved.variants[0]!.policy,
        });
        return await input.repository.prepare({
          actorContext: current,
          request,
          observedAt: now().toISOString(),
          signal: options?.signal,
        });
      } catch (error) {
        if (
          error instanceof ActorAccessError ||
          error instanceof CustomerMessagePrepareError
        )
          throw error;
        if (error instanceof CustomerMessageRepositoryError)
          throw new CustomerMessagePrepareError({
            code:
              error.code === "CONFLICT"
                ? "CONFLICT"
                : error.code === "STALE"
                  ? "STALE_CONTEXT"
                  : error.code === "POLICY"
                    ? "POLICY_UNAVAILABLE"
                    : "TEMPORARILY_UNAVAILABLE",
            requestId: actorContext.requestId,
            cause: error,
          });
        throw new CustomerMessagePrepareError({
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
export function isTrustedCustomerMessageService(
  value: unknown
): value is CustomerMessageService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
