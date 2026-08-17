import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CorrespondenceEvidenceReadInputSchema,
  CorrespondenceEvidenceResultSchema,
  CustomerJobsInputSchema,
  CustomerJobsResultSchema,
  JobHistoryResultSchema,
  JobHistorySearchInputSchema,
  JobSummaryInputSchema,
  JobSummaryResultSchema,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  createOpsAgentDomainService,
  type CreateOpsAgentDomainServiceInput,
} from "../create-domain-service";
import type {
  DomainCallOptions,
  OpsAgentDomainService,
} from "../domain-service";
import { createSupabaseJobCommunicationContextRepository } from "../job-communication-context-repository";
import { createSupabaseJobConversationContextRepository } from "../job-conversation-context-repository";
import { createSupabaseJobParticipantsRepository } from "../job-participants-repository";
import { createSupabaseJobReadinessRepository } from "../job-readiness-repository";
import { createOperationalReadCursorCodec } from "../operational-read-cursor";
import {
  createOpsAgentDomainRepositories,
  isTrustedOpsAgentDomainRepositories,
  type CreateOpsAgentDomainRepositoriesInput,
  type OpsAgentDomainRepositories,
} from "../repositories";
import { createSupabaseScheduledJobsRepository } from "../scheduled-jobs-repository";
import { createSupabaseCorrespondenceEvidencePageRepository } from "../correspondence-evidence-page-repository";
import { createSupabaseCustomerJobsRepository } from "../customer-jobs-repository";
import { createSupabaseJobHistoryRepository } from "../job-history-repository";
import { createSupabaseJobSummaryRepository } from "../job-summary-repository";
import {
  correspondenceEvidenceSnapshot,
  customerJobsSnapshot,
  jobHistorySnapshot,
  jobSummarySnapshot,
  StubTask13RpcClient,
  task13ActorContext,
  task13Authorization,
  TASK_13_CUSTOMER_JOBS_INPUT,
  TASK_13_EVIDENCE_INPUT,
  TASK_13_GENERATED_AT,
  TASK_13_JOB_HISTORY_INPUT,
  TASK_13_JOB_SUMMARY_INPUT,
} from "./fixtures/task13-job-catalog-fixtures";

const TASK_13_MANIFEST_REVISION = "2026-08-14.capability-manifest.v6" as const;
const TASK_13_CAPABILITIES = [
  "list_customer_jobs",
  "get_job_summary",
  "search_job_history",
  "get_correspondence_evidence",
] as const;
const FINAL_REPOSITORY_KEYS = [
  "jobConversationContext",
  "scheduledJobs",
  "jobReadiness",
  "jobCommunicationContext",
  "jobParticipants",
  "customerJobs",
  "jobSummary",
  "jobHistory",
  "correspondenceEvidence",
] as const;
const FINAL_SERVICE_KEYS = [
  "getJobConversationContext",
  "listScheduledJobs",
  "listJobReadinessIssues",
  "getJobCommunicationContext",
  "resolveJobParticipants",
  "listCustomerJobs",
  "getJobSummary",
  "searchJobHistory",
  "getCorrespondenceEvidence",
] as const;

function noReadClient() {
  return Object.freeze({
    rpc() {
      throw new Error("No repository read is expected in facade construction");
    },
  });
}

