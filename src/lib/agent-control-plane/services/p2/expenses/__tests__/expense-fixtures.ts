import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  ExpenseSummarySchema,
  GetExpenseContextInputSchema,
  ListExpensesInputSchema,
} from "@/lib/agent-control-plane/contracts/expenses";
import {
  GET_EXPENSE_CONTEXT_CANDIDATE,
  LIST_EXPENSES_CANDIDATE,
  selectedGetExpenseContextVariantKeys,
  selectedListExpensesVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/expenses";
import type { PermissionScope } from "@/lib/types/permissions";
import {
  authorizeGetExpenseContextRead,
  authorizeListExpensesRead,
} from "../expense-authorization";

export const EXPENSE_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const EXPENSE_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const EXPENSE_ID = "33333333-3333-4333-8333-333333333333";
export const EXPENSE_ALLOCATION_ID = "44444444-4444-4444-8444-444444444444";
export const EXPENSE_CATEGORY_ID = "55555555-5555-4555-8555-555555555555";
export const EXPENSE_BATCH_ID = "66666666-6666-4666-8666-666666666666";
export const EXPENSE_PROJECT_ID = "77777777-7777-4777-8777-777777777777";
export const EXPENSE_GRANT_ID = "88888888-8888-4888-8888-888888888888";
export const EXPENSE_CLIENT_ID = "99999999-9999-4999-8999-999999999999";
export const EXPENSE_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const EXPENSE_READ_AT = "2026-08-28T12:00:00.000Z";
export const EXPENSE_SOURCE_REVISIONS = Object.freeze([
  { domain: "expenses", source_revision: 19 },
] as const);

export type ExpensePermissions = Readonly<
  Partial<
    Record<
      "expenses.approve" | "expenses.view" | "projects.view",
      PermissionScope | null
    >
  >
>;

const DEFAULT_PERMISSIONS: ExpensePermissions = Object.freeze({
  "expenses.approve": "all",
  "expenses.view": "all",
  "projects.view": "all",
});

function authority(input: {
  readonly actorUserId: string;
  readonly permissions: ExpensePermissions;
  readonly isAdmin?: boolean;
}): ActorAuthoritySnapshot {
  const entries = Object.entries(input.permissions).filter(
    (entry): entry is [string, PermissionScope] => entry[1] !== null
  );
  return {
    actorUserId: input.actorUserId,
    companyId: EXPENSE_COMPANY_ID,
    isActive: true,
    isAdmin: input.isAdmin ?? false,
    roleIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    configuredPermissions: entries.map(([permission]) => permission),
    effectivePermissions: entries.map(([permission, scope]) => ({
      permission,
      scope,
    })),
    permissionSnapshotRevision: EXPENSE_PERMISSION_REVISION,
  };
}

async function actorContext(input: {
  readonly actorUserId?: string;
  readonly permissions?: ExpensePermissions;
  readonly oauthScopes?: readonly string[];
  readonly isAdmin?: boolean;
}) {
  const actorUserId = input.actorUserId ?? EXPENSE_ACTOR_ID;
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId,
      companyId: EXPENSE_COMPANY_ID,
      oauthGrantId: EXPENSE_GRANT_ID,
      oauthClientId: EXPENSE_CLIENT_ID,
      validatedScopes: input.oauthScopes ?? [
        "ops.expenses.read",
        "ops.jobs.read",
      ],
      tokenId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority({
        actorUserId,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
        isAdmin: input.isAdmin,
      })
    ),
    requestId: "request-expense-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

export async function expenseCandidateAuthorization(input: {
  readonly candidate:
    | typeof LIST_EXPENSES_CANDIDATE
    | typeof GET_EXPENSE_CONTEXT_CANDIDATE;
  readonly key: string;
  readonly actorUserId?: string;
  readonly permissions?: ExpensePermissions;
  readonly oauthScopes?: readonly string[];
  readonly isAdmin?: boolean;
}) {
  const context = await actorContext(input);
  const policy = input.candidate.authorization.variants.find(
    (variant) => variant.key === input.key
  )?.policy;
  if (!policy) throw new TypeError("EXPENSE_TEST_POLICY_MISSING");
  return authorizeCapability({ actorContext: context, policy });
}

export async function listExpenseAuthorization(
  rawQuery: unknown = {},
  permissions: ExpensePermissions = DEFAULT_PERMISSIONS,
  isAdmin = false
) {
  const query = ListExpensesInputSchema.parse(rawQuery);
  const [key] = selectedListExpensesVariantKeys(query);
  return authorizeListExpensesRead({
    query,
    authorizations: {
      [key]: await expenseCandidateAuthorization({
        candidate: LIST_EXPENSES_CANDIDATE,
        key,
        permissions,
        isAdmin,
      }),
    },
  });
}

export async function getExpenseAuthorization(
  permissions: ExpensePermissions = DEFAULT_PERMISSIONS,
  isAdmin = false
) {
  const query = GetExpenseContextInputSchema.parse({
    expense_ref: { kind: "expense", id: EXPENSE_ID },
  });
  const [key] = selectedGetExpenseContextVariantKeys(query);
  return authorizeGetExpenseContextRead({
    query,
    authorizations: {
      [key]: await expenseCandidateAuthorization({
        candidate: GET_EXPENSE_CONTEXT_CANDIDATE,
        key,
        permissions,
        isAdmin,
      }),
    },
  });
}

export function expenseSummary(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return ExpenseSummarySchema.parse({
    item_kind: "expense",
    expense_ref: { kind: "expense", id: EXPENSE_ID },
    submitted_by: {
      team_member_ref: { kind: "team_member", id: EXPENSE_ACTOR_ID },
      display_name: "Carly Hunter",
      content_kind: "untrusted_business_data",
    },
    category: {
      kind: "category",
      category_ref: { kind: "expense_category", id: EXPENSE_CATEGORY_ID },
      name: "Materials",
      content_kind: "untrusted_business_data",
    },
    merchant_name: "Deck Supply",
    expense_date: "2026-08-20",
    amount: { amount_minor: 12_345, currency: "CAD" },
    tax_amount: { amount_minor: 1_605, currency: "CAD" },
    lifecycle: "submitted",
    batch_ref: null,
    allocations: [
      {
        allocation_ref: {
          kind: "expense_allocation",
          id: EXPENSE_ALLOCATION_ID,
        },
        project_ref: { kind: "project", id: EXPENSE_PROJECT_ID },
        percentage_basis_points: 10_000,
        amount: { amount_minor: 12_345, currency: "CAD" },
      },
    ],
    updated_at: "2026-08-28T11:00:00.000Z",
    content_kind: "untrusted_business_data",
    ...overrides,
  });
}
