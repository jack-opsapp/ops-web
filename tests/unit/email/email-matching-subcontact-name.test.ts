import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

import {
  EmailMatchingServiceV2,
  nameIdentityTokens,
} from "@/lib/api/services/email-matching-service-v2";

/**
 * Bug 3799225e. Elaine emailed from a personal address about a deck the company
 * had already built for Mark Vanderwerf. Mark HAS a sub-contact — "Bruce And
 * Elaine" — but with no email recorded, so the exact-email tier could never see
 * her, and the name tier only ever scanned `clients`. A brand-new client and a
 * duplicate opportunity were the result.
 */

type Row = Record<string, unknown>;

function ilikeToRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\" && index + 1 < pattern.length) {
      index += 1;
      source += pattern[index].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (character === "%") {
      source += ".*";
    } else if (character === "_") {
      source += ".";
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "i");
}

function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let limitCount: number | null = null;

      const rows = () => {
        let result = [...(tables[table] ?? [])].filter((row) =>
          filters.every((filter) => filter(row))
        );
        for (const order of [...orders].reverse()) {
          result.sort((left, right) => {
            const a = String(left[order.column] ?? "");
            const b = String(right[order.column] ?? "");
            const comparison = a < b ? -1 : a > b ? 1 : 0;
            return order.ascending ? comparison : -comparison;
          });
        }
        if (limitCount !== null) result = result.slice(0, limitCount);
        return result;
      };

      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        ilike(column: string, value: unknown) {
          const regex = ilikeToRegex(String(value));
          filters.push((row) => {
            const cell = row[column];
            return typeof cell === "string" && regex.test(cell);
          });
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push((row) => (row[column] ?? null) === value);
          return builder;
        },
        order(column: string, options: { ascending?: boolean } = {}) {
          orders.push({ column, ascending: options.ascending !== false });
          return builder;
        },
        limit(value: number) {
          limitCount = value;
          return builder;
        },
        async maybeSingle() {
          const found = rows();
          return { data: found[0] ?? null, error: null };
        },
        then(
          resolve: (value: { data: Row[]; error: null }) => unknown
        ): unknown {
          return resolve({ data: rows(), error: null });
        },
      };

      return builder;
    },
  };
}

function subContact(over: Row = {}): Row {
  return {
    id: "sub-bruce-elaine",
    client_id: "client-mark",
    company_id: "company-1",
    name: "Bruce And Elaine",
    email: null,
    deleted_at: null,
    created_at: "2026-05-01T00:00:00.000Z",
    ...over,
  };
}

function match(tables: Record<string, Row[]>, name: string, email: string) {
  requireSupabaseMock.mockReturnValue(fakeSupabase(tables));
  return EmailMatchingServiceV2.match("company-1", email, { name });
}

beforeEach(() => {
  requireSupabaseMock.mockReset();
});

describe("nameIdentityTokens", () => {
  it("drops stopwords and sub-three-letter noise", () => {
    expect(nameIdentityTokens("Bruce And Elaine")).toEqual([
      "bruce",
      "elaine",
    ]);
    expect(nameIdentityTokens("Mr. Jo Li")).toEqual([]);
    expect(nameIdentityTokens("The Beattie Family")).toEqual(["beattie"]);
    expect(nameIdentityTokens(null)).toEqual([]);
  });

  it("deduplicates repeated tokens", () => {
    expect(nameIdentityTokens("Elaine Elaine")).toEqual(["elaine"]);
  });
});

describe("Tier 3.5 — sub-contact name match", () => {
  it("routes Elaine to review against Mark's existing client", async () => {
    const result = await match(
      { clients: [], sub_clients: [subContact()] },
      "Elaine Beattie",
      "bruceelainebeattie5@gmail.com"
    );

    expect(result).toEqual({
      clientId: null,
      subClientId: "sub-bruce-elaine",
      confidence: "name",
      needsReview: true,
      suggestedClientId: "client-mark",
      reason:
        'Name matches sub-contact "Bruce And Elaine" of existing client — needs review',
      action: "review",
    });
  });

  it("never links on a name alone — it always asks a human", async () => {
    const result = await match(
      { clients: [], sub_clients: [subContact()] },
      "Elaine Beattie",
      "bruceelainebeattie5@gmail.com"
    );

    expect(result.action).not.toBe("link");
    expect(result.clientId).toBeNull();
  });

  it("ignores a sub-contact that already carries a different email", async () => {
    const result = await match(
      {
        clients: [],
        sub_clients: [subContact({ email: "someone.else@example.com" })],
      },
      "Elaine Beattie",
      "bruceelainebeattie5@gmail.com"
    );

    expect(result.action).toBe("create_new");
    expect(result.confidence).toBe("unmatched");
  });

  it("leaves an already-recorded sub-contact to the exact-email tier", async () => {
    const result = await match(
      {
        clients: [],
        sub_clients: [
          subContact({ email: "BruceElaineBeattie5@gmail.com", id: "sub-x" }),
        ],
      },
      "Elaine Beattie",
      "bruceelainebeattie5@gmail.com"
    );

    // Once the email is on the record — which is exactly what confirming a
    // match backfills — she links straight through and never reaches review.
    expect(result.action).toBe("link");
    expect(result.confidence).toBe("exact");
    expect(result.clientId).toBe("client-mark");
    expect(result.subClientId).toBe("sub-x");
  });

  it("never matches on a stopword alone", async () => {
    const result = await match(
      { clients: [], sub_clients: [subContact({ name: "And Sons" })] },
      "Bruce And",
      "someone@gmail.com"
    );

    expect(result.action).toBe("create_new");
  });

  it("does not query sub-contacts when the name carries no identity", async () => {
    const result = await match(
      { clients: [], sub_clients: [subContact()] },
      "Jo Li",
      "joli@gmail.com"
    );

    expect(result.action).toBe("create_new");
  });

  it("suggests the newest relationship when several clients match", async () => {
    const result = await match(
      {
        clients: [],
        sub_clients: [
          subContact(),
          subContact({
            id: "sub-newer",
            client_id: "client-other",
            name: "Elaine Winters",
            created_at: "2026-07-01T00:00:00.000Z",
          }),
        ],
      },
      "Elaine Beattie",
      "bruceelainebeattie5@gmail.com"
    );

    expect(result.action).toBe("review");
    expect(result.suggestedClientId).toBe("client-other");
    expect(result.subClientId).toBe("sub-newer");
    expect(result.reason).toBe(
      "Name matches sub-contacts of 2 existing clients — needs review"
    );
  });

  it("leaves the earlier client name tier in charge when it hits", async () => {
    const result = await match(
      {
        clients: [
          {
            id: "client-beattie",
            company_id: "company-1",
            name: "Beattie Holdings",
            email: "office@beattieholdings.example",
            deleted_at: null,
          },
        ],
        sub_clients: [subContact()],
      },
      "Elaine Beattie",
      "bruceelainebeattie5@gmail.com"
    );

    expect(result.suggestedClientId).toBe("client-beattie");
    expect(result.reason).toContain("Name match:");
    expect(result.subClientId).toBeNull();
  });

  it("ignores a soft-deleted sub-contact", async () => {
    const result = await match(
      {
        clients: [],
        sub_clients: [subContact({ deleted_at: "2026-06-01T00:00:00.000Z" })],
      },
      "Elaine Beattie",
      "bruceelainebeattie5@gmail.com"
    );

    expect(result.action).toBe("create_new");
  });
});
