import { describe, expect, it } from "vitest";

import {
  COMPANY_CONTEXT_CANDIDATE,
  selectedCompanyContextVariantKeys,
} from "../company";

describe("P2 company-context candidate", () => {
  it("pins one dark read with the exact company scope and permission", () => {
    expect(COMPANY_CONTEXT_CANDIDATE).toMatchObject({
      name: "get_company_context",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      riskTier: "high",
      availability: { implementation: "available" },
      authorization: {
        variants: [
          {
            key: "company",
            selector: { kind: "always" },
            policy: {
              requiredOAuthScopes: ["ops.company.read"],
              permissionRequirementGroups: [
                [
                  {
                    permission: "settings.company",
                    allowedScopes: ["all"],
                  },
                ],
              ],
            },
          },
        ],
      },
      bounds: { maxResultItems: 1 },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(Object.isFrozen(COMPANY_CONTEXT_CANDIDATE)).toBe(true);
  });

  it("selects only the mandatory company variant", () => {
    expect(selectedCompanyContextVariantKeys({})).toEqual(["company"]);
    expect(() =>
      selectedCompanyContextVariantKeys({ include_billing: true })
    ).toThrow();
  });
});
