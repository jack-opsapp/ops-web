import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CustomerDiscoveryResultSchema,
  JobDiscoveryResultSchema,
  SearchCustomersInputSchema,
  SearchJobsInputSchema,
} from "@/lib/agent-control-plane/contracts/discovery";

let discoveryImplementationAvailable = false;

vi.mock("@/lib/agent-control-plane/registry/capability-manifest", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/agent-control-plane/registry/capability-manifest")
  >("@/lib/agent-control-plane/registry/capability-manifest");
  const availability = (entry: {
    readonly name: string;
    readonly availability: object;
  }) =>
    entry.name === "search_customers" || entry.name === "search_jobs"
      ? Object.freeze({
          ...entry,
          availability: Object.freeze({
            implementation: discoveryImplementationAvailable
              ? ("available" as const)
              : ("unavailable" as const),
            externalExposure: "disabled" as const,
          }),
        })
      : entry;
  return {
    ...actual,
    getCapabilityManifestEntry(name: string) {
      return availability(actual.getCapabilityManifestEntry(name));
    },
    resolveCapabilityAuthorization(name: string, input: unknown) {
      const resolved = actual.resolveCapabilityAuthorization(name, input);
      return Object.freeze({
        ...resolved,
        capability: availability(resolved.capability),
      });
    },
  };
});

import { createSupabaseCorrespondenceEvidencePageRepository } from "../correspondence-evidence-page-repository";
import { createOpsAgentDomainService } from "../create-domain-service";
import { createSupabaseCustomerDiscoveryRepository } from "../customer-discovery-repository";
import { createSupabaseCustomerJobsRepository } from "../customer-jobs-repository";
import type {
  DomainCallOptions,
  OpsAgentDomainService,
} from "../domain-service";
import { createSupabaseJobCommunicationContextRepository } from "../job-communication-context-repository";
import { createSupabaseJobConversationContextRepository } from "../job-conversation-context-repository";
import { createSupabaseJobDiscoveryRepository } from "../job-discovery-repository";
import { createSupabaseJobHistoryRepository } from "../job-history-repository";
import { createSupabaseJobParticipantsRepository } from "../job-participants-repository";
import { createSupabaseJobReadinessRepository } from "../job-readiness-repository";
import { createSupabaseJobSummaryRepository } from "../job-summary-repository";
import {
  createOpsAgentDomainRepositories,
  isTrustedOpsAgentDomainRepositories,
  type CreateOpsAgentDomainRepositoriesInput,
} from "../repositories";
import { createSupabaseScheduledJobsRepository } from "../scheduled-jobs-repository";
import {
  DISCOVERY_CUSTOMER_INPUT,
  DISCOVERY_GENERATED_AT,
  DISCOVERY_JOB_INPUT,
  StubDiscoveryRpcClient,
  customerDiscoveryAuthorization,
  customerDiscoverySnapshot,
  discoveryCursorCodec,
  jobDiscoveryAuthorization,
  jobDiscoverySnapshot,
} from "./fixtures/discovery-fixtures";
import { task13ActorContext } from "./fixtures/task13-job-catalog-fixtures";

const REPOSITORY_KEYS = [
  "jobConversationContext",
  "scheduledJobs",
  "jobReadiness",
  "jobCommunicationContext",
  "jobParticipants",
  "customerJobs",
  "jobSummary",
  "jobHistory",
  "correspondenceEvidence",
  "customerDiscovery",
  "jobDiscovery",
] as const;

const SERVICE_KEYS = [
  "getJobConversationContext",
  "listScheduledJobs",
  "listJobReadinessIssues",
  "getJobCommunicationContext",
  "resolveJobParticipants",
  "listCustomerJobs",
  "getJobSummary",
  "searchJobHistory",
  "getCorrespondenceEvidence",
  "searchCustomers",
  "searchJobs",
] as const;

function noReadClient() {
  return Object.freeze({
    rpc() {
      throw new Error("No unrelated repository read was expected");
    },
  });
}

