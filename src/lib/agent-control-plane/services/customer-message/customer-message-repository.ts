import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  CUSTOMER_MESSAGE_CAPABILITY_REVISION,
  CustomerMessagePrepareResultSchema,
  type CustomerMessagePrepareInput,
  type CustomerMessagePrepareResult,
} from "@/lib/agent-control-plane/contracts/customer-message";
import { CUSTOMER_MESSAGE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V15 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

interface RpcResponse {
  readonly data: unknown;
  readonly error: unknown;
}
interface RpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>;
}
export interface CustomerMessageRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

const TRUSTED_REPOSITORIES = new WeakSet<object>();
export class CustomerMessageRepositoryError extends Error {
  readonly code: "CONFLICT" | "STALE" | "POLICY" | "UNAVAILABLE";
  constructor(code: CustomerMessageRepositoryError["code"], cause?: unknown) {
    super(
      code === "CONFLICT"
        ? "The request key belongs to a different message"
        : code === "STALE"
          ? "The correspondence, recipient, mailbox, or authority changed"
          : code === "POLICY"
            ? "The customer message policy is unavailable"
            : "The customer message proposal is temporarily unavailable",
      { cause }
    );
    this.name = "CustomerMessageRepositoryError";
    this.code = code;
  }
}

function normalizeError(error: unknown): CustomerMessageRepositoryError {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message.startsWith("AGENT_CUSTOMER_MESSAGE_IDEMPOTENCY_"))
    return new CustomerMessageRepositoryError("CONFLICT", error);
  if (message.startsWith("AGENT_CUSTOMER_MESSAGE_POLICY_"))
    return new CustomerMessageRepositoryError("POLICY", error);
  if (
    message.startsWith("AGENT_CUSTOMER_MESSAGE_") &&
    /(SOURCE|RECIPIENT|MAILBOX|THREAD|AUTHORITY|GRANT|STALE|PROGRESS)/.test(
      message
    )
  )
    return new CustomerMessageRepositoryError("STALE", error);
  return new CustomerMessageRepositoryError("UNAVAILABLE", error);
}

export interface CustomerMessageRepository {
  prepare(input: {
    actorContext: ActorContext;
    request: CustomerMessagePrepareInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<CustomerMessagePrepareResult>;
}

function matchesRequest(
  result: CustomerMessagePrepareResult,
  request: CustomerMessagePrepareInput
): boolean {
  const proposal = result.proposal;
  const expectedOpportunityStamp = Date.parse(
    request.expected_opportunity_updated_at
  );
  const proposalOpportunityStamp = Date.parse(proposal.opportunity.updated_at);
  return (
    proposal.opportunity.id === request.opportunity_id &&
    Number.isFinite(expectedOpportunityStamp) &&
    proposalOpportunityStamp === expectedOpportunityStamp &&
    proposal.source.activity_id === request.source_activity_id &&
    proposal.source.source_sha256 === request.expected_source_sha256 &&
    proposal.source.sender_identity === proposal.recipients.to[0] &&
    proposal.message.subject === request.subject &&
    proposal.message.body === request.body &&
    proposal.sender.mailbox_type === "individual" &&
    proposal.recipients.to.length === 1 &&
    proposal.recipients.cc.length === 0 &&
    proposal.recipients.bcc.length === 0 &&
    proposal.message.attachment_ids.length === 0
  );
}

export function createCustomerMessageRepository(input: {
  rpc: CustomerMessageRpcClient["rpc"];
}): CustomerMessageRepository {
  if (!input || typeof input.rpc !== "function")
    throw new TypeError("A customer message RPC client is required");
  const repository: CustomerMessageRepository = {
    async prepare(read) {
      const actor = read.actorContext;
      if (
        actor.auth.channel !== "mcp" ||
        actor.capabilityManifestRevision !==
          CUSTOMER_MESSAGE_CAPABILITY_MANIFEST_REVISION
      )
        throw new TypeError("Customer messages require a v21 MCP actor");
      const request = input.rpc("prepare_agent_customer_message_as_system", {
        p_actor_user_id: actor.actorUserId,
        p_company_id: actor.companyId,
        p_oauth_grant_id: actor.auth.oauthGrantId,
        p_oauth_client_id: actor.auth.oauthClientId,
        p_grant_revision: actor.auth.grantRevision,
        p_granted_scope_ceiling: [...actor.auth.scopeCeiling],
        p_permission_snapshot_revision: actor.permissionSnapshotRevision,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_manifest_revision:
          CUSTOMER_MESSAGE_CAPABILITY_MANIFEST_REVISION,
        p_exposure_revision: MCP_EXPOSURE_V15.revision,
        p_capability_id: "prepare_customer_message",
        p_capability_revision: CUSTOMER_MESSAGE_CAPABILITY_REVISION,
        p_request_id: actor.requestId,
        p_request: read.request,
        p_observed_at: read.observedAt,
      });
      const response =
        read.signal && request.abortSignal
          ? await request.abortSignal(read.signal)
          : await request;
      if (response.error) throw normalizeError(response.error);
      const parsed = CustomerMessagePrepareResultSchema.safeParse(
        response.data
      );
      if (
        !parsed.success ||
        parsed.data.request_id !== actor.requestId ||
        !matchesRequest(parsed.data, read.request)
      )
        throw new CustomerMessageRepositoryError("UNAVAILABLE");
      return Object.freeze(parsed.data);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}
export function isTrustedCustomerMessageRepository(
  value: unknown
): value is CustomerMessageRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
