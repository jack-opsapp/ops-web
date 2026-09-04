import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  DISPATCH_CONFIRMATION_TASK_CAPABILITY_REVISION,
  DispatchConfirmationTaskResultSchema,
  type DispatchConfirmationTaskResult,
  type PrepareDispatchConfirmationTaskInput,
} from "@/lib/agent-control-plane/contracts/dispatch-confirmation-task";
import { DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V13 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

interface RpcResponse {
  readonly data: unknown;
  readonly error: unknown;
}
interface RpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>;
}
export interface DispatchConfirmationTaskRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

const TRUSTED_REPOSITORIES = new WeakSet<object>();

export class DispatchConfirmationTaskRepositoryError extends Error {
  readonly code: "CONFLICT" | "POLICY" | "STALE" | "UNAVAILABLE";
  constructor(
    code: DispatchConfirmationTaskRepositoryError["code"],
    cause?: unknown
  ) {
    super(
      code === "CONFLICT"
        ? "The idempotency key belongs to different input"
        : code === "POLICY"
          ? "The dispatch policy is missing, conflicting, or invalid"
          : code === "STALE"
            ? "The dispatch evidence or authority changed"
            : "The dispatch task proposal is unavailable",
      { cause }
    );
    this.name = "DispatchConfirmationTaskRepositoryError";
    this.code = code;
  }
}

function normalizedError(
  error: unknown
): DispatchConfirmationTaskRepositoryError {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message.startsWith("AGENT_DISPATCH_IDEMPOTENCY_CONFLICT"))
    return new DispatchConfirmationTaskRepositoryError("CONFLICT", error);
  if (message.startsWith("AGENT_DISPATCH_POLICY_"))
    return new DispatchConfirmationTaskRepositoryError("POLICY", error);
  if (
    message.startsWith("AGENT_DISPATCH_SOURCE_") ||
    message.startsWith("AGENT_DISPATCH_AUTHORITY_") ||
    message.startsWith("AGENT_DISPATCH_GRANT_")
  )
    return new DispatchConfirmationTaskRepositoryError("STALE", error);
  return new DispatchConfirmationTaskRepositoryError("UNAVAILABLE", error);
}

function binding(actor: ActorContext) {
  if (
    actor.auth.channel !== "mcp" ||
    actor.capabilityManifestRevision !==
      DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Dispatch confirmation tasks require a v19 MCP actor");
  }
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
      DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V13.revision,
    p_capability_id: "prepare_dispatch_confirmation_task",
    p_capability_revision: DISPATCH_CONFIRMATION_TASK_CAPABILITY_REVISION,
  } as const;
}

async function execute(request: RpcRequest, signal?: AbortSignal) {
  return signal && request.abortSignal
    ? await request.abortSignal(signal)
    : await request;
}

export interface DispatchConfirmationTaskRepository {
  prepare(input: {
    actorContext: ActorContext;
    request: PrepareDispatchConfirmationTaskInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<DispatchConfirmationTaskResult>;
}

export function createDispatchConfirmationTaskRepository(input: {
  rpc: DispatchConfirmationTaskRpcClient["rpc"];
}): DispatchConfirmationTaskRepository {
  if (!input || typeof input.rpc !== "function")
    throw new TypeError("A dispatch confirmation task RPC client is required");
  const repository: DispatchConfirmationTaskRepository = {
    async prepare(read) {
      const response = await execute(
        input.rpc("prepare_agent_dispatch_confirmation_task_as_system", {
          ...binding(read.actorContext),
          p_request_id: read.actorContext.requestId,
          p_source_task_id: read.request.source_task_id,
          p_expected_schedule_version: read.request.expected_schedule_version,
          p_operational_overview_proof_ref:
            read.request.evidence.operational_overview_proof_ref,
          p_work_queue_proof_ref: read.request.evidence.work_queue_proof_ref,
          p_task_context_proof_ref:
            read.request.evidence.task_context_proof_ref,
          p_idempotency_key: read.request.idempotency_key,
          p_observed_at: read.observedAt,
        }),
        read.signal
      );
      if (response.error) throw normalizedError(response.error);
      const parsed = DispatchConfirmationTaskResultSchema.safeParse(
        response.data
      );
      if (
        !parsed.success ||
        parsed.data.request_id !== read.actorContext.requestId ||
        parsed.data.evidence.source_task_id !== read.request.source_task_id ||
        parsed.data.evidence.schedule_version !==
          read.request.expected_schedule_version
      ) {
        throw new DispatchConfirmationTaskRepositoryError("UNAVAILABLE");
      }
      return Object.freeze(parsed.data);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedDispatchConfirmationTaskRepository(
  value: unknown
): value is DispatchConfirmationTaskRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
