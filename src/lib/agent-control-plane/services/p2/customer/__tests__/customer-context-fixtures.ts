import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  CustomerContextInputSchema,
  type CustomerContextInput,
} from "@/lib/agent-control-plane/contracts/customer-context";
import {
  CUSTOMER_CONTEXT_CANDIDATE,
  selectedCustomerContextVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/customer-context";
import {
  authorizeCustomerContextRead,
  type AuthorizedCustomerContextRead,
} from "../customer-context-authorization";
import {
  customerContextEnvelopeProofRef,
  type CustomerContextProofEnvelope,
} from "../customer-context-proof";

export const CUSTOMER_CONTEXT_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const CUSTOMER_CONTEXT_COMPANY_ID =
  "22222222-2222-4222-8222-222222222222";
export const CUSTOMER_CONTEXT_CLIENT_ID =
  "33333333-3333-4333-8333-333333333333";
export const CUSTOMER_CONTEXT_SUB_CLIENT_ID =
  "44444444-4444-4444-8444-444444444444";
export const CUSTOMER_CONTEXT_DUPLICATE_ID =
  "55555555-5555-4555-8555-555555555555";
export const CUSTOMER_CONTEXT_OAUTH_GRANT_ID =
  "77777777-7777-4777-8777-777777777777";
export const CUSTOMER_CONTEXT_OAUTH_CLIENT_ID =
  "88888888-8888-4888-8888-888888888888";
export const CUSTOMER_CONTEXT_GRANT_REVISION = "d".repeat(32);
export const CUSTOMER_CONTEXT_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const CUSTOMER_CONTEXT_READ_AT = "2026-08-23T12:00:00.000Z";
export const CUSTOMER_CONTEXT_CONTACTABILITY_DIGEST = `sha256:${"c".repeat(64)}`;

export class StubCustomerContextRpcClient {
  readonly calls: Array<{
    readonly functionName: string;
    readonly args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly abortSignals: AbortSignal[] = [];

  constructor(
    private readonly results: Array<
      | Readonly<{ data: unknown; error: unknown }>
      | (() => PromiseLike<Readonly<{ data: unknown; error: unknown }>>)
    >
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected customer-context repository read");
    const request =
      typeof next === "function"
        ? Promise.resolve(next())
        : Promise.resolve(next);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
  }
}

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: CUSTOMER_CONTEXT_ACTOR_ID,
    companyId: CUSTOMER_CONTEXT_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["66666666-6666-4666-8666-666666666666"],
    configuredPermissions: ["clients.view", "pipeline.view", "projects.view"],
    effectivePermissions: [
      { permission: "clients.view", scope: "assigned" },
      { permission: "pipeline.view", scope: "all" },
      { permission: "projects.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: CUSTOMER_CONTEXT_PERMISSION_REVISION,
  };
}

export async function customerContextAuthorization(
  rawQuery: unknown
): Promise<AuthorizedCustomerContextRead> {
  const query = CustomerContextInputSchema.parse(rawQuery);
  const actorContext = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: CUSTOMER_CONTEXT_ACTOR_ID,
      companyId: CUSTOMER_CONTEXT_COMPANY_ID,
      oauthGrantId: CUSTOMER_CONTEXT_OAUTH_GRANT_ID,
      oauthClientId: CUSTOMER_CONTEXT_OAUTH_CLIENT_ID,
      validatedScopes: [
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
      ],
      tokenId: "token-customer-context",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: CUSTOMER_CONTEXT_GRANT_REVISION,
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-customer-context",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
  const policies = new Map(
    CUSTOMER_CONTEXT_CANDIDATE.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  const authorizations = Object.fromEntries(
    selectedCustomerContextVariantKeys(query).map((key) => [
      key,
      authorizeCapability({ actorContext, policy: policies.get(key)! }),
    ])
  );
  return authorizeCustomerContextRead({ query, authorizations });
}

export const FULL_CUSTOMER_CONTEXT_QUERY: CustomerContextInput =
  CustomerContextInputSchema.parse({
    customer_ref: { kind: "sub_client", id: CUSTOMER_CONTEXT_SUB_CLIENT_ID },
    sections: [
      "business_address",
      "profile",
      "contacts",
      "preferences",
      "duplicate_state",
      "business_notes",
      "job_rollup",
    ],
    contact_purpose: "communication",
    job_kinds: ["opportunity", "project"],
  });

function fullCustomerContextEnvelope() {
  return {
    company_id: CUSTOMER_CONTEXT_COMPANY_ID,
    actor_user_id: CUSTOMER_CONTEXT_ACTOR_ID,
    oauth_grant_id: CUSTOMER_CONTEXT_OAUTH_GRANT_ID,
    oauth_client_id: CUSTOMER_CONTEXT_OAUTH_CLIENT_ID,
    grant_revision: CUSTOMER_CONTEXT_GRANT_REVISION,
    granted_scope_ceiling: [
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.jobs.read",
    ],
    permission_snapshot_revision: CUSTOMER_CONTEXT_PERMISSION_REVISION,
    capability_id: "get_customer_context",
    capability_revision: "get_customer_context:2026-08-22.v1",
    capability_manifest_revision: "2026-08-22.capability-manifest.v8",
    required_oauth_scopes: [
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.jobs.read",
    ],
    clients_scope: "assigned",
    pipeline_scope: "all",
    projects_scope: "assigned",
    customer_ref: {
      kind: "sub_client",
      id: CUSTOMER_CONTEXT_SUB_CLIENT_ID,
    },
    selected_sections: [
      "business_address",
      "business_notes",
      "contacts",
      "duplicate_state",
      "job_rollup",
      "preferences",
      "profile",
    ],
    contact_purpose: "communication",
    job_kinds: ["opportunity", "project"],
    read_at: CUSTOMER_CONTEXT_READ_AT,
    source_revisions: [
      { domain: "customer", source_revision: 17 },
      {
        source_domain: "operations",
        source_type: "operational_read_revision",
        source_id: "private.agent_operational_read_revisions",
        version: "revision:83",
      },
      {
        source_domain: "operations",
        source_type: "contactability_revision",
        source_id: CUSTOMER_CONTEXT_CONTACTABILITY_DIGEST,
        version: "revision:19",
      },
    ],
    source_inspected: {
      contacts: 2,
      duplicate_candidates: 1,
      opportunities: 2,
      projects: 1,
    },
    result: {
      customer: {
        requested_ref: {
          kind: "sub_client",
          id: CUSTOMER_CONTEXT_SUB_CLIENT_ID,
        },
        canonical_ref: { kind: "client", id: CUSTOMER_CONTEXT_CLIENT_ID },
        relationship: "sub_client_parent",
      },
      sections: {
        business_notes: {
          notes: "Glass on the back deck only.",
          truncated: false,
          content_kind: "untrusted_business_data",
        },
        contacts: {
          purpose: "communication",
          source_count: 2,
          source_has_more: false,
          returned_count: 2,
          result_budget_omitted_count: 0,
          contacts: [
            {
              contact_ref: {
                kind: "client",
                id: CUSTOMER_CONTEXT_CLIENT_ID,
              },
              relationship: "primary_client",
              display_name: "Carly Hunter",
              title: null,
              email: {
                state: "contactable",
                address: "carly@example.com",
              },
              phone: { state: "available", number: "+12505550199" },
              content_kind: "untrusted_business_data",
            },
            {
              contact_ref: {
                kind: "sub_client",
                id: CUSTOMER_CONTEXT_SUB_CLIENT_ID,
              },
              relationship: "sub_client",
              display_name: "Carly Hunter - Site",
              title: "Site contact",
              email: { state: "blocked" },
              phone: { state: "unavailable" },
              content_kind: "untrusted_business_data",
            },
          ],
        },
        duplicate_state: {
          state: "review_required",
          source_count: 1,
          source_has_more: false,
          returned_count: 1,
          result_budget_omitted_count: 0,
          candidates: [
            {
              customer_ref: {
                kind: "client",
                id: CUSTOMER_CONTEXT_DUPLICATE_ID,
              },
              display_name: "Hunter Holdings",
              confidence: "high",
              content_kind: "untrusted_business_data",
            },
          ],
        },
        job_rollup: {
          kinds: [
            {
              kind: "opportunity",
              total_count: 1,
              status_counts: [{ status: "quoted", count: 1 }],
            },
            {
              kind: "project",
              total_count: 1,
              status_counts: [{ status: "in_progress", count: 1 }],
            },
          ],
          content_kind: "untrusted_business_data",
        },
        preferences: {
          communication: { state: "not_recorded" },
          scheduling: { state: "not_recorded" },
        },
        profile: {
          display_name: "Carly Hunter - Site",
          parent_display_name: "Carly Hunter",
          content_kind: "untrusted_business_data",
        },
        business_address: {
          address: "12 Cedar Road",
          content_kind: "untrusted_business_data",
        },
      },
    },
  };
}

export const CUSTOMER_CONTEXT_PROOF_REF = customerContextEnvelopeProofRef(
  fullCustomerContextEnvelope() as CustomerContextProofEnvelope
);

export function fullCustomerContextRaw() {
  const envelope = fullCustomerContextEnvelope();
  return {
    ...envelope,
    proof_ref: customerContextEnvelopeProofRef(
      envelope as CustomerContextProofEnvelope
    ),
  };
}

export function reproofCustomerContextRaw<T extends { proof_ref: string }>(
  raw: T
) {
  const { proof_ref: previousProofRef, ...envelope } = raw;
  void previousProofRef;
  raw.proof_ref = customerContextEnvelopeProofRef(
    envelope as unknown as CustomerContextProofEnvelope
  );
  return raw;
}
