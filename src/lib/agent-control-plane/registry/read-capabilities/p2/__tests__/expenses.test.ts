import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  EXPENSE_AUTHORIZATION_VARIANT_KEYS,
  GET_EXPENSE_CONTEXT_CANDIDATE,
  LIST_EXPENSES_CANDIDATE,
  selectedGetExpenseContextVariantKeys,
  selectedListExpensesVariantKeys,
} from "../expenses";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("P2 expense candidates", () => {
  it("keeps list and context implementation-only, read-only, bounded, and immutable", () => {
    expect(LIST_EXPENSES_CANDIDATE).toMatchObject({
      name: "list_expenses",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      bounds: {
        maxInputBytes: 8_192,
        maxOutputCharacters: 60_000,
        maxResultItems: 25,
      },
      availability: { implementation: "available" },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(GET_EXPENSE_CONTEXT_CANDIDATE).toMatchObject({
      name: "get_expense_context",
      bounds: { maxResultItems: 1 },
      availability: { implementation: "available" },
    });
    for (const candidate of [
      LIST_EXPENSES_CANDIDATE,
      GET_EXPENSE_CONTEXT_CANDIDATE,
    ]) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(
        CAPABILITY_MANIFEST.some((entry) => entry.name === candidate.name)
      ).toBe(false);
    }
  });

  it("pins the five exact variants and never accepts a caller-selected employee", () => {
    expect(EXPENSE_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "mine",
      "company",
      "job",
      "pending_approval",
      "reimbursement_batches",
    ]);
    expect(selectedListExpensesVariantKeys({})).toEqual(["mine"]);
    for (const key of ["mine", "company", "pending_approval"] as const) {
      expect(selectedListExpensesVariantKeys({ view: { kind: key } })).toEqual([
        key,
      ]);
    }
    expect(
      selectedListExpensesVariantKeys({
        view: { kind: "job", job_ref: { kind: "project", id: UUID } },
      })
    ).toEqual(["job"]);
    expect(
      selectedListExpensesVariantKeys({
        view: { kind: "reimbursement_batches" },
      })
    ).toEqual(["reimbursement_batches"]);
    expect(() =>
      selectedListExpensesVariantKeys({
        view: { kind: "employee", user_id: UUID },
      })
    ).toThrow();
  });

  it("pins exact own/all/job/approval permission unions", () => {
    const policies = Object.fromEntries(
      LIST_EXPENSES_CANDIDATE.authorization.variants.map((variant) => [
        variant.key,
        variant.policy,
      ])
    );
    expect(policies.mine.requiredOAuthScopes).toEqual(["ops.expenses.read"]);
    expect(policies.mine.permissionRequirementGroups).toEqual([
      [{ permission: "expenses.view", allowedScopes: ["all", "own"] }],
    ]);
    expect(policies.company.permissionRequirementGroups).toEqual([
      [{ permission: "expenses.view", allowedScopes: ["all"] }],
    ]);
    expect(policies.job.requiredOAuthScopes).toEqual([
      "ops.expenses.read",
      "ops.jobs.read",
    ]);
    expect(policies.job.permissionRequirementGroups).toEqual([
      [
        { permission: "expenses.view", allowedScopes: ["all", "own"] },
        { permission: "projects.view", allowedScopes: ["all", "assigned"] },
      ],
    ]);
    expect(policies.pending_approval.permissionRequirementGroups).toEqual([
      [
        { permission: "expenses.approve", allowedScopes: ["all", "assigned"] },
        { permission: "expenses.view", allowedScopes: ["all"] },
      ],
    ]);
    expect(policies.reimbursement_batches.permissionRequirementGroups).toEqual([
      [
        { permission: "expenses.approve", allowedScopes: ["all", "assigned"] },
        { permission: "expenses.view", allowedScopes: ["all"] },
      ],
      [{ permission: "expenses.view", allowedScopes: ["all"] }],
      [{ permission: "expenses.view", allowedScopes: ["own"] }],
    ]);
  });

  it("uses the same ordered own/all/approval policy for exact context", () => {
    const policy =
      GET_EXPENSE_CONTEXT_CANDIDATE.authorization.variants[0]!.policy;
    expect(policy.requiredOAuthScopes).toEqual(["ops.expenses.read"]);
    expect(policy.permissionRequirementGroups).toEqual([
      [
        { permission: "expenses.approve", allowedScopes: ["all", "assigned"] },
        { permission: "expenses.view", allowedScopes: ["all"] },
      ],
      [{ permission: "expenses.view", allowedScopes: ["all"] }],
      [{ permission: "expenses.view", allowedScopes: ["own"] }],
    ]);
    expect(
      selectedGetExpenseContextVariantKeys({
        expense_ref: { kind: "expense", id: UUID },
      })
    ).toEqual(["expense"]);
  });
});
