import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import { createOperationalReadCursorCodec } from "../operational-read-cursor";
import {
  absentContentCorrespondenceEvidenceRaw,
  activitySummarySectionRaw,
  cloneTask13Fixture,
  conversationSummarySectionRaw,
  convertedCustomerJob,
  correspondenceEvidenceRaw,
  correspondenceEvidenceSnapshot,
  currentMemoryHistoryEvent,
  customerJobsSnapshot,
  deliveredHistoryEvent,
  jobHistorySnapshot,
  jobSummarySnapshot,
  linkedOpportunityNotReturnedProjectJob,
  linkedProjectNotReturnedOpportunityJob,
  participantSummarySectionRaw,
  readinessSummarySectionRaw,
  recoupleAtomicClaim,
  recoupleClaimProjectionHash,
  recoupleTopClaim,
  scheduleSummarySectionRaw,
  StubTask13RpcClient,
  task13ActorContext,
  task13ActorContextForAuthority,
  task13Authority,
  task13Authorization,
  TASK_13_ACTOR_ID,
  TASK_13_CLIENT_ID,
  TASK_13_COMPANY_ID,
  TASK_13_CUSTOMER_JOBS_INPUT,
  TASK_13_EVIDENCE_INPUT,
  TASK_13_GENERATED_AT,
  TASK_13_HISTORY_REVISION,
  TASK_13_JOB_HISTORY_INPUT,
  TASK_13_JOB_SUMMARY_INPUT,
  TASK_13_MANIFEST_REVISION,
  TASK_13_OPPORTUNITY_ID,
  TASK_13_PERMISSION_REVISION,
  TASK_13_PROJECT_ID,
  TASK_13_READ_AT,
  TASK_13_SOURCE_REVISION,
  TASK_13_TURN_EVIDENCE_ID,
  type AtomicTask13Claim,
  type Task13Authorization,
  type Task13Capability,
} from "./fixtures/task13-job-catalog-fixtures";

const CURSOR_KEY = new Uint8Array(32).fill(17);

function cursorCodec(options?: { now?: () => Date; ttlSeconds?: number }) {
  return createOperationalReadCursorCodec({
    key: CURSOR_KEY,
    keyId: "task13-catalog",
    version: 1,
    ...(options?.now ? { now: options.now } : {}),
    ...(options?.ttlSeconds ? { ttlSeconds: options.ttlSeconds } : {}),
  });
}

async function repositoryFor(
  kind: Task13Capability,
  client: unknown,
  codec = cursorCodec({ now: () => new Date(TASK_13_GENERATED_AT) })
) {
  switch (kind) {
    case "customer_jobs": {
      const { createSupabaseCustomerJobsRepository } =
        await import("../customer-jobs-repository");
      return createSupabaseCustomerJobsRepository(client as never, codec);
    }
    case "job_summary": {
      const { createSupabaseJobSummaryRepository } =
        await import("../job-summary-repository");
      return createSupabaseJobSummaryRepository(client as never);
    }
    case "job_history": {
      const { createSupabaseJobHistoryRepository } =
        await import("../job-history-repository");
      return createSupabaseJobHistoryRepository(client as never, codec);
    }
    case "correspondence_evidence": {
      const { createSupabaseCorrespondenceEvidencePageRepository } =
        await import("../correspondence-evidence-page-repository");
      return createSupabaseCorrespondenceEvidencePageRepository(
        client as never
      );
    }
  }
}

