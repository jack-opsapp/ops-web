import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  GetIntegrationHealthInputSchema,
  IntegrationHealthItemSchema,
  type GetIntegrationHealthInput,
  type IntegrationHealthItem,
} from "@/lib/agent-control-plane/contracts/company-operations";
import { GET_INTEGRATION_HEALTH_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/integrations";
import {
  authorizeIntegrationHealthRead,
  type AuthorizedIntegrationHealthRead,
} from "../integration-authorization";
import {
  integrationHealthCollectionProofRef,
  integrationHealthEntityProofRef,
  integrationHealthEvidenceRef,
  integrationHealthProofContext,
} from "../integration-proof";

export const INTEGRATION_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const INTEGRATION_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const INTEGRATION_GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const INTEGRATION_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const INTEGRATION_GRANT_REVISION = "b".repeat(32);
export const INTEGRATION_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const INTEGRATION_READ_AT = "2026-08-29T20:30:00.000Z";
export const INTEGRATION_SOURCE_REVISIONS = Object.freeze([
  Object.freeze({ domain: "company" as const, source_revision: 7 }),
  Object.freeze({ domain: "integrations" as const, source_revision: 13 }),
]);
export const INTEGRATION_SOURCE_INSPECTED = Object.freeze({
  accounting: 1,
  mailbox: 1,
});

function authority(emailScope: "all" | "own"): ActorAuthoritySnapshot {
  return {
    actorUserId: INTEGRATION_ACTOR_ID,
    companyId: INTEGRATION_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["55555555-5555-4555-8555-555555555555"],
    configuredPermissions: [
      "accounting.view",
      "email.view",
      "settings.integrations",
    ],
    effectivePermissions: [
      { permission: "accounting.view", scope: "all" },
      { permission: "email.view", scope: emailScope },
      { permission: "settings.integrations", scope: "all" },
    ],
    permissionSnapshotRevision: INTEGRATION_PERMISSION_REVISION,
  };
}

export async function integrationActorContext(
  emailScope: "all" | "own" = "own"
) {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: INTEGRATION_ACTOR_ID,
      companyId: INTEGRATION_COMPANY_ID,
      oauthGrantId: INTEGRATION_GRANT_ID,
      oauthClientId: INTEGRATION_CLIENT_ID,
      validatedScopes: ["ops.integrations.read"],
      tokenId: "66666666-6666-4666-8666-666666666666",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: INTEGRATION_GRANT_REVISION,
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(emailScope)
    ),
    requestId: "request-integration-health",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export function integrationQuery(): GetIntegrationHealthInput {
  return GetIntegrationHealthInputSchema.parse({
    integrations: [
      { integration_type: "accounting", provider: "quickbooks" },
      { integration_type: "mailbox", provider: "gmail" },
    ],
  });
}

export async function integrationAuthorization(input?: {
  readonly query?: unknown;
  readonly emailScope?: "all" | "own";
}): Promise<AuthorizedIntegrationHealthRead> {
  const query = GetIntegrationHealthInputSchema.parse(
    input?.query ?? integrationQuery()
  );
  const actorContext = await integrationActorContext(input?.emailScope);
  const authorizations = Object.fromEntries(
    [
      ...new Set(
        query.integrations.map((selection) => selection.integration_type)
      ),
    ].map((variantKey) => {
      const variant =
        GET_INTEGRATION_HEALTH_CANDIDATE.authorization.variants.find(
          (candidate) => candidate.key === variantKey
        );
      if (!variant) throw new TypeError("integration fixture variant missing");
      return [
        variantKey,
        authorizeCapability({ actorContext, policy: variant.policy }),
      ];
    })
  );
  return authorizeIntegrationHealthRead({ query, authorizations });
}

export function integrationItems(
  query: GetIntegrationHealthInput = integrationQuery()
): readonly IntegrationHealthItem[] {
  return query.integrations.map((selection) =>
    IntegrationHealthItemSchema.parse(
      selection.integration_type === "accounting"
        ? {
            ...selection,
            connection_state: "active",
            sync_state: "healthy",
            reason_code: "connected",
            last_healthy_progress_at: "2026-08-29T20:00:00.000Z",
          }
        : {
            ...selection,
            connection_state: "reconnect_required",
            sync_state: "not_available",
            reason_code: "needs_reconnect",
            last_healthy_progress_at: null,
            calendar_consent_granted: true,
          }
    )
  );
}

export function integrationRawSnapshot(input: {
  readonly authorization: AuthorizedIntegrationHealthRead;
  readonly items?: readonly IntegrationHealthItem[];
  readonly overrides?: Readonly<Record<string, unknown>>;
}) {
  const items = input.items ?? integrationItems(input.authorization.query);
  const context = integrationHealthProofContext({
    authorization: input.authorization,
    readAt: INTEGRATION_READ_AT,
    sourceRevisions: INTEGRATION_SOURCE_REVISIONS,
    sourceInspected: INTEGRATION_SOURCE_INSPECTED,
  });
  const rows = items.map((item, index) => {
    const selection = input.authorization.query.integrations[index]!;
    return {
      item,
      proof_ref: integrationHealthEntityProofRef({ context, item }),
      evidence_ref: integrationHealthEvidenceRef({ context, selection }),
    };
  });
  return {
    company_id: INTEGRATION_COMPANY_ID,
    actor_user_id: INTEGRATION_ACTOR_ID,
    oauth_grant_id: INTEGRATION_GRANT_ID,
    oauth_client_id: INTEGRATION_CLIENT_ID,
    grant_revision: INTEGRATION_GRANT_REVISION,
    granted_scope_ceiling: [...input.authorization.grantedScopeCeiling],
    permission_snapshot_revision: INTEGRATION_PERMISSION_REVISION,
    capability_id: "get_integration_health" as const,
    capability_revision: "get_integration_health:2026-08-22.v1" as const,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8" as const,
    required_oauth_scopes: ["ops.integrations.read"] as const,
    settings_integrations_scope: "all" as const,
    accounting_scope: input.authorization.accountingScope,
    email_scope: input.authorization.emailScope,
    selections: input.authorization.query.integrations.map((selection) => ({
      ...selection,
    })),
    read_at: INTEGRATION_READ_AT,
    source_revisions: INTEGRATION_SOURCE_REVISIONS,
    source_inspected: INTEGRATION_SOURCE_INSPECTED,
    rows,
    collection_proof_ref: integrationHealthCollectionProofRef({
      context,
      children: rows.map((row, index) => ({
        selection: input.authorization.query.integrations[index]!,
        proof_ref: row.proof_ref,
        evidence_ref: row.evidence_ref,
      })),
    }),
    ...input.overrides,
  };
}
