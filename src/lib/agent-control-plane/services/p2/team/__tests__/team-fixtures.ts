import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  ListTeamMembersInputSchema,
  TeamMemberSummarySchema,
  type TeamMemberSummary,
} from "@/lib/agent-control-plane/contracts/company-operations";
import { LIST_TEAM_MEMBERS_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/team";
import {
  authorizeTeamDirectoryRead,
  type AuthorizedTeamDirectoryRead,
} from "../team-authorization";
import type { TeamDirectoryCursorContext } from "../team-cursor";
import {
  teamDirectoryCollectionProofRef,
  teamDirectoryEntityProofRef,
  teamDirectoryEvidenceRef,
  teamDirectoryProofContext,
} from "../team-proof";

export const TEAM_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const TEAM_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const TEAM_MEMBER_ID = "33333333-3333-4333-8333-333333333333";
export const TEAM_SECOND_MEMBER_ID = "44444444-4444-4444-8444-444444444444";
export const TEAM_GRANT_ID = "55555555-5555-4555-8555-555555555555";
export const TEAM_CLIENT_ID = "66666666-6666-4666-8666-666666666666";
export const TEAM_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const TEAM_GRANT_REVISION = "b".repeat(32);
export const TEAM_READ_AT = "2026-08-29T12:00:00.000Z";
export const TEAM_SOURCE_REVISIONS = Object.freeze([
  Object.freeze({ domain: "company" as const, source_revision: 7 }),
  Object.freeze({ domain: "team" as const, source_revision: 12 }),
]);

function authority(scope: "all" | "assigned" = "all"): ActorAuthoritySnapshot {
  return {
    actorUserId: TEAM_ACTOR_ID,
    companyId: TEAM_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["77777777-7777-4777-8777-777777777777"],
    configuredPermissions: ["team.view"],
    effectivePermissions: [{ permission: "team.view", scope }],
    permissionSnapshotRevision: TEAM_PERMISSION_REVISION,
  };
}

export async function teamActorContext(scope: "all" | "assigned" = "all") {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: TEAM_ACTOR_ID,
      companyId: TEAM_COMPANY_ID,
      oauthGrantId: TEAM_GRANT_ID,
      oauthClientId: TEAM_CLIENT_ID,
      validatedScopes: ["ops.team.read"],
      tokenId: "88888888-8888-4888-8888-888888888888",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: TEAM_GRANT_REVISION,
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(scope)
    ),
    requestId: "request-team-directory",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function teamDirectoryAuthorization(
  rawQuery: unknown = {}
): Promise<AuthorizedTeamDirectoryRead> {
  const query = ListTeamMembersInputSchema.parse(rawQuery);
  const actorContext = await teamActorContext();
  const policy = LIST_TEAM_MEMBERS_CANDIDATE.authorization.variants[0]!.policy;
  return authorizeTeamDirectoryRead({
    query,
    authorizations: {
      team: authorizeCapability({ actorContext, policy }),
    },
  });
}

export function teamMember(input?: {
  readonly id?: string;
  readonly displayName?: string;
}): TeamMemberSummary {
  return TeamMemberSummarySchema.parse({
    member_ref: { kind: "team_member", id: input?.id ?? TEAM_MEMBER_ID },
    display_name: input?.displayName ?? "Alex Morgan",
    state: "active",
    display_image: {
      state: "available",
      url: "https://assets.opsapp.co/team/alex.png",
    },
    display_color: "#5D7185",
    team_label: "crew",
    content_kind: "untrusted_business_data",
  });
}

export function teamDirectoryRawSnapshot(input: {
  readonly authorization: AuthorizedTeamDirectoryRead;
  readonly cursor?: TeamDirectoryCursorContext | null;
  readonly items?: readonly TeamMemberSummary[];
  readonly sourceInspected?: number;
  readonly sourceHasMore?: boolean;
  readonly overrides?: Readonly<Record<string, unknown>>;
}) {
  const cursor = input.cursor ?? null;
  const items = input.items ?? [teamMember()];
  const sourceInspected = input.sourceInspected ?? items.length;
  const sourceHasMore = input.sourceHasMore ?? false;
  const context = teamDirectoryProofContext({
    authorization: input.authorization,
    cursor,
    readAt: TEAM_READ_AT,
    sourceRevisions: TEAM_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore,
  });
  const rows = items.map((item) => {
    const proofRef = teamDirectoryEntityProofRef({ context, item });
    const evidenceRef = teamDirectoryEvidenceRef({
      context,
      memberRef: item.member_ref,
    });
    return {
      item,
      proof_ref: proofRef,
      evidence_ref: evidenceRef,
      predecessor: {
        order: [item.display_name, item.member_ref.id],
        tie_breaker: item.member_ref.id,
      },
    } as const;
  });
  return {
    company_id: TEAM_COMPANY_ID,
    actor_user_id: TEAM_ACTOR_ID,
    oauth_grant_id: TEAM_GRANT_ID,
    oauth_client_id: TEAM_CLIENT_ID,
    grant_revision: TEAM_GRANT_REVISION,
    granted_scope_ceiling: [...input.authorization.grantedScopeCeiling],
    permission_snapshot_revision: TEAM_PERMISSION_REVISION,
    capability_id: "list_team_members" as const,
    capability_revision: "list_team_members:2026-08-22.v1" as const,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8" as const,
    ranking_revision: "team-member-order:2026-08-22.v1" as const,
    required_oauth_scopes: ["ops.team.read"] as const,
    team_scope: "all" as const,
    item_limit: input.authorization.query.limit,
    cursor_read_at: cursor?.readAt ?? null,
    cursor_source_revisions: cursor
      ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
      : [],
    cursor_predecessor: cursor?.predecessor ?? null,
    read_at: TEAM_READ_AT,
    source_revisions: TEAM_SOURCE_REVISIONS,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows,
    collection_proof_ref: teamDirectoryCollectionProofRef({
      context,
      returnedCount: rows.length,
      hasMore: sourceHasMore,
      children: rows.map((row) => ({
        member_ref: row.item.member_ref,
        proof_ref: row.proof_ref,
        evidence_ref: row.evidence_ref,
      })),
    }),
    ...input.overrides,
  };
}
