import { describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import type { OpsAgentReadCatalogueService } from "@/lib/agent-control-plane/services/read-catalogue-service";
import {
  createDayCloseoutRepository,
  type DayCloseoutRpcClient,
} from "../day-closeout-repository";
import { createDayCloseoutService } from "../day-closeout-service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "55555555-5555-4555-8555-555555555555";
const SCOPES = [
  "ops.correspondence.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.operations.prepare",
  "ops.operations.read",
  "ops.schedule.read",
  "ops.tasks.read",
] as const;
const PERMISSIONS = [
  "calendar.view",
  "email.view",
  "invoices.view",
  "pipeline.view",
  "projects.view",
  "reports.view",
  "tasks.view",
] as const;

function authority(
  permissions: readonly string[] = PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: USER_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [...permissions],
    effectivePermissions: permissions.map((permission) => ({
      permission,
      scope: "all",
    })),
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
}

async function fixture(permissions: readonly string[] = PERMISSIONS) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    authority(permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: USER_ID,
      companyId: COMPANY_ID,
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      validatedScopes: SCOPES,
      tokenId: "token-day-closeout",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "b".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-day-closeout",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION,
  });
  const rpc = vi.fn<DayCloseoutRpcClient["rpc"]>((functionName, args) => {
    if (functionName === "resolve_agent_day_closeout_timezone_as_system") {
      return Promise.resolve({ data: "America/Vancouver", error: null });
    }
    if (
      functionName === "inspect_agent_day_closeout_correspondence_as_system"
    ) {
      return Promise.resolve({
        data: {
          coverage_state: "unavailable",
          total_count: 1,
          readable_count: 0,
          unreadable_count: 1,
          fresh_at: "2026-08-31T03:00:00.000Z",
          normalization_revision: "ops.correspondence.normalized-text.v2",
        },
        error: null,
      });
    }
    if (
      functionName === "persist_agent_day_closeout_as_system" ||
      functionName === "persist_agent_day_closeout_routine_as_system"
    ) {
      return Promise.resolve({
        data: {
          run_id: RUN_ID,
          action_id: null,
          change_set_id: null,
          replayed: false,
          result: {
            ...(args.p_result_base as Record<string, unknown>),
            run_id: RUN_ID,
            filing: { kind: "not_required" },
          },
        },
        error: null,
      });
    }
    throw new Error(`unexpected RPC: ${functionName}`);
  });
  const readFailure = vi.fn(async () => {
    throw new Error("source offline");
  });
  const readService = {
    listScheduledJobs: readFailure,
    listJobReadinessIssues: readFailure,
    listWorkQueue: readFailure,
    listSalesDocuments: readFailure,
  } as unknown as OpsAgentReadCatalogueService;
  const service = createDayCloseoutService({
    readService,
    repository: createDayCloseoutRepository({ rpc }),
    authorityRepository: authorityClient.repository,
    now: () => new Date("2026-08-31T03:00:00.000Z"),
  });
  return {
    actor,
    authorityClient,
    authorityRepository: authorityClient.repository,
    rpc,
    readFailure,
    service,
  };
}

