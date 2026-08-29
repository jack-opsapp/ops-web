import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  GET_SALES_DOCUMENT_CANDIDATE,
  LIST_SALES_DOCUMENTS_CANDIDATE,
  SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS,
  selectedGetSalesDocumentVariantKeys,
  selectedListSalesDocumentsVariantKeys,
} from "../sales";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("P2 sales-document candidates", () => {
  it("keeps both reads implementation-only and immutable", () => {
    expect(LIST_SALES_DOCUMENTS_CANDIDATE).toMatchObject({
      name: "list_sales_documents",
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
    expect(GET_SALES_DOCUMENT_CANDIDATE).toMatchObject({
      name: "get_sales_document",
      bounds: { maxResultItems: 1 },
      availability: { implementation: "available" },
    });
    for (const candidate of [
      LIST_SALES_DOCUMENTS_CANDIDATE,
      GET_SALES_DOCUMENT_CANDIDATE,
    ]) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(
        CAPABILITY_MANIFEST.some((entry) => entry.name === candidate.name)
      ).toBe(false);
    }
  });

  it("pins independent estimate and invoice policy variants with project financial authority", () => {
    expect(SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "estimate",
      "invoice",
    ]);
    for (const candidate of [
      LIST_SALES_DOCUMENTS_CANDIDATE,
      GET_SALES_DOCUMENT_CANDIDATE,
    ]) {
      expect(candidate.authorization.variants.map(({ key }) => key)).toEqual(
        SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS
      );
      const estimate = candidate.authorization.variants[0]!.policy;
      expect(estimate.requiredOAuthScopes).toEqual([
        "ops.financial_documents.read",
      ]);
      expect(estimate.permissionRequirementGroups).toEqual([
        [
          { permission: "estimates.view", allowedScopes: ["all", "assigned"] },
          { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
        ],
        [
          { permission: "estimates.view", allowedScopes: ["all", "assigned"] },
          { permission: "projects.view", allowedScopes: ["all", "assigned"] },
          {
            permission: "projects.view_financials",
            allowedScopes: ["all"],
          },
        ],
        [{ permission: "estimates.view", allowedScopes: ["all"] }],
      ]);
      const invoice = candidate.authorization.variants[1]!.policy;
      expect(invoice.requiredOAuthScopes).toEqual([
        "ops.financial_documents.read",
      ]);
      expect(invoice.permissionRequirementGroups).toEqual([
        [
          { permission: "invoices.view", allowedScopes: ["all", "assigned"] },
          { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
        ],
        [
          { permission: "invoices.view", allowedScopes: ["all", "assigned"] },
          { permission: "projects.view", allowedScopes: ["all", "assigned"] },
          {
            permission: "projects.view_financials",
            allowedScopes: ["all"],
          },
        ],
        [{ permission: "invoices.view", allowedScopes: ["all"] }],
      ]);
    }
  });

  it("selects list kinds independently and one exact detail kind", () => {
    expect(selectedListSalesDocumentsVariantKeys({})).toEqual([
      "estimate",
      "invoice",
    ]);
    expect(
      selectedListSalesDocumentsVariantKeys({
        document_kinds: ["invoice"],
      })
    ).toEqual(["invoice"]);
    expect(
      selectedGetSalesDocumentVariantKeys({
        document_ref: { kind: "estimate", id: UUID },
      })
    ).toEqual(["estimate"]);
  });
});
