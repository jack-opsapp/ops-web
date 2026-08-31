import "server-only";

import { createSupabaseActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { createSupabaseCorrespondenceEvidencePageRepository } from "@/lib/agent-control-plane/services/correspondence-evidence-page-repository";
import { createOpsAgentDomainService } from "@/lib/agent-control-plane/services/create-domain-service";
import { createSupabaseCustomerJobsRepository } from "@/lib/agent-control-plane/services/customer-jobs-repository";
import { createSupabaseCustomerDiscoveryRepository } from "@/lib/agent-control-plane/services/customer-discovery-repository";
import { createOpsAgentP2DomainService } from "@/lib/agent-control-plane/services/p2/domain-service";
import { createSupabaseOpsAgentP2Repositories } from "@/lib/agent-control-plane/services/p2/repositories";
import {
  createOpsAgentReadCatalogueService,
  type OpsAgentReadCatalogueService,
} from "@/lib/agent-control-plane/services/read-catalogue-service";
import {
  createOpsAgentCapabilityService,
  type OpsAgentCapabilityService,
} from "@/lib/agent-control-plane/services/capability-service";
import { createDayCloseoutRepository } from "@/lib/agent-control-plane/services/day-closeout/day-closeout-repository";
import {
  createDayCloseoutService,
  type DayCloseoutService,
} from "@/lib/agent-control-plane/services/day-closeout/day-closeout-service";
import { createSupabaseJobCommunicationContextRepository } from "@/lib/agent-control-plane/services/job-communication-context-repository";
import { createSupabaseJobConversationContextRepository } from "@/lib/agent-control-plane/services/job-conversation-context-repository";
import { createSupabaseJobHistoryRepository } from "@/lib/agent-control-plane/services/job-history-repository";
import { createSupabaseJobDiscoveryRepository } from "@/lib/agent-control-plane/services/job-discovery-repository";
import { createSupabaseJobParticipantsRepository } from "@/lib/agent-control-plane/services/job-participants-repository";
import { createSupabaseJobReadinessRepository } from "@/lib/agent-control-plane/services/job-readiness-repository";
import { createSupabaseJobSummaryRepository } from "@/lib/agent-control-plane/services/job-summary-repository";
import { createOperationalReadCursorCodec } from "@/lib/agent-control-plane/services/operational-read-cursor";
import { createOpsAgentDomainRepositories } from "@/lib/agent-control-plane/services/repositories";
import { createSupabaseScheduledJobsRepository } from "@/lib/agent-control-plane/services/scheduled-jobs-repository";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  createDurableMcpRateLimiter,
  type DurableMcpRateLimiter,
} from "./durable-rate-limit";
import type { McpOAuthRpcClient } from "./oauth";

const OPERATIONAL_READ_CURSOR_KEY_ENV =
  "OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY" as const;
const CURSOR_KEY_PATTERN = /^[0-9a-f]{64}$/;

interface McpRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface McpRpcRequest extends PromiseLike<McpRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<McpRpcResult>;
}

interface McpRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): McpRpcRequest;
}

export interface McpServerRuntime {
  readonly domainService: OpsAgentCapabilityService;
  readonly dayCloseout: DayCloseoutService;
  readonly authorityRepository: ActorAuthorityRepository;
  readonly rpcClient: McpOAuthRpcClient;
  readonly durableRateLimiter: DurableMcpRateLimiter;
}

let cachedRuntime: McpServerRuntime | null = null;

async function settleMcpRpc(
  functionName: string,
  request: PromiseLike<McpRpcResult>
): Promise<McpRpcResult> {
  try {
    const { data, error } = await request;
    if (error != null) {
      const shaped = error as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      console.error(
        JSON.stringify({
          at: "mcp_runtime_rpc",
          fn: functionName,
          errorCode: shaped.code ?? "unknown",
          message: shaped.message ?? null,
          details: shaped.details ?? null,
          hint: shaped.hint ?? null,
        })
      );
    }
    return { data, error };
  } catch (thrown) {
    console.error(
      JSON.stringify({
        at: "mcp_runtime_rpc",
        fn: functionName,
        thrown: thrown instanceof Error ? thrown.message : "unknown",
      })
    );
    throw thrown;
  }
}

