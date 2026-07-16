import { describe, expect, it } from "vitest";

import { resolveNewEmailConversationConnectionId } from "@/lib/email/email-connection-selection";

type Row = {
  id: string;
  company_id: string;
  type: "company" | "individual";
  user_id: string | null;
  status: string;
  sync_enabled: boolean;
  created_at: string;
};

function database(rows: Row[]) {
  return {
    from(table: string) {
      if (table !== "email_connections") throw new Error(`unexpected ${table}`);
      let matches = [...rows];
      const query = {
        select: () => query,
        eq: (column: keyof Row, value: unknown) => {
          matches = matches.filter((row) => row[column] === value);
          return query;
        },
        order: (column: keyof Row, options: { ascending: boolean }) => {
          matches.sort((left, right) => {
            const comparison = String(left[column]).localeCompare(
              String(right[column])
            );
            return options.ascending ? comparison : -comparison;
          });
          return query;
        },
        limit: (count: number) => {
          matches = matches.slice(0, count);
          return query;
        },
        maybeSingle: async () => ({ data: matches[0] ?? null, error: null }),
      };
      return query;
    },
  } as never;
}

const shared: Row = {
  id: "company-mailbox",
  company_id: "company-1",
  type: "company",
  user_id: "legacy-connector-user",
  status: "active",
  sync_enabled: true,
  created_at: "2026-07-01T00:00:00.000Z",
};

describe("new email conversation mailbox selection", () => {
  it("prefers the actor's exact active personal mailbox", async () => {
    await expect(
      resolveNewEmailConversationConnectionId({
        supabase: database([
          shared,
          {
            ...shared,
            id: "actor-personal",
            type: "individual",
            user_id: "actor-1",
          },
        ]),
        companyId: "company-1",
        actorUserId: "actor-1",
      })
    ).resolves.toBe("actor-personal");
  });

  it("falls back to a company mailbox without using its legacy connector", async () => {
    await expect(
      resolveNewEmailConversationConnectionId({
        supabase: database([shared]),
        companyId: "company-1",
        actorUserId: "actor-1",
      })
    ).resolves.toBe("company-mailbox");
  });

  it("never selects another OPS user's personal mailbox", async () => {
    await expect(
      resolveNewEmailConversationConnectionId({
        supabase: database([
          {
            ...shared,
            id: "other-personal",
            type: "individual",
            user_id: "actor-2",
          },
        ]),
        companyId: "company-1",
        actorUserId: "actor-1",
      })
    ).resolves.toBeNull();
  });

  it("ignores disabled or non-syncing transports", async () => {
    await expect(
      resolveNewEmailConversationConnectionId({
        supabase: database([
          { ...shared, id: "disabled", status: "disconnected" },
          { ...shared, id: "paused", sync_enabled: false },
        ]),
        companyId: "company-1",
        actorUserId: "actor-1",
      })
    ).resolves.toBeNull();
  });
});