async function repositoryRead(input: {
  kind: Task13Capability;
  repository: unknown;
  authorization: Task13Authorization;
  signal?: AbortSignal;
}) {
  return (input.repository as { read(value: unknown): Promise<unknown> }).read({
    authorization: input.authorization,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

async function validSnapshot(
  kind: Task13Capability,
  authorization: Task13Authorization
) {
  switch (kind) {
    case "customer_jobs":
      return customerJobsSnapshot(authorization);
    case "job_summary":
      return jobSummarySnapshot(authorization);
    case "job_history":
      return jobHistorySnapshot(authorization);
    case "correspondence_evidence":
      return correspondenceEvidenceSnapshot(authorization);
  }
}

function expectedInvalidCode(kind: Task13Capability) {
  switch (kind) {
    case "customer_jobs":
      return "CUSTOMER_JOBS_INVALID";
    case "job_summary":
      return "JOB_SUMMARY_INVALID";
    case "job_history":
      return "JOB_HISTORY_INVALID";
    case "correspondence_evidence":
      return "CORRESPONDENCE_EVIDENCE_INVALID";
  }
}

function expectedReadFailedCode(kind: Task13Capability) {
  switch (kind) {
    case "customer_jobs":
      return "CUSTOMER_JOBS_READ_FAILED";
    case "job_summary":
      return "JOB_SUMMARY_READ_FAILED";
    case "job_history":
      return "JOB_HISTORY_READ_FAILED";
    case "correspondence_evidence":
      return "CORRESPONDENCE_EVIDENCE_READ_FAILED";
  }
}

function topClaim(snapshot: Record<string, unknown>): AtomicTask13Claim {
  const claim = snapshot.collection_claim ?? snapshot.summary_claim;
  if (!claim) throw new Error("Fixture lacks a top claim");
  return claim as AtomicTask13Claim;
}

function childClaims(snapshot: Record<string, unknown>): AtomicTask13Claim[] {
  const claims =
    snapshot.job_claims ??
    snapshot.section_claims ??
    snapshot.event_claims ??
    snapshot.evidence_claims;
  if (!Array.isArray(claims)) throw new Error("Fixture lacks child claims");
  return claims as AtomicTask13Claim[];
}

function expectedCommonArgs(authorization: Task13Authorization) {
  return {
    p_request_id: "request-task13-catalog",
    p_actor_user_id: TASK_13_ACTOR_ID,
    p_company_id: TASK_13_COMPANY_ID,
    p_permission_snapshot_revision: TASK_13_PERMISSION_REVISION,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_id: authorization.capabilityId,
    p_capability_revision: authorization.capabilityRevision,
    p_capability_manifest_revision: TASK_13_MANIFEST_REVISION,
    p_required_oauth_scopes: [...authorization.requiredOAuthScopes],
  };
}

describe("Task 13 customer-jobs repository", () => {
  it("calls the fixed current-only RPC with exact v6 authority, input, and null cursor bindings", async () => {
    const authorization = await task13Authorization("customer_jobs");
    const snapshot = customerJobsSnapshot(authorization);
    const client = new StubTask13RpcClient([{ data: snapshot, error: null }]);
    const repository = await repositoryFor("customer_jobs", client);

    const result = (await repositoryRead({
      kind: "customer_jobs",
      repository,
      authorization,
    })) as Record<string, unknown>;

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_customer_jobs_as_system",
        args: {
          ...expectedCommonArgs(authorization),
          p_clients_scope: "all",
          p_pipeline_scope: "all",
          p_projects_scope: "all",
          p_customer_kind: "client",
          p_customer_id: TASK_13_CLIENT_ID,
          p_job_kinds: ["opportunity", "project"],
          p_lifecycle_states: ["active", "terminal"],
          p_opportunity_stages: ["quoted"],
          p_project_statuses: ["accepted", "in_progress"],
          p_date_field: "updated_at",
          p_date_from: "2025-08-14T00:00:00.000Z",
          p_date_to_exclusive: "2026-08-14T00:00:00.000Z",
          p_read_as_of: null,
          p_cursor_source_revision: null,
          p_cursor_sort_at: null,
          p_cursor_job_kind: null,
          p_cursor_job_id: null,
          p_limit: 25,
        },
      },
    ]);
    expect(result).toMatchObject({
      company_id: TASK_13_COMPANY_ID,
      permission_snapshot_revision: TASK_13_PERMISSION_REVISION,
      read_at: TASK_13_READ_AT,
      job_claims: snapshot.job_claims,
      collection_claim: snapshot.collection_claim,
      page: { next_cursor: null, has_more: false },
    });
  });

  it("keeps an empty terminal collection cryptographically bound to the customer and canonical query", async () => {
    const authorization = await task13Authorization("customer_jobs");
    const snapshot = customerJobsSnapshot(authorization, []);
    const repository = await repositoryFor(
      "customer_jobs",
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    const result = (await repositoryRead({
      kind: "customer_jobs",
      repository,
      authorization,
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      job_claims: [],
      returned_job_count: 0,
      page: { next_cursor: null, has_more: false },
      collection_claim: {
        proof: {
          projection: {
            actor_user_id: TASK_13_ACTOR_ID,
            company_id: TASK_13_COMPANY_ID,
            capability_id: "list_customer_jobs",
            capability_manifest_revision: TASK_13_MANIFEST_REVISION,
            permission_snapshot_revision: TASK_13_PERMISSION_REVISION,
            canonical_input: TASK_13_CUSTOMER_JOBS_INPUT,
            read_at: TASK_13_READ_AT,
            source_revision: TASK_13_SOURCE_REVISION,
            retained_proof_sources: [],
          },
        },
      },
    });
  });

  it("preserves asymmetric conversion truth without fabricating a hidden reciprocal reference", async () => {
    const authorization = await task13Authorization("customer_jobs");
    for (const job of [
      linkedProjectNotReturnedOpportunityJob(),
      linkedOpportunityNotReturnedProjectJob(),
    ]) {
      const snapshot = customerJobsSnapshot(authorization, [job]);
      const result = (await repositoryRead({
        kind: "customer_jobs",
        repository: await repositoryFor(
          "customer_jobs",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })) as typeof snapshot;

      expect(result.job_claims[0]!.raw.conversion).toEqual(job.conversion);
      expect(Object.keys(job.conversion)).toEqual(["state"]);
      expect(result.job_claims[0]!.raw.anchor_refs).toEqual([job.job_ref]);
    }
  });

  it.each([
    [
      "an unselected project status",
      (snapshot: ReturnType<typeof customerJobsSnapshot>) => {
        snapshot.job_claims[0]!.raw.status = {
          kind: "project",
          value: "rfq",
        };
      },
    ],
    [
      "the exclusive date-window boundary",
      (snapshot: ReturnType<typeof customerJobsSnapshot>) => {
        const raw = snapshot.job_claims[0]!.raw as {
          dates: { updated_at: string };
        };
        raw.dates.updated_at = "2026-08-14T00:00:00.000Z";
      },
    ],
    [
      "the authorized customer relationship",
      (snapshot: ReturnType<typeof customerJobsSnapshot>) => {
        snapshot.job_claims[0]!.raw.relationship_basis = "sub_client_parent";
      },
    ],
  ])("rejects a fully rehashed row outside %s", async (_label, mutate) => {
    const authorization = await task13Authorization("customer_jobs");
    const snapshot = cloneTask13Fixture(customerJobsSnapshot(authorization));
    mutate(snapshot);
    recoupleAtomicClaim(snapshot.job_claims[0]!, "job");
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "customer_jobs",
        repository: await repositoryFor(
          "customer_jobs",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "CUSTOMER_JOBS_INVALID" });
  });

  it.each(["created_at", "updated_at"] as const)(
    "rejects a fully rehashed %s after the snapshot read fence",
    async (field) => {
      const { date_window: _window, ...inputWithoutWindow } =
        TASK_13_CUSTOMER_JOBS_INPUT;
      const authorization = await task13Authorization(
        "customer_jobs",
        inputWithoutWindow
      );
      const snapshot = cloneTask13Fixture(customerJobsSnapshot(authorization));
      const dates = (
        snapshot.job_claims[0]!.raw as {
          dates: Record<"created_at" | "updated_at", string>;
        }
      ).dates;
      dates[field] = "2026-08-14T18:00:00.000Z";
      recoupleAtomicClaim(snapshot.job_claims[0]!, "job");
      recoupleTopClaim(snapshot);

      await expect(
        repositoryRead({
          kind: "customer_jobs",
          repository: await repositoryFor(
            "customer_jobs",
            new StubTask13RpcClient([{ data: snapshot, error: null }])
          ),
          authorization,
        })
      ).rejects.toMatchObject({ code: "CUSTOMER_JOBS_INVALID" });
    }
  );
});

describe("Task 13 job-summary repository", () => {
  it("calls one fixed RPC and returns every requested section as an atomic claim", async () => {
    const authorization = await task13Authorization("job_summary");
    const snapshot = jobSummarySnapshot(authorization);
    const client = new StubTask13RpcClient([{ data: snapshot, error: null }]);
    const repository = await repositoryFor("job_summary", client);

    const result = (await repositoryRead({
      kind: "job_summary",
      repository,
      authorization,
    })) as Record<string, unknown>;

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_job_summary_as_system",
        args: {
          ...expectedCommonArgs(authorization),
          p_inbox_scope: null,
          p_clients_scope: null,
          p_pipeline_scope: null,
          p_projects_scope: "all",
          p_calendar_scope: null,
          p_tasks_scope: null,
          p_photos_scope: null,
          p_estimates_scope: null,
          p_invoices_scope: null,
          p_projects_financials_scope: null,
          p_job_kind: "project",
          p_job_id: TASK_13_PROJECT_ID,
          p_sections: ["identity"],
          p_readiness_rule_codes: null,
          p_financial_components: null,
        },
      },
    ]);
    expect(result).toMatchObject({
      requested_job: TASK_13_JOB_SUMMARY_INPUT.job_ref,
      section_claims: snapshot.section_claims,
      summary_claim: snapshot.summary_claim,
    });
    expect(
      snapshot.summary_claim.proof.projection.retained_proof_sources
    ).toEqual(snapshot.section_claims.map((claim) => claim.source_version));
  });

  it("rejects a missing, duplicate, or reordered requested section instead of silently omitting it", async () => {
    const authorization = await task13Authorization("job_summary");
    for (const mutate of [
      (snapshot: ReturnType<typeof jobSummarySnapshot>) => {
        snapshot.section_claims = [];
      },
      (snapshot: ReturnType<typeof jobSummarySnapshot>) => {
        snapshot.section_claims.push(snapshot.section_claims[0]!);
      },
      (snapshot: ReturnType<typeof jobSummarySnapshot>) => {
        snapshot.summary_claim.raw.requested_sections = ["activity"];
      },
    ]) {
      const snapshot = cloneTask13Fixture(jobSummarySnapshot(authorization));
      mutate(snapshot);
      const repository = await repositoryFor(
        "job_summary",
        new StubTask13RpcClient([{ data: snapshot, error: null }])
      );

      await expect(
        repositoryRead({ kind: "job_summary", repository, authorization })
      ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
    }
  });

  it("accepts only proof-bound private readiness sources for TypeScript rule evaluation", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["readiness" as const],
      readiness_rule_codes: [
        "SITE_PHOTOS_MISSING" as const,
        "CUSTOMER_RECORD_UNRESOLVED" as const,
        "SCHEDULE_UNCONFIRMED" as const,
        "CREW_UNASSIGNED" as const,
        "ADDRESS_INCOMPLETE" as const,
      ],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const snapshot = jobSummarySnapshot(authorization, [
      readinessSummarySectionRaw(),
    ]);
    const result = (await repositoryRead({
      kind: "job_summary",
      repository: await repositoryFor(
        "job_summary",
        new StubTask13RpcClient([{ data: snapshot, error: null }])
      ),
      authorization,
    })) as typeof snapshot;

    expect(result.section_claims[0]!.raw).toEqual(
      expect.objectContaining({
        section: "readiness",
        state: "readiness_sources",
        value: readinessSummarySectionRaw().value,
      })
    );

    const precomputed = cloneTask13Fixture(snapshot);
    precomputed.section_claims[0]!.raw = {
      section: "readiness",
      state: "evaluated",
      value: {
        evaluations: [
          {
            rule_code: "SITE_PHOTOS_MISSING",
            rule_revision: "site-photos-missing:v1",
            status: "clear",
            severity: "warning",
            fact: "Usable site photos are on file.",
          },
        ],
      },
      gaps: [],
      evidence_ids: [precomputed.section_claims[0]!.proof.evidence_id],
    };
    recoupleAtomicClaim(precomputed.section_claims[0]!, "section");
    recoupleTopClaim(precomputed);
    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: precomputed, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });

  it("accepts only purpose-minimized, source-bounded participant identities", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["participants" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const snapshot = jobSummarySnapshot(authorization, [
      participantSummarySectionRaw(),
    ]);
    const result = (await repositoryRead({
      kind: "job_summary",
      repository: await repositoryFor(
        "job_summary",
        new StubTask13RpcClient([{ data: snapshot, error: null }])
      ),
      authorization,
    })) as typeof snapshot;

    expect(result.section_claims[0]!.raw).toEqual(
      expect.objectContaining({
        section: "participants",
        state: "participant_sources",
        value: participantSummarySectionRaw().value,
      })
    );

    const leaked = cloneTask13Fixture(snapshot);
    const leakedParticipants = leaked.section_claims[0]!.raw.value as {
      participants: Array<Record<string, unknown>>;
    };
    Object.assign(leakedParticipants.participants[0]!, {
      email_source: {
        state: "available",
        normalized_address: "private@example.com",
      },
    });
    recoupleAtomicClaim(leaked.section_claims[0]!, "section");
    recoupleTopClaim(leaked);
    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: leaked, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });

  it("does not forward schedule authority for address-only readiness", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["readiness" as const],
      readiness_rule_codes: ["ADDRESS_INCOMPLETE" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const client = new StubTask13RpcClient([
      {
        data: jobSummarySnapshot(authorization, [readinessSummarySectionRaw()]),
        error: null,
      },
    ]);

    await repositoryRead({
      kind: "job_summary",
      repository: await repositoryFor("job_summary", client),
      authorization,
    });

    expect(client.calls[0]!.args).toMatchObject({
      p_sections: ["readiness"],
      p_readiness_rule_codes: ["ADDRESS_INCOMPLETE"],
      p_calendar_scope: null,
      p_tasks_scope: null,
    });
  });

  it("forwards schedule authority for activity because schedule-change facts are included", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["activity" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const client = new StubTask13RpcClient([
      {
        data: jobSummarySnapshot(authorization, [activitySummarySectionRaw()]),
        error: null,
      },
    ]);

    await repositoryRead({
      kind: "job_summary",
      repository: await repositoryFor("job_summary", client),
      authorization,
    });

    expect(client.calls[0]!.args).toMatchObject({
      p_sections: ["activity"],
      p_calendar_scope: "all",
      p_tasks_scope: "all",
    });
  });

  it("requires linked-project authority before returning opportunity activity sourced from project tasks", async () => {
    const summaryInput = {
      job_ref: { kind: "opportunity" as const, id: TASK_13_OPPORTUNITY_ID },
      sections: ["activity" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const client = new StubTask13RpcClient([
      {
        data: jobSummarySnapshot(authorization, [activitySummarySectionRaw()]),
        error: null,
      },
    ]);

    await repositoryRead({
      kind: "job_summary",
      repository: await repositoryFor("job_summary", client),
      authorization,
    });

    expect(client.calls[0]!.args).toMatchObject({
      p_job_kind: "opportunity",
      p_pipeline_scope: "all",
      p_projects_scope: "all",
      p_calendar_scope: "all",
      p_tasks_scope: "all",
    });
  });

  it("rejects a fully rehashed status event for a different job kind", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["activity" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const activity = {
      section: "activity" as const,
      state: "evaluated" as const,
      value: {
        events: [
          {
            event_ref: "job_status_event:opportunity:1",
            event_kind: "job_status_event" as const,
            occurred_at: "2026-08-14T16:00:00.000Z",
            from_status: {
              kind: "opportunity" as const,
              value: "quoted" as const,
            },
            to_status: {
              kind: "opportunity" as const,
              value: "won" as const,
            },
            status_version: null,
          },
        ],
        event_total: 1,
        events_omitted_count: 0,
        count_completeness: "exact" as const,
      },
      gaps: [],
    };
    const snapshot = jobSummarySnapshot(authorization, [activity]);

    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });

  it("rejects a fully rehashed financial component that was neither requested nor authorized", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["financials" as const],
      financial_components: ["estimate_rollup" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const financials = {
      section: "financials" as const,
      state: "evaluated" as const,
      value: {
        components: [
          {
            kind: "estimate_rollup" as const,
            document_count: 0,
            total: null,
            status_counts: [],
          },
          {
            kind: "invoice_rollup" as const,
            document_count: 0,
            total: null,
            amount_paid: null,
            balance_due: null,
            status_counts: [],
          },
        ],
      },
      gaps: [],
    };
    const snapshot = jobSummarySnapshot(authorization, [financials]);

    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });

  it("rejects a fully rehashed identity section for a different job", async () => {
    const authorization = await task13Authorization("job_summary");
    const snapshot = cloneTask13Fixture(jobSummarySnapshot(authorization));
    const raw = snapshot.section_claims[0]!.raw as {
      value: { job_ref: { id: string } };
    };
    raw.value.job_ref.id = "99999999-9999-4999-8999-999999999999";
    recoupleAtomicClaim(snapshot.section_claims[0]!, "section");
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });

  it.each(["created_at", "updated_at"] as const)(
    "rejects a fully rehashed identity %s after the summary read fence",
    async (field) => {
      const authorization = await task13Authorization("job_summary");
      const snapshot = cloneTask13Fixture(jobSummarySnapshot(authorization));
      const raw = snapshot.section_claims[0]!.raw as {
        value: { dates: Record<typeof field, string> };
      };
      raw.value.dates[field] = "2026-08-14T18:00:00.000Z";
      recoupleAtomicClaim(snapshot.section_claims[0]!, "section");
      recoupleTopClaim(snapshot);

      await expect(
        repositoryRead({
          kind: "job_summary",
          repository: await repositoryFor(
            "job_summary",
            new StubTask13RpcClient([{ data: snapshot, error: null }])
          ),
          authorization,
        })
      ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
    }
  );

  it("rejects a fully rehashed activity event after the summary read fence", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["activity" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const snapshot = cloneTask13Fixture(
      jobSummarySnapshot(authorization, [activitySummarySectionRaw()])
    );
    const activity = snapshot.section_claims[0]!.raw as {
      value: { events: { occurred_at: string }[] };
    };
    activity.value.events[0]!.occurred_at = "2026-08-14T18:00:00.000Z";
    recoupleAtomicClaim(snapshot.section_claims[0]!, "section");
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });

  it("rejects fully rehashed future observed schedule metadata while allowing future schedule instants", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["schedule" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const valid = jobSummarySnapshot(authorization, [
      scheduleSummarySectionRaw(),
    ]);
    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: valid, error: null }])
        ),
        authorization,
      })
    ).resolves.toMatchObject({ requested_job: summaryInput.job_ref });

    for (const field of [
      "task_updated_at",
      "project_updated_at",
      "schedule_confirmed_at",
    ] as const) {
      const snapshot = cloneTask13Fixture(valid);
      const schedule = snapshot.section_claims[0]!.raw as {
        value: {
          occurrences: Record<
            "task_updated_at" | "project_updated_at" | "schedule_confirmed_at",
            string | null
          >[];
        };
      };
      schedule.value.occurrences[0]![field] = "2026-08-14T18:00:00.000Z";
      recoupleAtomicClaim(snapshot.section_claims[0]!, "section");
      recoupleTopClaim(snapshot);

      await expect(
        repositoryRead({
          kind: "job_summary",
          repository: await repositoryFor(
            "job_summary",
            new StubTask13RpcClient([{ data: snapshot, error: null }])
          ),
          authorization,
        })
      ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
    }
  });

  it("rejects a fully rehashed latest visible delivery after the summary read fence", async () => {
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["conversation" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput
    );
    const snapshot = cloneTask13Fixture(
      jobSummarySnapshot(authorization, [conversationSummarySectionRaw()])
    );
    const conversation = snapshot.section_claims[0]!.raw as {
      value: { last_actor_visible_delivered_at: string | null };
    };
    conversation.value.last_actor_visible_delivered_at =
      "2026-08-14T18:00:00.000Z";
    recoupleAtomicClaim(snapshot.section_claims[0]!, "section");
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });

  it("binds actor-visible conversation counts while withholding global memory markers from assigned inbox scope", async () => {
    const authority = task13Authority();
    const assignedAuthority = {
      ...authority,
      effectivePermissions: authority.effectivePermissions.map((permission) =>
        permission.permission === "inbox.view"
          ? { ...permission, scope: "assigned" as const }
          : permission
      ),
    };
    const actor = await task13ActorContextForAuthority(assignedAuthority);
    const summaryInput = {
      job_ref: { kind: "project" as const, id: TASK_13_PROJECT_ID },
      sections: ["conversation" as const],
    };
    const authorization = await task13Authorization(
      "job_summary",
      summaryInput,
      actor
    );
    const restrictedSnapshot = jobSummarySnapshot(authorization, [
      conversationSummarySectionRaw({ exposeGlobalMemoryMarkers: false }),
    ]);
    const acceptedClient = new StubTask13RpcClient([
      { data: restrictedSnapshot, error: null },
    ]);

    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor("job_summary", acceptedClient),
        authorization,
      })
    ).resolves.toMatchObject({
      section_claims: [
        {
          raw: {
            value: {
              actor_visible_delivered_turn_count: 251,
              actor_visible_delivered_turn_count_completeness: "lower_bound",
              memory_version: null,
              turn_high_watermark_id: null,
            },
          },
        },
      ],
    });
    expect(acceptedClient.calls[0]!.args).toMatchObject({
      p_inbox_scope: "assigned",
    });

    const leaked = jobSummarySnapshot(authorization, [
      conversationSummarySectionRaw(),
    ]);
    await expect(
      repositoryRead({
        kind: "job_summary",
        repository: await repositoryFor(
          "job_summary",
          new StubTask13RpcClient([{ data: leaked, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_SUMMARY_INVALID" });
  });
});

describe("Task 13 job-history repository", () => {
  it("passes exact search data and returns a signed cursor bound to both source fences", async () => {
    const authorization = await task13Authorization("job_history");
    const snapshot = jobHistorySnapshot(
      authorization,
      [deliveredHistoryEvent()],
      {
        hasMore: true,
      }
    );
    const client = new StubTask13RpcClient([{ data: snapshot, error: null }]);
    const repository = await repositoryFor("job_history", client);

    const result = (await repositoryRead({
      kind: "job_history",
      repository,
      authorization,
    })) as {
      page: { next_cursor: string | null; has_more: boolean };
      boundary_cursors: readonly string[];
    };

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_job_history_as_system",
        args: {
          ...expectedCommonArgs(authorization),
          p_inbox_scope: "all",
          p_clients_scope: null,
          p_pipeline_scope: null,
          p_projects_scope: "all",
          p_calendar_scope: "all",
          p_tasks_scope: "all",
          p_estimates_scope: "all",
          p_projects_financials_scope: "all",
          p_query: "east gate Tuesday",
          p_scope_kind: "jobs",
          p_customer_kind: null,
          p_customer_id: null,
          p_scope_job_kinds: null,
          p_job_refs: [{ kind: "project", id: TASK_13_PROJECT_ID }],
          p_from: "2025-08-14T00:00:00.000Z",
          p_to_exclusive: "2026-08-14T00:00:00.000Z",
          p_source_types: [
            "delivered_correspondence",
            "current_memory_summary",
            "job_status_event",
            "task_event",
            "estimate_document",
          ],
          p_read_as_of: null,
          p_cursor_source_revision: null,
          p_cursor_history_revision: null,
          p_cursor_rank_micros: null,
          p_cursor_occurred_at: null,
          p_cursor_source_type: null,
          p_cursor_source_id: null,
          p_limit: 20,
        },
      },
    ]);
    expect(result.page.has_more).toBe(true);
    expect(result.page.next_cursor).toMatch(/^ops_cursor:/);
    expect(result.boundary_cursors).toHaveLength(1);
    expect(result.boundary_cursors[0]).toMatch(/^ops_cursor:/);
  });

  it("binds calendar and task scopes only when task-event schedule facts are selected", async () => {
    const correspondenceOnlyInput = {
      ...TASK_13_JOB_HISTORY_INPUT,
      source_types: ["delivered_correspondence" as const],
    };
    const authorization = await task13Authorization(
      "job_history",
      correspondenceOnlyInput
    );
    const client = new StubTask13RpcClient([
      {
        data: jobHistorySnapshot(authorization, []),
        error: null,
      },
    ]);
    const repository = await repositoryFor("job_history", client);

    await repositoryRead({ kind: "job_history", repository, authorization });

    expect(client.calls[0]!.args).toMatchObject({
      p_source_types: ["delivered_correspondence"],
      p_calendar_scope: null,
      p_tasks_scope: null,
      p_estimates_scope: null,
      p_projects_financials_scope: null,
    });
  });

  it("keeps an empty terminal search bound to query, scope, window, and both source fences", async () => {
    const authorization = await task13Authorization("job_history");
    const snapshot = jobHistorySnapshot(authorization, []);
    const repository = await repositoryFor(
      "job_history",
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    const result = (await repositoryRead({
      kind: "job_history",
      repository,
      authorization,
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      event_claims: [],
      returned_event_count: 0,
      page: { next_cursor: null, has_more: false },
      collection_claim: {
        proof: {
          projection: {
            actor_user_id: TASK_13_ACTOR_ID,
            company_id: TASK_13_COMPANY_ID,
            capability_id: "search_job_history",
            capability_manifest_revision: TASK_13_MANIFEST_REVISION,
            permission_snapshot_revision: TASK_13_PERMISSION_REVISION,
            canonical_input: TASK_13_JOB_HISTORY_INPUT,
            read_at: TASK_13_READ_AT,
            source_revision: TASK_13_SOURCE_REVISION,
            history_revision: TASK_13_HISTORY_REVISION,
            retained_proof_sources: [],
          },
        },
      },
    });
  });

  it("keeps one projection evidence atom while validating canonical memory drill-down selectors independently", async () => {
    const authorization = await task13Authorization("job_history");
    const memory = currentMemoryHistoryEvent();
    const snapshot = jobHistorySnapshot(authorization, [memory]);
    const result = (await repositoryRead({
      kind: "job_history",
      repository: await repositoryFor(
        "job_history",
        new StubTask13RpcClient([{ data: snapshot, error: null }])
      ),
      authorization,
    })) as typeof snapshot;

    expect(result.event_claims[0]!.evidence).toHaveLength(1);
    expect(result.event_claims[0]!.raw.evidence_ids).toEqual([
      result.event_claims[0]!.proof.evidence_id,
    ]);
    expect(result.event_claims[0]!.raw.correspondence_evidence_ids).toEqual(
      memory.correspondence_evidence_ids
    );
    expect(memory.correspondence_evidence_ids).not.toContain(
      result.event_claims[0]!.proof.evidence_id
    );

    const reordered = cloneTask13Fixture(snapshot);
    const reorderedSelectors = reordered.event_claims[0]!.raw
      .correspondence_evidence_ids as string[];
    reorderedSelectors.reverse();
    recoupleAtomicClaim(reordered.event_claims[0]!, "event");
    recoupleTopClaim(reordered);
    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor(
          "job_history",
          new StubTask13RpcClient([{ data: reordered, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_HISTORY_INVALID" });
  });

  it("rejects a fully rehashed history source gap outside the public bounded gap vocabulary", async () => {
    const authorization = await task13Authorization("job_history");
    const snapshot = cloneTask13Fixture(jobHistorySnapshot(authorization));
    const unsupportedGaps = [
      "SOURCE_UNAVAILABLE",
    ] as unknown as typeof snapshot.gaps;
    snapshot.gaps = unsupportedGaps;
    snapshot.collection_claim.raw.gaps = unsupportedGaps;
    recoupleAtomicClaim(snapshot.collection_claim, "collection");

    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor(
          "job_history",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_HISTORY_INVALID" });
  });

  it("rejects a fully rehashed match that has only supplemental recency relevance", async () => {
    const authorization = await task13Authorization("job_history");
    const snapshot = cloneTask13Fixture(jobHistorySnapshot(authorization));
    const historyEvent = snapshot.event_claims[0]!.raw as {
      relevance: { reason_codes: string[] };
    };
    historyEvent.relevance.reason_codes = ["RECENCY_MATCH"];
    recoupleAtomicClaim(snapshot.event_claims[0]!, "event");
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor(
          "job_history",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_HISTORY_INVALID" });
  });

  it("rejects a fully rehashed history event after read_at even when the requested window extends later", async () => {
    const historyInput = {
      ...TASK_13_JOB_HISTORY_INPUT,
      window: {
        from: "2026-08-14T17:00:00.000Z",
        to_exclusive: "2026-08-15T00:00:00.000Z",
      },
    };
    const authorization = await task13Authorization(
      "job_history",
      historyInput
    );
    const snapshot = cloneTask13Fixture(jobHistorySnapshot(authorization));
    snapshot.event_claims[0]!.raw.occurred_at = "2026-08-14T18:00:00.000Z";
    recoupleAtomicClaim(snapshot.event_claims[0]!, "event");
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor(
          "job_history",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_HISTORY_INVALID" });
  });

  it("derives and binds the exact 365-day effective window when the public input omits it", async () => {
    const { window: _window, ...historyInputWithoutWindow } =
      TASK_13_JOB_HISTORY_INPUT;
    const authorization = await task13Authorization(
      "job_history",
      historyInputWithoutWindow
    );
    const snapshot = jobHistorySnapshot(authorization);
    const client = new StubTask13RpcClient([{ data: snapshot, error: null }]);

    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor("job_history", client),
        authorization,
      })
    ).resolves.toMatchObject({
      collection_claim: {
        raw: {
          effective_window: {
            from: "2025-08-14T17:59:59.000Z",
            to_exclusive: TASK_13_READ_AT,
          },
        },
      },
    });
    expect(client.calls[0]!.args).toMatchObject({
      p_from: null,
      p_to_exclusive: null,
    });

    const shifted = cloneTask13Fixture(snapshot);
    const shiftedRaw = shifted.collection_claim.raw as {
      effective_window: { from: string };
    };
    shiftedRaw.effective_window.from = "2025-08-13T17:59:59.000Z";
    recoupleAtomicClaim(shifted.collection_claim, "collection");
    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor(
          "job_history",
          new StubTask13RpcClient([{ data: shifted, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_HISTORY_INVALID" });
  });

  it("rejects a fully rehashed event from an unselected history source", async () => {
    const authorization = await task13Authorization("job_history", {
      ...TASK_13_JOB_HISTORY_INPUT,
      source_types: ["delivered_correspondence"],
    });
    const snapshot = jobHistorySnapshot(authorization, [
      currentMemoryHistoryEvent(),
    ]);

    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor(
          "job_history",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_HISTORY_INVALID" });
  });

  it.each([
    [
      "outside the explicit job scope",
      (snapshot: ReturnType<typeof jobHistorySnapshot>) => {
        const raw = snapshot.event_claims[0]!.raw as {
          job_ref: { id: string };
        };
        raw.job_ref.id = "99999999-9999-4999-8999-999999999999";
      },
    ],
    [
      "outside the effective window",
      (snapshot: ReturnType<typeof jobHistorySnapshot>) => {
        snapshot.event_claims[0]!.raw.occurred_at = "2025-08-13T23:59:59.999Z";
      },
    ],
  ])("rejects a fully rehashed history event %s", async (_label, mutate) => {
    const authorization = await task13Authorization("job_history");
    const snapshot = cloneTask13Fixture(jobHistorySnapshot(authorization));
    mutate(snapshot);
    recoupleAtomicClaim(snapshot.event_claims[0]!, "event");
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "job_history",
        repository: await repositoryFor(
          "job_history",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_HISTORY_INVALID" });
  });
});

describe("Task 13 correspondence-evidence repository", () => {
  it("binds the requested job, IDs, and mode into one fixed all-or-error read", async () => {
    const authorization = await task13Authorization("correspondence_evidence");
    const snapshot = correspondenceEvidenceSnapshot(authorization);
    const client = new StubTask13RpcClient([{ data: snapshot, error: null }]);
    const repository = await repositoryFor("correspondence_evidence", client);

    const result = (await repositoryRead({
      kind: "correspondence_evidence",
      repository,
      authorization,
    })) as Record<string, unknown>;

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_correspondence_evidence_page_as_system",
        args: {
          ...expectedCommonArgs(authorization),
          p_inbox_scope: "all",
          p_pipeline_scope: null,
          p_projects_scope: "all",
          p_job_kind: "project",
          p_job_id: TASK_13_PROJECT_ID,
          p_evidence_ids: [TASK_13_TURN_EVIDENCE_ID],
          p_mode: "excerpt",
        },
      },
    ]);
    expect(result).toMatchObject({
      requested_job: TASK_13_EVIDENCE_INPUT.job_ref,
      requested_evidence_count: 1,
      returned_evidence_count: 1,
      evidence_claims: snapshot.evidence_claims,
      collection_claim: snapshot.collection_claim,
    });
  });

  it("rejects a fully rehashed operational source revision injected across the history-only proof boundary", async () => {
    const authorization = await task13Authorization("correspondence_evidence");
    const injected = cloneTask13Fixture(
      correspondenceEvidenceSnapshot(authorization)
    );
    for (const claim of injected.evidence_claims) {
      claim.proof.projection.source_revision = TASK_13_SOURCE_REVISION + 1;
      recoupleClaimProjectionHash(claim);
    }
    injected.collection_claim.proof.projection.source_revision =
      TASK_13_SOURCE_REVISION + 1;
    recoupleTopClaim(injected);

    await expect(
      repositoryRead({
        kind: "correspondence_evidence",
        repository: await repositoryFor(
          "correspondence_evidence",
          new StubTask13RpcClient([{ data: injected, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "CORRESPONDENCE_EVIDENCE_INVALID" });
  });

  it("rejects a fully proof-coupled evidence row anchored to a different job", async () => {
    const authorization = await task13Authorization("correspondence_evidence");
    const snapshot = cloneTask13Fixture(
      correspondenceEvidenceSnapshot(authorization)
    );
    const claim = snapshot.evidence_claims[0]!;
    claim.raw.job_ref = {
      kind: "project",
      id: "99999999-9999-4999-8999-999999999999",
    };
    recoupleAtomicClaim(claim, "correspondence_evidence");
    recoupleTopClaim(snapshot);
    const repository = await repositoryFor(
      "correspondence_evidence",
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({
        kind: "correspondence_evidence",
        repository,
        authorization,
      })
    ).rejects.toMatchObject({ code: "CORRESPONDENCE_EVIDENCE_INVALID" });
  });

  it("accepts exact absent content for empty or attachment-only mail under either read mode", async () => {
    for (const mode of ["excerpt", "full_text"] as const) {
      const authorization = await task13Authorization(
        "correspondence_evidence",
        { ...TASK_13_EVIDENCE_INPUT, mode }
      );
      const raw = absentContentCorrespondenceEvidenceRaw();
      const snapshot = correspondenceEvidenceSnapshot(authorization, [raw]);

      await expect(
        repositoryRead({
          kind: "correspondence_evidence",
          repository: await repositoryFor(
            "correspondence_evidence",
            new StubTask13RpcClient([{ data: snapshot, error: null }])
          ),
          authorization,
        })
      ).resolves.toMatchObject({
        evidence_claims: [{ raw: { content: raw.content } }],
      });
    }
  });

  it("rejects a fully rehashed absent-content claim carrying fabricated text or mode", async () => {
    const authorization = await task13Authorization("correspondence_evidence");
    const snapshot = correspondenceEvidenceSnapshot(authorization, [
      absentContentCorrespondenceEvidenceRaw(),
    ]);
    const leaked = cloneTask13Fixture(snapshot);
    leaked.evidence_claims[0]!.raw.content = {
      state: "absent",
      code: "NO_CONTENT",
      mode: "excerpt",
      normalized_plain_text: "fabricated",
    };
    recoupleAtomicClaim(leaked.evidence_claims[0]!, "correspondence_evidence");
    recoupleTopClaim(leaked);

    await expect(
      repositoryRead({
        kind: "correspondence_evidence",
        repository: await repositoryFor(
          "correspondence_evidence",
          new StubTask13RpcClient([{ data: leaked, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "CORRESPONDENCE_EVIDENCE_INVALID" });
  });

  it("rejects fully rehashed evidence delivered after the snapshot read fence", async () => {
    const authorization = await task13Authorization("correspondence_evidence");
    const snapshot = cloneTask13Fixture(
      correspondenceEvidenceSnapshot(authorization)
    );
    snapshot.evidence_claims[0]!.raw.delivered_at = "2026-08-14T18:00:00.000Z";
    recoupleAtomicClaim(
      snapshot.evidence_claims[0]!,
      "correspondence_evidence"
    );
    recoupleTopClaim(snapshot);

    await expect(
      repositoryRead({
        kind: "correspondence_evidence",
        repository: await repositoryFor(
          "correspondence_evidence",
          new StubTask13RpcClient([{ data: snapshot, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "CORRESPONDENCE_EVIDENCE_INVALID" });
  });

  it("maps only the exact full-text overflow sentinel to the typed too-large repository error", async () => {
    const authorization = await task13Authorization("correspondence_evidence");
    for (const fixture of [
      {
        error: {
          code: "54000",
          message: "agent_correspondence_evidence_full_text_too_large",
        },
        expectedCode: "CORRESPONDENCE_EVIDENCE_TOO_LARGE",
      },
      {
        error: {
          code: "54000",
          message: "agent_correspondence_evidence_full_text_too_large_extra",
        },
        expectedCode: "CORRESPONDENCE_EVIDENCE_READ_FAILED",
      },
    ] as const) {
      await expect(
        repositoryRead({
          kind: "correspondence_evidence",
          repository: await repositoryFor(
            "correspondence_evidence",
            new StubTask13RpcClient([{ data: null, error: fixture.error }])
          ),
          authorization,
        })
      ).rejects.toMatchObject({ code: fixture.expectedCode });
    }
  });

  it("accepts current redaction state only when text and attachments are absent", async () => {
    const authorization = await task13Authorization("correspondence_evidence");
    const raw = correspondenceEvidenceRaw();
    const redacted = {
      ...raw,
      subject: {
        state: "redacted" as const,
        code: "SUBJECT_REDACTED" as const,
      },
      content: {
        state: "redacted" as const,
        code: "CONTENT_REDACTED" as const,
      },
      redaction_kinds: [
        "content_redacted" as const,
        "attachment_metadata_redacted" as const,
      ],
      attachments: [],
    };
    const snapshot = correspondenceEvidenceSnapshot(authorization, [redacted]);
    const repository = await repositoryFor(
      "correspondence_evidence",
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({
        kind: "correspondence_evidence",
        repository,
        authorization,
      })
    ).resolves.toMatchObject({
      evidence_claims: [
        {
          raw: {
            subject: { state: "redacted" },
            content: { state: "redacted" },
            attachments: [],
          },
        },
      ],
    });

    const leaked = cloneTask13Fixture(snapshot);
    leaked.evidence_claims[0]!.raw.content = {
      state: "redacted",
      code: "CONTENT_REDACTED",
      normalized_plain_text: "must not survive redaction",
    };
    recoupleAtomicClaim(leaked.evidence_claims[0]!, "correspondence_evidence");
    recoupleTopClaim(leaked);
    await expect(
      repositoryRead({
        kind: "correspondence_evidence",
        repository: await repositoryFor(
          "correspondence_evidence",
          new StubTask13RpcClient([{ data: leaked, error: null }])
        ),
        authorization,
      })
    ).rejects.toMatchObject({ code: "CORRESPONDENCE_EVIDENCE_INVALID" });
  });
});

describe.each([
  "customer_jobs",
  "job_summary",
  "job_history",
  "correspondence_evidence",
] as const)("Task 13 %s atomic proof verification", (kind) => {
  it("contains hostile nested RPC error getters inside the privacy-safe read failure", async () => {
    const authorization = await task13Authorization(kind);
    const hostileError = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileError, "code", {
      get() {
        throw new Error("hostile nested RPC error getter");
      },
    });
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: null, error: hostileError }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedReadFailedCode(kind) });
  });

  it("contains hostile snapshot getters inside the typed invalid-result boundary", async () => {
    const authorization = await task13Authorization(kind);
    const hostileSnapshot = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileSnapshot, "company_id", {
      enumerable: true,
      get() {
        throw new Error("hostile snapshot getter");
      },
    });
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: hostileSnapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });

  it.each([
    [
      "actor",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.actor_user_id =
          "99999999-9999-4999-8999-999999999999";
      },
      true,
    ],
    [
      "company",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.company_id =
          "99999999-9999-4999-8999-999999999999";
      },
      true,
    ],
    [
      "capability",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.capability_id = "other_capability";
      },
      true,
    ],
    [
      "capability revision",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.capability_revision =
          "other_capability:2099-01-01.v999";
      },
      true,
    ],
    [
      "manifest v6",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.capability_manifest_revision =
          "2026-08-13.capability-manifest.v5";
      },
      true,
    ],
    [
      "permission snapshot",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.permission_snapshot_revision =
          `sha256:${"f".repeat(64)}`;
      },
      true,
    ],
    [
      "canonical input",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.canonical_input = {
          attacker: "broaden all jobs",
        };
      },
      true,
    ],
    [
      "read_at",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.read_at =
          "2026-08-14T17:00:00.000Z";
      },
      true,
    ],
    [
      "source revision",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.source_revision =
          TASK_13_SOURCE_REVISION + 1;
      },
      true,
    ],
    [
      "history revision",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.history_revision =
          TASK_13_HISTORY_REVISION + 1;
      },
      true,
    ],
    [
      "raw payload projection",
      (snapshot: Record<string, unknown>) => {
        const projection = topClaim(snapshot).proof.projection;
        if ("summary" in projection) {
          projection.summary = { attacker: "drop requested sections" };
        } else {
          projection.collection = { attacker: "broaden collection" };
        }
      },
      true,
    ],
    [
      "projection hash",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.source_content_hash =
          `sha256:${"f".repeat(64)}`;
      },
      false,
    ],
    [
      "proof source",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).source_version.source_id = "attacker-source";
      },
      false,
    ],
    [
      "proof evidence",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).evidence[0]!.evidence_id = "evidence:attacker";
      },
      false,
    ],
    [
      "retained proof order",
      (snapshot: Record<string, unknown>) => {
        topClaim(snapshot).proof.projection.retained_proof_sources = [];
      },
      true,
    ],
  ])("rejects %s drift", async (_label, mutate, recoupleProjection) => {
    const authorization = await task13Authorization(kind);
    const snapshot = cloneTask13Fixture(
      await validSnapshot(kind, authorization)
    ) as unknown as Record<string, unknown>;
    mutate(snapshot);
    if (recoupleProjection) {
      recoupleClaimProjectionHash(topClaim(snapshot));
    }
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });

  it("rejects a structural authorization clone before the RPC", async () => {
    const authorization = await task13Authorization(kind);
    const client = new StubTask13RpcClient([]);
    const repository = await repositoryFor(kind, client);

    await expect(
      repositoryRead({
        kind,
        repository,
        authorization: { ...authorization } as Task13Authorization,
      })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
    expect(client.calls).toHaveLength(0);
  });

  it("rejects a fully rehashed child claim whose authorization projection drifted", async () => {
    const authorization = await task13Authorization(kind);
    const snapshot = cloneTask13Fixture(
      await validSnapshot(kind, authorization)
    ) as unknown as Record<string, unknown>;
    const child = childClaims(snapshot)[0]!;
    child.proof.projection.actor_user_id =
      "99999999-9999-4999-8999-999999999999";
    recoupleClaimProjectionHash(child);
    recoupleTopClaim(snapshot);
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });

  it.each([
    ["child", (snapshot: Record<string, unknown>) => childClaims(snapshot)[0]!],
    ["top", (snapshot: Record<string, unknown>) => topClaim(snapshot)],
  ])(
    "rejects a %s evidence atom with a foreign locator",
    async (_label, claim) => {
      const authorization = await task13Authorization(kind);
      const snapshot = cloneTask13Fixture(
        await validSnapshot(kind, authorization)
      ) as unknown as Record<string, unknown>;
      claim(snapshot).evidence[0]!.locator =
        "ops://evidence/evidence%3Aforeign-job-projection";
      const repository = await repositoryFor(
        kind,
        new StubTask13RpcClient([{ data: snapshot, error: null }])
      );

      await expect(
        repositoryRead({ kind, repository, authorization })
      ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
    }
  );

  it("rejects a fully rehashed child whose public evidence list is not the one projection atom", async () => {
    const authorization = await task13Authorization(kind);
    const snapshot = cloneTask13Fixture(
      await validSnapshot(kind, authorization)
    ) as unknown as Record<string, unknown>;
    const child = childClaims(snapshot)[0]!;
    child.raw.evidence_ids = [
      ...(child.raw.evidence_ids as string[]),
      kind === "correspondence_evidence"
        ? "job_conversation_turn:99999999-9999-4999-8999-999999999999"
        : "evidence:unbound-extra-source",
    ];
    const payloadKey =
      kind === "customer_jobs"
        ? "job"
        : kind === "job_summary"
          ? "section"
          : kind === "job_history"
            ? "event"
            : "correspondence_evidence";
    recoupleAtomicClaim(child, payloadKey);
    recoupleTopClaim(snapshot);
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });

  it("rejects a fully self-coupled child projection evidence identity that is not canonically derived", async () => {
    const authorization = await task13Authorization(kind);
    const snapshot = cloneTask13Fixture(
      await validSnapshot(kind, authorization)
    ) as unknown as Record<string, unknown>;
    const child = childClaims(snapshot)[0]!;
    const payloadKey =
      kind === "customer_jobs"
        ? "job"
        : kind === "job_summary"
          ? "section"
          : kind === "job_history"
            ? "event"
            : "correspondence_evidence";
    child.proof.evidence_id = "evidence:attacker-derived-projection";
    child.evidence[0]!.evidence_id = "evidence:attacker-derived-projection";
    child.raw.evidence_ids = ["evidence:attacker-derived-projection"];
    recoupleAtomicClaim(child, payloadKey);
    recoupleTopClaim(snapshot);
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });

  it("rejects a fully self-coupled child projection source identity that is not canonically derived", async () => {
    const authorization = await task13Authorization(kind);
    const snapshot = cloneTask13Fixture(
      await validSnapshot(kind, authorization)
    ) as unknown as Record<string, unknown>;
    const child = childClaims(snapshot)[0]!;
    child.proof.source_version.source_id = "attacker-derived-child-source";
    child.source_version.source_id = "attacker-derived-child-source";
    child.evidence[0]!.source_id = "attacker-derived-child-source";
    recoupleTopClaim(snapshot);
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });

  it("rejects a fully self-coupled top projection evidence identity that is not canonically derived", async () => {
    const authorization = await task13Authorization(kind);
    const snapshot = cloneTask13Fixture(
      await validSnapshot(kind, authorization)
    ) as unknown as Record<string, unknown>;
    const top = topClaim(snapshot);
    top.proof.evidence_id = "evidence:attacker-derived-collection";
    top.evidence[0]!.evidence_id = "evidence:attacker-derived-collection";
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });

  it("rejects a fully self-coupled top projection source identity that is not canonically derived", async () => {
    const authorization = await task13Authorization(kind);
    const snapshot = cloneTask13Fixture(
      await validSnapshot(kind, authorization)
    ) as unknown as Record<string, unknown>;
    const top = topClaim(snapshot);
    top.proof.source_version.source_id = "attacker-derived-source";
    top.source_version.source_id = "attacker-derived-source";
    top.evidence[0]!.source_id = "attacker-derived-source";
    const repository = await repositoryFor(
      kind,
      new StubTask13RpcClient([{ data: snapshot, error: null }])
    );

    await expect(
      repositoryRead({ kind, repository, authorization })
    ).rejects.toMatchObject({ code: expectedInvalidCode(kind) });
  });
});

describe("Task 13 ordered claim and cursor verification", () => {
  it.each([
    {
      kind: "customer_jobs" as const,
      build: (authorization: Task13Authorization) =>
        customerJobsSnapshot(
          authorization,
          [convertedCustomerJob(0), convertedCustomerJob(1)],
          { hasMore: true }
        ),
      claimKey: "job_claims",
    },
    {
      kind: "job_history" as const,
      build: (authorization: Task13Authorization) =>
        jobHistorySnapshot(
          authorization,
          [deliveredHistoryEvent(0), deliveredHistoryEvent(1)],
          { hasMore: true }
        ),
      claimKey: "event_claims",
    },
  ])(
    "rejects reordered $kind claims even when every claim is independently valid",
    async (fixture) => {
      const authorization = await task13Authorization(fixture.kind);
      const snapshot = cloneTask13Fixture(
        fixture.build(authorization)
      ) as unknown as Record<string, unknown>;
      const claims = snapshot[fixture.claimKey] as AtomicTask13Claim[];
      claims.reverse();
      recoupleTopClaim(snapshot);
      const repository = await repositoryFor(
        fixture.kind,
        new StubTask13RpcClient([{ data: snapshot, error: null }])
      );

      await expect(
        repositoryRead({ kind: fixture.kind, repository, authorization })
      ).rejects.toMatchObject({ code: expectedInvalidCode(fixture.kind) });
    }
  );

  it("rejects tampered, expired, query-rebound, and permission-stale customer cursors before RPC", async () => {
    let now = new Date(TASK_13_GENERATED_AT);
    const codec = cursorCodec({ now: () => now, ttlSeconds: 60 });
    const authorization = await task13Authorization("customer_jobs");
    const firstRepository = await repositoryFor(
      "customer_jobs",
      new StubTask13RpcClient([
        {
          data: customerJobsSnapshot(authorization, [convertedCustomerJob()], {
            hasMore: true,
          }),
          error: null,
        },
      ]),
      codec
    );
    const first = (await repositoryRead({
      kind: "customer_jobs",
      repository: firstRepository,
      authorization,
    })) as { page: { next_cursor: string } };
    const cursor = first.page.next_cursor;

    const cases: Array<{
      name: string;
      rawInput: Record<string, unknown>;
      permissionRevision?: string;
      before?: () => void;
      expectedCode: "CUSTOMER_JOBS_INVALID" | "CUSTOMER_JOBS_STALE";
    }> = [
      {
        name: "signature tamper",
        rawInput: {
          ...TASK_13_CUSTOMER_JOBS_INPUT,
          cursor: `${cursor.slice(0, -1)}x`,
        },
        expectedCode: "CUSTOMER_JOBS_INVALID",
      },
      {
        name: "query rebound",
        rawInput: {
          ...TASK_13_CUSTOMER_JOBS_INPUT,
          lifecycle_states: ["archived"],
          cursor,
        },
        expectedCode: "CUSTOMER_JOBS_INVALID",
      },
      {
        name: "permission stale",
        rawInput: { ...TASK_13_CUSTOMER_JOBS_INPUT, cursor },
        permissionRevision: `sha256:${"d".repeat(64)}`,
        expectedCode: "CUSTOMER_JOBS_STALE",
      },
      {
        name: "expired",
        rawInput: { ...TASK_13_CUSTOMER_JOBS_INPUT, cursor },
        before: () => {
          now = new Date(Date.parse(TASK_13_GENERATED_AT) + 61_000);
        },
        expectedCode: "CUSTOMER_JOBS_INVALID",
      },
    ];

    for (const fixture of cases) {
      now = new Date(TASK_13_GENERATED_AT);
      fixture.before?.();
      const actor = await task13ActorContext(
        "internal",
        undefined,
        fixture.permissionRevision ?? TASK_13_PERMISSION_REVISION
      );
      const continued = await task13Authorization(
        "customer_jobs",
        fixture.rawInput,
        actor
      );
      const client = new StubTask13RpcClient([]);
      const repository = await repositoryFor("customer_jobs", client, codec);

      await expect(
        repositoryRead({
          kind: "customer_jobs",
          repository,
          authorization: continued,
        })
      ).rejects.toMatchObject({ code: fixture.expectedCode });
      expect(client.calls, fixture.name).toHaveLength(0);
    }
  });

  it("decodes the signed history keyset into exact RPC fields and never forwards the public cursor", async () => {
    const authorization = await task13Authorization("job_history");
    const codec = cursorCodec({ now: () => new Date(TASK_13_GENERATED_AT) });
    const first = (await repositoryRead({
      kind: "job_history",
      repository: await repositoryFor(
        "job_history",
        new StubTask13RpcClient([
          {
            data: jobHistorySnapshot(authorization, [deliveredHistoryEvent()], {
              hasMore: true,
            }),
            error: null,
          },
        ]),
        codec
      ),
      authorization,
    })) as { page: { next_cursor: string } };
    const continuedInput = {
      ...TASK_13_JOB_HISTORY_INPUT,
      cursor: first.page.next_cursor,
    };
    const continued = await task13Authorization("job_history", continuedInput);
    const terminalSnapshot = jobHistorySnapshot(continued, []);
    const client = new StubTask13RpcClient([
      { data: terminalSnapshot, error: null },
    ]);
    const repository = await repositoryFor("job_history", client, codec);

    await repositoryRead({
      kind: "job_history",
      repository,
      authorization: continued,
    });

    expect(client.calls[0]!.args).toMatchObject({
      p_read_as_of: TASK_13_READ_AT,
      p_cursor_source_revision: TASK_13_SOURCE_REVISION,
      p_cursor_history_revision: TASK_13_HISTORY_REVISION,
      p_cursor_rank_micros: 910_000,
      p_cursor_occurred_at: "2026-08-10T16:30:00.000Z",
      p_cursor_source_type: "delivered_correspondence",
      p_cursor_source_id: "job_history_match:delivered:1",
    });
    expect(client.calls[0]!.args).not.toHaveProperty("p_cursor");
  });

  it("rejects tampered, expired, query-rebound, and permission-stale history cursors before RPC", async () => {
    let now = new Date(TASK_13_GENERATED_AT);
    const codec = cursorCodec({ now: () => now, ttlSeconds: 60 });
    const authorization = await task13Authorization("job_history");
    const first = (await repositoryRead({
      kind: "job_history",
      repository: await repositoryFor(
        "job_history",
        new StubTask13RpcClient([
          {
            data: jobHistorySnapshot(authorization, [deliveredHistoryEvent()], {
              hasMore: true,
            }),
            error: null,
          },
        ]),
        codec
      ),
      authorization,
    })) as { page: { next_cursor: string } };
    const cursor = first.page.next_cursor;
    const cases: Array<{
      name: string;
      rawInput: Record<string, unknown>;
      permissionRevision?: string;
      before?: () => void;
      expectedCode: "JOB_HISTORY_INVALID" | "JOB_HISTORY_STALE";
    }> = [
      {
        name: "signature tamper",
        rawInput: {
          ...TASK_13_JOB_HISTORY_INPUT,
          cursor: `${cursor.slice(0, -1)}x`,
        },
        expectedCode: "JOB_HISTORY_INVALID",
      },
      {
        name: "query rebound",
        rawInput: {
          ...TASK_13_JOB_HISTORY_INPUT,
          query: "different customer history",
          cursor,
        },
        expectedCode: "JOB_HISTORY_INVALID",
      },
      {
        name: "permission stale",
        rawInput: { ...TASK_13_JOB_HISTORY_INPUT, cursor },
        permissionRevision: `sha256:${"d".repeat(64)}`,
        expectedCode: "JOB_HISTORY_STALE",
      },
      {
        name: "expired",
        rawInput: { ...TASK_13_JOB_HISTORY_INPUT, cursor },
        before: () => {
          now = new Date(Date.parse(TASK_13_GENERATED_AT) + 61_000);
        },
        expectedCode: "JOB_HISTORY_INVALID",
      },
    ];

    for (const fixture of cases) {
      now = new Date(TASK_13_GENERATED_AT);
      fixture.before?.();
      const actor = await task13ActorContext(
        "internal",
        undefined,
        fixture.permissionRevision ?? TASK_13_PERMISSION_REVISION
      );
      const continued = await task13Authorization(
        "job_history",
        fixture.rawInput,
        actor
      );
      const client = new StubTask13RpcClient([]);
      const repository = await repositoryFor("job_history", client, codec);

      await expect(
        repositoryRead({
          kind: "job_history",
          repository,
          authorization: continued,
        })
      ).rejects.toMatchObject({ code: fixture.expectedCode });
      expect(client.calls, fixture.name).toHaveLength(0);
    }
  });
});
