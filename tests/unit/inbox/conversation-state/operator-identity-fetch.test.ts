import { afterEach, describe, expect, it } from "vitest";
import { fetchOperatorIdentity } from "@/lib/api/services/conversation-state/operator-identity";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function makeSupabaseDouble(
  companyResult: QueryResult,
  usersResult: QueryResult,
  aliasesResult: QueryResult = { data: [], error: null }
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
            ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?:
            ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) =>
          Promise.resolve(
            table === "users"
              ? usersResult
              : table === "user_email_aliases"
                ? aliasesResult
                : { data: null, error: null }
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
              id: "user-crewlead",
              first_name: "Crew",
              last_name: "Lead",
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
    expect(identity.addresses).toContain("123 trade way");
    expect(identity.domains).toContain("canpro.example");
  });

  it("loads verified, pending, and rejected aliases with their owning member", async () => {
    setSupabaseOverride(
      makeSupabaseDouble(
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
        {
          data: [
            {
              id: "user-jason",
              first_name: "Jason",
              last_name: "Zavarella",
              email: "fourseasonscontracting705@gmail.com",
              phone: "2506619544",
            },
          ],
          error: null,
        },
        {
          data: [
            {
              user_id: "user-jason",
              email: "info.jzconstruct@gmail.com",
              status: "verified",
            },
            {
              user_id: "user-jason",
              email: "maybe.jz@gmail.com",
              status: "pending",
            },
          ],
          error: null,
        }
      ) as never
    );

    const identity = await fetchOperatorIdentity("company-1", connection);

    expect(identity.emails).toContain("info.jzconstruct@gmail.com");
    expect(identity.emails).not.toContain("maybe.jz@gmail.com");
    expect(identity.staffMembers?.[0]).toMatchObject({
      userId: "user-jason",
      fullName: "Jason Zavarella",
      phone: "2506619544",
    });
    expect(identity.staffMembers?.[0].pendingAliases).toContain(
      "maybe.jz@gmail.com"
    );
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
    [
      "alias roster read",
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
      { data: [], error: null },
      "Failed to load operator email aliases: aliases unavailable",
      { data: null, error: { message: "aliases unavailable" } },
    ],
  ])(
    "fails closed when the authoritative %s cannot be loaded",
    async (
      _label,
      companyResult,
      usersResult,
      expectedError,
      aliasesResult: {
        data: unknown[] | null;
        error: { message: string } | null;
      } = { data: [], error: null }
    ) => {
      setSupabaseOverride(
        makeSupabaseDouble(companyResult, usersResult, aliasesResult) as never
      );

      await expect(
        fetchOperatorIdentity("company-1", connection)
      ).rejects.toThrow(expectedError);
    }
  );
});
