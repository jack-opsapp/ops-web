import "server-only";

import { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  ESTIMATE_DRAFT_CAPABILITY_REVISION,
  ESTIMATE_DRAFT_MAX_SOURCE_LINE_ITEMS,
  ESTIMATE_DRAFT_MAX_SOURCE_SNAPSHOT_CHARACTERS,
  EstimateDraftSourceSnapshotSchema,
  type EstimateDraftSourceSnapshot,
  type PrepareEstimateFromPastJobInput,
} from "@/lib/agent-control-plane/contracts/estimate-draft";
import { ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V10 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface RpcRequest extends PromiseLike<RpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
}

export interface EstimateDraftRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

export class EstimateDraftRepositoryUnavailableError extends Error {
  constructor() {
    super("Estimate draft source is unavailable");
    this.name = "EstimateDraftRepositoryUnavailableError";
  }
}

export class EstimateDraftRepositoryAuthorityError extends Error {
  constructor() {
    super("Estimate draft authority changed");
    this.name = "EstimateDraftRepositoryAuthorityError";
  }
}

export class EstimateDraftRepositoryInputError extends Error {
  constructor() {
    super("Estimate draft input is invalid");
    this.name = "EstimateDraftRepositoryInputError";
  }
}

export class EstimateDraftRepositoryStaleError extends Error {
  constructor() {
    super("Estimate draft source changed");
    this.name = "EstimateDraftRepositoryStaleError";
  }
}

export class EstimateDraftRepositoryBoundError extends Error {
  constructor() {
    super("Estimate draft source exceeds its safe bound");
    this.name = "EstimateDraftRepositoryBoundError";
  }
}

function errorShape(error: unknown): { code: string; message: string } | null {
  if (typeof error !== "object" || error === null) return null;
  const value = error as Readonly<Record<string, unknown>>;
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "",
  };
}

function normalizeRpcError(error: unknown): Error {
  const value = errorShape(error);
  if (
    value?.code === "42501" ||
    value?.message.startsWith("AGENT_ESTIMATE_DRAFT_AUTHORITY") ||
    value?.message.startsWith("AGENT_ESTIMATE_DRAFT_GRANT") ||
    value?.message.startsWith("AGENT_ESTIMATE_DRAFT_BINDING")
  ) {
    return new EstimateDraftRepositoryAuthorityError();
  }
  if (
    value?.code === "22023" &&
    value.message.startsWith("AGENT_ESTIMATE_DRAFT_INPUT_INVALID")
  ) {
    return new EstimateDraftRepositoryInputError();
  }
  if (
    value?.code === "55000" &&
    value.message.startsWith("AGENT_ESTIMATE_DRAFT_SOURCE_STALE")
  ) {
    return new EstimateDraftRepositoryStaleError();
  }
  if (
    value?.code === "54000" &&
    value.message.startsWith("AGENT_ESTIMATE_DRAFT_SOURCE_BOUND")
  ) {
    return new EstimateDraftRepositoryBoundError();
  }
  return new EstimateDraftRepositoryUnavailableError();
}

function binding(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    actorContext.capabilityManifestRevision !==
      ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Estimate draft requires a v16 MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_capability_manifest_revision: ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V10.revision,
    p_capability_id: "prepare_estimate_from_past_job",
    p_capability_revision: ESTIMATE_DRAFT_CAPABILITY_REVISION,
  } as const;
}

function timestampNanoseconds(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
    value
  );
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(milliseconds)) return null;
  return (
    BigInt(milliseconds) * BigInt(1_000_000) +
    BigInt((match[2] ?? "").padEnd(9, "0"))
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

const FinalAuthorityResultSchema = z
  .object({
    permission_snapshot_revision: z.string().min(1).max(256),
    source_revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

async function execute(
  request: RpcRequest,
  signal?: AbortSignal
): Promise<RpcResult> {
  return signal && request.abortSignal
    ? await request.abortSignal(signal)
    : await request;
}

export interface EstimateDraftRepository {
  readSourceSnapshot(input: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareEstimateFromPastJobInput;
    signal?: AbortSignal;
  }): Promise<EstimateDraftSourceSnapshot>;
  assertCurrentAuthority(input: {
    actorContext: ActorContext;
    input: PrepareEstimateFromPastJobInput;
    expectedSourceRevision: string;
    signal?: AbortSignal;
  }): Promise<void>;
}

export function createEstimateDraftRepository(input: {
  rpc: EstimateDraftRpcClient["rpc"];
}): EstimateDraftRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("An estimate draft RPC client is required");
  }

  const repository: EstimateDraftRepository = {
    async readSourceSnapshot(readInput) {
      const response = await execute(
        input.rpc("read_agent_estimate_draft_as_system", {
          ...binding(readInput.actorContext),
          p_observed_at: readInput.observedAt,
          p_target_opportunity_id: readInput.input.target_opportunity_id,
          p_source_estimate_id: readInput.input.source_estimate_id,
          p_line_item_limit: ESTIMATE_DRAFT_MAX_SOURCE_LINE_ITEMS,
        }),
        readInput.signal
      );
      if (response.error) throw normalizeRpcError(response.error);

      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(response.data);
      } catch {
        throw new EstimateDraftRepositoryUnavailableError();
      }
      const parsed = EstimateDraftSourceSnapshotSchema.safeParse(response.data);
      const requestedInstant = timestampNanoseconds(readInput.observedAt);
      if (
        serialized === undefined ||
        serialized.length > ESTIMATE_DRAFT_MAX_SOURCE_SNAPSHOT_CHARACTERS ||
        !parsed.success ||
        requestedInstant === null ||
        timestampNanoseconds(parsed.data.observed_at) !== requestedInstant ||
        parsed.data.context.company_id !== readInput.actorContext.companyId ||
        parsed.data.target.opportunity_id !==
          readInput.input.target_opportunity_id ||
        parsed.data.source.estimate_id !== readInput.input.source_estimate_id
      ) {
        throw new EstimateDraftRepositoryUnavailableError();
      }
      return deepFreeze(parsed.data);
    },

    async assertCurrentAuthority(assertInput) {
      const response = await execute(
        input.rpc("assert_agent_estimate_draft_authority_as_system", {
          ...binding(assertInput.actorContext),
          p_target_opportunity_id: assertInput.input.target_opportunity_id,
          p_source_estimate_id: assertInput.input.source_estimate_id,
          p_expected_source_revision: assertInput.expectedSourceRevision,
        }),
        assertInput.signal
      );
      if (response.error) throw normalizeRpcError(response.error);
      const parsed = FinalAuthorityResultSchema.safeParse(response.data);
      if (
        !parsed.success ||
        parsed.data.permission_snapshot_revision !==
          assertInput.actorContext.permissionSnapshotRevision ||
        parsed.data.source_revision !== assertInput.expectedSourceRevision
      ) {
        throw new EstimateDraftRepositoryAuthorityError();
      }
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedEstimateDraftRepository(
  value: unknown
): value is EstimateDraftRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
