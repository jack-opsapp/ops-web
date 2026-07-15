import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

import { EmailMatchingServiceV2 } from "@/lib/api/services/email-matching-service-v2";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryOperation =
  | { method: "select"; columns: string }
  | { method: "eq" | "ilike" | "is"; column: string; value: unknown }
  | { method: "limit"; value: number };

type QueryTrace = {
  table: string;
  operations: QueryOperation[];
};

function makeFakeSupabase(results: Record<string, QueryResult[]>) {
  const traces: QueryTrace[] = [];

  const client = {
    from(table: string) {
      const trace: QueryTrace = { table, operations: [] };
      traces.push(trace);

      const builder = {
        select(columns: string) {
          trace.operations.push({ method: "select", columns });
          return builder;
        },
        eq(column: string, value: unknown) {
          trace.operations.push({ method: "eq", column, value });
          return builder;
        },
        ilike(column: string, value: unknown) {
          trace.operations.push({ method: "ilike", column, value });
          return builder;
        },
        is(column: string, value: unknown) {
          trace.operations.push({ method: "is", column, value });
          return builder;
        },
        limit(value: number) {
          trace.operations.push({ method: "limit", value });
          return builder;
        },
        async maybeSingle() {
          const result = results[table]?.shift();
          if (!result) {
            throw new Error(`Missing fake query result for ${table}`);
          }
          return result;
        },
      };

      return builder;
    },
  };

  return { client, traces };
}

describe("EmailMatchingServiceV2", () => {
  beforeEach(() => {
    requireSupabaseMock.mockReset();
  });

  it("throws when the exact client lookup fails", async () => {
    const fake = makeFakeSupabase({
      clients: [
        {
          data: null,
          error: { message: "clients table unavailable" },
        },
      ],
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      EmailMatchingServiceV2.match("company-1", "customer@gmail.com")
    ).rejects.toThrow(
      "[email-matching] exact client lookup failed: clients table unavailable"
    );
  });

  it("throws when the provider-thread lookup fails", async () => {
    const fake = makeFakeSupabase({
      clients: [{ data: null, error: null }],
      sub_clients: [{ data: null, error: null }],
      opportunity_email_threads: [
        {
          data: null,
          error: { message: "thread relationship read failed" },
        },
      ],
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      EmailMatchingServiceV2.match("company-1", "customer@gmail.com", {
        threadId: "provider-thread-1",
        connectionId: "connection-1",
      })
    ).rejects.toThrow(
      "[email-matching] provider thread lookup failed: thread relationship read failed"
    );
  });

  it("scopes the provider-thread opportunity read to the current company", async () => {
    const fake = makeFakeSupabase({
      clients: [{ data: null, error: null }],
      sub_clients: [{ data: null, error: null }],
      opportunity_email_threads: [
        { data: { opportunity_id: "opportunity-1" }, error: null },
      ],
      opportunities: [{ data: { client_id: "client-1" }, error: null }],
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      EmailMatchingServiceV2.match("company-1", "customer@gmail.com", {
        threadId: "provider-thread-1",
        connectionId: "connection-1",
      })
    ).resolves.toMatchObject({
      clientId: "client-1",
      confidence: "thread_cc",
      action: "create_subclient",
    });

    const opportunityTrace = fake.traces.find(
      (trace) => trace.table === "opportunities"
    );
    expect(opportunityTrace?.operations).toEqual(
      expect.arrayContaining([
        { method: "eq", column: "id", value: "opportunity-1" },
        { method: "eq", column: "company_id", value: "company-1" },
        { method: "is", column: "deleted_at", value: null },
      ])
    );
  });
});
