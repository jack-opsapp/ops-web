import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  authorizeCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { verifiedInternalPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "../capability-manifest";

const TASK_13_SCHEMA_REVISION = "2026-08-14.v1" as const;
const TASK_13_MANIFEST_REVISION = "2026-08-14.capability-manifest.v6" as const;
const TASK_13_CAPABILITIES = [
  "list_customer_jobs",
  "get_job_summary",
  "search_job_history",
  "get_correspondence_evidence",
] as const;

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const OPPORTUNITY_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const TURN_ID = "66666666-6666-4666-8666-666666666666";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;

type ScopedPermission = Readonly<{
  permission: string;
  scope: "all" | "assigned" | "own";
}>;

const ALL_PERMISSIONS: readonly ScopedPermission[] = [
  { permission: "calendar.view", scope: "all" },
  { permission: "clients.view", scope: "all" },
  { permission: "estimates.view", scope: "all" },
  { permission: "inbox.view", scope: "all" },
  { permission: "invoices.view", scope: "all" },
  { permission: "photos.view", scope: "all" },
  { permission: "pipeline.view", scope: "all" },
  { permission: "projects.view", scope: "all" },
  { permission: "projects.view_financials", scope: "all" },
  { permission: "tasks.view", scope: "all" },
];

function authority(
  effectivePermissions: readonly ScopedPermission[] = ALL_PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["77777777-7777-4777-8777-777777777777"],
    configuredPermissions: effectivePermissions.map(
      ({ permission }) => permission
    ),
    effectivePermissions,
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function actorContext(
  effectivePermissions: readonly ScopedPermission[] = ALL_PERMISSIONS
) {
  return await resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-task13-registry",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(effectivePermissions)
    ),
    requestId: "request-task13-registry",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

function requirementLabels(
  capability: ReturnType<typeof resolveCapabilityAuthorization>
) {
  return capability.variants.map((variant) => ({
    key: variant.key,
    oauth: [...variant.policy.requiredOAuthScopes].sort(),
    groups: variant.policy.permissionRequirementGroups.map((group) =>
      group
        .map(
          (requirement) =>
            `${requirement.permission}:${[...requirement.allowedScopes]
              .sort()
              .join(",")}`
        )
        .sort()
    ),
  }));
}

async function authorizeAllBeforeRead(input: {
  capabilityId: (typeof TASK_13_CAPABILITIES)[number];
  rawInput: unknown;
  effectivePermissions?: readonly ScopedPermission[];
  read: () => void;
}) {
  const actor = await actorContext(input.effectivePermissions);
  const resolved = resolveCapabilityAuthorization(
    input.capabilityId,
    input.rawInput
  );
  const authorizations = resolved.variants.map((variant) =>
    authorizeCapability({ actorContext: actor, policy: variant.policy })
  );
  input.read();
  return authorizations;
}

describe("Task 13 manifest v6 availability", () => {
  it("exposes the complete Task 13 bundle to internal callers only", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(TASK_13_MANIFEST_REVISION);
    for (const capabilityId of TASK_13_CAPABILITIES) {
      const entry = getCapabilityManifestEntry(capabilityId);
      expect(entry.schemaRevision).toBe(TASK_13_SCHEMA_REVISION);
      expect(entry.availability).toEqual({
        implementation: "available",
        externalExposure: "disabled",
      });
      expect(entry.bounds.maxOutputCharacters).toBe(60_000);
      expect(entry.evidencePolicy).toMatchObject({
        output: "required",
        promptSafeOutput: true,
        untrustedExternalContent: "structured_and_marked",
      });
    }
  });
});

describe("list_customer_jobs conditional authorization", () => {
  it("selects customer plus every requested job-kind policy", () => {
    const both = resolveCapabilityAuthorization("list_customer_jobs", {
      customer_ref: { kind: "client", id: CLIENT_ID },
    });
    expect(requirementLabels(both)).toEqual([
      {
        key: "customer",
        oauth: ["ops.customers.read"],
        groups: [["clients.view:all,assigned"]],
      },
      {
        key: "opportunity_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["pipeline.view:all,assigned"]],
      },
      {
        key: "project_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["projects.view:all,assigned"]],
      },
    ]);

    const opportunitiesOnly = resolveCapabilityAuthorization(
      "list_customer_jobs",
      {
        customer_ref: { kind: "client", id: CLIENT_ID },
        job_kinds: ["opportunity"],
      }
    );
    expect(opportunitiesOnly.variants.map(({ key }) => key)).toEqual([
      "customer",
      "opportunity_jobs",
    ]);
  });

  it("does not let one OR permission branch authorize a mixed-kind read", async () => {
    let reads = 0;
    const pipelineOnly = ALL_PERMISSIONS.filter(
      ({ permission }) => permission !== "projects.view"
    );
    await expect(
      authorizeAllBeforeRead({
        capabilityId: "list_customer_jobs",
        rawInput: {
          customer_ref: { kind: "client", id: CLIENT_ID },
          job_kinds: ["opportunity", "project"],
        },
        effectivePermissions: pipelineOnly,
        read: () => {
          reads += 1;
        },
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(reads).toBe(0);
  });
});

describe("get_job_summary section authorization", () => {
  it("selects all project section/rule/component policies without caller-policy omission", () => {
    const resolved = resolveCapabilityAuthorization("get_job_summary", {
      job_ref: { kind: "project", id: PROJECT_ID },
      sections: [
        "identity",
        "schedule",
        "readiness",
        "participants",
        "financials",
        "activity",
        "conversation",
      ],
      readiness_rule_codes: [
        "SITE_PHOTOS_MISSING",
        "CUSTOMER_RECORD_UNRESOLVED",
        "SCHEDULE_UNCONFIRMED",
        "CREW_UNASSIGNED",
        "ADDRESS_INCOMPLETE",
      ],
      financial_components: ["estimate_rollup", "invoice_rollup"],
    });

    expect(requirementLabels(resolved)).toEqual([
      {
        key: "project",
        oauth: ["ops.jobs.read"],
        groups: [["projects.view:all,assigned"]],
      },
      {
        key: "project:schedule",
        oauth: ["ops.schedule.read"],
        groups: [["calendar.view:all,own", "tasks.view:all,assigned"]],
      },
      {
        key: "project:readiness:site_photos",
        oauth: ["ops.photos.read"],
        groups: [["photos.view:all,assigned"]],
      },
      {
        key: "project:readiness:customer",
        oauth: ["ops.customers.read"],
        groups: [["clients.view:all,assigned"]],
      },
      {
        key: "project:readiness:schedule",
        oauth: ["ops.schedule.read"],
        groups: [["calendar.view:all,own", "tasks.view:all,assigned"]],
      },
      {
        key: "project:participants",
        oauth: [
          "ops.correspondence.read",
          "ops.customer_contacts.read",
          "ops.customers.read",
          "ops.jobs.read",
        ],
        groups: [
          [
            "clients.view:all,assigned",
            "inbox.view:all,assigned,own",
            "projects.view:all,assigned",
          ],
        ],
      },
      {
        key: "project:financials:estimate_rollup",
        oauth: ["ops.financials.read"],
        groups: [
          ["estimates.view:all,assigned", "projects.view_financials:all"],
        ],
      },
      {
        key: "project:financials:invoice_rollup",
        oauth: ["ops.financials.read"],
        groups: [
          ["invoices.view:all,assigned", "projects.view_financials:all"],
        ],
      },
      {
        key: "project:activity",
        oauth: ["ops.schedule.read"],
        groups: [["calendar.view:all,own", "tasks.view:all,assigned"]],
      },
      {
        key: "project:conversation",
        oauth: ["ops.correspondence.read"],
        groups: [["inbox.view:all,assigned,own"]],
      },
    ]);
  });

  it("selects only opportunity-safe sections and the exact estimate permission", () => {
    const resolved = resolveCapabilityAuthorization("get_job_summary", {
      job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
      sections: [
        "identity",
        "participants",
        "financials",
        "activity",
        "conversation",
      ],
      financial_components: ["estimate_rollup"],
    });
    expect(resolved.variants.map(({ key }) => key)).toEqual([
      "opportunity",
      "opportunity:participants",
      "opportunity:financials:estimate_rollup",
      "opportunity:activity",
      "opportunity:conversation",
    ]);
    expect(
      requirementLabels(resolved).find(
        ({ key }) => key === "opportunity:financials:estimate_rollup"
      )
    ).toEqual({
      key: "opportunity:financials:estimate_rollup",
      oauth: ["ops.financials.read"],
      groups: [["estimates.view:all,assigned"]],
    });
    expect(
      requirementLabels(resolved).find(
        ({ key }) => key === "opportunity:activity"
      )
    ).toEqual({
      key: "opportunity:activity",
      oauth: ["ops.schedule.read"],
      groups: [
        [
          "calendar.view:all,own",
          "projects.view:all,assigned",
          "tasks.view:all,assigned",
        ],
      ],
    });
  });

  it("keeps address-only readiness on base project authority", () => {
    const resolved = resolveCapabilityAuthorization("get_job_summary", {
      job_ref: { kind: "project", id: PROJECT_ID },
      sections: ["readiness"],
      readiness_rule_codes: ["ADDRESS_INCOMPLETE"],
    });
    expect(requirementLabels(resolved)).toEqual([
      {
        key: "project",
        oauth: ["ops.jobs.read"],
        groups: [["projects.view:all,assigned"]],
      },
    ]);
  });

  it("fails activity before reading without schedule authority", async () => {
    let reads = 0;
    const withoutCalendar = ALL_PERMISSIONS.filter(
      ({ permission }) => permission !== "calendar.view"
    );
    await expect(
      authorizeAllBeforeRead({
        capabilityId: "get_job_summary",
        rawInput: {
          job_ref: { kind: "project", id: PROJECT_ID },
          sections: ["activity"],
        },
        effectivePermissions: withoutCalendar,
        read: () => {
          reads += 1;
        },
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(reads).toBe(0);
  });

  it("fails the whole call before reading when one selected section is unauthorized", async () => {
    let reads = 0;
    const withoutInvoices = ALL_PERMISSIONS.filter(
      ({ permission }) => permission !== "invoices.view"
    );
    await expect(
      authorizeAllBeforeRead({
        capabilityId: "get_job_summary",
        rawInput: {
          job_ref: { kind: "project", id: PROJECT_ID },
          sections: ["identity", "financials"],
          financial_components: ["estimate_rollup", "invoice_rollup"],
        },
        effectivePermissions: withoutInvoices,
        read: () => {
          reads += 1;
        },
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(reads).toBe(0);
  });

  it("requires the complete Task 12 participant graph before any summary read", async () => {
    let reads = 0;
    const withoutInbox = ALL_PERMISSIONS.filter(
      ({ permission }) => permission !== "inbox.view"
    );
    await expect(
      authorizeAllBeforeRead({
        capabilityId: "get_job_summary",
        rawInput: {
          job_ref: { kind: "project", id: PROJECT_ID },
          sections: ["participants"],
        },
        effectivePermissions: withoutInbox,
        read: () => {
          reads += 1;
        },
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(reads).toBe(0);
  });
});

describe("search_job_history purpose-minimized authorization", () => {
  it("selects customer, every job kind, and only requested source policies", () => {
    const resolved = resolveCapabilityAuthorization("search_job_history", {
      query: "change order approved",
      scope: {
        kind: "customer",
        customer_ref: { kind: "client", id: CLIENT_ID },
        job_kinds: ["opportunity", "project"],
      },
      source_types: [
        "delivered_correspondence",
        "current_memory_summary",
        "job_status_event",
        "task_event",
        "estimate_document",
      ],
    });
    expect(requirementLabels(resolved)).toEqual([
      {
        key: "customer_scope",
        oauth: ["ops.customers.read"],
        groups: [["clients.view:all,assigned"]],
      },
      {
        key: "opportunity_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["pipeline.view:all,assigned"]],
      },
      {
        key: "project_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["projects.view:all,assigned"]],
      },
      {
        key: "correspondence_sources",
        oauth: ["ops.correspondence.read"],
        groups: [["inbox.view:all,assigned,own"]],
      },
      {
        key: "task_event",
        oauth: ["ops.schedule.read"],
        groups: [
          [
            "calendar.view:all,own",
            "projects.view:all,assigned",
            "tasks.view:all,assigned",
          ],
        ],
      },
      {
        key: "opportunity:estimate_document",
        oauth: ["ops.financials.read"],
        groups: [["estimates.view:all,assigned"]],
      },
      {
        key: "project:estimate_document",
        oauth: ["ops.financials.read"],
        groups: [
          ["estimates.view:all,assigned", "projects.view_financials:all"],
        ],
      },
    ]);
  });

  it("does not require customer permission for an explicit job scope", () => {
    const resolved = resolveCapabilityAuthorization("search_job_history", {
      query: "accepted",
      scope: {
        kind: "jobs",
        job_refs: [{ kind: "project", id: PROJECT_ID }],
      },
      source_types: ["job_status_event"],
    });
    expect(requirementLabels(resolved)).toEqual([
      {
        key: "project_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["projects.view:all,assigned"]],
      },
    ]);
  });

  it("authorizes every selected source before search execution", async () => {
    let reads = 0;
    const withoutEstimate = ALL_PERMISSIONS.filter(
      ({ permission }) => permission !== "estimates.view"
    );
    await expect(
      authorizeAllBeforeRead({
        capabilityId: "search_job_history",
        rawInput: {
          query: "approved estimate",
          scope: {
            kind: "jobs",
            job_refs: [{ kind: "project", id: PROJECT_ID }],
          },
          source_types: ["delivered_correspondence", "estimate_document"],
        },
        effectivePermissions: withoutEstimate,
        read: () => {
          reads += 1;
        },
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(reads).toBe(0);
  });

  it("requires project financial visibility only when estimate search can inspect projects", async () => {
    const opportunityOnly = resolveCapabilityAuthorization(
      "search_job_history",
      {
        query: "approved estimate",
        scope: {
          kind: "jobs",
          job_refs: [{ kind: "opportunity", id: OPPORTUNITY_ID }],
        },
        source_types: ["estimate_document"],
      }
    );
    expect(opportunityOnly.variants.map(({ key }) => key)).toEqual([
      "opportunity_jobs",
      "opportunity:estimate_document",
    ]);

    let reads = 0;
    const withoutProjectFinancials = ALL_PERMISSIONS.filter(
      ({ permission }) => permission !== "projects.view_financials"
    );
    await expect(
      authorizeAllBeforeRead({
        capabilityId: "search_job_history",
        rawInput: {
          query: "approved estimate",
          scope: {
            kind: "jobs",
            job_refs: [{ kind: "project", id: PROJECT_ID }],
          },
          source_types: ["estimate_document"],
        },
        effectivePermissions: withoutProjectFinancials,
        read: () => {
          reads += 1;
        },
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(reads).toBe(0);
  });
});

describe("get_correspondence_evidence job-bound authorization", () => {
  it("requires both exact job-kind and correspondence policies", () => {
    const resolved = resolveCapabilityAuthorization(
      "get_correspondence_evidence",
      {
        job_ref: { kind: "project", id: PROJECT_ID },
        evidence_ids: [`job_conversation_turn:${TURN_ID}`],
        mode: "full_text",
      }
    );
    expect(requirementLabels(resolved)).toEqual([
      {
        key: "project_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["projects.view:all,assigned"]],
      },
      {
        key: "correspondence_evidence",
        oauth: ["ops.correspondence.read"],
        groups: [["inbox.view:all,assigned,own"]],
      },
    ]);
  });

  it("cannot read a known evidence ID with inbox authority but no job authority", async () => {
    let reads = 0;
    const withoutProjects = ALL_PERMISSIONS.filter(
      ({ permission }) => permission !== "projects.view"
    );
    await expect(
      authorizeAllBeforeRead({
        capabilityId: "get_correspondence_evidence",
        rawInput: {
          job_ref: { kind: "project", id: PROJECT_ID },
          evidence_ids: [`job_conversation_turn:${TURN_ID}`],
          mode: "excerpt",
        },
        effectivePermissions: withoutProjects,
        read: () => {
          reads += 1;
        },
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(reads).toBe(0);
  });
});

describe("Task 13 nominal domain-read proofs", () => {
  it("mints one transport-independent nominal proof for every exact authorization set", async () => {
    const actor = await actorContext();
    const cases: readonly {
      readonly capabilityId: (typeof TASK_13_CAPABILITIES)[number];
      readonly rawInput: unknown;
      readonly authorize: (
        authorizations: AuthorizedCapability[]
      ) => Promise<readonly [unknown, (value: unknown) => boolean]>;
    }[] = [
      {
        capabilityId: "list_customer_jobs" as const,
        rawInput: {
          customer_ref: { kind: "client", id: CLIENT_ID },
          job_kinds: ["opportunity", "project"],
        },
        authorize: async (authorizations) => {
          const module =
            await import("../../services/customer-jobs-authorization");
          const proof = module.authorizeCustomerJobsRead({
            authorizations,
            rawInput: {
              customer_ref: { kind: "client", id: CLIENT_ID },
              job_kinds: ["opportunity", "project"],
            },
          });
          return [proof, module.isAuthorizedCustomerJobsRead] as const;
        },
      },
      {
        capabilityId: "get_job_summary" as const,
        rawInput: {
          job_ref: { kind: "project", id: PROJECT_ID },
          sections: ["identity", "financials"],
          financial_components: ["estimate_rollup", "invoice_rollup"],
        },
        authorize: async (authorizations) => {
          const module =
            await import("../../services/job-summary-authorization");
          const proof = module.authorizeJobSummaryRead({
            authorizations,
            rawInput: {
              job_ref: { kind: "project", id: PROJECT_ID },
              sections: ["identity", "financials"],
              financial_components: ["estimate_rollup", "invoice_rollup"],
            },
          });
          return [proof, module.isAuthorizedJobSummaryRead] as const;
        },
      },
      {
        capabilityId: "search_job_history" as const,
        rawInput: {
          query: "approved",
          scope: {
            kind: "jobs",
            job_refs: [{ kind: "project", id: PROJECT_ID }],
          },
          source_types: ["delivered_correspondence", "estimate_document"],
        },
        authorize: async (authorizations) => {
          const module =
            await import("../../services/job-history-authorization");
          const proof = module.authorizeJobHistoryRead({
            authorizations,
            rawInput: {
              query: "approved",
              scope: {
                kind: "jobs",
                job_refs: [{ kind: "project", id: PROJECT_ID }],
              },
              source_types: ["delivered_correspondence", "estimate_document"],
            },
          });
          return [proof, module.isAuthorizedJobHistoryRead] as const;
        },
      },
      {
        capabilityId: "get_correspondence_evidence" as const,
        rawInput: {
          job_ref: { kind: "project", id: PROJECT_ID },
          evidence_ids: [`job_conversation_turn:${TURN_ID}`],
        },
        authorize: async (authorizations) => {
          const module =
            await import("../../services/correspondence-evidence-page-authorization");
          const proof = module.authorizeCorrespondenceEvidencePageRead({
            authorizations,
            rawInput: {
              job_ref: { kind: "project", id: PROJECT_ID },
              evidence_ids: [`job_conversation_turn:${TURN_ID}`],
            },
          });
          return [
            proof,
            module.isAuthorizedCorrespondenceEvidencePageRead,
          ] as const;
        },
      },
    ];

    for (const testCase of cases) {
      const resolved = resolveCapabilityAuthorization(
        testCase.capabilityId,
        testCase.rawInput
      );
      const authorizations = resolved.variants.map((variant) =>
        authorizeCapability({ actorContext: actor, policy: variant.policy })
      );
      const [proof, isNominal] = await testCase.authorize(authorizations);
      expect(isNominal(proof)).toBe(true);
      expect(isNominal(Object.assign({}, proof as object))).toBe(false);
      expect(proof).toMatchObject({
        capabilityId: testCase.capabilityId,
        capabilityManifestRevision: TASK_13_MANIFEST_REVISION,
      });
    }
  });

  it("rejects an incomplete authorization set before minting a summary proof", async () => {
    const actor = await actorContext();
    const rawInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      sections: ["identity", "financials"],
      financial_components: ["estimate_rollup", "invoice_rollup"],
    };
    const resolved = resolveCapabilityAuthorization(
      "get_job_summary",
      rawInput
    );
    const authorizations = resolved.variants.map((variant) =>
      authorizeCapability({ actorContext: actor, policy: variant.policy })
    );
    const { authorizeJobSummaryRead } =
      await import("../../services/job-summary-authorization");
    expect(() =>
      authorizeJobSummaryRead({
        authorizations: authorizations.slice(0, -1),
        rawInput,
      })
    ).toThrow(ActorAccessError);
  });
});
