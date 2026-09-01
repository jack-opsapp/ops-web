import { describe, expect, it, vi } from "vitest";

import {
  ALL_OVERVIEW_PERMISSIONS,
  overviewActorContext,
} from "../../overview/__tests__/overview-fixtures";
import { authorizeWorkQueueRead } from "../work-queue-authorization";
import { createWorkQueueCursorService } from "../work-queue-cursor";
import {
  workQueueCollectionProofRef,
  workQueueEntityProofRef,
  workQueueEvidenceRef,
  workQueueProofContext,
} from "../work-queue-proof";
import { createWorkQueueRepository } from "../work-queue-repository";
import { listWorkQueue } from "../work-queue-reads";
import type { WorkQueueCard } from "@/lib/agent-control-plane/contracts/work-queue";
import type { AuthorizedWorkQueueRead } from "../work-queue-authorization";
import type { WorkQueueCursorContext } from "../work-queue-cursor";
import {
  reduceWorkQueueAtomicPrefix,
  WorkQueueBudgetError,
} from "../work-queue-budget";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";

const READ_AT = "2026-08-29T23:30:00.000Z";
const REVISIONS = [
  { domain: "legacy_operational", source_revision: 11 },
  { domain: "tasks", source_revision: 7 },
] as const;

async function authorization() {
  return authorizeWorkQueueRead({
    query: { sources: ["task"] },
    actorContext: await overviewActorContext({
      scopes: ["ops.operations.read", "ops.tasks.read"],
      permissions: ALL_OVERVIEW_PERMISSIONS,
    }),
  });
}

const SOURCE_DOMAINS: Record<WorkQueueCard["source"], readonly string[]> = {
  task: ["legacy_operational", "tasks"],
  lead: ["legacy_operational", "work_queue"],
  correspondence: ["legacy_job_history", "legacy_operational", "work_queue"],
  commitment: ["work_queue"],
  match_review: ["work_queue"],
  schedule: ["legacy_operational"],
  financial_document: ["legacy_operational", "sales_documents"],
  payment: ["legacy_operational", "payments", "sales_documents"],
  expense: ["expenses"],
};

function snapshotFor(input: {
  authorization: AuthorizedWorkQueueRead;
  items: readonly WorkQueueCard[];
  revisions: readonly { domain: string; source_revision: number }[];
  slices: readonly {
    source: WorkQueueCard["source"];
    source_inspected: number;
    bounded_count: number;
    truncated: boolean;
  }[];
  hasMore: boolean;
  cursor: WorkQueueCursorContext | null;
}) {
  const sourceInspected = input.slices.reduce(
    (total, slice) => total + slice.source_inspected,
    0
  );
  const context = workQueueProofContext({
    authorization: input.authorization,
    readAt: READ_AT,
    sourceRevisions: input.revisions,
    sourceInspected,
    sourceSlices: input.slices,
    sourceHasMore: input.hasMore,
    cursor: input.cursor,
  });
  const byDomain = new Map(
    input.revisions.map((revision) => [revision.domain, revision])
  );
  const rows = input.items.map((item) => {
    const itemRevisions = SOURCE_DOMAINS[item.source].map(
      (domain) => byDomain.get(domain)!
    );
    const proof = workQueueEntityProofRef({
      context,
      item,
      itemSourceRevisions: itemRevisions,
    });
    const evidence = workQueueEvidenceRef({ context, item });
    return {
      item,
      item_source_revisions: itemRevisions,
      proof_ref: proof,
      evidence_ref: evidence,
      predecessor: {
        order: [
          item.priority,
          item.attention_at,
          item.source,
          item.queue_ref.id,
        ],
        tie_breaker: item.queue_ref.id,
      },
    };
  });
  return {
    company_id: input.authorization.actorContext.companyId,
    actor_user_id: input.authorization.actorContext.actorUserId,
    oauth_grant_id: input.authorization.oauthGrantId,
    oauth_client_id: input.authorization.oauthClientId,
    grant_revision: input.authorization.grantRevision,
    granted_scope_ceiling: input.authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      input.authorization.actorContext.permissionSnapshotRevision,
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    capability_manifest_revision:
      input.authorization.capabilityManifestRevision,
    selections: input.authorization.selections,
    authorized_sources: input.authorization.authorizedSources.map((source) => ({
      source: source.source,
      origin: source.origin,
      required_oauth_scopes: source.requiredOAuthScopes,
      resolved_permission_scopes: source.resolvedPermissionScopes,
      satisfied_permission_group_indexes:
        source.satisfiedPermissionGroupIndexes,
    })),
    warnings: input.authorization.warnings,
    read_at: READ_AT,
    source_revisions: input.revisions,
    source_inspected: sourceInspected,
    source_slices: input.slices,
    source_has_more: input.hasMore,
    rows,
    collection_proof_ref: workQueueCollectionProofRef({
      context,
      returnedCount: rows.length,
      hasMore: input.hasMore,
      children: rows.map((row) => ({
        queue_ref: row.item.queue_ref,
        proof_ref: row.proof_ref,
        evidence_ref: row.evidence_ref,
      })),
    }),
  };
}

