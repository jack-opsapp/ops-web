import { describe, expect, it } from "vitest";
import { getEditorialOperator } from "@/lib/social/editorial/operator";

describe("cloud editorial notification recipient", () => {
  it("normalizes the whitespace present in production operator settings", () => {
    expect(
      getEditorialOperator({
        PMF_OPERATOR_USER_ID: " user-id\n",
        PMF_OPERATOR_COMPANY_ID: "company-id\n",
      })
    ).toEqual({ userId: "user-id", companyId: "company-id" });
  });
  it("does not combine recipient IDs from different configurations", () => {
    expect(
      getEditorialOperator({
        SOCIAL_OPERATOR_USER_ID: " ",
        SOCIAL_OPERATOR_COMPANY_ID: "social-company",
        PMF_OPERATOR_USER_ID: "fallback-user",
        PMF_OPERATOR_COMPANY_ID: "fallback-company",
      })
    ).toBeNull();
    expect(
      getEditorialOperator({
        SOCIAL_OPERATOR_USER_ID: "social-user\n",
        SOCIAL_OPERATOR_COMPANY_ID: "social-company\n",
      })
    ).toEqual({ userId: "social-user", companyId: "social-company" });
  });
  it("keeps the outbox pending when a recipient is incomplete", () => {
    expect(
      getEditorialOperator({ PMF_OPERATOR_USER_ID: "user-id" })
    ).toBeNull();
  });
});
