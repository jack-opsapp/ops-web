import { describe, expect, it } from "vitest";

import {
  GetExpenseContextInputSchema,
  ListExpensesInputSchema,
} from "@/lib/agent-control-plane/contracts/expenses";
import {
  GET_EXPENSE_CONTEXT_CANDIDATE,
  LIST_EXPENSES_CANDIDATE,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/expenses";
import {
  authorizeGetExpenseContextRead,
  authorizeListExpensesRead,
  ExpenseReadAuthorizationError,
  isAuthorizedGetExpenseContextRead,
  isAuthorizedListExpensesRead,
} from "../expense-authorization";
import {
  EXPENSE_ID,
  expenseCandidateAuthorization,
  getExpenseAuthorization,
  listExpenseAuthorization,
} from "./expense-fixtures";

describe("P2 expense nominal authorization", () => {
  it("mints exact mine, company, job, pending, and batch authority", async () => {
    const mine = await listExpenseAuthorization(
      { view: { kind: "mine" } },
      { "expenses.view": "own" }
    );
    expect(isAuthorizedListExpensesRead(mine)).toBe(true);
    expect(mine.authorizationCandidate).toMatchObject({
      variantKey: "mine",
      expensesViewScope: "own",
      expensesApproveScope: null,
      projectsViewScope: null,
      satisfiedPermissionGroupIndexes: [0],
    });

    const pending = await listExpenseAuthorization(
      { view: { kind: "pending_approval" } },
      { "expenses.view": "all", "expenses.approve": "assigned" }
    );
    expect(pending.authorizationCandidate).toMatchObject({
      variantKey: "pending_approval",
      expensesViewScope: "all",
      expensesApproveScope: "assigned",
      satisfiedPermissionGroupIndexes: [0],
    });

    const job = await listExpenseAuthorization(
      {
        view: {
          kind: "job",
          job_ref: {
            kind: "project",
            id: "77777777-7777-4777-8777-777777777777",
          },
        },
      },
      { "expenses.view": "own", "projects.view": "assigned" }
    );
    expect(job.authorizationCandidate).toMatchObject({
      variantKey: "job",
      expensesViewScope: "own",
      projectsViewScope: "assigned",
    });

    const batches = await listExpenseAuthorization(
      { view: { kind: "reimbursement_batches" } },
      { "expenses.view": "all", "expenses.approve": "all" }
    );
    expect(batches.authorizationCandidate).toMatchObject({
      variantKey: "reimbursement_batches",
      expensesViewScope: "all",
      expensesApproveScope: "all",
      satisfiedPermissionGroupIndexes: [0, 1],
    });
  });

  it("mints detail own/all/approval authority but never caller-selected authority", async () => {
    const proof = await getExpenseAuthorization({
      "expenses.view": "all",
      "expenses.approve": "assigned",
    });
    expect(isAuthorizedGetExpenseContextRead(proof)).toBe(true);
    expect(proof.authorizationCandidate).toMatchObject({
      variantKey: "expense",
      expensesViewScope: "all",
      expensesApproveScope: "assigned",
      satisfiedPermissionGroupIndexes: [0, 1],
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.authorizationCandidate)).toBe(true);
  });

  it("rejects absent approval, company-own, missing job scope, missing OAuth, and borrowed proofs", async () => {
    await expect(
      listExpenseAuthorization(
        { view: { kind: "pending_approval" } },
        { "expenses.view": "all", "expenses.approve": null }
      )
    ).rejects.toBeTruthy();
    await expect(
      listExpenseAuthorization(
        { view: { kind: "company" } },
        { "expenses.view": "own" }
      )
    ).rejects.toBeTruthy();
    await expect(
      listExpenseAuthorization(
        {
          view: {
            kind: "job",
            job_ref: {
              kind: "project",
              id: "77777777-7777-4777-8777-777777777777",
            },
          },
        },
        { "expenses.view": "all", "projects.view": null }
      )
    ).rejects.toBeTruthy();

    const query = ListExpensesInputSchema.parse({ view: { kind: "mine" } });
    const nominal = await expenseCandidateAuthorization({
      candidate: LIST_EXPENSES_CANDIDATE,
      key: "mine",
      oauthScopes: ["ops.jobs.read"],
      permissions: { "expenses.view": "own" },
    }).catch(() => null);
    expect(nominal).toBeNull();

    const detailQuery = GetExpenseContextInputSchema.parse({
      expense_ref: { kind: "expense", id: EXPENSE_ID },
    });
    const detailNominal = await expenseCandidateAuthorization({
      candidate: GET_EXPENSE_CONTEXT_CANDIDATE,
      key: "expense",
    });
    for (const authorizations of [
      {},
      { expense: { ...detailNominal } },
      { expense: detailNominal, extra: detailNominal },
    ]) {
      expect(() =>
        authorizeGetExpenseContextRead({
          query: detailQuery,
          authorizations,
        })
      ).toThrow(ExpenseReadAuthorizationError);
    }

    expect(() =>
      authorizeListExpensesRead({
        query,
        authorizations: { company: detailNominal },
      })
    ).toThrow(ExpenseReadAuthorizationError);
  });
});
