import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  ListPaymentsInputSchema,
  PaymentLedgerItemSchema,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import {
  LIST_PAYMENTS_CANDIDATE,
  selectedListPaymentsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/payments";
import type { PermissionScope } from "@/lib/types/permissions";
import { authorizeListPaymentsRead } from "../payment-authorization";

export const PAYMENT_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const PAYMENT_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
export const PAYMENT_INVOICE_ID = "44444444-4444-4444-8444-444444444444";
export const PAYMENT_CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
export const PAYMENT_JOB_ID = "66666666-6666-4666-8666-666666666666";
export const PAYMENT_GRANT_ID = "77777777-7777-4777-8777-777777777777";
export const PAYMENT_CLIENT_ID = "88888888-8888-4888-8888-888888888888";
export const PAYMENT_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const PAYMENT_READ_AT = "2026-08-28T12:00:00.000Z";
export const PAYMENT_SOURCE_REVISIONS = Object.freeze([
  { domain: "legacy_operational", source_revision: 7 },
  { domain: "payments", source_revision: 13 },
  { domain: "sales_documents", source_revision: 11 },
] as const);

export type PaymentPermissions = Readonly<
  Partial<
    Record<
      "finances.view" | "invoices.view" | "pipeline.view" | "projects.view",
      PermissionScope | null
    >
  >
>;

const DEFAULT_PERMISSIONS: PaymentPermissions = Object.freeze({
  "finances.view": "all",
  "invoices.view": "all",
  "pipeline.view": "all",
  "projects.view": "all",
});

function authority(input: {
  readonly actorUserId: string;
  readonly permissions: PaymentPermissions;
}): ActorAuthoritySnapshot {
  const entries = Object.entries(input.permissions).filter(
    (entry): entry is [string, PermissionScope] => entry[1] !== null
  );
  return {
    actorUserId: input.actorUserId,
    companyId: PAYMENT_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["99999999-9999-4999-8999-999999999999"],
    configuredPermissions: entries.map(([permission]) => permission),
    effectivePermissions: entries.map(([permission, scope]) => ({
      permission,
      scope,
    })),
    permissionSnapshotRevision: PAYMENT_PERMISSION_REVISION,
  };
}

export async function paymentCandidateAuthorization(
  input: {
    readonly permissions?: PaymentPermissions;
    readonly oauthScopes?: readonly string[];
  } = {}
) {
  const actorContext = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: PAYMENT_ACTOR_ID,
      companyId: PAYMENT_COMPANY_ID,
      oauthGrantId: PAYMENT_GRANT_ID,
      oauthClientId: PAYMENT_CLIENT_ID,
      validatedScopes: input.oauthScopes ?? ["ops.payments.read"],
      tokenId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority({
        actorUserId: PAYMENT_ACTOR_ID,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
      })
    ),
    requestId: "request-payment-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
  return authorizeCapability({
    actorContext,
    policy: LIST_PAYMENTS_CANDIDATE.authorization.variants[0]!.policy,
  });
}

export async function listPaymentAuthorization(
  rawQuery: unknown = {},
  permissions: PaymentPermissions = DEFAULT_PERMISSIONS
) {
  const query = ListPaymentsInputSchema.parse(rawQuery);
  const [key] = selectedListPaymentsVariantKeys(query);
  return authorizeListPaymentsRead({
    query,
    authorizations: {
      [key]: await paymentCandidateAuthorization({ permissions }),
    },
  });
}

export function paymentItem(overrides: Readonly<Record<string, unknown>> = {}) {
  return PaymentLedgerItemSchema.parse({
    payment_ref: { kind: "payment", id: PAYMENT_ID },
    invoice_ref: { kind: "invoice", id: PAYMENT_INVOICE_ID },
    customer_ref: { kind: "customer", id: PAYMENT_CUSTOMER_ID },
    job_ref: { kind: "project", id: PAYMENT_JOB_ID },
    amount: { amount_minor: 25_000, currency: "CAD" },
    payment_date: "2026-08-22",
    method_category: "card",
    reconciliation_state: "applied",
    voided_at: null,
    content_kind: "untrusted_business_data",
    ...overrides,
  });
}
