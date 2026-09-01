import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod-v4";

import {
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import type {
  ExpenseListItem,
  GetExpenseContextResult,
} from "@/lib/agent-control-plane/contracts/expenses";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type {
  AuthorizedGetExpenseContextRead,
  AuthorizedListExpensesRead,
  ExpenseAuthorizationCandidateBinding,
} from "./expense-authorization";
import type { ExpenseCursorContext } from "./expense-cursor";

const ExactExpenseSourceRevisionSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => revisions.length === 1 && revisions[0]?.domain === "expenses",
  "EXPENSE_REVISION_VECTOR_INVALID"
);

export interface ExpenseSourceRevision {
  readonly domain: "expenses";
  readonly source_revision: number;
}

interface ExpenseProofAuthority {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly authorization_candidate: ExpenseAuthorizationCandidateBinding;
}

export interface ExpenseListProofContext extends ExpenseProofAuthority {
  readonly capability_id: "list_expenses";
  readonly capability_revision: "list_expenses:2026-08-22.v1";
  readonly ranking_revision: "expense-ranking:2026-08-22.v1";
  readonly query: Readonly<Record<string, unknown>>;
  readonly item_limit: number;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly ExpenseSourceRevision[];
  readonly cursor_predecessor: ExpenseCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly ExpenseSourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
}

function proofRef(material: unknown): `ops_proof:v1:${string}` {
  return `ops_proof:v1:${createHash("sha256")
    .update(canonicalOperationalProjection(material as never), "utf8")
    .digest("hex")}`;
}

function evidenceRef(material: unknown): `ops_evidence:v1:${string}` {
  return `ops_evidence:v1:${createHash("sha256")
    .update(canonicalOperationalProjection(material as never), "utf8")
    .digest("hex")}`;
}

function authorityProjection(
  authorization: AuthorizedListExpensesRead | AuthorizedGetExpenseContextRead
): ExpenseProofAuthority {
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
    authorization_candidate: authorization.authorizationCandidate,
  };
}

export function exactExpenseSourceRevisions(
  value: unknown
): readonly ExpenseSourceRevision[] {
  const parsed = ExactExpenseSourceRevisionSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("EXPENSE_REVISION_VECTOR_INVALID");
  return Object.freeze(
    parsed.data.map((revision) =>
      Object.freeze({
        domain: "expenses" as const,
        source_revision: revision.source_revision,
      })
    )
  );
}

export function expenseListProofContext(input: {
  readonly authorization: AuthorizedListExpensesRead;
  readonly cursor: ExpenseCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): ExpenseListProofContext {
  const query = input.authorization.query;
  return {
    ...authorityProjection(input.authorization),
    capability_id: "list_expenses",
    capability_revision: "list_expenses:2026-08-22.v1",
    ranking_revision: "expense-ranking:2026-08-22.v1",
    query: { view: query.view },
    item_limit: query.limit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor?.sourceRevisions ?? [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactExpenseSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function expenseEntityProofRef(input: {
  readonly context: ExpenseListProofContext;
  readonly item: ExpenseListItem;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "expense_list_entity",
    item: input.item,
  });
}

export function expenseListEvidenceRef(input: {
  readonly context: ExpenseListProofContext;
  readonly item: ExpenseListItem;
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "expense_list_evidence",
    item_ref:
      input.item.item_kind === "expense"
        ? input.item.expense_ref
        : input.item.batch_ref,
  });
}

export function expenseCollectionProofRef(input: {
  readonly context: ExpenseListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly Readonly<{
    item_ref: Readonly<{ kind: string; id: string }>;
    proof_ref: string;
    evidence_ref: string;
  }>[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "expense_list_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}

export function expenseContextEntityProofRef(input: {
  readonly authorization: AuthorizedGetExpenseContextRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: Readonly<{ allocations: number; batches: number }>;
  readonly result: Omit<GetExpenseContextResult, "evidence" | "proof">;
}) {
  return proofRef({
    ...authorityProjection(input.authorization),
    capability_id: "get_expense_context",
    capability_revision: "get_expense_context:2026-08-22.v1",
    expense_ref: input.authorization.query.expense_ref,
    read_at: input.readAt,
    source_revisions: exactExpenseSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    proof_kind: "expense_context_entity",
    result: input.result,
  });
}

export function expenseContextEvidenceRef(input: {
  readonly companyId: string;
  readonly expenseId: string;
  readonly occurredAt: string;
}) {
  return evidenceRef({
    proof_kind: "expense_context_evidence",
    source_domain: "expenses",
    source_type: "expense",
    company_id: input.companyId,
    expense_ref: { kind: "expense", id: input.expenseId },
    occurred_at: input.occurredAt,
  });
}

export const ExpenseProofRefSchema = z
  .string()
  .regex(/^ops_proof:v1:[0-9a-f]{64}$/);
export const ExpenseEvidenceRefSchema = z
  .string()
  .regex(/^ops_evidence:v1:[0-9a-f]{64}$/);