function preserveMcpRpcCancellation(
  functionName: string,
  rawRequest: McpRpcRequest
): McpRpcRequest {
  let defaultExecution: Promise<McpRpcResult> | null = null;
  const then = <TResult1 = McpRpcResult, TResult2 = never>(
    onfulfilled?:
      | ((value: McpRpcResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> => {
    defaultExecution ??= settleMcpRpc(functionName, rawRequest);
    return defaultExecution.then(onfulfilled, onrejected);
  };
  const rawAbortSignal = rawRequest.abortSignal;
  if (typeof rawAbortSignal !== "function") {
    return Object.freeze({ then });
  }
  return Object.freeze({
    then,
    abortSignal(signal: AbortSignal): PromiseLike<McpRpcResult> {
      return settleMcpRpc(
        functionName,
        rawAbortSignal.call(rawRequest, signal)
      );
    },
  });
}

/**
 * Whether the operational-read cursor key is provisioned. The MCP mount is
 * deliberately unusable without it: signed keyset cursors are part of the
 * read contract, and serving page one of a read whose page two cannot exist
 * would be a silent partial capability.
 */
export function mcpRuntimeConfigured(): boolean {
  const rawKey = process.env[OPERATIONAL_READ_CURSOR_KEY_ENV]?.trim() ?? "";
  return CURSOR_KEY_PATTERN.test(rawKey);
}

/**
 * Production composition root for the MCP transport, mirroring the internal
 * Phase C runtime: one fixed service-role RPC transport feeds every
 * repository, the frozen domain service owns manifest authorization, and the
 * actor authority repository re-resolves authority per call. Lazy and cached;
 * throws only when called unconfigured (routes must gate on
 * mcpRuntimeConfigured() first so module import never throws at build time).
 */
export function getMcpServerRuntime(): McpServerRuntime {
  if (cachedRuntime) return cachedRuntime;

  const rawKey = process.env[OPERATIONAL_READ_CURSOR_KEY_ENV]?.trim() ?? "";
  if (!CURSOR_KEY_PATTERN.test(rawKey)) {
    throw new TypeError("MCP operational read cursor key is not provisioned");
  }
  const cursorKey = Uint8Array.from(Buffer.from(rawKey, "hex"));
  const cursorCodec = createOperationalReadCursorCodec({
    key: cursorKey,
    keyId: "mcp-operational-read",
    version: 1,
  });

  const supabase = getServiceRoleClient();
  const rpcClient: McpRpcClient = Object.freeze({
    rpc(
      functionName: string,
      args: Readonly<Record<string, unknown>>
    ): McpRpcRequest {
      const rawRequest = supabase.rpc(
        functionName,
        args as Record<string, unknown>
      ) as unknown as McpRpcRequest;
      return preserveMcpRpcCancellation(functionName, rawRequest);
    },
  });

  const repositories = createOpsAgentDomainRepositories({
    jobConversationContext:
      createSupabaseJobConversationContextRepository(rpcClient),
    scheduledJobs: createSupabaseScheduledJobsRepository(
      rpcClient,
      cursorCodec
    ),
    jobReadiness: createSupabaseJobReadinessRepository(rpcClient, cursorCodec),
    jobCommunicationContext:
      createSupabaseJobCommunicationContextRepository(rpcClient),
    jobParticipants: createSupabaseJobParticipantsRepository(rpcClient),
    customerJobs: createSupabaseCustomerJobsRepository(rpcClient, cursorCodec),
    jobSummary: createSupabaseJobSummaryRepository(rpcClient),
    jobHistory: createSupabaseJobHistoryRepository(rpcClient, cursorCodec),
    correspondenceEvidence:
      createSupabaseCorrespondenceEvidencePageRepository(rpcClient),
    customerDiscovery: createSupabaseCustomerDiscoveryRepository(
      rpcClient,
      cursorCodec
    ),
    jobDiscovery: createSupabaseJobDiscoveryRepository(rpcClient, cursorCodec),
  });

  const currentProduction = createOpsAgentDomainService({ repositories });
  const p2 = createOpsAgentP2DomainService({
    repositories: createSupabaseOpsAgentP2Repositories(rpcClient),
    cursorKey: { keyId: "mcp-p2-read", key: cursorKey },
  });

  const readService: OpsAgentReadCatalogueService =
    createOpsAgentReadCatalogueService({
      currentProduction,
      p2,
    });
  const authorityRepository = createSupabaseActorAuthorityRepository(rpcClient);
  const dayCloseout = createDayCloseoutService({
    readService,
    repository: createDayCloseoutRepository(rpcClient),
    authorityRepository,
  });

  cachedRuntime = Object.freeze({
    domainService: createOpsAgentCapabilityService({
      reads: readService,
      dayCloseout,
    }),
    dayCloseout,
    authorityRepository,
    rpcClient,
    durableRateLimiter: createDurableMcpRateLimiter(rpcClient),
  });
  return cachedRuntime;
}
