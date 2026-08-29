import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  GetJobArtifactEvidenceInputSchema,
  JobArtifactListInputSchema,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import {
  GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
  LIST_JOB_ARTIFACTS_CANDIDATE,
  selectedGetJobArtifactEvidenceVariantKeys,
  selectedListJobArtifactsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/artifacts";
import {
  ArtifactReadAuthorizationError,
  authorizeGetJobArtifactEvidenceRead,
  authorizeListJobArtifactsRead,
  isAuthorizedGetJobArtifactEvidenceRead,
  isAuthorizedListJobArtifactsRead,
} from "../artifact-authorization";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const EVIDENCE_REF = `ops_evidence:v1:${"a".repeat(64)}`;

const ALL_SCOPES = [
  "ops.correspondence.read",
  "ops.customers.read",
  "ops.expenses.read",
  "ops.files.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.schedule.read",
  "ops.site_visits.read",
] as const;

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["66666666-6666-4666-8666-666666666666"],
    configuredPermissions: [
      "calendar.view",
      "clients.view",
      "deck_builder.view",
      "documents.view",
      "email.view",
      "estimates.view",
      "expenses.view",
      "inbox.view",
      "invoices.view",
      "photos.view",
      "pipeline.view",
      "projects.view",
    ],
    effectivePermissions: [
      { permission: "calendar.view", scope: "all" },
      { permission: "clients.view", scope: "assigned" },
      { permission: "deck_builder.view", scope: "assigned" },
      { permission: "documents.view", scope: "all" },
      { permission: "email.view", scope: "own" },
      { permission: "estimates.view", scope: "assigned" },
      { permission: "expenses.view", scope: "own" },
      { permission: "inbox.view", scope: "assigned" },
      { permission: "invoices.view", scope: "assigned" },
      { permission: "photos.view", scope: "assigned" },
      { permission: "pipeline.view", scope: "assigned" },
      { permission: "projects.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: `sha256:${"b".repeat(64)}`,
  };
}

async function actorContext() {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      validatedScopes: [...ALL_SCOPES],
      tokenId: "77777777-7777-4777-8777-777777777777",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-artifact-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

async function authorizations(
  candidate:
    | typeof LIST_JOB_ARTIFACTS_CANDIDATE
    | typeof GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
  keys: readonly string[]
) {
  const context = await actorContext();
  const policies = new Map(
    candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  return Object.fromEntries(
    keys.map((key) => [
      key,
      authorizeCapability({
        actorContext: context,
        policy: policies.get(key)!,
      }),
    ])
  );
}

describe("P2 artifact candidate policies", () => {
  it("keeps metadata and exact-source reads dark, immutable, bounded, and read-only", () => {
    expect(LIST_JOB_ARTIFACTS_CANDIDATE).toMatchObject({
      name: "list_job_artifacts",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      availability: { implementation: "available" },
      bounds: { maxResultItems: 25, maxOutputCharacters: 60_000 },
    });
    expect(GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE).toMatchObject({
      name: "get_job_artifact_evidence",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      availability: { implementation: "available" },
      bounds: { maxResultItems: 1, maxOutputCharacters: 60_000 },
      evidencePolicy: { input: "required" },
    });
    expect(Object.isFrozen(LIST_JOB_ARTIFACTS_CANDIDATE)).toBe(true);
    expect(Object.isFrozen(GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE)).toBe(true);
  });

  it("selects the exact job and every explicit source policy before any read", () => {
    const list = JobArtifactListInputSchema.parse({
      job_ref: { kind: "project", id: JOB_ID },
      source_kinds: [
        "deck_design",
        "email_attachment",
        "expense_receipt",
        "generated_estimate",
        "generated_invoice",
        "project_note",
        "project_photo",
        "site_visit_artifact",
      ],
    });
    expect(selectedListJobArtifactsVariantKeys(list)).toEqual([
      "job_project",
      "deck_design",
      "email_attachment",
      "expense_receipt",
      "generated_estimate",
      "generated_invoice",
      "project_note_project",
      "project_photo",
      "site_visit_artifact",
    ]);

    const exact = GetJobArtifactEvidenceInputSchema.parse({
      job_ref: { kind: "opportunity", id: JOB_ID },
      source_kind: "email_attachment",
      evidence_ref: EVIDENCE_REF,
    });
    expect(selectedGetJobArtifactEvidenceVariantKeys(exact)).toEqual([
      "job_opportunity",
      "email_attachment",
    ]);
  });
});

describe("P2 artifact nominal authorization", () => {
  it("mints one immutable list proof carrying the complete selected union", async () => {
    const query = JobArtifactListInputSchema.parse({
      job_ref: { kind: "project", id: JOB_ID },
      source_kinds: [
        "deck_design",
        "email_attachment",
        "expense_receipt",
        "generated_estimate",
        "generated_invoice",
        "project_note",
        "project_photo",
        "site_visit_artifact",
      ],
    });
    const keys = selectedListJobArtifactsVariantKeys(query);
    const proof = authorizeListJobArtifactsRead({
      query,
      authorizations: await authorizations(LIST_JOB_ARTIFACTS_CANDIDATE, keys),
    });

    expect(isAuthorizedListJobArtifactsRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "list_job_artifacts",
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      requiredOAuthScopes: [...ALL_SCOPES],
      resolvedPermissionScopes: {
        "calendar.view": "all",
        "clients.view": "assigned",
        "deck_builder.view": "assigned",
        "documents.view": "all",
        "email.view": "own",
        "estimates.view": "assigned",
        "expenses.view": "own",
        "inbox.view": "assigned",
        "invoices.view": "assigned",
        "photos.view": "assigned",
        "pipeline.view": "assigned",
        "projects.view": "assigned",
      },
      variantKeys: keys,
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.resolvedPermissionScopes)).toBe(true);
  });

  it("binds the caller-declared exact source and rejects borrowed or reconstructed authority", async () => {
    const query = GetJobArtifactEvidenceInputSchema.parse({
      job_ref: { kind: "opportunity", id: JOB_ID },
      source_kind: "email_attachment",
      evidence_ref: EVIDENCE_REF,
    });
    const keys = selectedGetJobArtifactEvidenceVariantKeys(query);
    const exact = await authorizations(
      GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
      keys
    );
    const proof = authorizeGetJobArtifactEvidenceRead({
      query,
      authorizations: exact,
    });

    expect(isAuthorizedGetJobArtifactEvidenceRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      requiredOAuthScopes: ["ops.correspondence.read", "ops.files.read"],
      resolvedPermissionScopes: {
        "email.view": "own",
        "inbox.view": "assigned",
        "pipeline.view": "assigned",
      },
      variantKeys: ["job_opportunity", "email_attachment"],
    });

    for (const invalid of [
      { job_opportunity: exact.job_opportunity },
      { ...exact, email_attachment: exact.job_opportunity },
      { ...exact, email_attachment: { ...exact.email_attachment } },
    ]) {
      expect(() =>
        authorizeGetJobArtifactEvidenceRead({ query, authorizations: invalid })
      ).toThrow(ArtifactReadAuthorizationError);
    }
  });
});
