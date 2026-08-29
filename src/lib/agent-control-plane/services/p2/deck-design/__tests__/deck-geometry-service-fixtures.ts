import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { DeckDesignGeometryInputSchema } from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import {
  GET_DECK_DESIGN_GEOMETRY_CANDIDATE,
  selectedDeckDesignGeometryVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/deck-design";
import type { PermissionScope } from "@/lib/types/permissions";
import {
  authorizeDeckDesignGeometryRead,
  type AuthorizedDeckDesignGeometryRead,
} from "../deck-geometry-authorization";
import {
  deckDesignRef,
  deckGeometryDrawingContentHash,
} from "../deck-geometry-proof";

export const DECK_GEOMETRY_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const DECK_GEOMETRY_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const DECK_GEOMETRY_JOB_ID = "33333333-3333-4333-8333-333333333333";
export const DECK_GEOMETRY_DESIGN_ID = "44444444-4444-4444-8444-444444444444";
export const DECK_GEOMETRY_SITE_VISIT_ID =
  "55555555-5555-4555-8555-555555555555";
export const DECK_GEOMETRY_GRANT_ID = "66666666-6666-4666-8666-666666666666";
export const DECK_GEOMETRY_CLIENT_ID = "77777777-7777-4777-8777-777777777777";
export const DECK_GEOMETRY_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const DECK_GEOMETRY_DECK_REF = deckDesignRef({
  companyId: DECK_GEOMETRY_COMPANY_ID,
  designId: DECK_GEOMETRY_DESIGN_ID,
});
export const DECK_GEOMETRY_READ_AT = "2026-08-23T12:00:00.000Z";
export const DECK_GEOMETRY_SOURCE_REVISIONS = Object.freeze([
  { domain: "artifacts", source_revision: 11 },
  { domain: "deck_designs", source_revision: 13 },
  { domain: "legacy_operational", source_revision: 17 },
  { domain: "site_visits", source_revision: 19 },
] as const);

const GOLDEN_FIXTURE = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "src/lib/agent-control-plane/services/p2/deck-design/__fixtures__/ops-decks-ios/single-level-gate-stair-parapet.json"
    ),
    "utf8"
  )
) as Record<string, unknown>;

export const DECK_GEOMETRY_DRAWING_SOURCE = JSON.stringify(
  GOLDEN_FIXTURE.input_drawing_json
);

type DeckPermission =
  | "calendar.view"
  | "clients.view"
  | "deck_builder.view"
  | "pipeline.view"
  | "projects.view";

export type DeckPermissionOverrides = Partial<
  Record<DeckPermission, PermissionScope | null>
>;

const OAUTH_SCOPES = [
  "ops.customers.read",
  "ops.files.read",
  "ops.jobs.read",
  "ops.schedule.read",
  "ops.site_visits.read",
] as const;

function authority(
  overrides: DeckPermissionOverrides = {}
): ActorAuthoritySnapshot {
  const resolved: Record<DeckPermission, PermissionScope | null> = {
    "calendar.view": "all",
    "clients.view": "all",
    "deck_builder.view": "all",
    "pipeline.view": "all",
    "projects.view": "all",
    ...overrides,
  };
  const active = Object.entries(resolved).filter(
    (entry): entry is [DeckPermission, PermissionScope] => entry[1] !== null
  );
  return {
    actorUserId: DECK_GEOMETRY_ACTOR_ID,
    companyId: DECK_GEOMETRY_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["88888888-8888-4888-8888-888888888888"],
    configuredPermissions: active.map(([permission]) => permission),
    effectivePermissions: active.map(([permission, scope]) => ({
      permission,
      scope,
    })),
    permissionSnapshotRevision: DECK_GEOMETRY_PERMISSION_REVISION,
  };
}

