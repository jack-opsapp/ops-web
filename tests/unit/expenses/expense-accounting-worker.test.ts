import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  processExpenseQueueRow,
  type ExpenseQueueDependencies,
} from "@/lib/api/services/expense-accounting-queue-processor";
import { QuickBooksWriteService } from "@/lib/api/services/quickbooks-write-service";
import { AcceptedWriteDurabilityError } from "@/lib/api/services/sage-queue-processor";
import type { ExpenseQueueRow } from "@/lib/api/services/expense-accounting-provider-service";
import { createSageWriteClient } from "@/lib/api/services/sage-api-client";
import { assertSageWriteAllowed } from "@/lib/api/services/sage-config";
import { buildExpensePosting } from "@/lib/accounting/expenses/provider-mappers";

function postingFixture(provider: "quickbooks" | "sage") {
  return buildExpensePosting({
    provider,
    eventId: "event",
    expenseId: "expense",
    kind: "accrual",
    currency: "CAD",
    date: "2026-09-10",
    gross: "10.00",
    tax: "0.00",
    description: "Fuel",
    employeeId: "7",
    expenseAccountId: "60",
    configuration: {
      currency: "CAD",
      countryCode: "CA",
      liabilityAccountId: "40",
      reimbursementAccountId: null,
      reimbursementPaymentMethod: null,
      companyCardAccountId: null,
      taxComponentAccounts: {},
    },
  });
}

