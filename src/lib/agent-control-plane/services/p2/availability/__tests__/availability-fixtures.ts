import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  AvailabilityMemberSummarySchema,
  ListTeamAvailabilityInputSchema,
  type AvailabilityMemberSummary,
  type ListTeamAvailabilityInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import { LIST_TEAM_AVAILABILITY_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/availability";
import {
  authorizeTeamAvailabilityRead,
  type AuthorizedTeamAvailabilityRead,
} from "../availability-authorization";
import type { TeamAvailabilityCursorContext } from "../availability-cursor";
import {
  teamAvailabilityCollectionProofRef,
  teamAvailabilityEntityProofRef,
  teamAvailabilityEvidenceRef,
  teamAvailabilityProofContext,
} from "../availability-proof";

export const AVAILABILITY_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const AVAILABILITY_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const AVAILABILITY_MEMBER_ID = "33333333-3333-4333-8333-333333333333";
export const AVAILABILITY_SECOND_MEMBER_ID =
  "44444444-4444-4444-8444-444444444444";
export const AVAILABILITY_GRANT_ID = "55555555-5555-4555-8555-555555555555";
export const AVAILABILITY_CLIENT_ID = "66666666-6666-4666-8666-666666666666";
export const AVAILABILITY_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const AVAILABILITY_GRANT_REVISION = "b".repeat(32);
export const AVAILABILITY_READ_AT = "2026-11-01T12:00:00.000Z";
export const AVAILABILITY_SOURCE_REVISIONS = Object.freeze([
  Object.freeze({ domain: "availability" as const, source_revision: 3 }),
  Object.freeze({ domain: "site_visits" as const, source_revision: 5 }),
  Object.freeze({ domain: "tasks" as const, source_revision: 7 }),
  Object.freeze({ domain: "team" as const, source_revision: 11 }),
]);

function authority(input: {
  view: "company" | "self";
  calendarScope?: "all" | "own";
}): ActorAuthoritySnapshot {
  const calendarScope =
    input.calendarScope ?? (input.view === "company" ? "all" : "own");
  return {
    actorUserId: AVAILABILITY_ACTOR_ID,
    companyId: AVAILABILITY_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["77777777-7777-4777-8777-777777777777"],
    configuredPermissions:
      input.view === "company"
        ? ["calendar.view", "team.view"]
        : ["calendar.view"],
    effectivePermissions:
      input.view === "company"
        ? [
            { permission: "calendar.view", scope: calendarScope },
            { permission: "team.view", scope: "all" },
          ]
        : [{ permission: "calendar.view", scope: calendarScope }],
    permissionSnapshotRevision: AVAILABILITY_PERMISSION_REVISION,
  };
}

export async function availabilityActorContext(input: {
  view: "company" | "self";
  calendarScope?: "all" | "own";
}) {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: AVAILABILITY_ACTOR_ID,
      companyId: AVAILABILITY_COMPANY_ID,
      oauthGrantId: AVAILABILITY_GRANT_ID,
      oauthClientId: AVAILABILITY_CLIENT_ID,
      validatedScopes: ["ops.team.read"],
      tokenId: "88888888-8888-4888-8888-888888888888",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: AVAILABILITY_GRANT_REVISION,
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(input)
    ),
    requestId: `request-availability-${input.view}`,
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function availabilityAuthorization(
  rawQuery: unknown = {
    view: "company",
    starts_on: "2026-11-01",
    ends_on: "2026-11-03",
  },
  calendarScope?: "all" | "own"
): Promise<AuthorizedTeamAvailabilityRead> {
  const query = ListTeamAvailabilityInputSchema.parse(rawQuery);
  const actorContext = await availabilityActorContext({
    view: query.view,
    calendarScope,
  });
  const variant = LIST_TEAM_AVAILABILITY_CANDIDATE.authorization.variants.find(
    (candidate) => candidate.key === query.view
  );
  if (!variant) throw new TypeError("availability fixture variant missing");
  return authorizeTeamAvailabilityRead({
    query,
    authorizations: {
      [query.view]: authorizeCapability({
        actorContext,
        policy: variant.policy,
      }),
    },
  });
}

export function availabilityMember(input?: {
  readonly id?: string;
  readonly displayName?: string;
}): AvailabilityMemberSummary {
  return AvailabilityMemberSummarySchema.parse({
    member_ref: {
      kind: "team_member",
      id: input?.id ?? AVAILABILITY_MEMBER_ID,
    },
    display_name: input?.displayName ?? "Alex Morgan",
    days: [
      {
        date: "2026-11-01",
        state: "unavailable",
        working_minutes: 0,
        committed_minutes: 0,
        available_minutes: 0,
      },
      {
        date: "2026-11-02",
        state: "available",
        working_minutes: 540,
        committed_minutes: 0,
        available_minutes: 540,
      },
      {
        date: "2026-11-03",
        state: "limited",
        working_minutes: 540,
        committed_minutes: 180,
        available_minutes: 360,
      },
    ],
    content_kind: "untrusted_business_data",
  });
}

export function companyAvailabilityQuery(
  overrides: Partial<
    Extract<ListTeamAvailabilityInput, { view: "company" }>
  > = {}
) {
  return {
    view: "company" as const,
    starts_on: "2026-11-01",
    ends_on: "2026-11-03",
    ...overrides,
  };
}

export function availabilityRawSnapshot(input: {
  readonly authorization: AuthorizedTeamAvailabilityRead;
  readonly cursor?: TeamAvailabilityCursorContext | null;
  readonly items?: readonly AvailabilityMemberSummary[];
  readonly timezone?: string;
  readonly memberSourceInspected?: number;
  readonly scheduleSourceInspected?: number;
  readonly sourceHasMore?: boolean;
  readonly overrides?: Readonly<Record<string, unknown>>;
}) {
  const cursor = input.cursor ?? null;
  const items =
    input.items ??
    (input.authorization.availabilityScope === "self"
      ? [
          availabilityMember({
            id: AVAILABILITY_ACTOR_ID,
            displayName: "Jordan Lee",
          }),
        ]
      : [availabilityMember()]);
  const timezone = input.timezone ?? "America/Vancouver";
  const memberSourceInspected =
    input.memberSourceInspected ?? Math.max(items.length, 1);
  const scheduleSourceInspected = input.scheduleSourceInspected ?? 4;
  const sourceHasMore = input.sourceHasMore ?? false;
  const context = teamAvailabilityProofContext({
    authorization: input.authorization,
    cursor,
    readAt: AVAILABILITY_READ_AT,
    timezone,
    sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
    memberSourceInspected,
    scheduleSourceInspected,
    sourceHasMore,
  });
  const rows = items.map((item) => {
    const proofRef = teamAvailabilityEntityProofRef({ context, item });
    const evidenceRef = teamAvailabilityEvidenceRef({
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
    company_id: AVAILABILITY_COMPANY_ID,
    actor_user_id: AVAILABILITY_ACTOR_ID,
    oauth_grant_id: AVAILABILITY_GRANT_ID,
    oauth_client_id: AVAILABILITY_CLIENT_ID,
    grant_revision: AVAILABILITY_GRANT_REVISION,
    granted_scope_ceiling: [...input.authorization.grantedScopeCeiling],
    permission_snapshot_revision: AVAILABILITY_PERMISSION_REVISION,
    capability_id: "list_team_availability" as const,
    capability_revision: "list_team_availability:2026-08-22.v1" as const,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8" as const,
    ranking_revision: "availability-member-order:2026-08-22.v1" as const,
    required_oauth_scopes: ["ops.team.read"] as const,
    view: input.authorization.availabilityScope,
    team_scope: input.authorization.teamScope,
    calendar_scope: input.authorization.calendarScope,
    starts_on: input.authorization.query.starts_on,
    ends_on: input.authorization.query.ends_on,
    company_timezone: timezone,
    item_limit: input.authorization.itemLimit,
    cursor_read_at: cursor?.readAt ?? null,
    cursor_source_revisions: cursor
      ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
      : [],
    cursor_predecessor: cursor?.predecessor ?? null,
    read_at: AVAILABILITY_READ_AT,
    source_revisions: AVAILABILITY_SOURCE_REVISIONS,
    member_source_inspected: memberSourceInspected,
    schedule_source_inspected: scheduleSourceInspected,
    source_has_more: sourceHasMore,
    rows,
    collection_proof_ref: teamAvailabilityCollectionProofRef({
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
