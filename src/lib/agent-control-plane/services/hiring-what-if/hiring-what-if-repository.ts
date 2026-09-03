import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  HIRING_WHAT_IF_MAX_SUPPORTING_RECORDS,
  HIRING_WHAT_IF_WINDOW_WEEKS,
  HiringWhatIfSourceSnapshotSchema,
  type HiringWhatIfSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/hiring-what-if";
import {
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
  HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  MCP_EXPOSURE_V10,
  MCP_EXPOSURE_V9,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const HIRING_WHAT_IF_EXPOSURE_REVISION = "2026-08-31.mcp-exposure.v5" as const;
const HIRING_WHAT_IF_MEMBER_LIMIT = 25;
const HIRING_WHAT_IF_SCHEDULE_SOURCE_FETCH_LIMIT = 5_001;
const HIRING_WHAT_IF_FINANCIAL_SOURCE_FETCH_LIMIT = 5_001;
const HIRING_WHAT_IF_PROJECT_FETCH_LIMIT = 251;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface HiringWhatIfRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface HiringWhatIfRpcRequest extends PromiseLike<HiringWhatIfRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<HiringWhatIfRpcResult>;
}

export interface HiringWhatIfRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): HiringWhatIfRpcRequest;
}

export class HiringWhatIfRepositoryUnavailableError extends Error {
  constructor() {
    super("Hiring analysis source is unavailable");
    this.name = "HiringWhatIfRepositoryUnavailableError";
  }
}

function binding(actorContext: ActorContext) {
  if (actorContext.auth.channel !== "mcp") {
    throw new TypeError("Hiring analysis requires a supported MCP actor");
  }
  const exposureRevision =
    actorContext.capabilityManifestRevision ===
    HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION
      ? HIRING_WHAT_IF_EXPOSURE_REVISION
      : actorContext.capabilityManifestRevision ===
          RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION
        ? MCP_EXPOSURE_V9.revision
        : actorContext.capabilityManifestRevision ===
            ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION
          ? MCP_EXPOSURE_V10.revision
          : null;
  if (exposureRevision === null) {
    throw new TypeError("Hiring analysis requires a supported MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_capability_manifest_revision: actorContext.capabilityManifestRevision,
    p_exposure_revision: exposureRevision,
  } as const;
}

export interface HiringWhatIfRepository {
  readSourceSnapshot(input: {
    actorContext: ActorContext;
    role: string;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<HiringWhatIfSourceSnapshot>;
}

export function createHiringWhatIfRepository(
  client: HiringWhatIfRpcClient
): HiringWhatIfRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("A hiring analysis RPC client is required");
  }
  const repository: HiringWhatIfRepository = {
    async readSourceSnapshot(input) {
      const request = client.rpc("read_agent_hiring_what_if_as_system", {
        ...binding(input.actorContext),
        p_role: input.role,
        p_observed_at: input.observedAt,
        p_window_weeks: HIRING_WHAT_IF_WINDOW_WEEKS,
        p_member_limit: HIRING_WHAT_IF_MEMBER_LIMIT,
        p_schedule_source_limit: HIRING_WHAT_IF_SCHEDULE_SOURCE_FETCH_LIMIT,
        p_financial_source_limit: HIRING_WHAT_IF_FINANCIAL_SOURCE_FETCH_LIMIT,
        p_project_limit: HIRING_WHAT_IF_PROJECT_FETCH_LIMIT,
        p_supporting_record_limit: HIRING_WHAT_IF_MAX_SUPPORTING_RECORDS,
      });
      const response =
        input.signal && request.abortSignal
          ? await request.abortSignal(input.signal)
          : await request;
      if (response.error) {
        throw new HiringWhatIfRepositoryUnavailableError();
      }
      const parsed = HiringWhatIfSourceSnapshotSchema.safeParse(response.data);
      if (!parsed.success || parsed.data.observed_at !== input.observedAt) {
        throw new HiringWhatIfRepositoryUnavailableError();
      }
      return parsed.data;
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedHiringWhatIfRepository(
  value: unknown
): value is HiringWhatIfRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
