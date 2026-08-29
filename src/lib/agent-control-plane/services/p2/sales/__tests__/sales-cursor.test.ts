import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  SALES_DOCUMENT_RANKING_REVISION,
  createSalesDocumentCursorService,
} from "../sales-cursor";
import {
  SALES_CUSTOMER_ID,
  SALES_DOCUMENT_ID,
  SALES_READ_AT,
  SALES_SOURCE_REVISIONS,
  listSalesAuthorization,
} from "./sales-fixtures";

const key = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));

describe("P2 sales-document cursor", () => {
  it("round-trips the exact descending-date predecessor and immutable context", async () => {
    expect(SALES_DOCUMENT_RANKING_REVISION).toBe(
      "sales-document-ranking:2026-08-22.v1"
    );
    const authorization = await listSalesAuthorization();
    const service = createSalesDocumentCursorService({
      keyId: "sales-v1",
      key,
    });
    const predecessor = {
      order: [SALES_READ_AT, "estimate", SALES_DOCUMENT_ID],
      tie_breaker: SALES_DOCUMENT_ID,
    } as const;
    const token = service.encode(
      {
        authorization,
        sourceRevisions: SALES_SOURCE_REVISIONS,
        readAt: SALES_READ_AT,
        predecessor,
      },
      1_800_000_000
    );
    const decoded = service.decode({ authorization, token }, 1_800_000_100);
    expect(decoded).toEqual({
      readAt: SALES_READ_AT,
      sourceRevisions: SALES_SOURCE_REVISIONS,
      predecessor,
    });
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("rejects tamper, expiry, cross-filter, and cross-kind replay", async () => {
    const base = await listSalesAuthorization();
    const service = createSalesDocumentCursorService({
      keyId: "sales-v1",
      key,
    });
    const token = service.encode(
      {
        authorization: base,
        sourceRevisions: SALES_SOURCE_REVISIONS,
        readAt: SALES_READ_AT,
        predecessor: {
          order: [SALES_READ_AT, "estimate", SALES_DOCUMENT_ID],
          tie_breaker: SALES_DOCUMENT_ID,
        },
      },
      1_800_000_000
    );
    const filtered = await listSalesAuthorization({
      customer_ref: { kind: "customer", id: SALES_CUSTOMER_ID },
    });
    const invoices = await listSalesAuthorization({
      document_kinds: ["invoice"],
    });
    for (const attempt of [
      () =>
        service.decode(
          { authorization: base, token: `${token.slice(0, -1)}x` },
          1_800_000_100
        ),
      () => service.decode({ authorization: base, token }, 1_800_001_000),
      () => service.decode({ authorization: filtered, token }, 1_800_000_100),
      () => service.decode({ authorization: invoices, token }, 1_800_000_100),
    ]) {
      expect(attempt).toThrow(P2ReadCursorError);
    }
  });
});
