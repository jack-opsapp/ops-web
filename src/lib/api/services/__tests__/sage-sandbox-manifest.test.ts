import { describe, expect, it } from "vitest";

import {
  assertSageSandboxManifest,
  createSageSandboxManifest,
  preflightSageSandboxWarGame,
  providerCleanupTargets,
  redactSageSandboxManifest,
} from "../../../../../scripts/sage-sandbox-war-game";

const RUN_ID = "99999999-9999-4999-8999-999999999999";
const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "30000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "40000000-0000-4000-8000-000000000001";

function readyEnvironment(): NodeJS.ProcessEnv {
  return {
    SAGE_ACTIVE_PROFILE: "sandbox",
    ACCOUNTING_WRITE_ENABLED: "true",
    SAGE_WRITE_ENABLED: "true",
    QB_TOKEN_ENC_KEY: Buffer.alloc(32, 4).toString("base64"),
    SAGE_SANDBOX_CLIENT_ID: "sandbox-client",
    SAGE_SANDBOX_CLIENT_SECRET: "sandbox-secret",
    SAGE_SANDBOX_REDIRECT_URI: "http://localhost:3000/sage/callback",
    SAGE_SANDBOX_REFRESH_TOKEN: "sandbox-refresh",
    SAGE_SANDBOX_BUSINESS_ID: "business-exact",
    SAGE_SANDBOX_BUSINESS_IDS: "business-other,business-exact",
    SAGE_SANDBOX_OPS_COMPANY_ID: COMPANY_ID,
    SAGE_SANDBOX_OPS_CONNECTION_ID: CONNECTION_ID,
    SAGE_SANDBOX_OPS_USER_ID: USER_ID,
    SAGE_SANDBOX_OPS_EXPENSE_CATEGORY_ID: CATEGORY_ID,
    SAGE_SANDBOX_LEDGER_ACCOUNT_ID: "ledger-exact",
    SAGE_SANDBOX_TAX_RATE_ID: "tax-exact",
    SAGE_SANDBOX_BANK_ACCOUNT_ID: "bank-exact",
    SAGE_SANDBOX_PAYMENT_METHOD_ID: "EFT",
    NEXT_PUBLIC_SUPABASE_URL: "https://sandbox-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sandbox-service-role",
  };
}

