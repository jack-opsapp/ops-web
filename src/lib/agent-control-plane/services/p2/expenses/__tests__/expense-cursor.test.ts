import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  EXPENSE_RANKING_REVISION,
  createExpenseCursorService,
} from "../expense-cursor";
import {
  EXPENSE_ID,
  EXPENSE_READ_AT,
  EXPENSE_SOURCE_REVISIONS,
  listExpenseAuthorization,
} from "./expense-fixtures";

const key = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));

describe("P2 expense cursor", () => {
  it("round-trips exact date/ID predecessor, authority, and revision", async () => {
    expect(EXPENSE_RANKING_REVISION).toBe("expense-ranking:2026-08-22.v1");
    const authorization = await listExpenseAuthorization();
    const service = createExpenseCursorService({ keyId: "expenses-v1", key });
    const predecessor = {
      item_kind: "expense" as const,
      order: ["2026-08-20", EXPENSE_ID] as const,
      tie_breaker: EXPENSE_ID,
    };
    const token = service.encode(
      {
        authorization,
        sourceRevisions: EXPENSE_SOURCE_REVISIONS,
        readAt: EXPENSE_READ_AT,
        predecessor,
      },
      1_800_000_000
    );
    const decoded = service.decode({ authorization, token }, 1_800_000_100);
    expect(decoded).toEqual({
      readAt: EXPENSE_READ_AT,
      sourceRevisions: EXPENSE_SOURCE_REVISIONS,
      predecessor,
    });
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("rejects tamper, expiry, cross-view, cross-authority, and wrong-kind replay", async () => {
    const base = await listExpenseAuthorization();
    const service = createExpenseCursorService({ keyId: "expenses-v1", key });
    const token = service.encode(
      {
        authorization: base,
        sourceRevisions: EXPENSE_SOURCE_REVISIONS,
        readAt: EXPENSE_READ_AT,
        predecessor: {
          item_kind: "expense",
          order: ["2026-08-20", EXPENSE_ID],
          tie_breaker: EXPENSE_ID,
        },
      },
      1_800_000_000
    );
    const company = await listExpenseAuthorization({
      view: { kind: "company" },
    });
    const own = await listExpenseAuthorization(
      { view: { kind: "mine" } },
      { "expenses.view": "own" }
    );
    for (const attempt of [
      () =>
        service.decode(
          { authorization: base, token: `${token.slice(0, -1)}x` },
          1_800_000_100
        ),
      () => service.decode({ authorization: base, token }, 1_800_001_000),
      () => service.decode({ authorization: company, token }, 1_800_000_100),
      () => service.decode({ authorization: own, token }, 1_800_000_100),
      () =>
        service.encode({
          authorization: base,
          sourceRevisions: EXPENSE_SOURCE_REVISIONS,
          readAt: EXPENSE_READ_AT,
          predecessor: {
            item_kind: "reimbursement_batch",
            order: ["2026-08-20", EXPENSE_ID],
            tie_breaker: EXPENSE_ID,
          },
        }),
    ]) {
      expect(attempt).toThrow(P2ReadCursorError);
    }
  });
});