describe("work queue repository and service", () => {
  it("accepts JSONB object key reordering but rejects authority drift", async () => {
    const auth = await authorization();
    const base = snapshotFor({
      authorization: auth,
      items: [],
      revisions: REVISIONS,
      slices: [
        {
          source: "task",
          source_inspected: 0,
          bounded_count: 0,
          truncated: false,
        },
      ],
      hasMore: false,
      cursor: null,
    });
    const scopes = base.authorized_sources[0]!.resolved_permission_scopes;
    const reversedScopes = Object.fromEntries(
      Object.entries(scopes).reverse()
    ) as typeof scopes;
    const rpc = vi.fn(() =>
      Promise.resolve({
        data: {
          ...base,
          authorized_sources: [
            {
              ...base.authorized_sources[0]!,
              resolved_permission_scopes: reversedScopes,
            },
          ],
        },
        error: null,
      })
    );
    const repository = createWorkQueueRepository({ rpc } as never);

    await expect(
      repository.list({ authorization: auth, cursor: null })
    ).resolves.toMatchObject({ state: "found", units: [] });

    for (const driftedScopes of [
      { ...scopes, [Object.keys(scopes)[0]!]: "own" },
      Object.fromEntries(Object.entries(scopes).slice(1)),
    ] as (typeof scopes)[]) {
      rpc.mockImplementationOnce(() =>
        Promise.resolve({
          data: {
            ...base,
            authorized_sources: [
              {
                ...base.authorized_sources[0]!,
                resolved_permission_scopes: driftedScopes,
              },
            ],
          },
          error: null,
        })
      );
      await expect(
        repository.list({ authorization: auth, cursor: null })
      ).rejects.toThrow("WORK_QUEUE_READ_FAILED");
    }
  });

  it("uses one RPC and preserves atomic item/proof/evidence coupling", async () => {
    const auth = await authorization();
    const item = {
      source: "task" as const,
      queue_ref: {
        kind: "task" as const,
        id: "77777777-7777-4777-8777-777777777777",
      },
      priority: 0,
      attention_at: READ_AT,
      task_ref: {
        kind: "task" as const,
        id: "77777777-7777-4777-8777-777777777777",
      },
      job_ref: {
        kind: "project" as const,
        id: "88888888-8888-4888-8888-888888888888",
      },
      reason: "overdue" as const,
      title: "Replace failed disconnect",
      content_kind: "untrusted_business_data" as const,
    };
    const context = workQueueProofContext({
      authorization: auth,
      readAt: READ_AT,
      sourceRevisions: REVISIONS,
      sourceInspected: 1,
      sourceSlices: [
        {
          source: "task",
          source_inspected: 1,
          bounded_count: 1,
          truncated: false,
        },
      ],
      sourceHasMore: false,
      cursor: null,
    });
    const proof = workQueueEntityProofRef({
      context,
      item,
      itemSourceRevisions: REVISIONS,
    });
    const evidence = workQueueEvidenceRef({ context, item });
    const snapshot = {
      company_id: auth.actorContext.companyId,
      actor_user_id: auth.actorContext.actorUserId,
      oauth_grant_id: auth.oauthGrantId,
      oauth_client_id: auth.oauthClientId,
      grant_revision: auth.grantRevision,
      granted_scope_ceiling: auth.grantedScopeCeiling,
      permission_snapshot_revision:
        auth.actorContext.permissionSnapshotRevision,
      capability_id: auth.capabilityId,
      capability_revision: auth.capabilityRevision,
      capability_manifest_revision: auth.capabilityManifestRevision,
      selections: auth.selections,
      authorized_sources: auth.authorizedSources.map((source) => ({
        source: source.source,
        origin: source.origin,
        required_oauth_scopes: source.requiredOAuthScopes,
        resolved_permission_scopes: source.resolvedPermissionScopes,
        satisfied_permission_group_indexes:
          source.satisfiedPermissionGroupIndexes,
      })),
      warnings: [],
      read_at: READ_AT,
      source_revisions: REVISIONS,
      source_inspected: 1,
      source_slices: [
        {
          source: "task",
          source_inspected: 1,
          bounded_count: 1,
          truncated: false,
        },
      ],
      source_has_more: false,
      rows: [
        {
          item,
          item_source_revisions: REVISIONS,
          proof_ref: proof,
          evidence_ref: evidence,
          predecessor: {
            order: [0, READ_AT, "task", item.queue_ref.id],
            tie_breaker: item.queue_ref.id,
          },
        },
      ],
      collection_proof_ref: workQueueCollectionProofRef({
        context,
        returnedCount: 1,
        hasMore: false,
        children: [
          {
            queue_ref: item.queue_ref,
            proof_ref: proof,
            evidence_ref: evidence,
          },
        ],
      }),
    };
    const rpc = vi.fn<() => Promise<{ data: unknown; error: unknown }>>(() =>
      Promise.resolve({ data: snapshot, error: null })
    );
    const repository = createWorkQueueRepository({ rpc } as never);
    const result = await listWorkQueue({
      authorization: auth,
      repository,
      cursors: createWorkQueueCursorService({
        keyId: "work-queue-test",
        key: new Uint8Array(32).fill(7),
      }),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([item]);
    expect(result.item_proofs[0]!.proof_ref).toBe(proof);
    expect(result.evidence[0]!.evidence_ref).toBe(evidence);
    expect(result.collection_proof.returned_count).toBe(1);

    const extraRevisions = [
      ...REVISIONS,
      { domain: "work_queue", source_revision: 3 },
    ] as const;
    const extraContext = workQueueProofContext({
      authorization: auth,
      readAt: READ_AT,
      sourceRevisions: extraRevisions,
      sourceInspected: 1,
      sourceSlices: snapshot.source_slices,
      sourceHasMore: false,
      cursor: null,
    });
    const extraProof = workQueueEntityProofRef({
      context: extraContext,
      item,
      itemSourceRevisions: REVISIONS,
    });
    const extraEvidence = workQueueEvidenceRef({ context: extraContext, item });
    rpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          ...snapshot,
          source_revisions: extraRevisions,
          rows: [
            {
              ...snapshot.rows[0]!,
              proof_ref: extraProof,
              evidence_ref: extraEvidence,
            },
          ],
          collection_proof_ref: workQueueCollectionProofRef({
            context: extraContext,
            returnedCount: 1,
            hasMore: false,
            children: [
              {
                queue_ref: item.queue_ref,
                proof_ref: extraProof,
                evidence_ref: extraEvidence,
              },
            ],
          }),
        },
        error: null,
      })
    );
    await expect(
      repository.list({ authorization: auth, cursor: null })
    ).rejects.toThrow("WORK_QUEUE_READ_FAILED");

    const missingItemRevisions = [REVISIONS[0]] as const;
    const missingProof = workQueueEntityProofRef({
      context,
      item,
      itemSourceRevisions: missingItemRevisions,
    });
    rpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          ...snapshot,
          rows: [
            {
              ...snapshot.rows[0]!,
              item_source_revisions: missingItemRevisions,
              proof_ref: missingProof,
            },
          ],
          collection_proof_ref: workQueueCollectionProofRef({
            context,
            returnedCount: 1,
            hasMore: false,
            children: [
              {
                queue_ref: item.queue_ref,
                proof_ref: missingProof,
                evidence_ref: evidence,
              },
            ],
          }),
        },
        error: null,
      })
    );
    await expect(
      repository.list({ authorization: auth, cursor: null })
    ).rejects.toThrow("WORK_QUEUE_READ_FAILED");

    rpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          ...snapshot,
          rows: [snapshot.rows[0]!, snapshot.rows[0]!],
          collection_proof_ref: workQueueCollectionProofRef({
            context,
            returnedCount: 2,
            hasMore: false,
            children: [0, 1].map(() => ({
              queue_ref: item.queue_ref,
              proof_ref: proof,
              evidence_ref: evidence,
            })),
          }),
        },
        error: null,
      })
    );
    await expect(
      repository.list({ authorization: auth, cursor: null })
    ).rejects.toThrow("WORK_QUEUE_READ_FAILED");
  });

  it("performs zero repository reads when explicit preauthorization fails", async () => {
    const actor = await overviewActorContext({
      scopes: ["ops.operations.read"],
      permissions: [],
    });
    const rpc = vi.fn();
    expect(() =>
      authorizeWorkQueueRead({
        query: { sources: ["task"] },
        actorContext: actor,
      })
    ).toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("binds admin expense authority to the same two exact SQL groups", async () => {
    const actorContext = await resolveActorContext({
      principal: validatedMcpPrincipalFixture({
        actorUserId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        oauthGrantId: "33333333-3333-4333-8333-333333333333",
        oauthClientId: "44444444-4444-4444-8444-444444444444",
        validatedScopes: ["ops.expenses.read", "ops.operations.read"],
        tokenId: "66666666-6666-4666-8666-666666666666",
        issuer: "https://app.opsapp.co",
        audience: "https://app.opsapp.co/api/mcp",
        grantRevision: "b".repeat(32),
      }),
      authorityRepository: trustedAuthorityRepositoryForSnapshot({
        actorUserId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        isActive: true,
        isAdmin: true,
        roleIds: ["55555555-5555-4555-8555-555555555555"],
        configuredPermissions: [],
        effectivePermissions: [],
        permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
      }),
      requestId: "request-work-queue-admin",
      policyRevision: "actor-policy:v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
    });
    const admin = authorizeWorkQueueRead({
      query: { sources: ["expense"] },
      actorContext,
    });
    expect(admin.authorizedSources[0]).toMatchObject({
      resolvedPermissionScopes: {
        "expenses.approve": "all",
        "expenses.view": "all",
      },
      satisfiedPermissionGroupIndexes: [0, 1],
    });
  });

  it("maps only exact Task17 bound and stale database failures", async () => {
    const auth = await authorization();
    for (const error of [
      { code: "54000", message: "unrelated_program_limit" },
      { code: "40001", message: "unrelated_serialization" },
    ]) {
      const repository = createWorkQueueRepository({
        rpc: vi.fn(() => Promise.resolve({ data: null, error })),
      } as never);
      await expect(
        repository.list({ authorization: auth, cursor: null })
      ).rejects.toThrow("WORK_QUEUE_READ_FAILED");
    }
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_work_queue_source_query_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_work_queue_read_stale" }, "stale"],
    ] as const) {
      const repository = createWorkQueueRepository({
        rpc: vi.fn(() => Promise.resolve({ data: null, error })),
      } as never);
      await expect(
        repository.list({ authorization: auth, cursor: null })
      ).resolves.toEqual({ state });
    }
  });

  it("distinguishes an irreducible wire budget from malformed atomic proof", () => {
    const item = {
      source: "task" as const,
      queue_ref: {
        kind: "task" as const,
        id: "77777777-7777-4777-8777-777777777777",
      },
      priority: 0,
      attention_at: READ_AT,
      task_ref: {
        kind: "task" as const,
        id: "77777777-7777-4777-8777-777777777777",
      },
      job_ref: {
        kind: "project" as const,
        id: "88888888-8888-4888-8888-888888888888",
      },
      reason: "overdue" as const,
      title: "Replace failed disconnect",
      content_kind: "untrusted_business_data" as const,
    };
    const proof = {
      proof_ref: `ops_proof:v1:${"1".repeat(64)}`,
      read_at: READ_AT,
      source_revisions: REVISIONS,
    };
    const evidence = {
      evidence_ref: `ops_evidence:v1:${"2".repeat(64)}`,
      source_domain: "work_queue" as const,
      source_type: "task",
      occurred_at: READ_AT,
    };
    const run = (rawProof: unknown, warnings: readonly unknown[] = []) =>
      reduceWorkQueueAtomicPrefix({
        warnings,
        units: [{ item, proof: rawProof, evidence: [evidence] }],
        sourceHasMore: false,
        collectionSourceRevisions: REVISIONS,
        makeCollectionProof: (returnedCount, hasMore) => ({
          proof_ref: `ops_proof:v1:${"3".repeat(64)}`,
          read_at: READ_AT,
          source_revisions: REVISIONS,
          returned_count: returnedCount,
          has_more: hasMore,
        }),
      });
    expect(() => run(proof, [{ padding: "x".repeat(60_000) }])).toThrowError(
      expect.objectContaining<Partial<WorkQueueBudgetError>>({
        code: "BUDGET_EXCEEDED",
      })
    );
    expect(() => run({ ...proof, proof_ref: "forged" })).toThrowError(
      expect.objectContaining<Partial<WorkQueueBudgetError>>({
        code: "INVALID",
      })
    );
  });

  it("walks a real 26-card mixed-source union with a signed cursor", async () => {
    const actor = await overviewActorContext({
      scopes: ["ops.jobs.read", "ops.operations.read", "ops.tasks.read"],
      permissions: ALL_OVERVIEW_PERMISSIONS,
    });
    const pageOneAuthorization = authorizeWorkQueueRead({
      query: { sources: ["task", "lead"] },
      actorContext: actor,
    });
    const taskItems = Array.from({ length: 24 }, (_, index) => {
      const id = `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      return {
        source: "task" as const,
        queue_ref: { kind: "task" as const, id },
        priority: 0,
        attention_at: `2026-08-29T23:${String(index).padStart(2, "0")}:00.000Z`,
        task_ref: { kind: "task" as const, id },
        job_ref: {
          kind: "project" as const,
          id: "88888888-8888-4888-8888-888888888888",
        },
        reason: "overdue" as const,
        title: `Task ${index + 1}`,
        content_kind: "untrusted_business_data" as const,
      };
    });
    const leadItems = [1, 2].map((index) => {
      const id = `90000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      return {
        source: "lead" as const,
        queue_ref: { kind: "lead" as const, id },
        priority: 1,
        attention_at: `2026-08-29T23:${String(24 + index).padStart(2, "0")}:00.000Z`,
        job_ref: { kind: "opportunity" as const, id },
        reason: "follow_up_due" as const,
        content_kind: "untrusted_business_data" as const,
      };
    });
    const revisions = [
      { domain: "legacy_operational", source_revision: 11 },
      { domain: "tasks", source_revision: 7 },
      { domain: "work_queue", source_revision: 13 },
    ];
    const slices = [
      {
        source: "task" as const,
        source_inspected: 24,
        bounded_count: 24,
        truncated: false,
      },
      {
        source: "lead" as const,
        source_inspected: 2,
        bounded_count: 2,
        truncated: false,
      },
    ];
    const cursors = createWorkQueueCursorService({
      keyId: "work-queue-pagination",
      key: new Uint8Array(32).fill(12),
    });
    const firstSnapshot = snapshotFor({
      authorization: pageOneAuthorization,
      items: [...taskItems, leadItems[0]!],
      revisions,
      slices,
      hasMore: true,
      cursor: null,
    });
    const firstRepository = createWorkQueueRepository({
      rpc: vi.fn(() => Promise.resolve({ data: firstSnapshot, error: null })),
    } as never);
    const first = await listWorkQueue({
      authorization: pageOneAuthorization,
      repository: firstRepository,
      cursors,
    });
    expect(first.items).toHaveLength(25);
    expect(first.next_cursor?.length).toBeGreaterThan(512);
    expect(() => {
      (first.items[0]!.queue_ref as { id: string }).id = "mutated";
    }).toThrow();

    const pageTwoAuthorization = authorizeWorkQueueRead({
      query: { sources: ["task", "lead"], cursor: first.next_cursor },
      actorContext: actor,
    });
    const cursor = cursors.decode({
      authorization: pageTwoAuthorization,
      token: first.next_cursor!,
    });
    const secondSnapshot = snapshotFor({
      authorization: pageTwoAuthorization,
      items: [leadItems[1]!],
      revisions,
      slices,
      hasMore: false,
      cursor,
    });
    const secondRepository = createWorkQueueRepository({
      rpc: vi.fn(() => Promise.resolve({ data: secondSnapshot, error: null })),
    } as never);
    const second = await listWorkQueue({
      authorization: pageTwoAuthorization,
      repository: secondRepository,
      cursors,
    });
    expect(second.items.map((item) => item.queue_ref.id)).toEqual([
      leadItems[1]!.queue_ref.id,
    ]);
    expect(second.next_cursor).toBeNull();
  });
});
