import "server-only";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CATALOG_SETUP_WRITE_KINDS,
  CatalogSetupWriteResultSchema,
  type CatalogSetupWriteKind,
  type CatalogSetupWriteResult,
  type PrepareCreateCatalogVariantInput,
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
    message.startsWith("CATALOG_SETUP_FAMILY_NOT_FOUND")
  )
    return new CatalogSetupWriteRepositoryError("STALE", error);
  if (
    message.startsWith("CATALOG_SETUP_WRITE_INPUT_INVALID") ||
    message.startsWith("CATALOG_SETUP_PRICE_REQUIRED") ||
    message.startsWith("CATALOG_SETUP_OPTION_") ||
    message.startsWith("CATALOG_SETUP_THRESHOLDS_INVALID") ||
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