describe("day-closeout service", () => {
  it("threads its work deadline through current-authority reauthorization", async () => {
    const { actor, authorityClient, service } = await fixture();
    const signal = new AbortController().signal;

    await service.prepareDayCloseout(
      actor,
      {
        business_date: "2026-08-30",
        idempotency_key: "closeout-authority-deadline",
      },
      { signal }
    );

    expect(authorityClient.actorSignals).toEqual([signal]);
  });

  it("reports source failure as partial without inventing clear findings", async () => {
    const { actor, rpc, service } = await fixture();
    const result = await service.prepareDayCloseout(actor, {
      business_date: "2026-08-30",
      idempotency_key: "closeout-2026-08-30",
    });

    expect(result).toMatchObject({
      run_id: RUN_ID,
      business_date: "2026-08-30",
      timezone: "America/Vancouver",
      state: "partial",
      findings: [],
      communication_briefs: [],
      filing: { kind: "not_required" },
    });
    expect(result.components).toHaveLength(5);
    expect(
      result.components.every(
        (component) =>
          component.state === "not_evaluated" &&
          component.coverage.state === "unavailable"
      )
    ).toBe(true);
    const persist = rpc.mock.calls.find(
      ([name]) => name === "persist_agent_day_closeout_as_system"
    );
    expect(persist?.[1]).toMatchObject({
      p_actor_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_oauth_grant_id: GRANT_ID,
      p_oauth_client_id: CLIENT_ID,
      p_exposure_revision: "2026-08-30.mcp-exposure.v3",
      p_capability_manifest_revision:
        INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION,
    });
  });

  it("binds routine persistence to the exact claim and schedule occurrence", async () => {
    const { actor, rpc, service } = await fixture();

    await service.prepareDayCloseout(
      actor,
      {
        business_date: "2026-08-30",
        display_timezone: "America/Vancouver",
        idempotency_key:
          "routine:55555555-5555-4555-8555-555555555555:12:2026-08-31T03:00:00.000Z",
      },
      {
        routine: {
          routineId: "55555555-5555-4555-8555-555555555555",
          claimToken: "66666666-6666-4666-8666-666666666666",
          scheduledFor: "2026-08-31T03:00:00.000Z",
          scheduleRevision: 12,
        },
      }
    );

    expect(
      rpc.mock.calls.some(
        ([name]) => name === "persist_agent_day_closeout_as_system"
      )
    ).toBe(false);
    expect(
      rpc.mock.calls.find(
        ([name]) => name === "persist_agent_day_closeout_routine_as_system"
      )?.[1]
    ).toMatchObject({
      p_routine_id: "55555555-5555-4555-8555-555555555555",
      p_claim_token: "66666666-6666-4666-8666-666666666666",
      p_scheduled_for: "2026-08-31T03:00:00.000Z",
      p_schedule_revision: 12,
      p_actor_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_oauth_grant_id: GRANT_ID,
      p_oauth_client_id: CLIENT_ID,
    });
  });

  it("preserves a database authority denial during routine persistence", async () => {
    const { actor } = await fixture();
    const repository = createDayCloseoutRepository({
      rpc: () =>
        Promise.resolve({
          data: null,
          error: {
            code: "42501",
            message: "AGENT_DAY_CLOSEOUT_GRANT_STALE_OR_DENIED",
          },
        }),
    });

    await expect(
      repository.persistRoutine({
        actorContext: actor,
        businessDate: "2026-08-30",
        timezone: "America/Vancouver",
        idempotencyKey:
          "routine:55555555-5555-4555-8555-555555555555:12:2026-08-31T03:00:00.000Z",
        inputHash: "a".repeat(64),
        resultBase: {},
        routineId: "55555555-5555-4555-8555-555555555555",
        claimToken: "66666666-6666-4666-8666-666666666666",
        scheduledFor: "2026-08-31T03:00:00.000Z",
        scheduleRevision: 12,
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
  });

  it("rejects before any day-closeout RPC when one current owner permission is missing", async () => {
    const { actor, rpc, readFailure, service } = await fixture(
      PERMISSIONS.filter((permission) => permission !== "email.view")
    );
    await expect(
      service.prepareDayCloseout(actor, {
        idempotency_key: "closeout-missing-email-view",
      })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(readFailure).not.toHaveBeenCalled();
  });

  it("builds one server-defined closeout and excludes non-outstanding invoices", async () => {
    const { actor, authorityRepository } = await fixture();
    const actionId = "66666666-6666-4666-8666-666666666666";
    const changeSetId = "77777777-7777-4777-8777-777777777777";
    const sourceRevision = [{ domain: "work_queue", source_revision: 7 }];
    const readService = {
      listScheduledJobs: vi.fn(async () => ({
        data: { returned_occurrence_count: 1 },
        page: { has_more: false },
        freshness: {
          source_versions: [
            {
              source_domain: "schedule",
              source_type: "project_tasks",
              version: "5",
            },
          ],
        },
        evidence: [{ evidence_id: "schedule:tomorrow" }],
      })),
      listJobReadinessIssues: vi.fn(async () => ({
        data: {
          evaluated_candidate_count: 1,
          jobs: [
            {
              job_ref: { id: "88888888-8888-4888-8888-888888888888" },
              title: "Baxter deck",
              rules: [{ rule_code: "CREW_UNASSIGNED", status: "issue" }],
            },
          ],
        },
        page: { has_more: false },
        freshness: {
          source_versions: [
            {
              source_domain: "readiness",
              source_type: "project_tasks",
              version: "6",
            },
          ],
        },
        evidence: [{ evidence_id: "readiness:baxter" }],
      })),
      listWorkQueue: vi.fn(async () => ({
        items: [
          {
            source: "lead",
            job_ref: {
              kind: "opportunity",
              id: "99999999-9999-4999-8999-999999999999",
            },
            reason: "follow_up_due",
            title: "Fraser addition",
            attention_at: "2026-08-30T18:00:00.000Z",
          },
          {
            source: "correspondence",
            thread_ref: {
              kind: "email_thread",
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
            job_ref: {
              kind: "project",
              id: "88888888-8888-4888-8888-888888888888",
            },
            reason: "unresolved_correspondence",
            subject: "Gate code",
            snippet: "Please confirm the gate code.",
            attention_at: "2026-08-30T19:00:00.000Z",
          },
          {
            source: "task",
            task_ref: {
              kind: "task",
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            },
            job_ref: {
              kind: "project",
              id: "88888888-8888-4888-8888-888888888888",
            },
            reason: "overdue",
            title: "Order joists",
            attention_at: "2026-08-30T17:00:00.000Z",
          },
        ],
        evidence: [{ evidence_ref: "work-queue:page-1" }],
        collection_proof: {
          source_revisions: sourceRevision,
          read_at: "2026-08-31T03:00:00.000Z",
        },
        next_cursor: null,
      })),
      listSalesDocuments: vi.fn(async () => ({
        items: [
          {
            document_ref: {
              kind: "invoice",
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            },
            document_number: "INV-101",
            status: "past_due",
            due_date: "2026-08-15",
            balance_due: { amount_minor: 125_000, currency: "CAD" },
          },
          {
            document_ref: {
              kind: "invoice",
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            },
            document_number: "INV-102",
            status: "sent",
            due_date: "2026-09-15",
            balance_due: { amount_minor: 50_000, currency: "USD" },
          },
          {
            document_ref: {
              kind: "invoice",
              id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            },
            document_number: "DRAFT-103",
            status: "draft",
            due_date: "2026-09-30",
            balance_due: { amount_minor: 999_999, currency: "CAD" },
          },
        ],
        evidence: [{ evidence_ref: "invoices:page-1" }],
        collection_proof: {
          source_revisions: [
            { domain: "financial_documents", source_revision: 9 },
          ],
          read_at: "2026-08-31T03:00:00.000Z",
        },
        next_cursor: null,
      })),
    } as unknown as OpsAgentReadCatalogueService;
    const rpc = vi.fn<DayCloseoutRpcClient["rpc"]>((functionName, args) => {
      if (functionName === "resolve_agent_day_closeout_timezone_as_system") {
        return Promise.resolve({ data: "America/Vancouver", error: null });
      }
      if (
        functionName === "inspect_agent_day_closeout_correspondence_as_system"
      ) {
        return Promise.resolve({
          data: {
            coverage_state: "complete",
            total_count: 3,
            readable_count: 3,
            unreadable_count: 0,
            fresh_at: "2026-08-31T03:00:00.000Z",
            normalization_revision: "ops.correspondence.normalized-text.v2",
          },
          error: null,
        });
      }
      if (functionName === "persist_agent_day_closeout_as_system") {
        const resultBase = args.p_result_base as Record<string, unknown> & {
          findings: unknown[];
        };
        return Promise.resolve({
          data: {
            run_id: RUN_ID,
            action_id: actionId,
            change_set_id: changeSetId,
            replayed: false,
            result: {
              ...resultBase,
              run_id: RUN_ID,
              filing: {
                kind: "approval_required",
                action_id: actionId,
                change_set_id: changeSetId,
                approval_url: "/agent/queue",
                preview: {
                  business_date: "2026-08-30",
                  finding_count: resultBase.findings.length,
                  filing_statement: "File this day closeout inside OPS.",
                  truth_boundary: "No messages sent. No money moved.",
                  preview_sha256: `sha256:${"f".repeat(64)}`,
                },
              },
            },
          },
          error: null,
        });
      }
      throw new Error(`unexpected RPC: ${functionName}`);
    });
    const service = createDayCloseoutService({
      readService,
      repository: createDayCloseoutRepository({ rpc }),
      authorityRepository,
      now: () => new Date("2026-08-31T03:00:00.000Z"),
    });

    const result = await service.prepareDayCloseout(actor, {
      business_date: "2026-08-30",
      idempotency_key: "closeout-complete-2026-08-30",
    });

    expect(result.state).toBe("attention");
    expect(result.findings).toHaveLength(6);
    expect(result.communication_briefs).toHaveLength(1);
    expect(result.outstanding_balances).toEqual([
      { currency: "CAD", amount_minor: 125_000, invoice_count: 1 },
      { currency: "USD", amount_minor: 50_000, invoice_count: 1 },
    ]);
    expect(
      result.findings.some(
        (finding) =>
          finding.subject_ref.id === "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
      )
    ).toBe(false);
    expect(result.filing).toMatchObject({
      kind: "approval_required",
      action_id: actionId,
      change_set_id: changeSetId,
    });
  });
});