describe("Sage sandbox acceptance manifest", () => {
  it("requires one unique run, exact provider identity, exact OPS ids, timestamps, and cleanup state", () => {
    const manifest = createSageSandboxManifest({
      runId: RUN_ID,
      businessId: "business-exact",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      createdAt: "2026-09-04T12:00:00.000Z",
    });

    manifest.opsIds.customer.push("50000000-0000-4000-8000-000000000001");
    manifest.externalIds.contacts.push("sage-contact-exact");
    manifest.accepted.push({
      resource: "contacts",
      action: "create",
      externalId: "sage-contact-exact",
      acceptedAt: "2026-09-04T12:00:01.000Z",
      requestId: "sage-request-1",
    });
    manifest.cleanup.status = "complete";
    manifest.cleanup.startedAt = "2026-09-04T12:01:00.000Z";
    manifest.cleanup.completedAt = "2026-09-04T12:01:01.000Z";
    manifest.cleanup.opsRemaining = 0;

    expect(assertSageSandboxManifest(manifest)).toBe(manifest);
    expect(manifest).toMatchObject({
      version: 1,
      runId: RUN_ID,
      environment: "sandbox",
      businessId: "business-exact",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      createdAt: "2026-09-04T12:00:00.000Z",
      cleanup: { status: "complete", opsRemaining: 0 },
    });
  });

  it("rejects malformed or incomplete proof instead of emitting an ambiguous artifact", () => {
    const manifest = createSageSandboxManifest({
      runId: RUN_ID,
      businessId: "business-exact",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      createdAt: "2026-09-04T12:00:00.000Z",
    });

    expect(() =>
      assertSageSandboxManifest({ ...manifest, runId: "reused-run" })
    ).toThrow(/run id/i);
    expect(() =>
      assertSageSandboxManifest({ ...manifest, businessId: "" })
    ).toThrow(/business/i);
    expect(() =>
      assertSageSandboxManifest({ ...manifest, companyId: "company" })
    ).toThrow(/company/i);
    expect(() =>
      assertSageSandboxManifest({ ...manifest, createdAt: "today" })
    ).toThrow(/created/i);
  });

  it("redacts credentials and raw provider bodies while preserving verification evidence", () => {
    const manifest = createSageSandboxManifest({
      runId: RUN_ID,
      businessId: "business-exact",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      createdAt: "2026-09-04T12:00:00.000Z",
    });
    const unsafe = {
      ...manifest,
      accessToken: "access-super-secret",
      refresh_token: "refresh-super-secret",
      clientSecret: "client-super-secret",
      providerBodies: [{ private: "raw-provider-body" }],
      nested: { Authorization: "Bearer access-super-secret" },
    };

    const redacted = redactSageSandboxManifest(unsafe);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("access-super-secret");
    expect(serialized).not.toContain("refresh-super-secret");
    expect(serialized).not.toContain("client-super-secret");
    expect(serialized).not.toContain("raw-provider-body");
    expect(serialized).toContain(RUN_ID);
    expect(serialized).toContain("business-exact");
  });

  it("cleans provider children before documents and contacts", () => {
    const manifest = createSageSandboxManifest({
      runId: RUN_ID,
      businessId: "business-exact",
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      createdAt: "2026-09-04T12:00:00.000Z",
    });
    manifest.externalIds.contacts.push("customer", "supplier");
    manifest.externalIds.sales_invoices.push("invoice");
    manifest.externalIds.contact_payments.push("payment");

    expect(providerCleanupTargets(manifest)).toEqual([
      { resource: "contact_payments", id: "payment" },
      { resource: "sales_invoices", id: "invoice" },
      { resource: "contacts", id: "supplier" },
      { resource: "contacts", id: "customer" },
    ]);
  });
});

describe("Sage sandbox acceptance preflight", () => {
  it("returns a complete sandbox-only configuration when every fence passes", () => {
    expect(preflightSageSandboxWarGame(readyEnvironment())).toMatchObject({
      status: "ready",
      config: {
        environment: "sandbox",
        businessId: "business-exact",
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
      },
    });
  });

  it.each([
    ["explicit sandbox profile", { SAGE_ACTIVE_PROFILE: "production" }],
    ["accounting write gate", { ACCOUNTING_WRITE_ENABLED: "false" }],
    ["Sage write gate", { SAGE_WRITE_ENABLED: "false" }],
    ["token encryption key", { QB_TOKEN_ENC_KEY: "short" }],
    ["dedicated credentials", { SAGE_SANDBOX_CLIENT_SECRET: "" }],
    ["exact allow-list", { SAGE_SANDBOX_BUSINESS_IDS: "business-other" }],
    ["exact OPS company", { SAGE_SANDBOX_OPS_COMPANY_ID: "not-a-uuid" }],
    ["exact mappings", { SAGE_SANDBOX_TAX_RATE_ID: "" }],
  ])("blocks before network when %s is unsafe", (_label, override) => {
    const result = preflightSageSandboxWarGame({
      ...readyEnvironment(),
      ...override,
    });
    expect(result).toMatchObject({ status: "blocked" });
    if (result.status === "blocked") {
      expect(result.reason).toMatch(/^BLOCKED :: /);
    }
  });

  it("rejects sandbox credentials that equal configured production credentials", () => {
    const environment = readyEnvironment();
    environment.SAGE_CLIENT_ID = environment.SAGE_SANDBOX_CLIENT_ID;
    environment.SAGE_CLIENT_SECRET = environment.SAGE_SANDBOX_CLIENT_SECRET;

    expect(preflightSageSandboxWarGame(environment)).toMatchObject({
      status: "blocked",
      reason: expect.stringMatching(/dedicated/i),
    });
  });
});