const row: ExpenseQueueRow = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "company",
  connectionId: "connection",
  provider: "quickbooks",
  entityType: "expense",
  entityId: "expense",
  externalId: null,
  operation: "create",
  sourceTable: "expense_accounting_events",
  sourceAction: "insert",
  sourceUpdatedAt: null,
  idempotencyKey: "event:connection",
  status: "claimed",
  attempts: 1,
  maxAttempts: 5,
  runAfter: "2026-09-12T10:00:00Z",
  lockedAt: "2026-09-12T10:00:00Z",
  lockedBy: "worker",
  providerRequestId: null,
  providerAcceptedAt: null,
  idempotencyExpiresAt: null,
  lastError: null,
  payloadSnapshot: {
    eventId: "event",
    providerEnvironment: "sandbox",
    providerIdentitySnapshot: "realm-lookup",
  },
  createdAt: "2026-09-12T10:00:00Z",
  updatedAt: "2026-09-12T10:00:00Z",
};
function fixture(
  response = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ JournalEntry: { Id: "88", SyncToken: "0" } }),
        { status: 200 }
      )
    )
) {
  const actions: string[] = [];
  const fetchImpl = vi.fn(async () => {
    actions.push("write");
    return response();
  });
  const dependencies: ExpenseQueueDependencies = {
    loadConnection: vi.fn(async () => ({
      id: "connection",
      company_id: "company",
      provider: "quickbooks",
      provider_environment: "sandbox",
      is_connected: true,
      sync_enabled: true,
      sync_direction: "push_only",
      sage_business_id: null,
      realm_id_lookup: "realm-lookup",
    })),
    getToken: vi.fn(async () => ({
      accessToken: "token",
      realmId: "123",
      providerEnvironment: "sandbox" as const,
    })),
    decryptBusinessId: () => "business",
    assertSageAllowed: vi.fn(),
    createSession: async (_connection, token, onAccepted) => ({
      environment: "sandbox",
      providerTargetId: "123",
      quickbooks: new QuickBooksWriteService({
        environment: "sandbox",
        realmId: "123",
        accessToken: token.accessToken,
        fetchImpl,
        onAccepted,
      }),
    }),
    prepare: vi.fn(async () => {
      actions.push("freeze");
      return {
        payload: {
          resource: "JournalEntry" as const,
          body: postingFixture("quickbooks").payload,
          idempotencyId: row.id,
          providerEnvironment: "sandbox" as const,
          providerTargetId: "123",
        },
        posting: postingFixture("quickbooks").posting,
        createdAt: "2026-09-12T10:00:00Z",
      };
    }),
    finalize: vi.fn(async () => {
      actions.push("finalize");
      return true;
    }),
    queue: {
      recordProviderAcceptance: vi.fn(async () => {
        actions.push("accepted");
        return row as never;
      }),
      markNeedsReview: vi.fn(),
      markBlocked: vi.fn(),
      scheduleRetry: vi.fn(async () => row),
    },
    audit: vi.fn(async () => {}),
    now: () => new Date("2026-09-12T10:05:00Z"),
  };
  return { dependencies, fetchImpl, actions };
}
beforeEach(() => {
  vi.stubEnv("ACCOUNTING_WRITE_ENABLED", "true");
  vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());
describe("expense queue custody", () => {
  it("writes only after freezing and persists acceptance before finalization", async () => {
    const { dependencies, actions, fetchImpl } = fixture();
    const result = await processExpenseQueueRow({
      row,
      workerId: "worker",
      dependencies,
    });
    expect(result).toMatchObject({ status: "succeeded", externalId: "88" });
    expect(actions).toEqual(["freeze", "write", "accepted", "finalize"]);
    expect(fetchImpl.mock.calls[0]).toBeDefined();
  });
  it("does not access credentials or the provider while the write gate is off", async () => {
    vi.stubEnv("ACCOUNTING_WRITE_ENABLED", "false");
    const { dependencies, fetchImpl } = fixture();
    expect(
      (await processExpenseQueueRow({ row, workerId: "worker", dependencies }))
        .status
    ).toBe("blocked");
    expect(dependencies.getToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects another worker's claim without modifying it", async () => {
    const { dependencies, fetchImpl } = fixture();
    await expect(
      processExpenseQueueRow({ row, workerId: "other", dependencies })
    ).rejects.toThrow(/ownership/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(dependencies.queue.markNeedsReview).not.toHaveBeenCalled();
  });
  it("does not reuse a token in a different environment", async () => {
    const { dependencies, fetchImpl } = fixture();
    dependencies.getToken = async () => ({
      accessToken: "token",
      realmId: "123",
      providerEnvironment: "production",
    });
    expect(
      (await processExpenseQueueRow({ row, workerId: "worker", dependencies }))
        .status
    ).toBe("needs_review");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("never retries an accepted response whose JSON cannot be read", async () => {
    const { dependencies, actions } = fixture(
      async () => new Response("broken", { status: 200 })
    );
    expect(
      (await processExpenseQueueRow({ row, workerId: "worker", dependencies }))
        .status
    ).toBe("needs_review");
    expect(actions).toEqual(["freeze", "write", "accepted"]);
    expect(dependencies.queue.scheduleRetry).not.toHaveBeenCalled();
  });
  it("stops the batch when accepted evidence cannot be saved", async () => {
    const { dependencies } = fixture();
    dependencies.queue.recordProviderAcceptance = async () => {
      throw new Error("database unavailable");
    };
    await expect(
      processExpenseQueueRow({ row, workerId: "worker", dependencies })
    ).rejects.toBeInstanceOf(AcceptedWriteDurabilityError);
    expect(dependencies.queue.scheduleRetry).not.toHaveBeenCalled();
  });
  it("puts an accepted write with failed finalization in review without another write", async () => {
    const { dependencies, fetchImpl } = fixture();
    dependencies.finalize = async () => false;
    expect(
      (await processExpenseQueueRow({ row, workerId: "worker", dependencies }))
        .status
    ).toBe("needs_review");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(dependencies.queue.scheduleRetry).not.toHaveBeenCalled();
  });
  it("refuses a claimed row that already contains provider acceptance", async () => {
    const { dependencies, fetchImpl } = fixture();
    expect(
      (
        await processExpenseQueueRow({
          row: { ...row, providerAcceptedAt: "2026-09-12T10:00:01Z" },
          workerId: "worker",
          dependencies,
        })
      ).status
    ).toBe("needs_review");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses a relinked company even when the provider and environment still match", async () => {
    const { dependencies, fetchImpl } = fixture();
    expect(
      (
        await processExpenseQueueRow({
          row: {
            ...row,
            payloadSnapshot: {
              ...row.payloadSnapshot,
              providerIdentitySnapshot: "old-realm",
            },
          },
          workerId: "worker",
          dependencies,
        })
      ).status
    ).toBe("needs_review");
    expect(dependencies.getToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function sageFixture(
  response = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: "sage-journal",
          updated_at: "2026-09-12T10:00:00Z",
        }),
        { status: 201 }
      )
    )
) {
  const fixtureResult = fixture();
  const { dependencies, actions } = fixtureResult;
  const sageRow: ExpenseQueueRow = {
    ...row,
    provider: "sage",
    payloadSnapshot: {
      ...row.payloadSnapshot,
      providerIdentitySnapshot: "sage-lookup",
    },
  };
  dependencies.loadConnection = async () => ({
    id: "connection",
    company_id: "company",
    provider: "sage",
    provider_environment: "sandbox",
    is_connected: true,
    sync_enabled: true,
    sync_direction: "push_only",
    sage_business_id: "encrypted",
    sage_business_id_lookup: "sage-lookup",
  });
  const request = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => {
      actions.push("write");
      return response();
    }
  );
  dependencies.createSession = async (_connection, _token, onAccepted) => ({
    providerTargetId: "business",
    environment: "sandbox",
    sage: createSageWriteClient({
      businessId: "business",
      getAccessToken: async () => "token",
      refreshAccessToken: async () => "new-token",
      onDisconnect: async () => {},
      fetchFn: request,
      onAccepted,
    }),
  });
  dependencies.prepare = async () => {
    actions.push("freeze");
    return {
      payload: {
        resource: "journals",
        body: {
          date: "2026-09-10",
          journal_lines: [
            { debit: 10, credit: 0 },
            { credit: 10, debit: 0 },
          ],
        },
        providerEnvironment: "sandbox",
        providerTargetId: "business",
        idempotencyId: "11111111111111111111111111111111",
      },
      posting: postingFixture("sage").posting,
      createdAt: "2026-09-12T10:00:00Z",
    };
  };
  return { ...fixtureResult, sageRow, request };
}
describe("Sage expense posting safeguards", () => {
  it("records repayment as a contact-free other payment without reclaiming receipt tax", async () => {
    const { dependencies, sageRow, request } = sageFixture();
    const original = postingFixture("sage").posting;
    const plan = buildExpensePosting({
      provider: "sage",
      eventId: "payment-event",
      expenseId: "expense",
      kind: "settlement",
      currency: "CAD",
      date: "2026-09-12",
      gross: "10",
      tax: "0",
      description: "Crew repayment",
      original,
      reimbursementLedgerAccountId: "bank-ledger",
      configuration: {
        ...original.configuration,
        reimbursementAccountId: "bank-resource",
        reimbursementPaymentMethod: "bank-transfer",
      },
    });
    dependencies.prepare = async () => ({
      payload: {
        resource: "other_payments",
        body: plan.payload,
        providerEnvironment: "sandbox",
        providerTargetId: "business",
        idempotencyId: "22222222222222222222222222222222",
      },
      posting: plan.posting,
      createdAt: "2026-09-12T10:00:00Z",
    });
    expect(
      (
        await processExpenseQueueRow({
          row: sageRow,
          workerId: "worker",
          dependencies,
        })
      ).status
    ).toBe("succeeded");
    expect(request.mock.calls[0][0]).toBe(
      "https://api.accounting.sage.com/v3.1/other_payments"
    );
    const payload = JSON.parse(
      String(request.mock.calls[0][1]?.body)
    ).other_payment;
    expect(payload).toMatchObject({
      bank_account_id: "bank-resource",
      total_amount: 10,
      tax_amount: 0,
      payment_lines: [
        { ledger_account_id: "40", total_amount: 10, tax_amount: 0 },
      ],
    });
    expect(payload.contact_id).toBeUndefined();
  });
  it("uses Sage Accounting journals with native idempotency and durable acceptance", async () => {
    const { dependencies, sageRow, request, actions } = sageFixture();
    expect(
      (
        await processExpenseQueueRow({
          row: sageRow,
          workerId: "worker",
          dependencies,
        })
      ).status
    ).toBe("succeeded");
    expect(actions).toEqual(["freeze", "write", "accepted", "finalize"]);
    expect(request.mock.calls[0][0]).toBe(
      "https://api.accounting.sage.com/v3.1/journals"
    );
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      journal: { idempotency_id: "11111111111111111111111111111111" },
    });
  });
  it("requires the real Sage write gate before accessing a token", async () => {
    vi.stubEnv("SAGE_WRITE_ENABLED", "false");
    const { dependencies, sageRow, request } = sageFixture();
    dependencies.assertSageAllowed = assertSageWriteAllowed;
    expect(
      (
        await processExpenseQueueRow({
          row: sageRow,
          workerId: "worker",
          dependencies,
        })
      ).status
    ).toBe("blocked");
    expect(dependencies.getToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("does not retry an old request beyond Sage's seven-day window", async () => {
    const { dependencies, sageRow, request } = sageFixture();
    dependencies.now = () => new Date("2026-09-20T10:00:00Z");
    expect(
      (
        await processExpenseQueueRow({
          row: { ...sageRow, attempts: 2 },
          workerId: "worker",
          dependencies,
        })
      ).status
    ).toBe("needs_review");
    expect(request).not.toHaveBeenCalled();
  });
  it("preserves a malformed accepted Sage response as review, not a fresh write", async () => {
    const { dependencies, sageRow, actions } = sageFixture(
      async () => new Response("broken", { status: 201 })
    );
    expect(
      (
        await processExpenseQueueRow({
          row: sageRow,
          workerId: "worker",
          dependencies,
        })
      ).status
    ).toBe("needs_review");
    expect(actions).toEqual(["freeze", "write", "accepted"]);
    expect(dependencies.queue.scheduleRetry).not.toHaveBeenCalled();
  });
});


describe("expense-only activation hold", () => {
  it.each([
    { lockedBy: "another-worker" },
    { status: "blocked" as const },
    { sourceTable: "expenses" },
    { operation: "update" as const },
  ])("preserves claim and source ownership while paused: %s", async (invalid) => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
    const { dependencies, fetchImpl } = fixture();
    await expect(
      processExpenseQueueRow({
        row: { ...row, ...invalid },
        workerId: "worker",
        dependencies,
      })
    ).rejects.toThrow(/ownership/i);
    expect(dependencies.queue.markBlocked).not.toHaveBeenCalled();
    expect(dependencies.queue.markNeedsReview).not.toHaveBeenCalled();
    expect(dependencies.loadConnection).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "false", "TRUE", "1"])(
    "holds before any connection, token, preparation or provider access when %s",
    async (value) => {
      vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", value);
      for (const provider of ["quickbooks", "sage"] as const) {
        const { dependencies, fetchImpl } = fixture();
        dependencies.loadConnection = vi.fn(dependencies.loadConnection);
        dependencies.createSession = vi.fn(dependencies.createSession);
        const held = { ...row, provider };
        const before = structuredClone(held);
        const result = await processExpenseQueueRow({ row: held, workerId: "worker", dependencies });
        expect(result).toMatchObject({ status: "blocked", error: "Expense accounting sync is paused." });
        expect(dependencies.queue.markBlocked).toHaveBeenCalledWith(row.id, result.error, { workerId: "worker" });
        expect(dependencies.loadConnection).not.toHaveBeenCalled();
        expect(dependencies.getToken).not.toHaveBeenCalled();
        expect(dependencies.createSession).not.toHaveBeenCalled();
        expect(dependencies.prepare).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(dependencies.finalize).not.toHaveBeenCalled();
        expect(dependencies.queue.scheduleRetry).not.toHaveBeenCalled();
        expect(dependencies.queue.recordProviderAcceptance).not.toHaveBeenCalled();
        expect(held).toEqual(before);
      }
    }
  );
  it("propagates a failed hold save without retrying or accessing the provider", async () => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
    const { dependencies, fetchImpl } = fixture();
    dependencies.queue.markBlocked = vi.fn().mockRejectedValue(new Error("hold ownership lost"));
    await expect(processExpenseQueueRow({ row, workerId: "worker", dependencies })).rejects.toThrow("hold ownership lost");
    expect(dependencies.queue.scheduleRetry).not.toHaveBeenCalled();
    expect(dependencies.getToken).not.toHaveBeenCalled();
    expect(dependencies.prepare).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(dependencies.audit).not.toHaveBeenCalled();
  });
  it.each(["providerAcceptedAt", "providerRequestId", "externalId", "idempotencyExpiresAt"] as const)(
    "keeps %s evidence in reconciliation while disabled",
    async (field) => {
      vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
      const { dependencies, fetchImpl } = fixture();
      const accepted = { ...row, [field]: "provider-evidence" };
      const before = structuredClone(accepted);
      expect((await processExpenseQueueRow({ row: accepted, workerId: "worker", dependencies })).status).toBe("needs_review");
      expect(dependencies.queue.markBlocked).not.toHaveBeenCalled();
      expect(dependencies.queue.markNeedsReview).toHaveBeenCalledWith(row.id, expect.stringMatching(/reconcile/i), { workerId: "worker" });
      expect(dependencies.getToken).not.toHaveBeenCalled();
      expect(dependencies.prepare).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(accepted).toEqual(before);
    }
  );
  it("does not release a blocked row on enable; only a newly owned claim can proceed", async () => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
    const { dependencies, fetchImpl } = fixture();
    await processExpenseQueueRow({ row, workerId: "worker", dependencies });
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "true");
    await expect(processExpenseQueueRow({ row: { ...row, status: "blocked", lockedBy: null }, workerId: "worker", dependencies })).rejects.toThrow(/ownership/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await processExpenseQueueRow({ row, workerId: "worker", dependencies })).status).toBe("succeeded");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not acknowledge reconciliation if its guarded save fails while paused", async () => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
    const { dependencies, fetchImpl } = fixture();
    dependencies.queue.markNeedsReview = vi.fn().mockRejectedValue(
      new Error("review ownership lost")
    );
    await expect(
      processExpenseQueueRow({
        row: { ...row, providerAcceptedAt: "2026-09-12T10:00:01Z" },
        workerId: "worker",
        dependencies,
      })
    ).rejects.toThrow("review ownership lost");
    expect(dependencies.queue.markBlocked).not.toHaveBeenCalled();
    expect(dependencies.queue.scheduleRetry).not.toHaveBeenCalled();
    expect(dependencies.getToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(dependencies.audit).not.toHaveBeenCalled();
  });
});