function trustedInput(input?: {
  readonly customerClient?: StubDiscoveryRpcClient;
  readonly jobClient?: StubDiscoveryRpcClient;
}): CreateOpsAgentDomainRepositoriesInput {
  const client = noReadClient();
  const cursorCodec = discoveryCursorCodec({
    now: () => new Date(DISCOVERY_GENERATED_AT),
  });
  return {
    jobConversationContext:
      createSupabaseJobConversationContextRepository(client),
    scheduledJobs: createSupabaseScheduledJobsRepository(client, cursorCodec),
    jobReadiness: createSupabaseJobReadinessRepository(client, cursorCodec),
    jobCommunicationContext:
      createSupabaseJobCommunicationContextRepository(client),
    jobParticipants: createSupabaseJobParticipantsRepository(client),
    customerJobs: createSupabaseCustomerJobsRepository(client, cursorCodec),
    jobSummary: createSupabaseJobSummaryRepository(client),
    jobHistory: createSupabaseJobHistoryRepository(client, cursorCodec),
    correspondenceEvidence:
      createSupabaseCorrespondenceEvidencePageRepository(client),
    customerDiscovery: createSupabaseCustomerDiscoveryRepository(
      input?.customerClient ?? new StubDiscoveryRpcClient([]),
      cursorCodec
    ),
    jobDiscovery: createSupabaseJobDiscoveryRepository(
      input?.jobClient ?? new StubDiscoveryRpcClient([]),
      cursorCodec
    ),
  };
}

beforeEach(() => {
  discoveryImplementationAvailable = false;
});

