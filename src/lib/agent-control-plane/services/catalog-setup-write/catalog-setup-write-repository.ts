import "server-only";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CATALOG_SETUP_WRITE_KINDS,
  CatalogSetupWriteResultSchema,
  type CatalogSetupWriteKind,
  type CatalogSetupWriteResult,
  type PrepareCreateCatalogVariantInput,
  type PrepareSetCatalogPricingInput,
  type PrepareSetVariantThresholdsInput,
} from "@/lib/agent-control-plane/contracts/catalog-setup-write";
import { CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";

interface RpcResponse {
  readonly data: unknown;
  readonly error: unknown;
}
interface RpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>;
}
export interface CatalogSetupWriteRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

const TRUSTED_REPOSITORIES = new WeakSet<object>();

export class CatalogSetupWriteRepositoryError extends Error {
  readonly code:
    | "CONFLICT"
    | "DUPLICATE"
    | "POLICY"
    | "STALE"
    | "UNAVAILABLE"
    | "INVALID";
  constructor(code: CatalogSetupWriteRepositoryError["code"], cause?: unknown) {
    super(
      code === "CONFLICT"
        ? "The idempotency key belongs to different input"
        : code === "DUPLICATE"
          ? "That combination of option values already exists on this family"
          : code === "POLICY"
            ? "The catalogue write effect policy is missing, conflicting, or invalid"
            : code === "STALE"
              ? "The family, authority or grant changed"
              : code === "INVALID"
                ? "The catalogue write request is invalid"
                : "The catalogue write proposal is unavailable",
      { cause }
    );
    this.name = "CatalogSetupWriteRepositoryError";
    this.code = code;
  }
}

/**
 * Database error names are the contract between the SQL vertical and this
 * layer. Everything the prepare can raise starts CATALOG_SETUP_WRITE_ or
 * CATALOG_SETUP_, exactly as the customer-update repository maps
 * AGENT_CUSTOMER_UPDATE_*.
 */
function normalizedError(error: unknown): CatalogSetupWriteRepositoryError {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message === "CATALOG_SETUP_VARIANT_EXISTS")
    return new CatalogSetupWriteRepositoryError("DUPLICATE", error);
  if (message.startsWith("CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT"))
    return new CatalogSetupWriteRepositoryError("CONFLICT", error);
  if (
    message.startsWith("CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED") ||
    message.startsWith("CATALOG_SETUP_WRITE_EFFECT_POLICY_")
  )
    return new CatalogSetupWriteRepositoryError("POLICY", error);
  if (
    message.startsWith("CATALOG_SETUP_SOURCE_") ||
    message.startsWith("CATALOG_SETUP_WRITE_AUTHORITY_") ||
    message.startsWith("CATALOG_SETUP_WRITE_GRANT_") ||
    message.startsWith("CATALOG_SETUP_WRITE_CONFIRMATION_STALE") ||
    message.startsWith("CATALOG_SETUP_FAMILY_NOT_FOUND") ||
    message.startsWith("CATALOG_SETUP_VARIANT_NOT_FOUND")
  )
    return new CatalogSetupWriteRepositoryError("STALE", error);
  if (
    message.startsWith("CATALOG_SETUP_WRITE_INPUT_INVALID") ||
    message.startsWith("CATALOG_SETUP_PRICE_REQUIRED") ||
    message.startsWith("CATALOG_SETUP_OPTION_") ||
    message.startsWith("CATALOG_SETUP_THRESHOLDS_INVALID") ||
    message.startsWith("CATALOG_SETUP_THRESHOLDS_NOT_WHOLE") ||
    message.startsWith("CATALOG_SETUP_NO_CHANGE") ||
    message.startsWith("CATALOG_SETUP_AFFECTED_VARIANTS_TOO_MANY") ||
    message.startsWith("CATALOG_SETUP_PRICE_") ||
    message.startsWith("CATALOG_SETUP_CURRENCY_") ||
    message.startsWith("CATALOG_SETUP_EVIDENCE_") ||
    message.startsWith("CATALOG_SETUP_FAMILY_HAS_NO_OPTIONS") ||
    message.startsWith("CATALOG_SETUP_WRITE_KIND_UNAVAILABLE")
  )
    return new CatalogSetupWriteRepositoryError("INVALID", error);
  return new CatalogSetupWriteRepositoryError("UNAVAILABLE", error);
}

