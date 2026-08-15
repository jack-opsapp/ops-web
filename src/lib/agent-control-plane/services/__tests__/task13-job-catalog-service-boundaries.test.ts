import { describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { verifiedInternalPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts";
import {
  CorrespondenceEvidenceReadInputSchema,
  CustomerJobsInputSchema,
  JobHistorySearchInputSchema,
  JobSummaryInputSchema,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { createOperationalReadCursorCodec } from "../operational-read-cursor";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const TURN_ID = "55555555-5555-4555-8555-555555555555";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const FIXED_NOW = "2026-08-14T18:00:00.000Z";

const RAW_INPUTS = {
  customerJobs: CustomerJobsInputSchema.parse({
    customer_ref: { kind: "client", id: CLIENT_ID },
  }),
  jobSummary: JobSummaryInputSchema.parse({
    job_ref: { kind: "project", id: PROJECT_ID },
    sections: ["identity"],
  }),
  jobHistory: JobHistorySearchInputSchema.parse({
    query: "east gate",
    scope: {
      kind: "jobs",
      job_refs: [{ kind: "project", id: PROJECT_ID }],
    },
  }),
  correspondenceEvidence: CorrespondenceEvidenceReadInputSchema.parse({
    job_ref: { kind: "project", id: PROJECT_ID },
    evidence_ids: [`job_conversation_turn:${TURN_ID}`],
  }),
} as const;

type RpcResult = Readonly<{ data: unknown; error: unknown }>;

class StubRpcClient {
  readonly calls: Array<{
    readonly functionName: string;
    readonly args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly abortSignals: AbortSignal[] = [];

  constructor(
    private readonly results: Array<RpcResult | (() => PromiseLike<RpcResult>)>
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected Task 13 repository read");
    const request =
      typeof next === "function"
        ? Promise.resolve(next())
        : Promise.resolve(next);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
  }
}

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    configuredPermissions: [
      "calendar.view",
      "clients.view",
      "estimates.view",
      "inbox.view",
      "photos.view",
      "pipeline.view",
      "projects.view",
      "projects.view_financials",
      "tasks.view",
    ],
    effectivePermissions: [
      { permission: "calendar.view", scope: "all" },
      { permission: "clients.view", scope: "all" },
      { permission: "estimates.view", scope: "all" },
      { permission: "inbox.view", scope: "all" },
      { permission: "photos.view", scope: "all" },
      { permission: "pipeline.view", scope: "all" },
      { permission: "projects.view", scope: "all" },
      { permission: "projects.view_financials", scope: "all" },
      { permission: "tasks.view", scope: "all" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function actorContext() {
  return resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-task13-service-boundary",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-task13-service-boundary",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

async function genericAuthorizations(capabilityId: string, rawInput: unknown) {
  const actor = await actorContext();
  const resolved = resolveCapabilityAuthorization(capabilityId, rawInput);
  return resolved.variants.map((variant) =>
    authorizeCapability({ actorContext: actor, policy: variant.policy })
  );
}

const cursorCodec = () =>
  createOperationalReadCursorCodec({
    key: new Uint8Array(32).fill(23),
    keyId: "task13-boundary",
    version: 1,
    now: () => new Date(FIXED_NOW),
  });

type Harness = Readonly<{
  name: string;
  capabilityId:
    | "list_customer_jobs"
    | "get_job_summary"
    | "search_job_history"
    | "get_correspondence_evidence";
  rawInput: unknown;
  rpcName: string;
  exactNotFoundMessage: string;
  createAuthorization(): Promise<unknown>;
  createRepository(
    client: StubRpcClient | Readonly<Record<string, unknown>>
  ): Promise<unknown>;
  isTrustedRepository(repository: unknown): Promise<boolean>;
  readRepository(input: {
    authorization: unknown;
    repository: unknown;
    signal?: AbortSignal;
  }): Promise<unknown>;
  invokeService(input: {
    authorization: unknown;
    repository: unknown;
    signal?: AbortSignal;
  }): Promise<unknown>;
  serviceErrorClass(): Promise<new (...args: never[]) => Error>;
}>;

const HARNESSES: readonly Harness[] = [
  {
    name: "customer jobs",
    capabilityId: "list_customer_jobs",
    rawInput: RAW_INPUTS.customerJobs,
    rpcName: "read_agent_customer_jobs_as_system",
    exactNotFoundMessage: "agent_customer_jobs_not_found_or_not_visible",
    async createAuthorization() {
      const authorizations = await genericAuthorizations(
        this.capabilityId,
        this.rawInput
      );
      const { authorizeCustomerJobsRead } =
        await import("../customer-jobs-authorization");
      return authorizeCustomerJobsRead({
        authorizations,
        rawInput: this.rawInput,
      });
    },
    async createRepository(client) {
      const { createSupabaseCustomerJobsRepository } =
        await import("../customer-jobs-repository");
      return createSupabaseCustomerJobsRepository(
        client as never,
        cursorCodec()
      );
    },
    async isTrustedRepository(repository) {
      const { isTrustedCustomerJobsRepository } =
        await import("../customer-jobs-repository");
      return isTrustedCustomerJobsRepository(repository);
    },
    async readRepository({ authorization, repository, signal }) {
      return (repository as { read(input: unknown): Promise<unknown> }).read({
        authorization,
        ...(signal ? { signal } : {}),
      });
    },
    async invokeService({ authorization, repository, signal }) {
      const { listCustomerJobs } = await import("../list-customer-jobs");
      return listCustomerJobs({
        authorization: authorization as never,
        repository: repository as never,
        ...(signal ? { signal } : {}),
        now: () => new Date(FIXED_NOW),
      });
    },
    async serviceErrorClass() {
      return (await import("../list-customer-jobs")).CustomerJobsReadError;
    },
  },
  {
    name: "job summary",
    capabilityId: "get_job_summary",
    rawInput: RAW_INPUTS.jobSummary,
    rpcName: "read_agent_job_summary_as_system",
    exactNotFoundMessage: "agent_job_summary_not_found_or_not_visible",
    async createAuthorization() {
      const authorizations = await genericAuthorizations(
        this.capabilityId,
        this.rawInput
      );
      const { authorizeJobSummaryRead } =
        await import("../job-summary-authorization");
      return authorizeJobSummaryRead({
        authorizations,
        rawInput: this.rawInput,
      });
    },
    async createRepository(client) {
      const { createSupabaseJobSummaryRepository } =
        await import("../job-summary-repository");
      return createSupabaseJobSummaryRepository(client as never);
    },
    async isTrustedRepository(repository) {
      const { isTrustedJobSummaryRepository } =
        await import("../job-summary-repository");
      return isTrustedJobSummaryRepository(repository);
    },
    async readRepository({ authorization, repository, signal }) {
      return (repository as { read(input: unknown): Promise<unknown> }).read({
        authorization,
        ...(signal ? { signal } : {}),
      });
    },
    async invokeService({ authorization, repository, signal }) {
      const { getJobSummary } = await import("../get-job-summary");
      return getJobSummary({
        authorization: authorization as never,
        repository: repository as never,
        ...(signal ? { signal } : {}),
        now: () => new Date(FIXED_NOW),
      });
    },
    async serviceErrorClass() {
      return (await import("../get-job-summary")).JobSummaryReadError;
    },
  },
  {
    name: "job history",
    capabilityId: "search_job_history",
    rawInput: RAW_INPUTS.jobHistory,
    rpcName: "read_agent_job_history_as_system",
    exactNotFoundMessage: "agent_job_history_not_found_or_not_visible",
    async createAuthorization() {
      const authorizations = await genericAuthorizations(
        this.capabilityId,
        this.rawInput
      );
      const { authorizeJobHistoryRead } =
        await import("../job-history-authorization");
      return authorizeJobHistoryRead({
        authorizations,
        rawInput: this.rawInput,
      });
    },
    async createRepository(client) {
      const { createSupabaseJobHistoryRepository } =
        await import("../job-history-repository");
      return createSupabaseJobHistoryRepository(client as never, cursorCodec());
    },
    async isTrustedRepository(repository) {
      const { isTrustedJobHistoryRepository } =
        await import("../job-history-repository");
      return isTrustedJobHistoryRepository(repository);
    },
    async readRepository({ authorization, repository, signal }) {
      return (repository as { read(input: unknown): Promise<unknown> }).read({
        authorization,
        ...(signal ? { signal } : {}),
      });
    },
    async invokeService({ authorization, repository, signal }) {
      const { searchJobHistory } = await import("../search-job-history");
      return searchJobHistory({
        authorization: authorization as never,
        repository: repository as never,
        ...(signal ? { signal } : {}),
        now: () => new Date(FIXED_NOW),
      });
    },
    async serviceErrorClass() {
      return (await import("../search-job-history")).JobHistoryReadError;
    },
  },
  {
    name: "correspondence evidence",
    capabilityId: "get_correspondence_evidence",
    rawInput: RAW_INPUTS.correspondenceEvidence,
    rpcName: "read_agent_correspondence_evidence_page_as_system",
    exactNotFoundMessage:
      "agent_correspondence_evidence_not_found_or_not_visible",
    async createAuthorization() {
      const authorizations = await genericAuthorizations(
        this.capabilityId,
        this.rawInput
      );
      const { authorizeCorrespondenceEvidencePageRead } =
        await import("../correspondence-evidence-page-authorization");
      return authorizeCorrespondenceEvidencePageRead({
        authorizations,
        rawInput: this.rawInput,
      });
    },
    async createRepository(client) {
      const { createSupabaseCorrespondenceEvidencePageRepository } =
        await import("../correspondence-evidence-page-repository");
      return createSupabaseCorrespondenceEvidencePageRepository(
        client as never
      );
    },
    async isTrustedRepository(repository) {
      const { isTrustedCorrespondenceEvidencePageRepository } =
        await import("../correspondence-evidence-page-repository");
      return isTrustedCorrespondenceEvidencePageRepository(repository);
    },
    async readRepository({ authorization, repository, signal }) {
      return (repository as { read(input: unknown): Promise<unknown> }).read({
        authorization,
        ...(signal ? { signal } : {}),
      });
    },
    async invokeService({ authorization, repository, signal }) {
      const { getCorrespondenceEvidence } =
        await import("../get-correspondence-evidence");
      return getCorrespondenceEvidence({
        authorization: authorization as never,
        repository: repository as never,
        ...(signal ? { signal } : {}),
        now: () => new Date(FIXED_NOW),
      });
    },
    async serviceErrorClass() {
      return (await import("../get-correspondence-evidence"))
        .CorrespondenceEvidenceReadError;
    },
  },
];

async function serviceErrorFrom(harness: Harness, promise: Promise<unknown>) {
  const ErrorClass = await harness.serviceErrorClass();
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorClass);
    return error as Error & { toAgentError(): unknown };
  }
  throw new Error(`Expected ${harness.name} service error`);
}

describe.each(HARNESSES)("Task 13 $name service boundary", (harness) => {
  it("accepts only a WeakSet-minted repository and rejects a structural clone before reading", async () => {
    const client = new StubRpcClient([]);
    const authorization = await harness.createAuthorization();
    const repository = await harness.createRepository(client);

    expect(await harness.isTrustedRepository(repository)).toBe(true);
    expect(
      await harness.isTrustedRepository({ ...(repository as object) })
    ).toBe(false);

    const error = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization,
        repository: { ...(repository as object) },
      })
    );
    expect(AgentErrorSchema.parse(error.toAgentError())).toMatchObject({
      request_id: "request-task13-service-boundary",
      code: "INTERNAL",
      retryable: false,
    });
    expect(client.calls).toHaveLength(0);
  });

  it("maps only the exact privacy-safe not-found sentinel to NOT_FOUND", async () => {
    const secret = `${PROJECT_ID}:private-address:provider-message`;
    const client = new StubRpcClient([
      {
        data: null,
        error: {
          code: "P0002",
          message: harness.exactNotFoundMessage,
          details: secret,
        },
      },
    ]);
    const error = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization: await harness.createAuthorization(),
        repository: await harness.createRepository(client),
      })
    );
    const agentError = AgentErrorSchema.parse(error.toAgentError());

    expect(agentError).toMatchObject({
      request_id: "request-task13-service-boundary",
      code: "NOT_FOUND",
      retryable: false,
    });
    expect(JSON.stringify(agentError)).not.toContain(secret);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.functionName).toBe(harness.rpcName);
  });

  it("treats a near-miss not-found sentinel as unavailable and never exposes it", async () => {
    const nearMiss = `${harness.exactNotFoundMessage}:attacker-detail`;
    const client = new StubRpcClient([
      {
        data: null,
        error: { code: "P0002", message: nearMiss },
      },
    ]);
    const error = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization: await harness.createAuthorization(),
        repository: await harness.createRepository(client),
      })
    );
    const agentError = AgentErrorSchema.parse(error.toAgentError());

    expect(agentError).toMatchObject({
      request_id: "request-task13-service-boundary",
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(agentError)).not.toContain(nearMiss);
  });

  it("maps a provider failure to retryable unavailability without leaking raw detail", async () => {
    const secret = `${CLIENT_ID}:secret-customer-row`;
    const client = new StubRpcClient([
      {
        data: null,
        error: { code: "XX000", message: secret, details: secret },
      },
    ]);
    const error = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization: await harness.createAuthorization(),
        repository: await harness.createRepository(client),
      })
    );
    const agentError = AgentErrorSchema.parse(error.toAgentError());

    expect(agentError).toMatchObject({
      request_id: "request-task13-service-boundary",
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(agentError)).not.toContain(secret);
  });

  it("maps malformed repository data to non-retryable INTERNAL without broad context", async () => {
    const secret = `${COMPANY_ID}:attacker-selected-broad-context`;
    const client = new StubRpcClient([
      {
        data: {
          company_id: COMPANY_ID,
          broad_context: secret,
          rows: [{ raw_html: `<script>${secret}</script>` }],
        },
        error: null,
      },
    ]);
    const error = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization: await harness.createAuthorization(),
        repository: await harness.createRepository(client),
      })
    );
    const agentError = AgentErrorSchema.parse(error.toAgentError());

    expect(agentError).toMatchObject({
      request_id: "request-task13-service-boundary",
      code: "INTERNAL",
      retryable: false,
    });
    expect(JSON.stringify(agentError)).not.toContain(secret);
  });

  it("captures authorization and AbortSignal once, forwards a live signal, and fails a pre-aborted call before RPC", async () => {
    const authorization = await harness.createAuthorization();
    const liveController = new AbortController();
    const client = new StubRpcClient([
      {
        data: null,
        error: { code: "XX000", message: "expected boundary failure" },
      },
    ]);
    const repository = await harness.createRepository(client);
    let authorizationReads = 0;
    let signalReads = 0;

    await expect(
      (repository as { read(input: unknown): Promise<unknown> }).read({
        get authorization() {
          authorizationReads += 1;
          return authorizationReads === 1
            ? authorization
            : { ...(authorization as object) };
        },
        get signal() {
          signalReads += 1;
          return signalReads === 1
            ? liveController.signal
            : AbortSignal.abort();
        },
      })
    ).rejects.toBeDefined();

    expect(authorizationReads).toBe(1);
    expect(signalReads).toBe(1);
    expect(client.abortSignals).toEqual([liveController.signal]);

    const aborted = new AbortController();
    aborted.abort("caller cancelled");
    const preAbortedClient = new StubRpcClient([]);
    const preAbortedError = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization,
        repository: await harness.createRepository(preAbortedClient),
        signal: aborted.signal,
      })
    );
    expect(
      AgentErrorSchema.parse(preAbortedError.toAgentError())
    ).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(preAbortedClient.calls).toHaveLength(0);
  });

  it("fails closed when cancellation wins after an RPC that cannot attach a transport signal", async () => {
    const authorization = await harness.createAuthorization();
    const controller = new AbortController();
    let rpcCalls = 0;
    const client = {
      rpc() {
        rpcCalls += 1;
        return Promise.resolve({
          data: { attacker: "must not materialize" },
          error: null,
        }).then((response) => {
          controller.abort("caller cancelled after await");
          return response;
        });
      },
    };
    const error = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization,
        repository: await harness.createRepository(client),
        signal: controller.signal,
      })
    );

    expect(AgentErrorSchema.parse(error.toAgentError())).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(rpcCalls).toBe(1);
  });

  it("captures the RPC dependency exactly once and never executes a swapped getter", async () => {
    const authorization = await harness.createAuthorization();
    const trustedRpc = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { code: "XX000", message: "expected boundary failure" },
      })
    );
    const attackerRpc = vi.fn(() => {
      throw new Error("Attacker RPC getter must never execute");
    });
    let rpcGetterReads = 0;
    const client = Object.defineProperty({}, "rpc", {
      get() {
        rpcGetterReads += 1;
        return rpcGetterReads === 1 ? trustedRpc : attackerRpc;
      },
    });
    const repository = await harness.createRepository(client);

    await expect(
      harness.readRepository({ authorization, repository })
    ).rejects.toBeDefined();

    expect(rpcGetterReads).toBe(1);
    expect(trustedRpc).toHaveBeenCalledTimes(1);
    expect(attackerRpc).not.toHaveBeenCalled();
  });
});

