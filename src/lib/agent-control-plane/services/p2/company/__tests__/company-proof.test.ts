import { describe, expect, it } from "vitest";

import {
  companyContextPayload,
  createAuthorizedCompanyContextRead,
  READ_AT,
  SOURCE_INSPECTED,
  SOURCE_REVISIONS,
} from "./company-fixtures";
import {
  companyContextProofMaterial,
  companyContextProofRef,
} from "../company-proof";

describe("P2 company-context proof", () => {
  it("binds authority, source validity, revision, time, and every returned field", async () => {
    const authorization = await createAuthorizedCompanyContextRead();
    const material = companyContextProofMaterial({
      authorization,
      readAt: READ_AT,
      sourceRevisions: SOURCE_REVISIONS,
      sourceInspected: SOURCE_INSPECTED,
      result: companyContextPayload(),
    });
    const reference = companyContextProofRef(material);

    expect(reference).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(
      companyContextProofRef({
        ...material,
        result: {
          ...material.result,
          regional: { ...material.result.regional, currency_code: "USD" },
        },
      })
    ).not.toBe(reference);
    expect(
      companyContextProofRef({
        ...material,
        source_inspected: { ...material.source_inspected, company_settings: 0 },
      })
    ).not.toBe(reference);
    expect(
      companyContextProofRef({
        ...material,
        source_revisions: [{ domain: "company", source_revision: 8 }],
      })
    ).not.toBe(reference);
  });
});