function binding(actor: ActorContext, kind: CatalogSetupWriteKind) {
  if (
    actor.auth.channel !== "mcp" ||
    actor.capabilityManifestRevision !==
      CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Catalogue setup writes require a v28 MCP actor");
  }
  const capabilityId = CATALOG_SETUP_WRITE_KINDS[kind].capabilityId;
  return {
    p_actor_user_id: actor.actorUserId,
    p_company_id: actor.companyId,
    p_oauth_grant_id: actor.auth.oauthGrantId,
    p_oauth_client_id: actor.auth.oauthClientId,
    p_grant_revision: actor.auth.grantRevision,
    p_granted_scope_ceiling: [...actor.auth.scopeCeiling],
    p_permission_snapshot_revision: actor.permissionSnapshotRevision,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_manifest_revision:
      CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: "2026-09-15.mcp-exposure.v24",
    p_capability_id: capabilityId,
    p_capability_revision: `${capabilityId}:2026-09-15.v1`,
  } as const;
}

async function execute(request: RpcRequest, signal?: AbortSignal) {
  return signal && request.abortSignal
    ? await request.abortSignal(signal)
    : await request;
}

export interface CatalogSetupWriteRepository {
  prepareCreateVariant(input: {
    actorContext: ActorContext;
    request: PrepareCreateCatalogVariantInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<CatalogSetupWriteResult>;
  prepareSetThresholds(input: {
    actorContext: ActorContext;
    request: PrepareSetVariantThresholdsInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<CatalogSetupWriteResult>;
  prepareSetPricing(input: {
    actorContext: ActorContext;
    request: PrepareSetCatalogPricingInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<CatalogSetupWriteResult>;
}

/**
 * The returned proposal must describe the request that was sent. A preview that
 * names a different family, a different value set or a different price is not a
 * preview of this request, whatever it claims.
 */
export function matchesCreateVariantRequest(
  result: CatalogSetupWriteResult,
  request: PrepareCreateCatalogVariantInput
): boolean {
  if (result.kind !== "create_variant") return false;
  const proposal = result.proposal;
  if (proposal.kind !== "create_variant") return false;
  if (proposal.family.family_ref.id !== request.family_ref.id) return false;

  const requested = [...request.option_values]
    .map((entry) => `${entry.option_ref.id}:${entry.value_ref.id}`)
    .sort();
  const previewed = [...proposal.after.variant.option_values]
    .map((entry) => `${entry.option_ref.id}:${entry.value_ref.id}`)
    .sort();
  if (
    requested.length !== previewed.length ||
    requested.some((value, index) => value !== previewed[index])
  ) {
    return false;
  }

  if (proposal.after.variant.sku !== (request.sku ?? null)) return false;
  if (request.price_override) {
    if (
      proposal.after.currency !== request.price_override.currency ||
      proposal.after.variant.sale_price_source !== "variant_override" ||
      !sameDecimal(
        proposal.after.variant.sale_price,
        request.price_override.amount
      )
    ) {
      return false;
    }
  } else if (proposal.after.variant.sale_price_source !== "family_default") {
    return false;
  }

  for (const [field, value] of [
    ["warning_threshold", request.warning_threshold],
    ["critical_threshold", request.critical_threshold],
  ] as const) {
    const previewedValue = proposal.after.variant[field];
    if (value === undefined) {
      if (previewedValue !== null) return false;
    } else if (previewedValue !== String(value)) return false;
  }

  const opening = request.opening_quantity;
  if (opening) {
    if (
      proposal.after.opening_quantity === null ||
      !sameDecimal(proposal.after.opening_quantity.quantity, opening.quantity) ||
      proposal.after.opening_quantity.note !== (opening.note ?? null) ||
      !sameDecimal(proposal.after.variant.quantity, opening.quantity) ||
      proposal.effects.stock_units_created !== 1 ||
      proposal.effects.stock_events_recorded !== 1
    ) {
      return false;
    }
  } else if (
    proposal.after.opening_quantity !== null ||
    !sameDecimal(proposal.after.variant.quantity, "0") ||
    proposal.effects.stock_units_created !== 0 ||
    proposal.effects.stock_events_recorded !== 0
  ) {
    return false;
  }

  if (proposal.evidence.length !== request.evidence.length) return false;
  return request.evidence.every(
    (item, index) => proposal.evidence[index]?.text === item.text
  );
}

/**
 * A thresholds preview must describe this variant and exactly the levels the
 * request asked for: a number sets the variant's own level, a null leaves the
 * variant carrying none of its own, and an omitted key leaves that level
 * untouched. Anything else is a preview of a different change.
 */
export function matchesSetThresholdsRequest(
  result: CatalogSetupWriteResult,
  request: PrepareSetVariantThresholdsInput
): boolean {
  if (result.kind !== "set_thresholds") return false;
  const proposal = result.proposal;
  if (proposal.kind !== "set_thresholds") return false;
  if (
    proposal.before.variant.variant_ref.id !== request.variant_ref.id ||
    proposal.after.variant.variant_ref.id !== request.variant_ref.id
  ) {
    return false;
  }

  let changed = 0;
  for (const [field, side] of [
    ["warning_threshold", "warning"],
    ["critical_threshold", "critical"],
  ] as const) {
    const before = proposal.before[side];
    const after = proposal.after[side];
    if (!Object.prototype.hasOwnProperty.call(request, field)) {
      if (after.value !== before.value || after.origin !== before.origin)
        return false;
      continue;
    }
    const requested = request[field];
    if (requested === null || requested === undefined) {
      // Cleared: the variant may no longer be the origin of this level.
      if (after.origin === "variant") return false;
    } else if (after.origin !== "variant" || after.value !== String(requested)) {
      return false;
    }
    if (after.value !== before.value || after.origin !== before.origin) {
      changed += 1;
    }
  }
  if (changed < 1) return false;
  if (
    proposal.effects.thresholds_changed !== changed ||
    proposal.effects.variants_updated !== 1 ||
    proposal.effects.stock_events_recorded !== 0 ||
    proposal.effects.prices_changed !== 0
  ) {
    return false;
  }

  if (proposal.evidence.length !== request.evidence.length) return false;
  return request.evidence.every(
    (item, index) => proposal.evidence[index]?.text === item.text
  );
}


/**
 * A pricing preview must describe this item, this amount, this currency, and
 * the level the ref aimed at. It must also be internally consistent: the two
 * sides list the same variants in the same order, and `prices_changed` is the
 * number of those variants whose resolved sale price actually moves. A preview
 * that under-counts what it moves is the exact shape of a wrong approval.
 */
export function matchesSetPricingRequest(
  result: CatalogSetupWriteResult,
  request: PrepareSetCatalogPricingInput
): boolean {
  if (result.kind !== "set_pricing") return false;
  const proposal = result.proposal;
  if (proposal.kind !== "set_pricing") return false;

  const { before, after } = proposal;
  for (const side of [before, after]) {
    if (
      side.target.item_ref.kind !== request.item_ref.kind ||
      side.target.item_ref.id !== request.item_ref.id
    ) {
      return false;
    }
  }

  const requested = request.sale_price;
  if (requested === null) {
    // Cleared: the level the ref names carries nothing of its own any more, so
    // the answer is either the level above or no price at all.
    if (after.price.origin === levelFor(request.item_ref.kind)) return false;
    if (request.item_ref.kind === "catalog_family" && after.price.amount !== null)
      return false;
  } else {
    if (
      after.price.currency !== requested.currency ||
      after.price.origin !== levelFor(request.item_ref.kind) ||
      !sameDecimal(after.price.amount, requested.amount)
    ) {
      return false;
    }
  }
  if (before.price.currency !== after.price.currency) return false;

  const beforeRows = before.affected_variants;
  const afterRows = after.affected_variants;
  if (beforeRows.length !== afterRows.length) return false;
  let moved = 0;
  for (let index = 0; index < afterRows.length; index += 1) {
    const past = beforeRows[index]!;
    const next = afterRows[index]!;
    if (past.variant_ref.id !== next.variant_ref.id) return false;
    if (
      !sameDecimal(past.sale_price, next.sale_price) ||
      past.sale_price_origin !== next.sale_price_origin
    ) {
      if (!sameDecimal(past.sale_price, next.sale_price)) moved += 1;
    }
  }
  if (proposal.effects.prices_changed !== moved) return false;

  const expectedFamily = request.item_ref.kind === "catalog_family" ? 1 : 0;
  if (
    proposal.effects.families_updated !== expectedFamily ||
    proposal.effects.variants_updated !== 1 - expectedFamily ||
    proposal.effects.stock_events_recorded !== 0 ||
    proposal.effects.supplier_cost_profiles_written !== 0
  ) {
    return false;
  }

  if (proposal.evidence.length !== request.evidence.length) return false;
  return request.evidence.every(
    (item, index) => proposal.evidence[index]?.text === item.text
  );
}

/** The level a ref writes at, named the way the projection names its origin. */
function levelFor(kind: "catalog_family" | "catalog_variant") {
  return kind === "catalog_family" ? "family" : "variant";
}

/** "45.0000" and "45" are the same price; string equality alone is not. */
function sameDecimal(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  return Number.parseFloat(left) === Number.parseFloat(right);
}

export function createCatalogSetupWriteRepository(input: {
  rpc: CatalogSetupWriteRpcClient["rpc"];
}): CatalogSetupWriteRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("A catalogue setup write RPC client is required");
  }
  const repository: CatalogSetupWriteRepository = {
    async prepareCreateVariant(read) {
      const response = await execute(
        input.rpc("prepare_catalog_setup_write_as_system", {
          ...binding(read.actorContext, "create_variant"),
          p_kind: "create_variant",
          p_request_id: read.actorContext.requestId,
          p_request: read.request,
          p_observed_at: read.observedAt,
        }),
        read.signal
      );
      if (response.error) throw normalizedError(response.error);
      const parsed = CatalogSetupWriteResultSchema.safeParse(response.data);
      if (
        !parsed.success ||
        parsed.data.request_id !== read.actorContext.requestId ||
        !matchesCreateVariantRequest(parsed.data, read.request)
      ) {
        throw new CatalogSetupWriteRepositoryError("UNAVAILABLE");
      }
      return Object.freeze(parsed.data);
    },
    async prepareSetPricing(read) {
      const response = await execute(
        input.rpc("prepare_catalog_setup_write_as_system", {
          ...binding(read.actorContext, "set_pricing"),
          p_kind: "set_pricing",
          p_request_id: read.actorContext.requestId,
          p_request: read.request,
          p_observed_at: read.observedAt,
        }),
        read.signal
      );
      if (response.error) throw normalizedError(response.error);
      const parsed = CatalogSetupWriteResultSchema.safeParse(response.data);
      if (
        !parsed.success ||
        parsed.data.request_id !== read.actorContext.requestId ||
        !matchesSetPricingRequest(parsed.data, read.request)
      ) {
        throw new CatalogSetupWriteRepositoryError("UNAVAILABLE");
      }
      return Object.freeze(parsed.data);
    },
    async prepareSetThresholds(read) {
      const response = await execute(
        input.rpc("prepare_catalog_setup_write_as_system", {
          ...binding(read.actorContext, "set_thresholds"),
          p_kind: "set_thresholds",
          p_request_id: read.actorContext.requestId,
          p_request: read.request,
          p_observed_at: read.observedAt,
        }),
        read.signal
      );
      if (response.error) throw normalizedError(response.error);
      const parsed = CatalogSetupWriteResultSchema.safeParse(response.data);
      if (
        !parsed.success ||
        parsed.data.request_id !== read.actorContext.requestId ||
        !matchesSetThresholdsRequest(parsed.data, read.request)
      ) {
        throw new CatalogSetupWriteRepositoryError("UNAVAILABLE");
      }
      return Object.freeze(parsed.data);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedCatalogSetupWriteRepository(
  value: unknown
): value is CatalogSetupWriteRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
