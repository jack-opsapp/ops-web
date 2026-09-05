import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  CUSTOMER_UPDATE_CAPABILITY_REVISION,
  CustomerUpdateResultSchema,
  type CustomerUpdateResult,
  type PrepareCustomerUpdateInput,
} from "@/lib/agent-control-plane/contracts/customer-update";
import { CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V14 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

interface RpcResponse {
  readonly data: unknown;
  readonly error: unknown;
}
interface RpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>;
}
export interface CustomerUpdateRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

const TRUSTED_REPOSITORIES = new WeakSet<object>();

export class CustomerUpdateRepositoryError extends Error {
  readonly code: "CONFLICT" | "POLICY" | "STALE" | "UNAVAILABLE";
  constructor(code: CustomerUpdateRepositoryError["code"], cause?: unknown) {
    super(
      code === "CONFLICT"
        ? "The idempotency key belongs to different input"
        : code === "POLICY"
          ? "The customer update policy is missing, conflicting, or invalid"
          : code === "STALE"
            ? "The update evidence or authority changed"
            : "The customer update proposal is unavailable",
      { cause }
    );
    this.name = "CustomerUpdateRepositoryError";
    this.code = code;
  }
}

function normalizedError(error: unknown): CustomerUpdateRepositoryError {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message.startsWith("AGENT_CUSTOMER_UPDATE_IDEMPOTENCY_CONFLICT"))
    return new CustomerUpdateRepositoryError("CONFLICT", error);
  if (message.startsWith("AGENT_CUSTOMER_UPDATE_POLICY_"))
    return new CustomerUpdateRepositoryError("POLICY", error);
  if (
    message.startsWith("AGENT_CUSTOMER_UPDATE_SOURCE_") ||
    message.startsWith("AGENT_CUSTOMER_UPDATE_AUTHORITY_") ||
    message.startsWith("AGENT_CUSTOMER_UPDATE_GRANT_")
  )
    return new CustomerUpdateRepositoryError("STALE", error);
  return new CustomerUpdateRepositoryError("UNAVAILABLE", error);
}

function binding(actor: ActorContext) {
  if (
    actor.auth.channel !== "mcp" ||
    actor.capabilityManifestRevision !==
      CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Customer updates require a v20 MCP actor");
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
      CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V14.revision,
    p_capability_id: "prepare_customer_update",
    p_capability_revision: CUSTOMER_UPDATE_CAPABILITY_REVISION,
  } as const;
}

async function execute(request: RpcRequest, signal?: AbortSignal) {
  return signal && request.abortSignal
    ? await request.abortSignal(signal)
    : await request;
}

export interface CustomerUpdateRepository {
  prepare(input: {
    actorContext: ActorContext;
    request: PrepareCustomerUpdateInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<CustomerUpdateResult>;
}

function matchesRequest(
  result: CustomerUpdateResult,
  request: PrepareCustomerUpdateInput
): boolean {
  const { before, after, evidence, effects } = result.proposal;
  if (
    after.opportunity_id !== request.opportunity_id ||
    Date.parse(before.updated_at) !== Date.parse(request.expected_updated_at) ||
    before.updated_at !== after.updated_at ||
    evidence.length !== request.evidence.length
  )
    return false;
  for (const field of [
    "title",
    "description",
    "assigned_to",
    "next_follow_up_at",
  ] as const) {
    const expected = request.changes[field] ?? before[field];
    if (field === "next_follow_up_at") {
      if (
        (expected === null) !== (after[field] === null) ||
        (expected !== null &&
          Date.parse(expected) !== Date.parse(after[field]!))
      )
        return false;
    } else if (after[field] !== expected) return false;
  }
  const assignmentChanged = before.assigned_to !== after.assigned_to;
  if (
    after.assignment_version !==
      before.assignment_version + Number(assignmentChanged) ||
    effects.assignments_changed !== Number(assignmentChanged) ||
    effects.assignment_history_recorded !== assignmentChanged ||
    effects.customers_updated !== Number(Boolean(request.customer))
  )
    return false;
  if (request.customer) {
    if (
      before.customer?.id !== request.customer.id ||
      after.customer?.id !== request.customer.id ||
      Date.parse(before.customer.updated_at) !==
        Date.parse(request.customer.expected_updated_at) ||
      before.customer.updated_at !== after.customer.updated_at ||
      before.customer.name !== after.customer.name ||
      after.customer.notes !== request.customer.notes
    )
      return false;
  } else if (before.customer !== null || after.customer !== null) return false;
  return request.evidence.every((item, index) => {
    const returned = evidence[index]!;
    return (
      returned.kind === item.kind &&
      returned.text ===
        (item.kind === "operator_statement" ? item.text : item.excerpt) &&
      returned.activity_id ===
        (item.kind === "correspondence" ? item.activity_id : null) &&
      JSON.stringify(returned.supports) === JSON.stringify(item.supports)
    );
  });
}

export function createCustomerUpdateRepository(input: {
  rpc: CustomerUpdateRpcClient["rpc"];
}): CustomerUpdateRepository {
  if (!input || typeof input.rpc !== "function")
    throw new TypeError("A customer update RPC client is required");
  const repository: CustomerUpdateRepository = {
    async prepare(read) {
      const response = await execute(
        input.rpc("prepare_agent_customer_update_as_system", {
          ...binding(read.actorContext),
          p_request_id: read.actorContext.requestId,
          p_request: read.request,
          p_observed_at: read.observedAt,
        }),
        read.signal
      );
      if (response.error) throw normalizedError(response.error);
      const parsed = CustomerUpdateResultSchema.safeParse(response.data);
      if (
        !parsed.success ||
        parsed.data.request_id !== read.actorContext.requestId ||
        parsed.data.proposal.before.opportunity_id !==
          read.request.opportunity_id ||
        !matchesRequest(parsed.data, read.request)
      ) {
        throw new CustomerUpdateRepositoryError("UNAVAILABLE");
      }
      return Object.freeze(parsed.data);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedCustomerUpdateRepository(
  value: unknown
): value is CustomerUpdateRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
