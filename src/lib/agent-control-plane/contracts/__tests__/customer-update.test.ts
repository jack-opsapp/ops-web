import { describe, expect, it } from "vitest";
import { PrepareCustomerUpdateInputSchema } from "../customer-update";
const request = {
  opportunity_id: "11111111-1111-4111-8111-111111111111",
  expected_updated_at: "2026-09-04T12:00:00Z",
  changes: {
    description: "Replace the cedar deck",
    next_follow_up_at: "2026-09-08T16:00:00Z",
  },
  evidence: [
    {
      kind: "operator_statement",
      text: "Customer confirmed replacement. Follow up Tuesday.",
      supports: ["description", "next_follow_up_at"],
    },
  ],
  idempotency_key: "customer-update:example-1",
};
describe("customer update boundary", () => {
  it("accepts an exact, supported proposal with attributed operator evidence", () => {
    expect(PrepareCustomerUpdateInputSchema.parse(request)).toEqual(request);
  });
  it.each([
    "stage",
    "estimated_value",
    "project_id",
    "contact_email",
    "address",
    "handled_at",
    "next_step",
  ])("rejects unsupported %s", (field) => {
    expect(
      PrepareCustomerUpdateInputSchema.safeParse({
        ...request,
        changes: { ...request.changes, [field]: "x" },
      }).success
    ).toBe(false);
  });
  it("rejects empty changes, absent support, conflict and injected authority", () => {
    for (const patch of [
      { changes: {} },
      { evidence: [] },
      { company_id: request.opportunity_id },
      { evidence: [{ ...request.evidence[0], supports: ["description"] }] },
      { evidence: [{ ...request.evidence[0], relation: "contradicts" }] },
    ]) {
      expect(
        PrepareCustomerUpdateInputSchema.safeParse({ ...request, ...patch })
          .success
      ).toBe(false);
    }
  });
  it("requires customer identity and version for notes", () => {
    expect(
      PrepareCustomerUpdateInputSchema.safeParse({
        ...request,
        customer: { notes: "Gate code confirmed" },
      }).success
    ).toBe(false);
  });
});
