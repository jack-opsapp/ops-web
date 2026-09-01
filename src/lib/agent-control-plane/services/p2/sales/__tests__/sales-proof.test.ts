import { describe, expect, it } from "vitest";

import {
  exactSalesDocumentSourceRevisions,
  salesDocumentCollectionProofRef,
  salesDocumentDetailEvidenceRef,
  salesDocumentEntityProofRef,
  salesDocumentListEvidenceRef,
  salesDocumentListProofContext,
} from "../sales-proof";
import {
  SALES_READ_AT,
  SALES_SOURCE_REVISIONS,
  listSalesAuthorization,
  salesHeader,
} from "./sales-fixtures";

describe("P2 sales-document proof material", () => {
  it("accepts only the exact sales and legacy revision vector", () => {
    expect(exactSalesDocumentSourceRevisions(SALES_SOURCE_REVISIONS)).toEqual(
      SALES_SOURCE_REVISIONS
    );
    for (const invalid of [
      [{ domain: "sales_documents", source_revision: 13 }],
      [...SALES_SOURCE_REVISIONS].reverse(),
      [SALES_SOURCE_REVISIONS[0], { domain: "payments", source_revision: 13 }],
    ]) {
      expect(() => exactSalesDocumentSourceRevisions(invalid)).toThrow(
        "SALES_DOCUMENT_REVISION_VECTOR_INVALID"
      );
    }
  });

  it("binds policy, cursor, source work, authority path, money, and children", async () => {
    const authorization = await listSalesAuthorization();
    const context = salesDocumentListProofContext({
      authorization,
      cursor: null,
      readAt: SALES_READ_AT,
      sourceRevisions: SALES_SOURCE_REVISIONS,
      sourceInspected: 2,
      sourceHasMore: false,
    });
    const item = salesHeader();
    const selected = authorization.authorizationCandidates[0];
    const entity = salesDocumentEntityProofRef({
      context,
      item,
      selectedAuthorization: selected,
      authorityPath: "opportunity",
    });
    const evidence = salesDocumentListEvidenceRef({
      context,
      item,
      selectedAuthorization: selected,
      authorityPath: "opportunity",
    });
    const collection = salesDocumentCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          document_ref: item.document_ref,
          proof_ref: entity,
          evidence_ref: evidence,
        },
      ],
    });
    for (const value of [entity, collection]) {
      expect(value).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    }
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(
      salesDocumentEntityProofRef({
        context,
        item: salesHeader("estimate", {
          total: { amount_minor: 125_001, currency: "CAD" },
        }),
        selectedAuthorization: selected,
        authorityPath: "opportunity",
      })
    ).not.toBe(entity);
    expect(
      salesDocumentDetailEvidenceRef({
        companyId: authorization.actorContext.companyId,
        documentRef: item.document_ref,
        updatedAt: item.updated_at,
      })
    ).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
  });
});
