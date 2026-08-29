import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { AppPermission, PermissionScope } from "@/lib/types/permissions";
import {
  authorizeOperationalOverviewRead,
  type AuthorizedOperationalOverviewRead,
} from "../overview-authorization";
import {
  operationalOverviewCollectionProofRef,
  operationalOverviewEntityProofRef,
  operationalOverviewEvidenceRef,
  operationalOverviewProofContext,
} from "../overview-proof";
import type {
  OperationalOverviewComponentItem,
  OperationalOverviewRevision,
} from "@/lib/agent-control-plane/contracts/operational-overview";

export const OVERVIEW_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const OVERVIEW_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const OVERVIEW_GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const OVERVIEW_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const OVERVIEW_GRANT_REVISION = "b".repeat(32);
export const OVERVIEW_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const OVERVIEW_READ_AT = "2026-08-29T23:30:00.000Z";

export const ALL_OVERVIEW_SCOPES = Object.freeze([
  "ops.catalog.read",
  "ops.correspondence.read",
  "ops.expenses.read",
  "ops.financial_documents.read",
  "ops.integrations.read",
  "ops.jobs.read",
  "ops.operations.read",
  "ops.payments.read",
  "ops.purchasing.read",
  "ops.schedule.read",
  "ops.tasks.read",
]);

export const ALL_OVERVIEW_PERMISSIONS = Object.freeze([
  ["accounting.view", "all"],
  ["calendar.view", "all"],
  ["catalog.orders.view", "all"],
  ["catalog.products.view", "all"],
  ["catalog.view", "all"],
  ["email.view", "all"],
  ["estimates.view", "all"],
  ["expenses.approve", "all"],
  ["expenses.view", "all"],
  ["finances.view", "all"],
  ["inbox.view", "all"],
  ["invoices.view", "all"],
  ["pipeline.view", "all"],
  ["projects.view", "all"],
  ["reports.view", "all"],
  ["settings.integrations", "all"],
  ["tasks.view", "all"],
] as const satisfies readonly (readonly [AppPermission, PermissionScope])[]);

function authority(
  permissions: readonly (readonly [AppPermission, PermissionScope])[]
): ActorAuthoritySnapshot {
  return {
    actorUserId: OVERVIEW_ACTOR_ID,
    companyId: OVERVIEW_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["55555555-5555-4555-8555-555555555555"],
    configuredPermissions: permissions.map(([permission]) => permission),
    effectivePermissions: permissions.map(([permission, scope]) => ({
      permission,
      scope,
    })),
    permissionSnapshotRevision: OVERVIEW_PERMISSION_REVISION,
  };
}

export async function overviewActorContext(input?: {
  readonly scopes?: readonly string[];
  readonly permissions?: readonly (readonly [AppPermission, PermissionScope])[];
  readonly manifestRevision?: string;
}) {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: OVERVIEW_ACTOR_ID,
      companyId: OVERVIEW_COMPANY_ID,
      oauthGrantId: OVERVIEW_GRANT_ID,
      oauthClientId: OVERVIEW_CLIENT_ID,
      validatedScopes: input?.scopes ?? ALL_OVERVIEW_SCOPES,
      tokenId: "66666666-6666-4666-8666-666666666666",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: OVERVIEW_GRANT_REVISION,
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(input?.permissions ?? ALL_OVERVIEW_PERMISSIONS)
    ),
    requestId: "request-operational-overview",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision:
      input?.manifestRevision ?? "2026-08-22.capability-manifest.v8",
  });
}

export async function overviewAuthorization(input?: {
  readonly query?: unknown;
  readonly scopes?: readonly string[];
  readonly permissions?: readonly (readonly [AppPermission, PermissionScope])[];
}): Promise<AuthorizedOperationalOverviewRead> {
  return authorizeOperationalOverviewRead({
    query: input?.query ?? {},
    actorContext: await overviewActorContext({
      scopes: input?.scopes,
      permissions: input?.permissions,
    }),
  });
}

