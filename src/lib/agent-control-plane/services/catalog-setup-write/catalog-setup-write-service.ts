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
  PrepareCreateCatalogVariantInputSchema,
  PrepareSetCatalogPricingInputSchema,
  PrepareSetSupplierCostInputSchema,
  PrepareSetVariantThresholdsInputSchema,
  type CatalogSetupWriteResult,
  type PrepareCreateCatalogVariantInput,
  type PrepareSetCatalogPricingInput,
  type PrepareSetSupplierCostInput,
  type PrepareSetVariantThresholdsInput,
} from "@/lib/agent-control-plane/contracts/catalog-setup-write";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION,
  resolveCatalogSetupWriteCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { toP2ReadAgentError } from "@/lib/agent-control-plane/services/p2/shared/read-error-transport";
import {
  CatalogSetupWriteRepositoryError,
  isTrustedCatalogSetupWriteRepository,
  type CatalogSetupWriteRepository,
} from "./catalog-setup-write-repository";

const TRUSTED_SERVICES = new WeakSet<object>();

export class CatalogSetupWritePrepareError extends Error {
  readonly code:
    | "CONFLICT"
    | "DUPLICATE"
    | "INVALID_ARGUMENT"
    | "POLICY_UNAVAILABLE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  constructor(input: {
    code: CatalogSetupWritePrepareError["code"];
    requestId: string;
    cause?: unknown;
  }) {
    const messages = {
      CONFLICT: "That request key is already bound to a different change.",
      DUPLICATE:
        "A variant with those option values already exists on this family.",
      INVALID_ARGUMENT: "The catalogue change request is invalid.",
      POLICY_UNAVAILABLE:
        "Catalogue changes are not turned on for this company yet.",
      STALE_CONTEXT:
        "The family, policy or authority changed. Read the family again.",
      TEMPORARILY_UNAVAILABLE:
        "The catalogue change proposal is temporarily unavailable.",
    } as const;
    super(messages[input.code], { cause: input.cause });
    this.name = "CatalogSetupWritePrepareError";
    this.code = input.code;
    this.requestId = input.requestId;
  }

  toAgentError() {
    if (
      this.code === "INVALID_ARGUMENT" ||
      this.code === "CONFLICT" ||
      this.code === "DUPLICATE"
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
                  ? "CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT"
                  : this.code === "DUPLICATE"
                    ? "CATALOG_SETUP_VARIANT_EXISTS"
                    : "CATALOG_SETUP_WRITE_INPUT_INVALID",
              message: this.message,
            },
          ],
        },
      });
    }
    // The database deliberately discloses no current family revision through
    // this write-preparation boundary, so a stale or dormant policy projects to
    // the shared transport rather than fabricating a version marker.
    return toP2ReadAgentError({
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

export interface CatalogSetupWriteService {
  prepareCreateCatalogVariant(
    actorContext: ActorContext,
    input: PrepareCreateCatalogVariantInput,
    options?: { signal?: AbortSignal }
  ): Promise<CatalogSetupWriteResult>;
  prepareSetVariantThresholds(
    actorContext: ActorContext,
    input: PrepareSetVariantThresholdsInput,
    options?: { signal?: AbortSignal }
  ): Promise<CatalogSetupWriteResult>;
  prepareSetCatalogPricing(
    actorContext: ActorContext,
    input: PrepareSetCatalogPricingInput,
    options?: { signal?: AbortSignal }
  ): Promise<CatalogSetupWriteResult>;
  prepareSetSupplierCost(
    actorContext: ActorContext,
    input: PrepareSetSupplierCostInput,
    options?: { signal?: AbortSignal }
  ): Promise<CatalogSetupWriteResult>;
}

function authorize(
  actorContext: ActorContext,
  capabilityId: string,
  input: unknown
) {
  const resolved = resolveCatalogSetupWriteCapabilityAuthorization(
    capabilityId,
    input
  );
  if (resolved.variants.length < 1) {
    throw authorizationInternal(
      actorContext.requestId,
      "catalog_setup_write_authorization_variant_invalid"
    );
  }
  for (const variant of resolved.variants) {
    authorizeCapability({ actorContext, policy: variant.policy });
  }
}

export function createCatalogSetupWriteService(input: {
  repository: CatalogSetupWriteRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): CatalogSetupWriteService {
  if (!isTrustedCatalogSetupWriteRepository(input.repository)) {
    throw new TypeError("A trusted catalogue setup write repository is required");
  }
  if (!input.authorityRepository) {
    throw new TypeError("A catalogue setup write authority repository is required");
  }
  const now = input.now ?? (() => new Date());
  if (typeof now !== "function") {
    throw new TypeError("A valid clock is required");
  }

  /**
   * Every kind runs the same gate: trusted actor, its own zod parse,
   * capability authorization, a fresh authority re-read, capability
   * authorization again against that fresh authority, then the repository. The
   * per-kind part is the schema, the capability id and the repository call.
   */
  async function prepare<Input>(args: {
    actorContext: ActorContext;
    rawInput: unknown;
    options?: { signal?: AbortSignal };
    capabilityId: string;
    schema: { parse(value: unknown): Input };
    send(current: ActorContext, request: Input, observedAt: string): Promise<CatalogSetupWriteResult>;
  }): Promise<CatalogSetupWriteResult> {
    const { actorContext, rawInput, options, capabilityId, schema } = args;
    if (!isActorContext(actorContext)) {
      throw authorizationInternal(
        "unknown-request",
        "catalog_setup_write_actor_untrusted"
      );
    }
    let request: Input;
    try {
      request = schema.parse(rawInput);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new CatalogSetupWritePrepareError({
          code: "INVALID_ARGUMENT",
          requestId: actorContext.requestId,
          cause: error,
        });
      }
      throw error;
    }
    authorize(actorContext, capabilityId, request);
    try {
      const current = await reauthorizeResolvedMcpActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        capabilityManifestRevision:
          CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION,
        signal: options?.signal,
      });
      authorize(current, capabilityId, request);
      const observedAt = now();
      if (Number.isNaN(observedAt.getTime())) {
        throw new Error("Invalid clock");
      }
      return await args.send(current, request, observedAt.toISOString());
    } catch (error) {
      if (
        error instanceof ActorAccessError ||
        error instanceof CatalogSetupWritePrepareError
      ) {
        throw error;
      }
      if (error instanceof CatalogSetupWriteRepositoryError) {
        const code =
          error.code === "CONFLICT" || error.code === "DUPLICATE"
            ? error.code
            : error.code === "INVALID"
              ? "INVALID_ARGUMENT"
              : error.code === "POLICY"
                ? "POLICY_UNAVAILABLE"
                : error.code === "STALE"
                  ? "STALE_CONTEXT"
                  : "TEMPORARILY_UNAVAILABLE";
        throw new CatalogSetupWritePrepareError({
          code,
          requestId: actorContext.requestId,
          cause: error,
        });
      }
      throw new CatalogSetupWritePrepareError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: actorContext.requestId,
        cause: error,
      });
    }
  }

  const service: CatalogSetupWriteService = {
    async prepareCreateCatalogVariant(actorContext, rawInput, options) {
      return await prepare<PrepareCreateCatalogVariantInput>({
        actorContext,
        rawInput,
        options,
        capabilityId: "prepare_create_catalog_variant",
        schema: PrepareCreateCatalogVariantInputSchema,
        send: (current, request, observedAt) =>
          input.repository.prepareCreateVariant({
            actorContext: current,
            request,
            observedAt,
            signal: options?.signal,
          }),
      });
    },
    async prepareSetVariantThresholds(actorContext, rawInput, options) {
      return await prepare<PrepareSetVariantThresholdsInput>({
        actorContext,
        rawInput,
        options,
        capabilityId: "prepare_set_variant_thresholds",
        schema: PrepareSetVariantThresholdsInputSchema,
        send: (current, request, observedAt) =>
          input.repository.prepareSetThresholds({
            actorContext: current,
            request,
            observedAt,
            signal: options?.signal,
          }),
      });
    },
    async prepareSetCatalogPricing(actorContext, rawInput, options) {
      return await prepare<PrepareSetCatalogPricingInput>({
        actorContext,
        rawInput,
        options,
        capabilityId: "prepare_set_catalog_pricing",
        schema: PrepareSetCatalogPricingInputSchema,
        send: (current, request, observedAt) =>
          input.repository.prepareSetPricing({
            actorContext: current,
            request,
            observedAt,
            signal: options?.signal,
          }),
      });
    },
    async prepareSetSupplierCost(actorContext, rawInput, options) {
      return await prepare<PrepareSetSupplierCostInput>({
        actorContext,
        rawInput,
        options,
        capabilityId: "prepare_set_supplier_cost",
        schema: PrepareSetSupplierCostInputSchema,
        send: (current, request, observedAt) =>
          input.repository.prepareSetSupplierCost({
            actorContext: current,
            request,
            observedAt,
            signal: options?.signal,
          }),
      });
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedCatalogSetupWriteService(
  value: unknown
): value is CatalogSetupWriteService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
