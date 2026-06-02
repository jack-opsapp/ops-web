import { describe, it, expect } from "vitest";
import { resolveCustomerMatch, type ExistingClient } from "../qbo-match";

const clients: ExistingClient[] = [
  { id: "c-email", name: "Acme Holdings Ltd", email: "AP@acme.com", phone_number: null },
  { id: "c-name1", name: "Bright Spark Electric", email: null, phone_number: null },
  { id: "c-name2a", name: "Northside Plumbing", email: null, phone_number: null },
  { id: "c-name2b", name: "Northside Plumbing Inc", email: null, phone_number: null },
];

describe("resolveCustomerMatch", () => {
  it("email exact (case-insensitive, trimmed) → link / high", () => {
    const r = resolveCustomerMatch(
      { qb_id: "1", display_name: "Acme", email: "  ap@acme.com ", phone: null },
      clients,
      [] // no fuzzy candidates needed
    );
    expect(r.proposed_action).toBe("link");
    expect(r.matched_client_id).toBe("c-email");
    expect(r.match_basis).toBe("email");
    expect(r.confidence).toBe("high");
  });

  it("normalized-name exact single → link / medium", () => {
    const r = resolveCustomerMatch(
      { qb_id: "2", display_name: "Bright Spark Electric", email: null, phone: null },
      clients,
      []
    );
    expect(r.proposed_action).toBe("link");
    expect(r.matched_client_id).toBe("c-name1");
    expect(r.match_basis).toBe("name_exact");
    expect(r.confidence).toBe("medium");
  });

  it("normalized-name exact with >1 match → needs_review with candidates", () => {
    // "Northside Plumbing" and "Northside Plumbing Inc" normalize to the same key
    const r = resolveCustomerMatch(
      { qb_id: "3", display_name: "Northside Plumbing", email: null, phone: null },
      clients,
      []
    );
    expect(r.proposed_action).toBe("needs_review");
    expect(r.match_basis).toBe("name_exact");
    expect(r.confidence).toBe("medium");
    expect(r.candidates.map((c) => c.client_id).sort()).toEqual(["c-name2a", "c-name2b"]);
  });

  it("fuzzy candidate present (no exact) → link / low / name_fuzzy", () => {
    const r = resolveCustomerMatch(
      { qb_id: "4", display_name: "Brite Sparks Electrical", email: null, phone: null },
      [], // no exact-name pool so it falls to fuzzy
      [{ client_id: "c-fuzzy", name: "Bright Spark Electric", email: null, phone_number: null, similarity: 0.72 }]
    );
    expect(r.proposed_action).toBe("link");
    expect(r.match_basis).toBe("name_fuzzy");
    expect(r.confidence).toBe("low");
    expect(r.matched_client_id).toBe("c-fuzzy");
  });

  it("no match anywhere → create / none", () => {
    const r = resolveCustomerMatch(
      { qb_id: "5", display_name: "Totally New Customer", email: "new@x.com", phone: null },
      clients,
      []
    );
    expect(r.proposed_action).toBe("create");
    expect(r.match_basis).toBe("none");
    expect(r.matched_client_id).toBeNull();
  });
});
