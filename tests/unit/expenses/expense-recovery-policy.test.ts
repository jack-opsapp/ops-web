import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expenseRecoveryAction,
  expenseIssueReason,
} from "@/lib/accounting/expenses/review-service";

const row = {
  entity_type: "expense",
  source_table: "expense_accounting_events",
  operation: "create",
  status: "needs_review",
  provider: "quickbooks",
  external_id: null,
  provider_accepted_at: null,
  provider_request_id: null,
  idempotency_expires_at: null,
  payload_snapshot: {
    providerEnvironment: "production",
    providerIdentitySnapshot: "identity",
  },
};
const connection = {
  is_connected: true,
  sync_enabled: true,
  sync_direction: "bidirectional",
  provider_environment: "production",
  realm_id_lookup: "identity",
  sage_business_id_lookup: "identity",
};

describe("expense recovery display policy", () => {
  it.each(["quickbooks", "sage"])(
    "offers safe pre-write retry for %s",
    (provider) => {
      expect(
        expenseRecoveryAction(
          { ...row, provider },
          { kind: "accrual" },
          false,
          connection
        )
      ).toBe("retry");
    }
  );
  it.each([
    "external_id",
    "provider_accepted_at",
    "provider_request_id",
    "idempotency_expires_at",
  ])("rejects any %s evidence even without a transaction ID", (field) => {
    expect(
      expenseRecoveryAction(
        { ...row, [field]: "evidence" },
        { kind: "accrual" },
        false,
        connection
      )
    ).toBe("reconcile");
    expect(
      expenseRecoveryAction(
        { ...row, [field]: undefined },
        { kind: "accrual" },
        false,
        connection
      )
    ).toBe("reconcile");
  });
  it("keeps frozen writes, legacy records, relinked identities in reconciliation", () => {
    expect(
      expenseRecoveryAction(row, { kind: "accrual" }, true, connection)
    ).toBe("reconcile");
    expect(
      expenseRecoveryAction(row, { kind: "review" }, false, connection)
    ).toBe("reconcile");
    expect(expenseRecoveryAction(row, undefined, false, connection)).toBe(
      "reconcile"
    );
    expect(
      expenseRecoveryAction(
        { ...row, status: "failed" },
        { kind: "accrual" },
        false,
        connection
      )
    ).toBe("retry");
    expect(
      expenseRecoveryAction(row, { kind: "accrual" }, false, {
        ...connection,
        realm_id_lookup: "replacement",
      })
    ).toBe("reconcile");
  });
  it.each([
    { is_connected: false },
    { sync_enabled: false },
    { sync_direction: "pull_only" },
  ])("requires restoring connection state %s before retry", (patch) => {
    expect(
      expenseRecoveryAction(row, { kind: "accrual" }, false, {
        ...connection,
        ...patch,
      })
    ).toBe("connection");
  });
});

describe("safe expense issue reasons", () => {
  it.each([
    ["The mapped QuickBooks employee is unavailable or inactive.", "crew"],
    ["Map the receipt tax rate before accounting can sync.", "tax"],
    [
      "Expense currency must match the connected accounting company.",
      "currency",
    ],
    [
      "Map the expense category account before accounting can sync.",
      "accounts",
    ],
    ["Expense accounting date needs review.", "details"],
    [
      "Unexpected failure at provider ID 874d9429-f956-4b3e-ae58-264d30c13fc8",
      "unknown",
    ],
  ])("maps diagnostics to a bounded reason: %s", (message, expected) => {
    expect(expenseIssueReason(message)).toBe(expected);
  });
});


beforeEach(() => vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());


describe("paused recovery precedence", () => {
  it("holds otherwise safe retry by default and restores it only after enable", () => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", undefined);
    expect(expenseRecoveryAction(row, { kind: "accrual" }, false, connection)).toBe("paused");
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "true");
    expect(expenseRecoveryAction(row, { kind: "accrual" }, false, connection)).toBe("retry");
  });
  it("retains frozen, accepted and changed-identity reconciliation while paused", () => {
    vi.stubEnv("EXPENSE_ACCOUNTING_WRITE_ENABLED", "false");
    expect(expenseRecoveryAction(row, { kind: "accrual" }, true, connection)).toBe("reconcile");
    for (const field of ["external_id", "provider_accepted_at", "provider_request_id", "idempotency_expires_at"]) {
      expect(expenseRecoveryAction({ ...row, [field]: "evidence" }, { kind: "accrual" }, false, connection)).toBe("reconcile");
    }
    expect(expenseRecoveryAction(row, { kind: "accrual" }, false, { ...connection, realm_id_lookup: "changed" })).toBe("reconcile");
    expect(expenseRecoveryAction(row, { kind: "review" }, false, connection)).toBe("reconcile");
  });
});
