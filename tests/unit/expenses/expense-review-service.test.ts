// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadExpenseAccountingIssues } from "@/lib/accounting/expenses/review-service";

const companyId = "company-1";
const connectionId = "connection-1";
const eventId = "ade86f52-7a78-4a44-b1ad-4f011959cfb1";
const queueId = "332eef6b-cd08-469f-97d7-8a6aa7796bcb";
const row = {
  id: queueId,
  entity_id: "expense-1",
  entity_type: "expense",
  operation: "create",
  source_table: "expense_accounting_events",
  provider: "quickbooks",
  status: "failed",
  payload_snapshot: {
    eventId,
    providerEnvironment: "production",
    providerIdentitySnapshot: "identity",
  },
  external_id: null,
  provider_accepted_at: null,
  provider_request_id: null,
  idempotency_expires_at: null,
  last_error: "Unexpected provider failure for private ID 7342937",
};
const event = {
  id: eventId,
  expense_id: row.entity_id,
  kind: "accrual",
  source_snapshot: {
    merchant_name: "Hardware",
    amount: "105.00",
    tax_amount: "5.00",
    currency: "CAD",
    expense_date: "2026-09-12",
  },
};

function database(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    accounting_connections: {
      id: connectionId,
      provider: "quickbooks",
      is_connected: true,
      sync_enabled: true,
      sync_direction: "bidirectional",
      provider_environment: "production",
      realm_id_lookup: "identity",
      sage_business_id_lookup: "identity",
    },
    accounting_sync_queue: [row],
    expense_accounting_events: [event],
    expense_accounting_postings: [],
    ...overrides,
  };
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "range"])
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      const result = () =>
        data[table] instanceof Error
          ? { data: null, error: data[table] }
          : { data: data[table], error: null };
      builder.maybeSingle = async () => result();
      builder.then = (resolve: (value: unknown) => void) =>
        Promise.resolve(result()).then(resolve);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("expense issue inventory", () => {
  it("bounds invalid receipt display values without changing accounting state", async () => {
    const { db } = database({
      expense_accounting_events: [
        {
          ...event,
          source_snapshot: {
            ...event.source_snapshot,
            amount: "9".repeat(400),
            expense_date: "2026-02-31",
            currency: "invalid",
          },
        },
      ],
    });
    expect(
      (await loadExpenseAccountingIssues(db, companyId, connectionId, 0))
        .issues[0]
    ).toMatchObject({ amount: null, expenseDate: null, currency: null });
  });
  it.each(["quickbooks", "sage"])(
    "scopes every query and displays immutable gross receipt context for %s",
    async (provider) => {
      const { db, calls } = database({
        accounting_connections: {
          provider,
          is_connected: true,
          sync_enabled: true,
          sync_direction: "push_only",
          provider_environment: "production",
          realm_id_lookup: "identity",
          sage_business_id_lookup: "identity",
        },
        accounting_sync_queue: [{ ...row, provider }],
      });
      const result = await loadExpenseAccountingIssues(
        db,
        companyId,
        connectionId,
        0
      );
      expect(result).toEqual({
        connectionId,
        issues: [
          {
            queueId,
            provider,
            kind: "accrual",
            merchantName: "Hardware",
            amount: 105,
            currency: "CAD",
            expenseDate: "2026-09-12",
            reason: "unknown",
            recovery: "retry",
          },
        ],
        nextOffset: null,
      });
      expect(JSON.stringify(result)).not.toContain("7342937");
      for (const table of [
        "accounting_connections",
        "accounting_sync_queue",
        "expense_accounting_events",
        "expense_accounting_postings",
      ]) {
        expect(calls).toContainEqual({
          table,
          method: "eq",
          args: ["company_id", companyId],
        });
      }
      for (const table of [
        "accounting_sync_queue",
        "expense_accounting_postings",
      ]) {
        expect(calls).toContainEqual({
          table,
          method: "eq",
          args: ["connection_id", connectionId],
        });
      }
      expect(calls).toContainEqual({
        table: "accounting_sync_queue",
        method: "eq",
        args: ["provider", provider],
      });
      expect(calls).toContainEqual({
        table: "accounting_sync_queue",
        method: "in",
        args: ["status", ["blocked", "needs_review", "failed"]],
      });
    }
  );

  it("keeps a frozen unaccepted posting in reconciliation", async () => {
    const { db } = database({
      expense_accounting_postings: [{ queue_id: queueId, event_id: eventId }],
    });
    expect(
      (await loadExpenseAccountingIssues(db, companyId, connectionId, 0))
        .issues[0].recovery
    ).toBe("reconcile");
  });

  it("does not use another expense's event context or assume missing evidence is safe", async () => {
    const { db } = database({
      expense_accounting_events: [
        { ...event, expense_id: "different-expense" },
      ],
    });
    expect(
      (await loadExpenseAccountingIssues(db, companyId, connectionId, 0))
        .issues[0]
    ).toMatchObject({
      merchantName: null,
      amount: null,
      recovery: "reconcile",
      kind: "review",
    });
  });

  it("returns a bounded page and a continuation without querying mutable expenses", async () => {
    const { db, calls } = database({
      accounting_sync_queue: Array.from({ length: 51 }, (_, index) => ({
        ...row,
        id: `queue-${index}`,
      })),
    });
    const result = await loadExpenseAccountingIssues(
      db,
      companyId,
      connectionId,
      50
    );
    expect(result.issues).toHaveLength(50);
    expect(result.nextOffset).toBe(100);
    expect(calls).toContainEqual({
      table: "accounting_sync_queue",
      method: "range",
      args: [50, 100],
    });
    expect(calls.some((call) => call.table === "expenses")).toBe(false);
  });

  it("fails closed if evidence cannot be read", async () => {
    const { db } = database({
      expense_accounting_postings: new Error("evidence unavailable"),
    });
    await expect(
      loadExpenseAccountingIssues(db, companyId, connectionId, 0)
    ).rejects.toThrow("evidence unavailable");
  });

  it("does not enumerate a missing or foreign connection", async () => {
    const { db, calls } = database({ accounting_connections: null });
    await expect(
      loadExpenseAccountingIssues(db, companyId, connectionId, 0)
    ).rejects.toThrow("expense_connection_unavailable");
    expect(calls.some((call) => call.table === "accounting_sync_queue")).toBe(
      false
    );
  });
});
