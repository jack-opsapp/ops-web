import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  type ArtifactMetadata,
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
  authorizeGetJobArtifactEvidenceRead,
  authorizeListJobArtifactsRead,
} from "../artifact-authorization";
import { artifactEvidenceRef } from "../artifact-proof";

export const ARTIFACT_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const ARTIFACT_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const ARTIFACT_JOB_ID = "33333333-3333-4333-8333-333333333333";
export const ARTIFACT_GRANT_ID = "44444444-4444-4444-8444-444444444444";
export const ARTIFACT_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
export const ARTIFACT_PERMISSION_REVISION = `sha256:${"b".repeat(64)}`;
export const ARTIFACT_READ_AT = "2026-08-23T12:00:00.000Z";
export const ARTIFACT_OCCURRED_AT = "2026-08-22T10:00:00.000Z";
export const ARTIFACT_SOURCE_ID = "88888888-8888-4888-8888-888888888888";
export const ARTIFACT_EVIDENCE_REF = artifactEvidenceRef({
  companyId: ARTIFACT_COMPANY_ID,
  jobRef: { kind: "project", id: ARTIFACT_JOB_ID },
  sourceIdentity: {
    source_kind: "project_photo",
    source_id: ARTIFACT_SOURCE_ID,
  },
});
export const ARTIFACT_PROOF_REF = `ops_proof:v1:${"d".repeat(64)}`;
export const ARTIFACT_SOURCE_REVISIONS = Object.freeze([
  { domain: "artifacts", source_revision: 17 },
  { domain: "legacy_operational", source_revision: 23 },
] as const);

const OAUTH_SCOPES = [
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
    actorUserId: ARTIFACT_ACTOR_ID,
    companyId: ARTIFACT_COMPANY_ID,
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
    permissionSnapshotRevision: ARTIFACT_PERMISSION_REVISION,
  };
}

async function context() {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ARTIFACT_ACTOR_ID,
      companyId: ARTIFACT_COMPANY_ID,
      oauthGrantId: ARTIFACT_GRANT_ID,
      oauthClientId: ARTIFACT_CLIENT_ID,
      validatedScopes: [...OAUTH_SCOPES],
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

async function candidateAuthorizations(
  candidate:
    | typeof LIST_JOB_ARTIFACTS_CANDIDATE
    | typeof GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
  keys: readonly string[]
) {
  const actorContext = await context();
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
        actorContext,
        policy: policies.get(key)!,
      }),
    ])
  );
}

export async function listArtifactsAuthorization(
  rawQuery: unknown = {
    job_ref: { kind: "project", id: ARTIFACT_JOB_ID },
    source_kinds: ["project_photo"],
  }
) {
  const query = JobArtifactListInputSchema.parse(rawQuery);
  const keys = selectedListJobArtifactsVariantKeys(query);
  return authorizeListJobArtifactsRead({
    query,
    authorizations: await candidateAuthorizations(
      LIST_JOB_ARTIFACTS_CANDIDATE,
      keys
    ),
  });
}

export async function exactArtifactAuthorization(
  rawQuery: unknown = {
    job_ref: { kind: "project", id: ARTIFACT_JOB_ID },
    source_kind: "project_photo",
    evidence_ref: ARTIFACT_EVIDENCE_REF,
  }
) {
  const query = GetJobArtifactEvidenceInputSchema.parse(rawQuery);
  const keys = selectedGetJobArtifactEvidenceVariantKeys(query);
  return authorizeGetJobArtifactEvidenceRead({
    query,
    authorizations: await candidateAuthorizations(
      GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
      keys
    ),
  });
}

export function artifactMetadata(
  overrides: Readonly<Record<string, unknown>> = {}
): ArtifactMetadata {
  return {
    evidence_ref: ARTIFACT_EVIDENCE_REF,
    source_kind: "project_photo",
    artifact_kind: "photo",
    occurred_at: ARTIFACT_OCCURRED_AT,
    display_name: {
      text: "Rear elevation",
      content_kind: "untrusted_business_data",
    },
    note_excerpt: null,
    review_state: "not_applicable",
    client_visibility: "visible",
    mime_family: "image",
    byte_size: 1_024,
    availability: "available",
    inspection_state: "passed",
    ...overrides,
  } as ArtifactMetadata;
}

export function artifactEvidenceIdentity(evidenceRef = ARTIFACT_EVIDENCE_REF) {
  return {
    evidence_ref: evidenceRef,
    source_domain: "artifacts",
    source_type: "project_photo",
    occurred_at: ARTIFACT_READ_AT,
  };
}

export function artifactProof(proofRef = ARTIFACT_PROOF_REF) {
  return {
    proof_ref: proofRef,
    read_at: ARTIFACT_READ_AT,
    source_revisions: ARTIFACT_SOURCE_REVISIONS,
  };
}
