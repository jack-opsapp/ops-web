import "server-only";
import type { ActorAuthorityRepository } from "../../actor/authority-repository";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "../../actor/authority-repository";
import { authorizeCapability } from "../../actor/authorize-capability";
import { ActorAccessError, authorizationInternal } from "../../actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "../../actor/resolve-actor-context";
import { reauthorizeResolvedMcpActor } from "../../mcp/actor-reauthorization";
import { resolveCatalogAuthoringCapabilityAuthorization } from "../../registry/capability-manifest";
import {
  CatalogAuthoringRequestSchema,
  CatalogAuthoringResultSchema,
  CATALOG_AUTHORING_MANIFEST,
  type CatalogAuthoringRequest,
  type CatalogAuthoringResult,
} from "../../contracts/catalog-authoring";
import type { ScheduleChangeRpcClient } from "../schedule-change/schedule-change-repository";
const trusted = new WeakSet<object>();
export interface CatalogAuthoringService {
  inspectCatalogChanges(
    actor: ActorContext,
    input: CatalogAuthoringRequest,
    options?: { signal?: AbortSignal }
  ): Promise<CatalogAuthoringResult>;
  prepareCatalogChanges(
    actor: ActorContext,
    input: CatalogAuthoringRequest,
    options?: { signal?: AbortSignal }
  ): Promise<CatalogAuthoringResult>;
  prepareInventoryAdjustment(
    actor: ActorContext,
    input: CatalogAuthoringRequest,
    options?: { signal?: AbortSignal }
  ): Promise<CatalogAuthoringResult>;
}
export function catalogActorBinding(actor: ActorContext) {
  if (
    !isActorContext(actor) ||
    actor.capabilityManifestRevision !== CATALOG_AUTHORING_MANIFEST
  )
    throw new TypeError("A current catalog actor is required");
  return {
    actor: actor.actorUserId,
    company: actor.companyId,
    channel: actor.auth.channel,
    manifest: CATALOG_AUTHORING_MANIFEST,
    permission_revision: actor.permissionSnapshotRevision,
    permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    grant: actor.auth.channel === "mcp" ? actor.auth.oauthGrantId : null,
    client: actor.auth.channel === "mcp" ? actor.auth.oauthClientId : null,
    grant_revision:
      actor.auth.channel === "mcp" ? actor.auth.grantRevision : null,
    scopes: actor.auth.channel === "mcp" ? [...actor.auth.scopeCeiling] : null,
  };
}
export function createCatalogAuthoringService(input: {
  rpc: ScheduleChangeRpcClient["rpc"];
  authorityRepository: ActorAuthorityRepository;
}): CatalogAuthoringService {
  if (typeof input.rpc !== "function" || !input.authorityRepository)
    throw new TypeError("Catalog RPC and authority repository are required");
  async function call(
    name:
      | "inspect_catalog_changes"
      | "prepare_catalog_changes"
      | "prepare_inventory_adjustment",
    actor: ActorContext,
    raw: CatalogAuthoringRequest,
    options?: { signal?: AbortSignal }
  ) {
    if (!isActorContext(actor))
      throw authorizationInternal("unknown-request", "catalog_actor_untrusted");
    let request: CatalogAuthoringRequest;
    try {
      request = CatalogAuthoringRequestSchema.parse(raw);
    } catch {
      throw new ActorAccessError({
        requestId: actor.requestId,
        code: "INVALID_ARGUMENT",
        message: "Resolve the catalog input before continuing.",
        retryable: false,
        auditReason: "catalog_input_invalid",
        fieldIssues: [
          {
            path: ["input"],
            code: "CATALOG_INPUT_INVALID",
            message:
              "Use exact supported values and a separate stock proposal.",
          },
        ],
      });
    }
    const current =
      actor.auth.channel === "mcp"
        ? await reauthorizeResolvedMcpActor({
            actorContext: actor,
            authorityRepository: input.authorityRepository,
            capabilityManifestRevision: CATALOG_AUTHORING_MANIFEST,
            signal: options?.signal,
          })
        : actor;
    const resolved = resolveCatalogAuthoringCapabilityAuthorization(
      name,
      request
    );
    for (const variant of resolved.variants)
      authorizeCapability({ actorContext: current, policy: variant.policy });
    const rpc = input.rpc(
      name === "inspect_catalog_changes"
        ? "inspect_catalog_changes_as_system"
        : "prepare_catalog_changes_as_system",
      {
        p_context: catalogActorBinding(current),
        p_request: request,
        p_request_id: current.requestId,
      }
    );
    const response = await (options?.signal && rpc.abortSignal
      ? rpc.abortSignal(options.signal)
      : rpc);
    if (response.error) {
      const error = response.error as { code?: string; message?: string };
      if (
        [
          "55P03",
          "57014",
          "25P04",
          "40P01",
          "08006",
          "PGRST001",
          "PGRST002",
          "PGRST003",
        ].includes(error.code ?? "")
      )
        throw new ActorAccessError({
          requestId: current.requestId,
          code: "TEMPORARILY_UNAVAILABLE",
          message: "The catalog is busy. Retry the same request shortly.",
          retryable: true,
          auditReason: "catalog_database_busy_or_deadline",
        });
      if (error.code === "42501")
        throw new ActorAccessError({
          requestId: current.requestId,
          code: "FORBIDDEN",
          message:
            "Your current catalog authority does not allow this request.",
          retryable: false,
          auditReason: "catalog_authority_denied",
        });
      throw new Error(
        /STALE|CONFLICT/.test(error.message ?? "")
          ? "The catalog or approval changed. Inspect the current records and review a new proposal."
          : /ACTIVATION|POLICY/.test(error.message ?? "")
            ? "Catalog saving is not activated for this connection."
            : "Catalog changes could not be prepared. Resolve the input or retry the same request."
      );
    }
    if ((JSON.stringify(response.data) ?? "").length > 262144)
      throw new Error("Catalog result exceeds its verified bound");
    const result = CatalogAuthoringResultSchema.parse(response.data);
    if (
      JSON.stringify(result.proposal.skipped_rows) !==
        JSON.stringify(request.skipped_rows) ||
      result.proposal.source.name !== request.source.name ||
      result.proposal.source.kind !== request.source.kind ||
      new Set(result.proposal.rows.map((r) => r.row_key)).size !==
        request.rows.length ||
      result.proposal.rows.some((row) => {
        const input = request.rows.find((r) => r.row_key === row.row_key);
        return (
          !input ||
          (input.existing_id !== null && input.existing_id !== row.id) ||
          (!("cost" in input.values) &&
            ((row.before &&
              ("cost" in row.before || "effective_cost" in row.before)) ||
              (row.after &&
                ("cost" in row.after || "effective_cost" in row.after))))
        );
      }) ||
      result.request_id !== current.requestId ||
      result.proposal.operation !== request.operation ||
      result.proposal.currency !== request.currency ||
      result.proposal.rows.length !== request.rows.length ||
      result.proposal.source.sha256 !== request.source.sha256 ||
      result.proposal.source.key !== request.source.key ||
      result.proposal.rows.some(
        (row) =>
          !request.rows.some(
            (r) =>
              r.row_key === row.row_key &&
              r.source_row === row.source_row &&
              r.entity === row.entity
          )
      )
    )
      throw new Error("Catalog result binding could not be verified");
    return Object.freeze(result);
  }
  const service: CatalogAuthoringService = {
    inspectCatalogChanges: (a, r, o) =>
      call("inspect_catalog_changes", a, r, o),
    prepareCatalogChanges: (a, r, o) =>
      call("prepare_catalog_changes", a, r, o),
    prepareInventoryAdjustment: (a, r, o) =>
      call("prepare_inventory_adjustment", a, r, o),
  };
  trusted.add(service);
  return Object.freeze(service);
}
export function isTrustedCatalogAuthoringService(
  value: unknown
): value is CatalogAuthoringService {
  return typeof value === "object" && value !== null && trusted.has(value);
}
