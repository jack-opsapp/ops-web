import "server-only";

import { z } from "zod-v4";

import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";
import type { McpOAuthRpcClient } from "./oauth";

export const DURABLE_MCP_RATE_LIMIT_POLICIES = Object.freeze({
  lightweight_read: "mcp-lightweight-read:2026-08-23.v1",
  evidence_search: "mcp-evidence-search:2026-08-23.v1",
  prepare: "mcp-day-closeout-prepare:2026-08-30.v1",
} as const);

export type DurableMcpRateLimitBucket =
  keyof typeof DURABLE_MCP_RATE_LIMIT_POLICIES;

export interface DurableMcpRateLimitInput {
  readonly requestId: string;
  readonly grantId: string;
  readonly actorUserId: string;
  readonly companyId: string;
  readonly capabilityId: string;
  readonly protocolEra: "legacy" | "modern";
  readonly bucket: DurableMcpRateLimitBucket;
}

export interface DurableMcpRateLimitDecision {
  readonly allowed: boolean;
  readonly remainingUnits: number;
  readonly resetAt: string;
}

export interface DurableMcpRateLimiter {
  consume(
    input: DurableMcpRateLimitInput
  ): Promise<DurableMcpRateLimitDecision>;
}

export class DurableMcpRateLimitUnavailableError extends Error {
  constructor() {
    super("Durable MCP rate limiter is unavailable");
    this.name = "DurableMcpRateLimitUnavailableError";
  }
}

const OAuthUuidSchema = z.uuid();
const InputSchema = z
  .object({
    requestId: z.string().trim().min(1).max(128),
    grantId: OAuthUuidSchema,
    actorUserId: PostgresUuidSchema,
    companyId: PostgresUuidSchema,
    capabilityId: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    protocolEra: z.enum(["legacy", "modern"]),
    bucket: z.enum(["lightweight_read", "evidence_search", "prepare"]),
  })
  .strict();

const DatabaseDecisionSchema = z
  .object({
    allowed: z.boolean(),
    remaining_units: z.number().int().min(0).max(600),
    reset_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  })
  .strict()
  .refine(
    (decision) => decision.allowed || decision.remaining_units === 0,
    "A durable denial must report zero remaining units"
  );

const DURABLE_CONSUME_TIMEOUT_MS = 3_000 as const;

type McpRateLimitRpcResponse = {
  readonly data: unknown;
  readonly error: unknown;
};

type AbortableMcpRateLimitRpc = PromiseLike<McpRateLimitRpcResponse> & {
  abortSignal(signal: AbortSignal): PromiseLike<McpRateLimitRpcResponse>;
};

function supportsAbortSignal(
  request: PromiseLike<McpRateLimitRpcResponse>
): request is AbortableMcpRateLimitRpc {
  return (
    typeof request === "object" &&
    request !== null &&
    "abortSignal" in request &&
    typeof request.abortSignal === "function"
  );
}

function unavailable(): DurableMcpRateLimitUnavailableError {
  return new DurableMcpRateLimitUnavailableError();
}

async function consumeWithDeadline(
  client: McpOAuthRpcClient,
  args: Readonly<Record<string, unknown>>
): Promise<McpRateLimitRpcResponse> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(unavailable());
    }, DURABLE_CONSUME_TIMEOUT_MS);
  });

  try {
    const rawRequest = client.rpc(
      args.p_policy_id === DURABLE_MCP_RATE_LIMIT_POLICIES.prepare
        ? "consume_agent_day_closeout_prepare_rate_limit_as_system"
        : "consume_agent_mcp_rate_limit_as_system",
      args
    );
    const request = supportsAbortSignal(rawRequest)
      ? rawRequest.abortSignal(controller.signal)
      : rawRequest;
    return await Promise.race([Promise.resolve(request), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Strict adapter for the one atomic database consume boundary. A transport
 * ambiguity is never retried here: the first statement may have committed,
 * and a blind retry could double-charge the request. The caller fails closed.
 */
export function createDurableMcpRateLimiter(
  client: McpOAuthRpcClient
): DurableMcpRateLimiter {
  return Object.freeze({
    async consume(
      rawInput: DurableMcpRateLimitInput
    ): Promise<DurableMcpRateLimitDecision> {
      const parsedInput = InputSchema.safeParse(rawInput);
      if (!parsedInput.success) throw unavailable();
      const input = parsedInput.data;

      let data: unknown;
      let error: unknown;
      try {
        ({ data, error } = await consumeWithDeadline(client, {
          p_request_id: input.requestId,
          p_grant_id: input.grantId,
          p_actor_user_id: input.actorUserId,
          p_company_id: input.companyId,
          p_capability_id: input.capabilityId,
          p_policy_id: DURABLE_MCP_RATE_LIMIT_POLICIES[input.bucket],
          p_requested_units: 1,
          p_protocol_era: input.protocolEra,
        }));
      } catch {
        throw unavailable();
      }
      if (error != null || !Array.isArray(data) || data.length !== 1) {
        throw unavailable();
      }

      const parsedDecision = DatabaseDecisionSchema.safeParse(data[0]);
      if (!parsedDecision.success) throw unavailable();
      const decision = parsedDecision.data;
      const canonicalResetAt = new Date(decision.reset_at).toISOString();

      return Object.freeze({
        allowed: decision.allowed,
        remainingUnits: decision.remaining_units,
        resetAt: canonicalResetAt,
      });
    },
  });
}