const FIXTURE_REVISIONS = Object.freeze({
  financial_attention: Object.freeze([
    Object.freeze({ domain: "expenses", source_revision: 3 }),
    Object.freeze({ domain: "legacy_operational", source_revision: 5 }),
    Object.freeze({ domain: "payments", source_revision: 7 }),
    Object.freeze({ domain: "sales_documents", source_revision: 11 }),
  ]),
  integration_attention: Object.freeze([
    Object.freeze({ domain: "company", source_revision: 13 }),
    Object.freeze({ domain: "integrations", source_revision: 17 }),
  ]),
  schedule_readiness: Object.freeze([
    Object.freeze({ domain: "legacy_operational", source_revision: 5 }),
  ]),
  stock_attention: Object.freeze([
    Object.freeze({ domain: "catalog", source_revision: 19 }),
    Object.freeze({ domain: "purchasing", source_revision: 23 }),
  ]),
  unresolved_correspondence: Object.freeze([
    Object.freeze({ domain: "legacy_job_history", source_revision: 29 }),
    Object.freeze({ domain: "legacy_operational", source_revision: 5 }),
    Object.freeze({ domain: "work_queue", source_revision: 31 }),
  ]),
  work_due: Object.freeze([
    Object.freeze({ domain: "legacy_operational", source_revision: 5 }),
    Object.freeze({ domain: "tasks", source_revision: 37 }),
    Object.freeze({ domain: "work_queue", source_revision: 31 }),
  ]),
} as const satisfies Readonly<
  Record<string, readonly OperationalOverviewRevision[]>
>);

export function overviewItems(
  authorization: AuthorizedOperationalOverviewRead
): readonly OperationalOverviewComponentItem[] {
  return authorization.authorizedComponents.map(({ component }, index) =>
    index === 0
      ? {
          component,
          state: "clear" as const,
          attention_count: 0 as const,
          count_state: "exact" as const,
        }
      : {
          component,
          state: "attention" as const,
          attention_count: 25 as const,
          count_state: "at_least_limit" as const,
        }
  );
}

export function overviewRawSnapshot(input: {
  readonly authorization: AuthorizedOperationalOverviewRead;
  readonly overrides?: Readonly<Record<string, unknown>>;
}) {
  const authorization = input.authorization;
  const items = overviewItems(authorization);
  const sourceInspected = authorization.authorizedComponents.length;
  const context = operationalOverviewProofContext({
    authorization,
    readAt: OVERVIEW_READ_AT,
    sourceInspected,
  });
  const rows = items.map((item) => {
    const sourceRevisions = FIXTURE_REVISIONS[item.component];
    return {
      item,
      source_revisions: sourceRevisions,
      proof_ref: operationalOverviewEntityProofRef({
        context,
        item,
        sourceRevisions,
      }),
      evidence_ref: operationalOverviewEvidenceRef({
        context,
        component: item.component,
        sourceRevisions,
      }),
    };
  });
  const revisionByDomain = new Map<string, number>();
  for (const row of rows) {
    for (const revision of row.source_revisions) {
      revisionByDomain.set(revision.domain, revision.source_revision);
    }
  }
  const sourceRevisions = [...revisionByDomain.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([domain, source_revision]) => ({ domain, source_revision }));
  const authorizedComponents = authorization.authorizedComponents.map(
    (component) => ({
      component: component.component,
      origin: component.origin,
      required_oauth_scopes: [...component.requiredOAuthScopes],
      resolved_permission_scopes: {
        ...component.resolvedPermissionScopes,
      },
      satisfied_permission_group_indexes: [0] as const,
    })
  );
  const children = rows.map((row) => ({
    component: row.item.component,
    proof_ref: row.proof_ref,
    evidence_ref: row.evidence_ref,
    source_revisions: row.source_revisions,
  }));
  return {
    request_id: authorization.actorContext.requestId,
    company_id: OVERVIEW_COMPANY_ID,
    actor_user_id: OVERVIEW_ACTOR_ID,
    oauth_grant_id: OVERVIEW_GRANT_ID,
    oauth_client_id: OVERVIEW_CLIENT_ID,
    grant_revision: OVERVIEW_GRANT_REVISION,
    granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    permission_snapshot_revision: OVERVIEW_PERMISSION_REVISION,
    capability_id: "get_operational_overview" as const,
    capability_revision: "get_operational_overview:2026-08-22.v1" as const,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8" as const,
    selections: authorization.selections.map((selection) => ({
      ...selection,
    })),
    authorized_components: authorizedComponents,
    warnings: authorization.warnings.map((warning) => ({ ...warning })),
    read_at: OVERVIEW_READ_AT,
    source_revisions: sourceRevisions,
    source_inspected: sourceInspected,
    rows,
    collection_proof_ref: operationalOverviewCollectionProofRef({
      context,
      sourceRevisions,
      children,
    }),
    ...input.overrides,
  };
}
