import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  SALES_TRUTH_MAX_ACTIVITIES,
  SALES_TRUTH_MAX_DISPOSITIONS,
  SALES_TRUTH_MAX_OPPORTUNITIES,
  SALES_TRUTH_MAX_TRANSITIONS,
  SALES_TRUTH_SCHEMA_REVISION,
  SALES_TRUTH_WINDOW_DAYS,
  SalesTruthSourceSnapshotSchema,
  type SalesTruthSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/sales-truth";
import { SALES_TRUTH_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V7 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface SalesTruthRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface SalesTruthRpcRequest extends PromiseLike<SalesTruthRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<SalesTruthRpcResult>;
}

export interface SalesTruthRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): SalesTruthRpcRequest;
}

export class SalesTruthRepositoryUnavailableError extends Error {
  constructor() {
    super("Sales-truth source is unavailable");
    this.name = "SalesTruthRepositoryUnavailableError";
  }
}

function binding(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    actorContext.capabilityManifestRevision !==
      SALES_TRUTH_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Sales-truth analysis requires a v13 MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_capability_manifest_revision: SALES_TRUTH_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V7.revision,
    p_capability_id: "analyze_sales_truth",
    p_capability_revision: `analyze_sales_truth:${SALES_TRUTH_SCHEMA_REVISION}`,
  } as const;
}

export interface SalesTruthRepository {
  readSourceSnapshot(input: {
    actorContext: ActorContext;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<SalesTruthSourceSnapshot>;
}

export function createSalesTruthRepository(input: {
  rpc: SalesTruthRpcClient["rpc"];
}): SalesTruthRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("A sales-truth RPC client is required");
  }
  const repository: SalesTruthRepository = {
    async readSourceSnapshot(readInput) {
      const request = input.rpc("read_agent_sales_truth_as_system", {
        ...binding(readInput.actorContext),
        p_observed_at: readInput.observedAt,
        p_window_days: SALES_TRUTH_WINDOW_DAYS,
        p_opportunity_limit: SALES_TRUTH_MAX_OPPORTUNITIES,
        p_transition_limit: SALES_TRUTH_MAX_TRANSITIONS,
        p_disposition_limit: SALES_TRUTH_MAX_DISPOSITIONS,
        p_activity_limit: SALES_TRUTH_MAX_ACTIVITIES,
      });
      const response =
        readInput.signal && request.abortSignal
          ? await request.abortSignal(readInput.signal)
          : await request;
      if (response.error) throw new SalesTruthRepositoryUnavailableError();
      const parsed = SalesTruthSourceSnapshotSchema.safeParse(response.data);
      if (!parsed.success || parsed.data.observed_at !== readInput.observedAt) {
        throw new SalesTruthRepositoryUnavailableError();
      }
      return parsed.data;
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedSalesTruthRepository(
  value: unknown
): value is SalesTruthRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
