import { afterEach, describe, expect, it } from "vitest";
import { fetchOperatorIdentity } from "@/lib/api/services/conversation-state/operator-identity";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function makeSupabaseDouble(
  companyResult: QueryResult,
  usersResult: QueryResult
) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => companyResult,
        then: <TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null
        ) =>
          Promise.resolve(
            table === "users" ? usersResult : { data: null, error: null }
          ).then(onfulfilled, onrejected),
      };
      return chain;
    },
  };
}

const connection = {
  email: "owner@gmail.com",
  syncFilters: {
    userEmailAddresses: ["estimator@canpro.example"],
    companyDomains: ["canpro.example"],
  },
} as never;

describe("fetchOperatorIdentity", () => {
  afterEach(() => setSupabaseOverride(null));

  it("unions the authoritative company and active-user identity rows", async () => {
    setSupabaseOverride(
      makeSupabaseDouble(
        {
          data: {
            id: "company-1",
            name: "Canpro",
            email: "office@canpro.example",
            phone: "+1 250 555 0100",
            address: "123 Trade Way, Victoria BC",
          },
          error: null,
        },
        {
          data: [
            {
              email: "crewlead@gmail.com",
              phone: "250-555-0101",
            },
          ],
          error: null,
        }
      ) as never
    );

    const identity = await fetchOperatorIdentity("company-1", connection);

    expect(identity.emails).toEqual(
      new Set([
        "owner@gmail.com",
        "crewlead@gmail.com",
        "office@canpro.example",
        "estimator@canpro.example",
      ])
    );
    expect(identity.phones).toEqual(new Set(["2505550101", "2505550100"]));
    expect(identity.addresses).toContain("123 trade way victoria bc");
    expect(identity.domains).toContain("canpro.example");
  });

  it.each([
    [
      "company read",
      { data: null, error: { message: "company unavailable" } },
      { data: [], error: null },
      "Failed to load operator company identity: company unavailable",
    ],
    [
      "missing company",
      { data: null, error: null },
      { data: [], error: null },
      "Failed to load operator company identity: company not found",
    ],
    [
      "user roster read",
      {
        data: {
          id: "company-1",
          name: "Canpro",
          email: null,
          phone: null,
          address: null,
        },
        error: null,
      },
      { data: null, error: { message: "users unavailable" } },
      "Failed to load operator user identities: users unavailable",
    ],
  ])(
    "fails closed when the authoritative %s cannot be loaded",
    async (_label, companyResult, usersResult, expectedError) => {
      setSupabaseOverride(
        makeSupabaseDouble(companyResult, usersResult) as never
      );

      await expect(
        fetchOperatorIdentity("company-1", connection)
      ).rejects.toThrow(expectedError);
    }
  );
});
