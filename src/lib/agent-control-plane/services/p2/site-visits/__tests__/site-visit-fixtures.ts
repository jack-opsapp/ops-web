import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  GetSiteVisitContextInputSchema,
  ListSiteVisitsInputSchema,
} from "@/lib/agent-control-plane/contracts/site-visits";
import {
  GET_SITE_VISIT_CONTEXT_CANDIDATE,
  LIST_SITE_VISITS_CANDIDATE,
  selectedGetSiteVisitContextVariantKeys,
  selectedListSiteVisitsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/site-visits";
import type { PermissionScope } from "@/lib/types/permissions";
import {
  authorizeGetSiteVisitContextRead,
  authorizeListSiteVisitsRead,
} from "../site-visit-authorization";

export const SITE_VISIT_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const SITE_VISIT_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const SITE_VISIT_ID = "33333333-3333-4333-8333-333333333333";
export const SITE_VISIT_OPPORTUNITY_ID = "44444444-4444-4444-8444-444444444444";
export const SITE_VISIT_CLIENT_RECORD_ID =
  "55555555-5555-4555-8555-555555555555";
export const SITE_VISIT_GRANT_ID = "66666666-6666-4666-8666-666666666666";
export const SITE_VISIT_OAUTH_CLIENT_ID =
  "77777777-7777-4777-8777-777777777777";
export const SITE_VISIT_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const SITE_VISIT_READ_AT = "2026-08-23T12:00:00.000Z";
export const SITE_VISIT_SOURCE_REVISIONS = Object.freeze([
  { domain: "site_visits", source_revision: 17 },
] as const);
export const SITE_VISIT_ARTIFACT_SOURCE_REVISIONS = Object.freeze([
  { domain: "artifacts", source_revision: 9 },
  { domain: "site_visits", source_revision: 17 },
] as const);

type VisitPermission =
  | "calendar.view"
  | "clients.view"
  | "deck_builder.view"
  | "photos.view"
  | "pipeline.view";

function authority(
  scopes: Partial<Record<VisitPermission, PermissionScope>> = {}
): ActorAuthoritySnapshot {
  const resolved = {
    "calendar.view": "all",
    "clients.view": "all",
    "deck_builder.view": "all",
    "photos.view": "all",
    "pipeline.view": "all",
    ...scopes,
  } as const;
  return {
    actorUserId: SITE_VISIT_ACTOR_ID,
    companyId: SITE_VISIT_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["88888888-8888-4888-8888-888888888888"],
    configuredPermissions: Object.keys(resolved) as VisitPermission[],
    effectivePermissions: Object.entries(resolved).map(
      ([permission, scope]) => ({
        permission: permission as VisitPermission,
        scope,
      })
    ),
    permissionSnapshotRevision: SITE_VISIT_PERMISSION_REVISION,
  };
}

async function actorContext(
  scopes?: Partial<Record<VisitPermission, PermissionScope>>
) {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: SITE_VISIT_ACTOR_ID,
      companyId: SITE_VISIT_COMPANY_ID,
      oauthGrantId: SITE_VISIT_GRANT_ID,
      oauthClientId: SITE_VISIT_OAUTH_CLIENT_ID,
      validatedScopes: [
        "ops.customers.read",
        "ops.files.read",
        "ops.jobs.read",
        "ops.schedule.read",
        "ops.site_visits.read",
      ],
      tokenId: "99999999-9999-4999-8999-999999999999",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(scopes)
    ),
    requestId: "request-site-visit-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function siteVisitCandidateAuthorizations(input: {
  readonly candidate:
    typeof LIST_SITE_VISITS_CANDIDATE | typeof GET_SITE_VISIT_CONTEXT_CANDIDATE;
  readonly keys: readonly string[];
  readonly scopes?: Partial<Record<VisitPermission, PermissionScope>>;
}) {
  const context = await actorContext(input.scopes);
  const policies = new Map(
    input.candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  return Object.fromEntries(
    input.keys.map((key) => [
      key,
      authorizeCapability({
        actorContext: context,
        policy: policies.get(key)!,
      }),
    ])
  );
}

export async function listSiteVisitsAuthorization(
  rawQuery: unknown = {
    view: "booked_appointments",
    from: "2026-08-20T00:00:00.000Z",
    to: "2026-08-30T00:00:00.000Z",
  },
  scopes?: Partial<Record<VisitPermission, PermissionScope>>
) {
  const query = ListSiteVisitsInputSchema.parse(rawQuery);
  const keys = selectedListSiteVisitsVariantKeys(query);
  return authorizeListSiteVisitsRead({
    query,
    authorizations: await siteVisitCandidateAuthorizations({
      candidate: LIST_SITE_VISITS_CANDIDATE,
      keys,
      ...(scopes ? { scopes } : {}),
    }),
  });
}

export async function siteVisitContextAuthorization(
  rawQuery: unknown = {
    anchor: "opportunity",
    opportunity_ref: {
      kind: "opportunity",
      id: SITE_VISIT_OPPORTUNITY_ID,
    },
    site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
  },
  scopes?: Partial<Record<VisitPermission, PermissionScope>>
) {
  const query = GetSiteVisitContextInputSchema.parse(rawQuery);
  const keys = selectedGetSiteVisitContextVariantKeys(query);
  return authorizeGetSiteVisitContextRead({
    query,
    authorizations: await siteVisitCandidateAuthorizations({
      candidate: GET_SITE_VISIT_CONTEXT_CANDIDATE,
      keys,
      ...(scopes ? { scopes } : {}),
    }),
  });
}

export function linkedBookedVisitSummary() {
  return {
    site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
    link: {
      state: "linked",
      opportunity_ref: {
        kind: "opportunity",
        id: SITE_VISIT_OPPORTUNITY_ID,
      },
    },
    status: "scheduled",
    booking: {
      state: "booked",
      booked_at: "2026-08-24T09:00:00.000Z",
      scheduled_start: "2026-08-25T17:00:00.000Z",
      duration_minutes: 60,
    },
    created_at: "2026-08-23T10:00:00.000Z",
    completed_at: null,
  } as const;
}