describe("discovery domain facade", () => {
  it("publishes exact typed methods only with the complete nominal repository bundle", () => {
    type SearchCustomersMethod = (
      actorContext: ActorContext,
      input: z.input<typeof SearchCustomersInputSchema>,
      options?: DomainCallOptions
    ) => Promise<z.infer<typeof CustomerDiscoveryResultSchema>>;
    type SearchJobsMethod = (
      actorContext: ActorContext,
      input: z.input<typeof SearchJobsInputSchema>,
      options?: DomainCallOptions
    ) => Promise<z.infer<typeof JobDiscoveryResultSchema>>;

    expectTypeOf<
      OpsAgentDomainService["searchCustomers"]
    >().toEqualTypeOf<SearchCustomersMethod>();
    expectTypeOf<
      OpsAgentDomainService["searchJobs"]
    >().toEqualTypeOf<SearchJobsMethod>();

    const repositories = createOpsAgentDomainRepositories(trustedInput());
    const service = createOpsAgentDomainService({ repositories });
    expect(Object.keys(repositories)).toEqual(REPOSITORY_KEYS);
    expect(Object.keys(service)).toEqual(SERVICE_KEYS);
    expect(Object.isFrozen(repositories)).toBe(true);
    expect(Object.isFrozen(service)).toBe(true);
    expect(isTrustedOpsAgentDomainRepositories(repositories)).toBe(true);
    expect(isTrustedOpsAgentDomainRepositories({ ...repositories })).toBe(
      false
    );
  });

  it.each(["customerDiscovery", "jobDiscovery"] as const)(
    "rejects a missing or structurally cloned %s repository",
    (key) => {
      const complete = trustedInput();
      const missing = { ...complete } as Record<string, unknown>;
      delete missing[key];
      expect(() =>
        createOpsAgentDomainRepositories(
          missing as unknown as CreateOpsAgentDomainRepositoriesInput
        )
      ).toThrow(TypeError);
      expect(() =>
        createOpsAgentDomainRepositories({
          ...complete,
          [key]: { ...complete[key] },
        })
      ).toThrow(TypeError);
    }
  );

  it("captures both discovery repository getters exactly once before trust validation", () => {
    const complete = trustedInput();
    const reads = { customerDiscovery: 0, jobDiscovery: 0 };
    const callerOwned = { ...complete } as Record<string, unknown>;
    for (const key of Object.keys(reads) as Array<keyof typeof reads>) {
      Object.defineProperty(callerOwned, key, {
        enumerable: true,
        configurable: true,
        get() {
          reads[key] += 1;
          return reads[key] === 1 ? complete[key] : { ...complete[key] };
        },
      });
    }

    const repositories = createOpsAgentDomainRepositories(
      callerOwned as unknown as CreateOpsAgentDomainRepositoriesInput
    );
    expect(reads).toEqual({ customerDiscovery: 1, jobDiscovery: 1 });
    expect(repositories.customerDiscovery).toBe(complete.customerDiscovery);
    expect(repositories.jobDiscovery).toBe(complete.jobDiscovery);
  });

  it("keeps both methods dark before availability without touching either repository", async () => {
    const customerClient = new StubDiscoveryRpcClient([]);
    const jobClient = new StubDiscoveryRpcClient([]);
    const service = createOpsAgentDomainService({
      repositories: createOpsAgentDomainRepositories(
        trustedInput({ customerClient, jobClient })
      ),
    });
    const actor = await task13ActorContext();

    await expect(
      service.searchCustomers(actor, DISCOVERY_CUSTOMER_INPUT)
    ).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(
      service.searchJobs(actor, DISCOVERY_JOB_INPUT)
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(customerClient.calls).toEqual([]);
    expect(jobClient.calls).toEqual([]);
  });

  it("uses the manifest authorization, nominal repositories, and pure services after the explicit test-only availability flip", async () => {
    discoveryImplementationAvailable = true;
    const actor = await task13ActorContext();
    const customerAuthorization = await customerDiscoveryAuthorization(
      DISCOVERY_CUSTOMER_INPUT,
      actor
    );
    const jobAuthorization = await jobDiscoveryAuthorization(
      DISCOVERY_JOB_INPUT,
      actor
    );
    const customerClient = new StubDiscoveryRpcClient([
      { data: customerDiscoverySnapshot(customerAuthorization), error: null },
    ]);
    const jobClient = new StubDiscoveryRpcClient([
      { data: jobDiscoverySnapshot(jobAuthorization), error: null },
    ]);
    const service = createOpsAgentDomainService({
      repositories: createOpsAgentDomainRepositories(
        trustedInput({ customerClient, jobClient })
      ),
      now: () => new Date(DISCOVERY_GENERATED_AT),
    });

    const [customers, jobs] = await Promise.all([
      service.searchCustomers(actor, DISCOVERY_CUSTOMER_INPUT),
      service.searchJobs(actor, DISCOVERY_JOB_INPUT),
    ]);

    expect(customers.data.returned_match_count).toBe(1);
    expect(jobs.data.returned_match_count).toBe(1);
    expect(customerClient.calls[0]?.functionName).toBe(
      "read_agent_customer_discovery_as_system"
    );
    expect(jobClient.calls[0]?.functionName).toBe(
      "read_agent_job_discovery_as_system"
    );
    expect(customerClient.calls[0]?.args.p_actor_user_id).toBe(
      actor.actorUserId
    );
    expect(jobClient.calls[0]?.args.p_company_id).toBe(actor.companyId);
  });

  it("rejects an impossible lifecycle/status filter before any repository read", async () => {
    discoveryImplementationAvailable = true;
    const customerClient = new StubDiscoveryRpcClient([]);
    const jobClient = new StubDiscoveryRpcClient([]);
    const service = createOpsAgentDomainService({
      repositories: createOpsAgentDomainRepositories(
        trustedInput({ customerClient, jobClient })
      ),
    });
    const actor = await task13ActorContext();

    await expect(
      service.searchJobs(actor, {
        job_kinds: ["project"],
        lifecycle_states: ["active"],
        project_statuses: ["completed"],
      })
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      service.searchCustomers(actor, {
        lookup: "exact_email",
        query: "dispatch@invalid-.example",
      })
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(customerClient.calls).toEqual([]);
    expect(jobClient.calls).toEqual([]);
  });
});
