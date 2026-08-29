import { describe, expect, it } from "vitest";

import {
  GetSalesDocumentInputSchema,
  ListSalesDocumentsInputSchema,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import {
  GET_SALES_DOCUMENT_CANDIDATE,
  LIST_SALES_DOCUMENTS_CANDIDATE,
  selectedGetSalesDocumentVariantKeys,
  selectedListSalesDocumentsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/sales";
import {
  authorizeGetSalesDocumentRead,
  authorizeListSalesDocumentsRead,
  isAuthorizedGetSalesDocumentRead,
  isAuthorizedListSalesDocumentsRead,
  SalesDocumentReadAuthorizationError,
} from "../sales-authorization";
import {
  SALES_DOCUMENT_ID,
  salesCandidateAuthorizations,
} from "./sales-fixtures";

describe("P2 sales-document nominal authorization", () => {
  it("mints independently authorized estimate and invoice candidates", async () => {
    const query = ListSalesDocumentsInputSchema.parse({});
    const keys = selectedListSalesDocumentsVariantKeys(query);
    const proof = authorizeListSalesDocumentsRead({
      query,
      authorizations: await salesCandidateAuthorizations({
        candidate: LIST_SALES_DOCUMENTS_CANDIDATE,
        keys,
      }),
    });

    expect(isAuthorizedListSalesDocumentsRead(proof)).toBe(true);
    expect(proof.variantKeys).toEqual(["estimate", "invoice"]);
    expect(proof.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "estimate",
        documentScope: "all",
        pipelineScope: "all",
        projectsScope: "all",
        projectFinancialsScope: "all",
        satisfiedPermissionGroupIndexes: [0, 1, 2],
      }),
      expect.objectContaining({
        variantKey: "invoice",
        documentScope: "all",
        pipelineScope: "all",
        projectsScope: "all",
        projectFinancialsScope: "all",
        satisfiedPermissionGroupIndexes: [0, 1, 2],
      }),
    ]);
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.authorizationCandidates)).toBe(true);
  });

  it("keeps assigned documents job-bound and does not mint unlinked authority", async () => {
    const query = GetSalesDocumentInputSchema.parse({
      document_ref: { kind: "estimate", id: SALES_DOCUMENT_ID },
    });
    const keys = selectedGetSalesDocumentVariantKeys(query);
    const proof = authorizeGetSalesDocumentRead({
      query,
      authorizations: await salesCandidateAuthorizations({
        candidate: GET_SALES_DOCUMENT_CANDIDATE,
        keys,
        permissions: {
          "estimates.view": "assigned",
          "invoices.view": null,
          "pipeline.view": "assigned",
          "projects.view": "assigned",
          "projects.view_financials": "all",
        },
      }),
    });

    expect(isAuthorizedGetSalesDocumentRead(proof)).toBe(true);
    expect(proof.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "estimate",
        documentScope: "assigned",
        satisfiedPermissionGroupIndexes: [0, 1],
      }),
    ]);
  });

  it("does not mint a project branch without projects.view_financials=all", async () => {
    const query = GetSalesDocumentInputSchema.parse({
      document_ref: { kind: "invoice", id: SALES_DOCUMENT_ID },
    });
    const keys = selectedGetSalesDocumentVariantKeys(query);
    const proof = authorizeGetSalesDocumentRead({
      query,
      authorizations: await salesCandidateAuthorizations({
        candidate: GET_SALES_DOCUMENT_CANDIDATE,
        keys,
        permissions: {
          "estimates.view": null,
          "invoices.view": "assigned",
          "pipeline.view": "assigned",
          "projects.view": "assigned",
          "projects.view_financials": null,
        },
      }),
    });
    expect(proof.authorizationCandidates[0]).toMatchObject({
      satisfiedPermissionGroupIndexes: [0],
      projectsScope: null,
      projectFinancialsScope: null,
    });
  });

  it("rejects missing, extra, borrowed, reconstructed, and mixed-actor proofs", async () => {
    const query = ListSalesDocumentsInputSchema.parse({});
    const keys = selectedListSalesDocumentsVariantKeys(query);
    const exact = await salesCandidateAuthorizations({
      candidate: LIST_SALES_DOCUMENTS_CANDIDATE,
      keys,
    });
    const otherActor = await salesCandidateAuthorizations({
      candidate: LIST_SALES_DOCUMENTS_CANDIDATE,
      keys: ["invoice"],
      actorUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    for (const invalid of [
      {},
      { estimate: exact.estimate },
      { ...exact, extra: exact.estimate },
      { estimate: exact.invoice, invoice: exact.estimate },
      { estimate: { ...exact.estimate }, invoice: exact.invoice },
      { estimate: exact.estimate, invoice: otherActor.invoice },
    ]) {
      expect(() =>
        authorizeListSalesDocumentsRead({ query, authorizations: invalid })
      ).toThrow(SalesDocumentReadAuthorizationError);
    }
  });
});