describe("Task 13 correspondence-evidence size boundary", () => {
  const harness = HARNESSES[3]!;

  it("maps only the exact reducible full-text bound to INVALID_ARGUMENT", async () => {
    const authorization = await harness.createAuthorization();
    const exactClient = new StubRpcClient([
      {
        data: null,
        error: {
          code: "54000",
          message: "agent_correspondence_evidence_full_text_too_large",
        },
      },
    ]);
    const exactError = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization,
        repository: await harness.createRepository(exactClient),
      })
    );

    expect(AgentErrorSchema.parse(exactError.toAgentError())).toMatchObject({
      request_id: "request-task13-service-boundary",
      code: "INVALID_ARGUMENT",
      retryable: false,
      message: "Requested evidence is too large.",
      details: {
        field_issues: [
          {
            path: ["evidence_ids"],
            code: "PROMPT_BUDGET_EXCEEDED",
            message: "Request fewer evidence items or use excerpt mode.",
          },
        ],
      },
    });

    const nearMiss =
      "agent_correspondence_evidence_full_text_too_large:private-detail";
    const nearMissClient = new StubRpcClient([
      { data: null, error: { code: "54000", message: nearMiss } },
    ]);
    const nearMissError = await serviceErrorFrom(
      harness,
      harness.invokeService({
        authorization,
        repository: await harness.createRepository(nearMissClient),
      })
    );

    const nearMissAgentError = AgentErrorSchema.parse(
      nearMissError.toAgentError()
    );
    expect(nearMissAgentError).toMatchObject({
      request_id: "request-task13-service-boundary",
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(nearMissAgentError)).not.toContain(nearMiss);
  });
});