async function actorContext(
  overrides?: DeckPermissionOverrides,
  oauthScopes: readonly string[] = OAUTH_SCOPES
) {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: DECK_GEOMETRY_ACTOR_ID,
      companyId: DECK_GEOMETRY_COMPANY_ID,
      oauthGrantId: DECK_GEOMETRY_GRANT_ID,
      oauthClientId: DECK_GEOMETRY_CLIENT_ID,
      validatedScopes: [...oauthScopes],
      tokenId: "99999999-9999-4999-8999-999999999999",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(overrides)
    ),
    requestId: "request-deck-geometry-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function deckGeometryCandidateAuthorizations(input: {
  readonly query: unknown;
  readonly permissions?: DeckPermissionOverrides;
  readonly oauthScopes?: readonly string[];
}) {
  const query = DeckDesignGeometryInputSchema.parse(input.query);
  const selection = selectedDeckDesignGeometryVariantKeys(query);
  const context = await actorContext(input.permissions, input.oauthScopes);
  const policies = new Map(
    GET_DECK_DESIGN_GEOMETRY_CANDIDATE.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  const authorize = (
    key: (typeof GET_DECK_DESIGN_GEOMETRY_CANDIDATE.authorization.variants)[number]["key"]
  ) =>
    authorizeCapability({
      actorContext: context,
      policy: policies.get(key)!,
    });
  const entries = selection.required.map(
    (key) => [key, authorize(key)] as const
  );

  for (const alternative of selection.alternatives) {
    const candidateEntries = [];
    try {
      for (const key of alternative) {
        candidateEntries.push([key, authorize(key)] as const);
      }
    } catch (error) {
      if (
        error instanceof ActorAccessError &&
        (error.code === "INSUFFICIENT_SCOPE" || error.code === "FORBIDDEN")
      ) {
        continue;
      }
      throw error;
    }
    entries.push(...candidateEntries);
  }

  return Object.fromEntries(entries);
}

export async function deckGeometryAuthorization(
  rawQuery: unknown = {
    source: "job_artifact",
    job_ref: { kind: "project", id: DECK_GEOMETRY_JOB_ID },
    deck_design_ref: DECK_GEOMETRY_DECK_REF,
  },
  permissions?: DeckPermissionOverrides,
  oauthScopes?: readonly string[]
) {
  const query = DeckDesignGeometryInputSchema.parse(rawQuery);
  return authorizeDeckDesignGeometryRead({
    query,
    authorizations: await deckGeometryCandidateAuthorizations({
      query,
      ...(permissions ? { permissions } : {}),
      ...(oauthScopes ? { oauthScopes } : {}),
    }),
  });
}

export function deckGeometryRawSnapshot(
  authorization: AuthorizedDeckDesignGeometryRead,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const query = authorization.query;
  const siteSource = query.source === "site_visit_artifact";
  const designParents =
    query.source === "job_artifact"
      ? query.job_ref.kind === "opportunity"
        ? { opportunity_id: query.job_ref.id, project_id: null }
        : { opportunity_id: null, project_id: query.job_ref.id }
      : { opportunity_id: null, project_id: DECK_GEOMETRY_JOB_ID };
  const selectedAuthorization =
    authorization.authorizationCandidates.find(
      (candidate) =>
        candidate.variantKey === overrides.selected_authorization_variant
    ) ?? authorization.authorizationCandidates[0]!;
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    selected_authorization_variant: selectedAuthorization.variantKey,
    required_oauth_scopes: selectedAuthorization.requiredOAuthScopes,
    resolved_permission_scopes: selectedAuthorization.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      selectedAuthorization.satisfiedPermissionGroupIndexes,
    query,
    read_at: DECK_GEOMETRY_READ_AT,
    source_revisions: DECK_GEOMETRY_SOURCE_REVISIONS,
    source_inspected: {
      artifact_bridges: siteSource ? 1 : 0,
      deck_designs: 1,
      jobs:
        Number(designParents.opportunity_id !== null) +
        Number(designParents.project_id !== null),
      site_visits: siteSource ? 1 : 0,
      visit_opportunities: siteSource ? 1 : 0,
    },
    authority_path: siteSource
      ? "site_visit_linked"
      : query.job_ref.kind === "project"
        ? "job_project"
        : "job_opportunity",
    visit_opportunity_id: siteSource ? DECK_GEOMETRY_JOB_ID : null,
    design_parents: designParents,
    design_id: DECK_GEOMETRY_DESIGN_ID,
    deck_design_ref: query.deck_design_ref,
    title_text: "Rear deck",
    drawing_source: DECK_GEOMETRY_DRAWING_SOURCE,
    drawing_content_hash: deckGeometryDrawingContentHash(
      DECK_GEOMETRY_DRAWING_SOURCE
    ),
    ...overrides,
  };
}
