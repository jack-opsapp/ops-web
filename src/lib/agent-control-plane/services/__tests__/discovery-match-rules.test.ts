import { describe, expect, it } from "vitest";

import {
  compareCustomerDiscoveryOrder,
  compareJobDiscoveryOrder,
  customerNameMatchBasisFits,
  expectedJobTextMatchBasis,
} from "../discovery-match-rules";

describe("discovery match rules", () => {
  it.each([
    ["  ACME\u3000Construction  ", "exact_name", true],
    ["Acme Construction West", "prefix_name", true],
    ["Construction work for Acme", "all_tokens_name", true],
    ["Acme Construction", "prefix_name", false],
    ["Construction work for Acme", "prefix_name", false],
    ["Cedar job AB", "all_tokens_name", false],
    ["Acme\u202e Construction", "all_tokens_name", false],
  ] as const)(
    "derives the exclusive customer name tier for %s",
    (displayName, claimedBasis, expected) => {
      expect(
        customerNameMatchBasisFits({
          displayName,
          canonicalQuery:
            displayName === "Cedar job AB" ? "ab cedar" : "acme construction",
          claimedBasis,
        })
      ).toBe(expected);
    }
  );

  it("selects exact before prefix and title before address within one tier", () => {
    expect(
      expectedJobTextMatchBasis({
        displayTitle: "Cedar Street deck",
        address: "Cedar Street",
        canonicalQuery: "cedar street",
        queryFields: ["title", "address"],
      })
    ).toBe("exact_address");
    expect(
      expectedJobTextMatchBasis({
        displayTitle: "Cedar Street",
        address: "Cedar Street",
        canonicalQuery: "cedar street",
        queryFields: ["address", "title"],
      })
    ).toBe("exact_title");
  });

  it("respects selected fields and the minimum all-token length", () => {
    expect(
      expectedJobTextMatchBasis({
        displayTitle: "Unrelated title",
        address: "100 Cedar Street",
        canonicalQuery: "cedar street",
        queryFields: ["title"],
      })
    ).toBeNull();
    expect(
      expectedJobTextMatchBasis({
        displayTitle: "Cedar project AB",
        address: null,
        canonicalQuery: "ab cedar",
        queryFields: ["title"],
      })
    ).toBeNull();
    expect(
      expectedJobTextMatchBasis({
        displayTitle: "Street deck on Cedar",
        address: null,
        canonicalQuery: "cedar street",
        queryFields: ["title"],
      })
    ).toBe("all_tokens_title");
  });

  it("orders customer matches by tier, kind, UTF-8 C bytes, then UUID", () => {
    const base = {
      customer_ref: {
        kind: "client" as const,
        id: "10000000-0000-4000-8000-000000000001",
      },
      display_name: "Acme",
      match_basis: { kind: "exact_name" as const },
    };
    expect(
      compareCustomerDiscoveryOrder(
        { ...base, match_basis: { kind: "prefix_name" } },
        base
      )
    ).toBeGreaterThan(0);
    expect(
      compareCustomerDiscoveryOrder(
        {
          ...base,
          customer_ref: { ...base.customer_ref, kind: "sub_client" },
        },
        base
      )
    ).toBeGreaterThan(0);
    expect(
      compareCustomerDiscoveryOrder(
        { ...base, display_name: "\ue000" },
        { ...base, display_name: "\u{10000}" }
      )
    ).toBeLessThan(0);
    expect(
      compareCustomerDiscoveryOrder(base, {
        ...base,
        customer_ref: {
          ...base.customer_ref,
          id: "20000000-0000-4000-8000-000000000002",
        },
      })
    ).toBeLessThan(0);
  });

  it("orders text-backed jobs by tier, field, kind, value, then UUID", () => {
    type JobOrderMatch = Parameters<typeof compareJobDiscoveryOrder>[0]["left"];
    const base: JobOrderMatch = {
      job_ref: {
        kind: "opportunity" as const,
        id: "10000000-0000-4000-8000-000000000001",
      },
      display_title: "Cedar Street",
      address: "100 Cedar Street",
      dates: {
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      },
      match_basis: { kind: "exact_title" as const, field: "title" as const },
    };
    const compare = (left: JobOrderMatch, right: JobOrderMatch) =>
      compareJobDiscoveryOrder({
        left,
        right,
        dateField: "updated_at",
      });
    expect(
      compare(
        {
          ...base,
          match_basis: {
            kind: "prefix_title",
            field: "title",
          },
        },
        base
      )
    ).toBeGreaterThan(0);
    expect(
      compare(
        {
          ...base,
          match_basis: {
            kind: "exact_address",
            field: "address",
          },
        },
        base
      )
    ).toBeGreaterThan(0);
    expect(
      compare(
        {
          ...base,
          job_ref: { ...base.job_ref, kind: "project" },
        },
        base
      )
    ).toBeGreaterThan(0);
  });

  it("orders filter-only jobs by date descending, kind, then UUID", () => {
    const older = {
      job_ref: {
        kind: "opportunity" as const,
        id: "10000000-0000-4000-8000-000000000001",
      },
      display_title: "Older",
      address: null,
      dates: {
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      },
      match_basis: { kind: "filter_only" as const, field: "none" as const },
    };
    const newer = {
      ...older,
      job_ref: {
        ...older.job_ref,
        id: "20000000-0000-4000-8000-000000000002",
      },
      dates: {
        ...older.dates,
        updated_at: "2026-08-03T00:00:00.000Z",
      },
    };
    expect(
      compareJobDiscoveryOrder({
        left: newer,
        right: older,
        dateField: "updated_at",
      })
    ).toBeLessThan(0);
    const sameMillisecondHigherId = {
      ...older,
      job_ref: {
        ...older.job_ref,
        id: "20000000-0000-4000-8000-000000000002",
      },
    };
    expect(
      compareJobDiscoveryOrder({
        left: older,
        right: sameMillisecondHigherId,
        dateField: "updated_at",
      })
    ).toBeLessThan(0);
    expect(
      compareJobDiscoveryOrder({
        left: older,
        right: {
          ...older,
          job_ref: {
            kind: "project",
            id: "00000000-0000-4000-8000-000000000001",
          },
        },
        dateField: "updated_at",
      })
    ).toBeLessThan(0);
  });
});
