import "server-only";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CATALOG_SETUP_WRITE_KINDS,
  CatalogSetupWriteResultSchema,
  type CatalogSetupWriteKind,
  type CatalogSetupWriteResult,
  type PrepareCreateCatalogOptionInput,
  type PrepareCreateCatalogVariantInput,
  type PrepareSetCatalogPricingInput,
  type PrepareSetSupplierCostInput,
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
    | "INVALID"
    | "NO_CHANGE";
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
                : code === "NO_CHANGE"
                  ? "The catalogue already holds the requested values"
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
  // A request the database understood and found already true is not a
  // malformed request. It gets its own answer so an agent stops instead of
  // reshaping and retrying a request the tool handled correctly.
  if (message.startsWith("CATALOG_SETUP_NO_CHANGE"))
    return new CatalogSetupWriteRepositoryError("NO_CHANGE", error);
  if (
    message.startsWith("CATALOG_SETUP_WRITE_INPUT_INVALID") ||
    message.startsWith("CATALOG_SETUP_PRICE_REQUIRED") ||
    message.startsWith("CATALOG_SETUP_OPTION_") ||
    message.startsWith("CATALOG_SETUP_BACKFILL_VALUE_INVALID") ||
    message.startsWith("CATALOG_SETUP_VARIANT_SET_AMBIGUOUS") ||
    message.startsWith("CATALOG_SETUP_THRESHOLDS_INVALID") ||
    message.startsWith("CATALOG_SETUP_THRESHOLDS_NOT_WHOLE") ||
    message.startsWith("CATALOG_SETUP_AFFECTED_VARIANTS_TOO_MANY") ||
    message.startsWith("CATALOG_SETUP_PRICE_") ||
    message.startsWith("CATALOG_SETUP_DEFAULT_REQUIRED") ||
    message.startsWith("CATALOG_SETUP_PROFILES_TOO_MANY") ||
    message.startsWith("CATALOG_SETUP_PROFILE_") ||
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
  prepareSetSupplierCost(input: {
    actorContext: ActorContext;
    request: PrepareSetSupplierCostInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<CatalogSetupWriteResult>;
  prepareCreateOption(input: {
    actorContext: ActorContext;
    request: PrepareCreateCatalogOptionInput;
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

  // The price resolves to what was asked for, AT THE LEVEL THE FAMILY ALREADY
  // ANSWERS: a requested price equal to the family default is inherited, never
  // pinned onto the new variant, and a price inherited from the family is the
  // family's own default and nothing else.
  const salePrice = proposal.after.variant.sale_price;
  const familyPrice = proposal.before.default_price;
  if (request.price_override) {
    const requested = request.price_override.amount;
    if (
      proposal.after.currency !== request.price_override.currency ||
      !sameDecimal(salePrice.amount, requested)
    ) {
      return false;
    }
    if (salePrice.origin === "family") {
      if (!sameDecimal(familyPrice, requested)) return false;
    } else if (salePrice.origin === "variant") {
      if (familyPrice !== null && sameDecimal(familyPrice, requested)) {
        return false;
      }
    } else {
      return false;
    }
  } else if (
    salePrice.origin !== "family" ||
    !sameDecimal(salePrice.amount, familyPrice)
  ) {
    return false;
  }

  // The write never gives a new variant a cost of its own, so its cost is the
  // family's — or none, and it says which.
  const unitCost = proposal.after.variant.unit_cost;
  if (
    unitCost.origin === "variant" ||
    !sameDecimal(unitCost.amount, proposal.before.default_unit_cost)
  ) {
    return false;
  }

  // A requested level resolves to that number, on the variant or inherited
  // from the family or category when it equals what they answer. A level the
  // request never named is never the variant's own.
  for (const [field, value] of [
    ["warning_threshold", request.warning_threshold],
    ["critical_threshold", request.critical_threshold],
  ] as const) {
    const previewed = proposal.after.variant[field];
    if (value === undefined) {
      if (previewed.origin === "variant") return false;
    } else if (previewed.value !== String(value)) return false;
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
    if (
      !keepsInheritedLevel(
        { resolved: before.value, origin: before.origin },
        { resolved: after.value, origin: after.origin }
      )
    ) {
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(request, field)) {
      if (after.value !== before.value || after.origin !== before.origin)
        return false;
      continue;
    }
    const requested = request[field];
    if (requested === null || requested === undefined) {
      // Cleared: the variant may no longer be the origin of this level.
      if (after.origin === "variant") return false;
    } else if (after.value !== String(requested)) {
      // A number resolves to that number — as the variant's own level, or
      // inherited when the family or category already answers it.
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
 * A variant-level write moves the variant's own term and nothing above it, so
 * whatever the variant inherits is the same answer on both sides of the
 * preview. When the before side is NOT the variant's own value, it IS that
 * inherited answer — and then:
 *
 *  - an after side that is also inherited must be exactly that answer, and
 *  - an after side on the variant must differ from it, because a variant term
 *    equal to what the variant inherits is a level change nobody asked for:
 *    the variant would stop following its family.
 *
 * When the before side is the variant's own value the preview cannot show what
 * it would inherit, so nothing more is checkable here; the database refuses the
 * commit if the write would pin an inherited value regardless.
 */
function keepsInheritedLevel(
  before: { readonly resolved: string | null; readonly origin: string },
  after: { readonly resolved: string | null; readonly origin: string }
): boolean {
  if (before.origin === "variant") return true;
  if (after.origin === "variant") {
    return !sameDecimal(after.resolved, before.resolved);
  }
  return (
    after.origin === before.origin &&
    sameDecimal(after.resolved, before.resolved)
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
  const isFamily = request.item_ref.kind === "catalog_family";
  if (requested === null) {
    // Cleared: the level the ref names carries nothing of its own any more, so
    // the answer is either the level above or no price at all.
    if (after.price.origin === levelFor(request.item_ref.kind)) return false;
    if (isFamily && after.price.amount !== null) return false;
  } else {
    if (
      after.price.currency !== requested.currency ||
      !sameDecimal(after.price.amount, requested.amount)
    ) {
      return false;
    }
    // A family ref writes the family default. A variant ref lands on the
    // variant, or — when the amount equals the family default — on the family
    // the variant goes on inheriting from.
    if (isFamily ? after.price.origin !== "family" : after.price.origin === "none") {
      return false;
    }
  }
  if (
    !isFamily &&
    !keepsInheritedLevel(
      { resolved: before.price.amount, origin: before.price.origin },
      { resolved: after.price.amount, origin: after.price.origin }
    )
  ) {
    return false;
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

  // The variants a family default does not reach. A family write moves no
  // variant row, so the list is the same variants carrying the same prices on
  // both sides, none of them among the variants the default does reach; and
  // `redundant` is exactly "this variant's own price equals the default on
  // this side". A variant target shadows nothing.
  const beforeShadowing = before.shadowing_variants;
  const afterShadowing = after.shadowing_variants;
  if (!isFamily && (beforeShadowing.length > 0 || afterShadowing.length > 0)) {
    return false;
  }
  if (beforeShadowing.length !== afterShadowing.length) return false;
  const reached = new Set(afterRows.map((row) => row.variant_ref.id));
  for (let index = 0; index < afterShadowing.length; index += 1) {
    const past = beforeShadowing[index]!;
    const next = afterShadowing[index]!;
    if (
      past.variant_ref.id !== next.variant_ref.id ||
      reached.has(next.variant_ref.id) ||
      !sameDecimal(past.price_override, next.price_override) ||
      past.redundant !==
        (before.price.amount !== null &&
          sameDecimal(past.price_override, before.price.amount)) ||
      next.redundant !==
        (after.price.amount !== null &&
          sameDecimal(next.price_override, after.price.amount))
    ) {
      return false;
    }
  }

  const expectedFamily = isFamily ? 1 : 0;
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


/**
 * A supplier-cost preview must describe this variant, this profile key, this
 * cost and this default decision — and it must be a coherent cost sheet on its
 * own terms. Three invariants are checked here rather than trusted, because all
 * three are ways a wrong preview would still look plausible:
 *
 *  - no profile the variant already had may disappear from the after side,
 *  - exactly one profile is the default on each side, and
 *  - a mirror is claimed exactly when the variant's own cost field ends up
 *    equal to the default profile's cost after moving.
 */
export function matchesSetSupplierCostRequest(
  result: CatalogSetupWriteResult,
  request: PrepareSetSupplierCostInput
): boolean {
  if (result.kind !== "set_supplier_cost") return false;
  const proposal = result.proposal;
  if (proposal.kind !== "set_supplier_cost") return false;

  const { before, after, effects } = proposal;
  if (
    before.variant.variant_ref.id !== request.variant_ref.id ||
    after.variant.variant_ref.id !== request.variant_ref.id
  ) {
    return false;
  }

  const target = after.profiles.find(
    (entry) => entry.profile_key === request.profile_key
  );
  if (
    !target ||
    target.label !== request.label.trim() ||
    target.currency !== request.unit_cost.currency ||
    !sameDecimal(target.unit_cost, request.unit_cost.amount) ||
    target.is_default !== request.is_default
  ) {
    return false;
  }

  // Nothing the variant already carried may vanish from the after side.
  const afterKeys = new Set(after.profiles.map((entry) => entry.profile_key));
  if (before.profiles.some((entry) => !afterKeys.has(entry.profile_key))) {
    return false;
  }
  if (afterKeys.size !== after.profiles.length) return false;

  const defaultsBefore = before.profiles.filter((entry) => entry.is_default);
  const defaultsAfter = after.profiles.filter((entry) => entry.is_default);
  if (defaultsAfter.length !== 1) return false;
  if (before.profiles.length > 0 && defaultsBefore.length !== 1) return false;

  const demoted = after.profiles.filter(
    (entry) => entry.state === "demoted"
  ).length;
  if (
    effects.profiles_demoted !== (demoted > 0 ? 1 : 0) ||
    demoted > 1 ||
    effects.supplier_cost_profiles_written !== 1 + effects.profiles_demoted ||
    effects.prices_changed !== 0 ||
    effects.stock_events_recorded !== 0
  ) {
    return false;
  }

  // The mirror: when claimed, the variant's catalogue cost resolves to the
  // default profile's cost — on the variant's own term, or inherited from the
  // family when the family cost already equals it. When not claimed, the cost
  // and its level stay exactly where they were. A flag that does not match the
  // numbers beside it is the one way the two cost models silently drift again
  // (gap #17), and a cost pinned onto the variant at the value it already
  // inherits is the level change the database refuses to commit.
  const mirrored = effects.variant_unit_cost_mirrored;
  const costBefore = before.variant_unit_cost;
  const costAfter = after.variant_unit_cost;
  if (
    !keepsInheritedLevel(
      { resolved: costBefore.amount, origin: costBefore.origin },
      { resolved: costAfter.amount, origin: costAfter.origin }
    )
  ) {
    return false;
  }
  if (mirrored) {
    if (
      costAfter.origin === "none" ||
      !sameDecimal(costAfter.amount, defaultsAfter[0]!.unit_cost)
    ) {
      return false;
    }
  } else if (
    costAfter.origin !== costBefore.origin ||
    !sameDecimal(costAfter.amount, costBefore.amount)
  ) {
    return false;
  }

  if (proposal.evidence.length !== request.evidence.length) return false;
  return request.evidence.every(
    (item, index) => proposal.evidence[index]?.text === item.text
  );
}

/**
 * An option preview must describe this family, this dimension, these values and
 * this backfill — and it must be a coherent grid on its own terms. What is
 * checked here rather than trusted is everything a plausible-looking wrong
 * preview would get wrong:
 *
 *  - exactly one option is created, and it is the one that was asked for,
 *  - no option the family already had disappears,
 *  - the variant list is the same variants, in the same order, on both sides,
 *  - every variant gains exactly one label when a backfill was asked for and
 *    none when it was not, and
 *  - the counters equal what the two sides actually show.
 */
export function matchesCreateCatalogOptionRequest(
  result: CatalogSetupWriteResult,
  request: PrepareCreateCatalogOptionInput
): boolean {
  if (result.kind !== "create_option") return false;
  const proposal = result.proposal;
  if (proposal.kind !== "create_option") return false;

  const { before, after, effects } = proposal;
  for (const side of [proposal.family, before.family, after.family]) {
    if (side.family_ref.id !== request.family_ref.id) return false;
  }

  // Exactly one created option, and it is the dimension that was asked for.
  const created = after.options.filter((entry) => entry.state === "created");
  if (created.length !== 1) return false;
  const dimension = created[0]!;
  if (dimension.name !== request.name) return false;
  if (
    request.sort_order !== undefined &&
    dimension.sort_order !== request.sort_order
  ) {
    return false;
  }
  const requestedValues = request.values.map((entry) => entry.value).sort();
  const previewedValues = dimension.values.map((entry) => entry.value).sort();
  if (
    requestedValues.length !== previewedValues.length ||
    requestedValues.some((value, index) => value !== previewedValues[index])
  ) {
    return false;
  }

  // Nothing the family already carried may vanish, and nothing else is created.
  if (before.options.some((entry) => entry.state !== "unchanged")) return false;
  if (after.options.length !== before.options.length + 1) return false;
  const carried = new Set(
    after.options
      .filter((entry) => entry.state === "unchanged")
      .map((entry) => entry.option_ref?.id)
  );
  if (before.options.some((entry) => !carried.has(entry.option_ref?.id))) {
    return false;
  }

  // The same variants, in the same order, each gaining exactly the one value.
  const backfillValue = request.value_for_existing_variants ?? null;
  if (before.variants.length !== after.variants.length) return false;
  let backfilled = 0;
  for (let index = 0; index < after.variants.length; index += 1) {
    const past = before.variants[index]!;
    const next = after.variants[index]!;
    if (past.variant_ref.id !== next.variant_ref.id) return false;
    if (past.state !== "unchanged") return false;
    if (backfillValue === null) {
      if (
        next.state !== "unchanged" ||
        next.value_labels.length !== past.value_labels.length
      ) {
        return false;
      }
      continue;
    }
    if (
      next.state !== "backfilled" ||
      next.value_labels.length !== past.value_labels.length + 1 ||
      !next.value_labels.includes(backfillValue)
    ) {
      return false;
    }
    backfilled += 1;
  }

  if (
    after.backfill.option_name !== request.name ||
    after.backfill.value !== backfillValue ||
    after.backfill.variant_count !== backfilled ||
    before.backfill.variant_count !== 0
  ) {
    return false;
  }

  if (
    effects.options_created !== 1 ||
    effects.option_values_created !== request.values.length ||
    effects.variants_backfilled !== backfilled ||
    effects.variants_updated !== backfilled ||
    effects.variants_created !== 0 ||
    effects.prices_changed !== 0 ||
    effects.stock_events_recorded !== 0 ||
    effects.supplier_cost_profiles_written !== 0
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
    async prepareSetSupplierCost(read) {
      const response = await execute(
        input.rpc("prepare_catalog_setup_write_as_system", {
          ...binding(read.actorContext, "set_supplier_cost"),
          p_kind: "set_supplier_cost",
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
        !matchesSetSupplierCostRequest(parsed.data, read.request)
      ) {
        throw new CatalogSetupWriteRepositoryError("UNAVAILABLE");
      }
      return Object.freeze(parsed.data);
    },
    async prepareCreateOption(read) {
      const response = await execute(
        input.rpc("prepare_catalog_setup_write_as_system", {
          ...binding(read.actorContext, "create_option"),
          p_kind: "create_option",
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
        !matchesCreateCatalogOptionRequest(parsed.data, read.request)
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
