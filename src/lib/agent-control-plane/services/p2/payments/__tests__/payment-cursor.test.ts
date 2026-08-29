import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  PAYMENT_RANKING_REVISION,
  createPaymentCursorService,
} from "../payment-cursor";
import {
  PAYMENT_ID,
  PAYMENT_READ_AT,
  PAYMENT_SOURCE_REVISIONS,
  listPaymentAuthorization,
} from "./payment-fixtures";

const key = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));

describe("P2 payment cursor", () => {
  it("round-trips exact date/ID predecessor, authority, query, and revisions", async () => {
    expect(PAYMENT_RANKING_REVISION).toBe("payment-ranking:2026-08-22.v1");
    const authorization = await listPaymentAuthorization();
    const cursors = createPaymentCursorService({ keyId: "payments-v1", key });
    const predecessor = {
      order: ["2026-08-22", PAYMENT_ID] as const,
      tie_breaker: PAYMENT_ID,
    };
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: PAYMENT_SOURCE_REVISIONS,
        readAt: PAYMENT_READ_AT,
        predecessor,
      },
      1_800_000_000
    );
    expect(cursors.decode({ authorization, token }, 1_800_000_100)).toEqual({
      readAt: PAYMENT_READ_AT,
      sourceRevisions: PAYMENT_SOURCE_REVISIONS,
      predecessor,
    });
  });

  it("rejects tamper, expiry, cross-filter, cross-authority, and revision substitution", async () => {
    const authorization = await listPaymentAuthorization();
    const cursors = createPaymentCursorService({ keyId: "payments-v1", key });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: PAYMENT_SOURCE_REVISIONS,
        readAt: PAYMENT_READ_AT,
        predecessor: {
          order: ["2026-08-22", PAYMENT_ID],
          tie_breaker: PAYMENT_ID,
        },
      },
      1_800_000_000
    );
    const filtered = await listPaymentAuthorization({
      reconciliation_states: ["voided"],
    });
    const assigned = await listPaymentAuthorization(
      {},
      {
        "finances.view": "all",
        "invoices.view": "assigned",
        "projects.view": "assigned",
      }
    );
    for (const attempt of [
      () =>
        cursors.decode(
          { authorization, token: `${token.slice(0, -1)}x` },
          1_800_000_100
        ),
      () => cursors.decode({ authorization, token }, 1_800_001_000),
      () => cursors.decode({ authorization: filtered, token }, 1_800_000_100),
      () => cursors.decode({ authorization: assigned, token }, 1_800_000_100),
      () =>
        cursors.encode({
          authorization,
          sourceRevisions: PAYMENT_SOURCE_REVISIONS.slice(1),
          readAt: PAYMENT_READ_AT,
          predecessor: {
            order: ["2026-08-22", PAYMENT_ID],
            tie_breaker: PAYMENT_ID,
          },
        }),
    ]) {
      expect(attempt).toThrow(P2ReadCursorError);
    }
  });
});