function trustedRepositoryInput(): CreateOpsAgentDomainRepositoriesInput {
  const cursorCodec = createOperationalReadCursorCodec({
    key: new Uint8Array(32).fill(31),
    keyId: "task13-facade",
    version: 1,
    now: () => new Date("2026-08-14T18:00:00.000Z"),
  });
  return {
    jobConversationContext:
      createSupabaseJobConversationContextRepository(noReadClient()),
    scheduledJobs: createSupabaseScheduledJobsRepository(
      noReadClient(),
      cursorCodec
    ),
    jobReadiness: createSupabaseJobReadinessRepository(
      noReadClient(),
      cursorCodec
    ),
    jobCommunicationContext:
      createSupabaseJobCommunicationContextRepository(noReadClient()),
    jobParticipants: createSupabaseJobParticipantsRepository(noReadClient()),
    customerJobs: createSupabaseCustomerJobsRepository(
      noReadClient(),
      cursorCodec
    ),
    jobSummary: createSupabaseJobSummaryRepository(noReadClient()),
    jobHistory: createSupabaseJobHistoryRepository(noReadClient(), cursorCodec),
    correspondenceEvidence:
      createSupabaseCorrespondenceEvidencePageRepository(noReadClient()),
  };
}

describe("Task 13 job-catalog domain facade", () => {
  it("publishes all four typed domain methods only after their exact trusted repository bundle exists", () => {
    type CustomerJobsMethod = (
      actorContext: ActorContext,
      input: z.input<typeof CustomerJobsInputSchema>,
      options?: DomainCallOptions
    ) => Promise<z.infer<typeof CustomerJobsResultSchema>>;
    type JobSummaryMethod = (
      actorContext: ActorContext,
      input: z.input<typeof JobSummaryInputSchema>,
      options?: DomainCallOptions
    ) => Promise<z.infer<typeof JobSummaryResultSchema>>;
    type JobHistoryMethod = (
      actorContext: ActorContext,
      input: z.input<typeof JobHistorySearchInputSchema>,
      options?: DomainCallOptions
    ) => Promise<z.infer<typeof JobHistoryResultSchema>>;
    type CorrespondenceEvidenceMethod = (
      actorContext: ActorContext,
      input: z.input<typeof CorrespondenceEvidenceReadInputSchema>,
      options?: DomainCallOptions
    ) => Promise<z.infer<typeof CorrespondenceEvidenceResultSchema>>;

    expectTypeOf<
      OpsAgentDomainService["listCustomerJobs"]
    >().toEqualTypeOf<CustomerJobsMethod>();
    expectTypeOf<
      OpsAgentDomainService["getJobSummary"]
    >().toEqualTypeOf<JobSummaryMethod>();
    expectTypeOf<
      OpsAgentDomainService["searchJobHistory"]
    >().toEqualTypeOf<JobHistoryMethod>();
    expectTypeOf<
      OpsAgentDomainService["getCorrespondenceEvidence"]
    >().toEqualTypeOf<CorrespondenceEvidenceMethod>();

    const repositories = createOpsAgentDomainRepositories(
      trustedRepositoryInput()
    );
    const service = createOpsAgentDomainService({ repositories });

    expect(Object.keys(repositories)).toEqual(FINAL_REPOSITORY_KEYS);
    expect(Object.keys(service)).toEqual(FINAL_SERVICE_KEYS);
    expect(Object.isFrozen(repositories)).toBe(true);
    expect(Object.isFrozen(service)).toBe(true);
    expect(isTrustedOpsAgentDomainRepositories(repositories)).toBe(true);
    expect(isTrustedOpsAgentDomainRepositories({ ...repositories })).toBe(
      false
    );
    expect(Object.keys(service)).not.toEqual(
      expect.arrayContaining([
        "transport",
        "headers",
        "token",
        "tenant",
        "authorization",
        "policy",
        "repository",
        "supabase",
      ])
    );
  });

  it.each([
    "customerJobs",
    "jobSummary",
    "jobHistory",
    "correspondenceEvidence",
  ] as const)(
    "keeps every Task 13 method unavailable when the trusted %s repository is absent",
    (missingRepository) => {
      const complete = trustedRepositoryInput();
      const incomplete = { ...complete } as Record<string, unknown>;
      delete incomplete[missingRepository];

      expect(() =>
        createOpsAgentDomainRepositories(
          incomplete as unknown as CreateOpsAgentDomainRepositoriesInput
        )
      ).toThrow(TypeError);
    }
  );

  it("keeps the four capabilities available only through the internal domain catalog", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(TASK_13_MANIFEST_REVISION);
    for (const capabilityName of TASK_13_CAPABILITIES) {
      const capability = CAPABILITY_MANIFEST.find(
        (entry) => entry.name === capabilityName
      );
      expect(capability?.availability).toEqual({
        implementation: "available",
        externalExposure: "disabled",
      });
    }
    expect(
      CAPABILITY_MANIFEST.every(
        (capability) => capability.availability.externalExposure === "disabled"
      )
    ).toBe(true);
  });

  it("captures all four repository getters and the final bundle exactly once before trust validation", () => {
    const trusted = trustedRepositoryInput();
    const attacker = {
      read: vi.fn(async () => {
        throw new Error("Attacker repository must never execute");
      }),
    };
    const reads = {
      customerJobs: 0,
      jobSummary: 0,
      jobHistory: 0,
      correspondenceEvidence: 0,
    };
    const input = { ...trusted } as Record<string, unknown>;
    for (const key of Object.keys(reads) as Array<keyof typeof reads>) {
      Object.defineProperty(input, key, {
        enumerable: true,
        configurable: true,
        get() {
          reads[key] += 1;
          return reads[key] === 1 ? trusted[key] : attacker;
        },
      });
    }

    const repositories = createOpsAgentDomainRepositories(
      input as unknown as CreateOpsAgentDomainRepositoriesInput
    );

    expect(reads).toEqual({
      customerJobs: 1,
      jobSummary: 1,
      jobHistory: 1,
      correspondenceEvidence: 1,
    });
    expect(repositories.customerJobs).toBe(trusted.customerJobs);
    expect(repositories.jobSummary).toBe(trusted.jobSummary);
    expect(repositories.jobHistory).toBe(trusted.jobHistory);
    expect(repositories.correspondenceEvidence).toBe(
      trusted.correspondenceEvidence
    );
  });

  it("captures the trusted repository bundle and clock once before constructing the facade", () => {
    const repositories = createOpsAgentDomainRepositories(
      trustedRepositoryInput()
    );
    const attackerBundle = {
      ...repositories,
      customerJobs: {
        read: vi.fn(async () => {
          throw new Error("Attacker bundle must never execute");
        }),
      },
    } as unknown as OpsAgentDomainRepositories;
    const trustedNow = () => new Date("2026-08-14T18:00:00.000Z");
    const attackerNow = () => new Date("2030-01-01T00:00:00.000Z");
    let bundleReads = 0;
    let clockReads = 0;
    const input = Object.defineProperties(
      {},
      {
        repositories: {
          get() {
            bundleReads += 1;
            return bundleReads === 1 ? repositories : attackerBundle;
          },
        },
        now: {
          get() {
            clockReads += 1;
            return clockReads === 1 ? trustedNow : attackerNow;
          },
        },
      }
    ) as CreateOpsAgentDomainServiceInput;

    const service = createOpsAgentDomainService(input);

    expect(bundleReads).toBe(1);
    expect(clockReads).toBe(1);
    expect(Object.keys(service)).toEqual(FINAL_SERVICE_KEYS);
  });

  it("rejects structural repository and bundle clones even when every method is present", () => {
    const trustedInput = trustedRepositoryInput();
    const structuralClone = {
      read: vi.fn(async () => ({ attacker: true })),
    };

    for (const key of [
      "customerJobs",
      "jobSummary",
      "jobHistory",
      "correspondenceEvidence",
    ] as const) {
      expect(() =>
        createOpsAgentDomainRepositories({
          ...trustedInput,
          [key]: structuralClone,
        } as unknown as CreateOpsAgentDomainRepositoriesInput)
      ).toThrow(TypeError);
    }

    const repositories = createOpsAgentDomainRepositories(trustedInput);
    expect(() =>
      createOpsAgentDomainService({
        repositories: { ...repositories } as OpsAgentDomainRepositories,
      })
    ).toThrow(TypeError);
  });

  it("returns identical parsed Task 13 results for internal, OPS API, and direct MCP actor contexts while external exposure stays disabled", async () => {
    const [
      customerAuthorization,
      summaryAuthorization,
      historyAuthorization,
      evidenceAuthorization,
    ] = await Promise.all([
      task13Authorization("customer_jobs"),
      task13Authorization("job_summary"),
      task13Authorization("job_history"),
      task13Authorization("correspondence_evidence"),
    ]);
    const customerSnapshot = customerJobsSnapshot(customerAuthorization);
    const summarySnapshot = jobSummarySnapshot(summaryAuthorization);
    const historySnapshot = jobHistorySnapshot(historyAuthorization);
    const evidenceSnapshot = correspondenceEvidenceSnapshot(
      evidenceAuthorization
    );
    const customerClient = new StubTask13RpcClient(
      Array.from({ length: 3 }, () => ({
        data: customerSnapshot,
        error: null,
      }))
    );
    const summaryClient = new StubTask13RpcClient(
      Array.from({ length: 3 }, () => ({
        data: summarySnapshot,
        error: null,
      }))
    );
    const historyClient = new StubTask13RpcClient(
      Array.from({ length: 3 }, () => ({
        data: historySnapshot,
        error: null,
      }))
    );
    const evidenceClient = new StubTask13RpcClient(
      Array.from({ length: 3 }, () => ({
        data: evidenceSnapshot,
        error: null,
      }))
    );
    const base = trustedRepositoryInput();
    const codec = createOperationalReadCursorCodec({
      key: new Uint8Array(32).fill(31),
      keyId: "task13-parity",
      version: 1,
      now: () => new Date(TASK_13_GENERATED_AT),
    });
    const repositories = createOpsAgentDomainRepositories({
      ...base,
      customerJobs: createSupabaseCustomerJobsRepository(customerClient, codec),
      jobSummary: createSupabaseJobSummaryRepository(summaryClient),
      jobHistory: createSupabaseJobHistoryRepository(historyClient, codec),
      correspondenceEvidence:
        createSupabaseCorrespondenceEvidencePageRepository(evidenceClient),
    });
    const service = createOpsAgentDomainService({
      repositories,
      now: () => new Date(TASK_13_GENERATED_AT),
    });
    const actors = await Promise.all([
      task13ActorContext("internal"),
      task13ActorContext("ops_api"),
      task13ActorContext("mcp"),
    ]);

    const customerResults = await Promise.all(
      actors.map((actor) =>
        service.listCustomerJobs(actor, TASK_13_CUSTOMER_JOBS_INPUT)
      )
    );
    const summaryResults = await Promise.all(
      actors.map((actor) =>
        service.getJobSummary(actor, TASK_13_JOB_SUMMARY_INPUT)
      )
    );
    const historyResults = await Promise.all(
      actors.map((actor) =>
        service.searchJobHistory(actor, TASK_13_JOB_HISTORY_INPUT)
      )
    );
    const evidenceResults = await Promise.all(
      actors.map((actor) =>
        service.getCorrespondenceEvidence(actor, TASK_13_EVIDENCE_INPUT)
      )
    );

    for (const results of [
      customerResults,
      summaryResults,
      historyResults,
      evidenceResults,
    ]) {
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    }
    expect(customerClient.calls).toHaveLength(3);
    expect(summaryClient.calls).toHaveLength(3);
    expect(historyClient.calls).toHaveLength(3);
    expect(evidenceClient.calls).toHaveLength(3);
    for (const capabilityName of TASK_13_CAPABILITIES) {
      expect(
        CAPABILITY_MANIFEST.find((entry) => entry.name === capabilityName)
          ?.availability.externalExposure
      ).toBe("disabled");
    }
  });
});
