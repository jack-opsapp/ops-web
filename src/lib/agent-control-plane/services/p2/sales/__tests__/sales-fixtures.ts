import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  GetSalesDocumentInputSchema,
  ListSalesDocumentsInputSchema,
  SalesDocumentHeaderSchema,
  type SalesDocumentHeader,
  type SalesDocumentKind,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import {
  GET_SALES_DOCUMENT_CANDIDATE,
  LIST_SALES_DOCUMENTS_CANDIDATE,
  selectedGetSalesDocumentVariantKeys,
  selectedListSalesDocumentsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/sales";
import type { PermissionScope } from "@/lib/types/permissions";
import {
  authorizeGetSalesDocumentRead,
  authorizeListSalesDocumentsRead,
} from "../sales-authorization";

export const SALES_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const SALES_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const SALES_CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
export const SALES_DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
export const SALES_GRANT_ID = "55555555-5555-4555-8555-555555555555";
export const SALES_CLIENT_ID = "66666666-6666-4666-8666-666666666666";
export const SALES_JOB_ID = "77777777-7777-4777-8777-777777777777";
export const SALES_LINE_ID = "88888888-8888-4888-8888-888888888888";
export const SALES_MILESTONE_ID = "99999999-9999-4999-8999-999999999999";
export const SALES_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const SALES_READ_AT = "2026-08-28T12:00:00.000Z";
export const SALES_SOURCE_REVISIONS = Object.freeze([
  { domain: "legacy_operational", source_revision: 8 },
  { domain: "sales_documents", source_revision: 13 },
] as const);

export type SalesPermissions = Readonly<
  Partial<
    Record<
      | "estimates.view"
      | "invoices.view"
      | "pipeline.view"
      | "projects.view"
      | "projects.view_financials",
      PermissionScope | null
    >
  >
>;

const DEFAULT_PERMISSIONS: SalesPermissions = Object.freeze({
  "estimates.view": "all",
  "invoices.view": "all",
  "pipeline.view": "all",
  "projects.view": "all",
  "projects.view_financials": "all",
});

function authority(input: {
  readonly actorUserId: string;
  readonly permissions: SalesPermissions;
}): ActorAuthoritySnapshot {
  const entries = Object.entries(input.permissions).filter(
    (entry): entry is [string, PermissionScope] => entry[1] !== null
  );
  return {
    actorUserId: input.actorUserId,
    companyId: SALES_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    configuredPermissions: entries.map(([permission]) => permission),
    effectivePermissions: entries.map(([permission, scope]) => ({
      permission,
      scope,
    })),
    permissionSnapshotRevision: SALES_PERMISSION_REVISION,
  };
}

async function actorContext(input: {
  readonly actorUserId?: string;
  readonly permissions?: SalesPermissions;
  readonly oauthScopes?: readonly string[];
}) {
  const actorUserId = input.actorUserId ?? SALES_ACTOR_ID;
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId,
      companyId: SALES_COMPANY_ID,
      oauthGrantId: SALES_GRANT_ID,
      oauthClientId: SALES_CLIENT_ID,
      validatedScopes: input.oauthScopes ?? ["ops.financial_documents.read"],
      tokenId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority({
        actorUserId,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
      })
    ),
    requestId: "request-sales-document-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function salesCandidateAuthorizations(input: {
  readonly candidate:
    | typeof LIST_SALES_DOCUMENTS_CANDIDATE
    | typeof GET_SALES_DOCUMENT_CANDIDATE;
  readonly keys: readonly SalesDocumentKind[];
  readonly actorUserId?: string;
  readonly permissions?: SalesPermissions;
  readonly oauthScopes?: readonly string[];
}) {
  const context = await actorContext(input);
  const policies = new Map(
    input.candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  return Object.fromEntries(
    input.keys.flatMap((key) => {
      try {
        return [
          [
            key,
            authorizeCapability({
              actorContext: context,
              policy: policies.get(key)!,
            }),
          ],
        ];
      } catch {
        return [];
      }
    })
  );
}

export async function listSalesAuthorization(
  rawQuery: unknown = {},
  permissions: SalesPermissions = DEFAULT_PERMISSIONS
) {
  const query = ListSalesDocumentsInputSchema.parse(rawQuery);
  const keys = selectedListSalesDocumentsVariantKeys(query);
  return authorizeListSalesDocumentsRead({
    query,
    authorizations: await salesCandidateAuthorizations({
      candidate: LIST_SALES_DOCUMENTS_CANDIDATE,
      keys,
      permissions,
    }),
  });
}

export async function getSalesAuthorization(
  kind: SalesDocumentKind = "estimate",
  permissions: SalesPermissions = DEFAULT_PERMISSIONS
) {
  const query = GetSalesDocumentInputSchema.parse({
    document_ref: { kind, id: SALES_DOCUMENT_ID },
  });
  const keys = selectedGetSalesDocumentVariantKeys(query);
  return authorizeGetSalesDocumentRead({
    query,
    authorizations: await salesCandidateAuthorizations({
      candidate: GET_SALES_DOCUMENT_CANDIDATE,
      keys,
      permissions,
    }),
  });
}

type EstimateSalesDocumentHeader = Extract<
  SalesDocumentHeader,
  { document_ref: { kind: "estimate" } }
>;
type InvoiceSalesDocumentHeader = Extract<
  SalesDocumentHeader,
  { document_ref: { kind: "invoice" } }
>;

export function salesHeader(): EstimateSalesDocumentHeader;
export function salesHeader(
  kind: "estimate",
  overrides?: Readonly<Record<string, unknown>>
): EstimateSalesDocumentHeader;
export function salesHeader(
  kind: "invoice",
  overrides?: Readonly<Record<string, unknown>>
): InvoiceSalesDocumentHeader;
export function salesHeader(
  kind: SalesDocumentKind,
  overrides?: Readonly<Record<string, unknown>>
): SalesDocumentHeader;
export function salesHeader(
  kind: SalesDocumentKind = "estimate",
  overrides: Readonly<Record<string, unknown>> = {}
): SalesDocumentHeader {
  return SalesDocumentHeaderSchema.parse(
    kind === "estimate"
      ? {
          document_ref: { kind, id: SALES_DOCUMENT_ID },
          customer_ref: { kind: "customer", id: SALES_CUSTOMER_ID },
          job_ref: { kind: "opportunity", id: SALES_JOB_ID },
          document_number: "EST-2026-00001",
          title: "Carly Hunter deck",
          status: "sent",
          issue_date: "2026-08-20",
          expiration_date: "2026-09-20",
          total: { amount_minor: 125_000, currency: "CAD" },
          updated_at: "2026-08-28T11:00:00.000Z",
          content_kind: "untrusted_business_data",
          ...overrides,
        }
      : {
          document_ref: { kind, id: SALES_DOCUMENT_ID },
          customer_ref: { kind: "customer", id: SALES_CUSTOMER_ID },
          job_ref: { kind: "project", id: SALES_JOB_ID },
          document_number: "INV-2026-00001",
          title: "Carly Hunter deck",
          status: "partially_paid",
          issue_date: "2026-08-21",
          due_date: "2026-09-20",
          paid_at: null,
          total: { amount_minor: 125_000, currency: "CAD" },
          amount_paid: { amount_minor: 25_000, currency: "CAD" },
          balance_due: { amount_minor: 100_000, currency: "CAD" },
          updated_at: "2026-08-28T10:00:00.000Z",
          content_kind: "untrusted_business_data",
          ...overrides,
        }
  );
}
