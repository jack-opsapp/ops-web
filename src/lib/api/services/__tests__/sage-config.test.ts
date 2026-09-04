import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function clearSageEnvironment(): void {
  for (const name of [
    "SAGE_ACTIVE_PROFILE",
    "SAGE_CLIENT_ID",
    "SAGE_CLIENT_SECRET",
    "SAGE_REDIRECT_URI",
    "SAGE_SANDBOX_CLIENT_ID",
    "SAGE_SANDBOX_CLIENT_SECRET",
    "SAGE_SANDBOX_REDIRECT_URI",
    "SAGE_SANDBOX_BUSINESS_IDS",
    "ACCOUNTING_WRITE_ENABLED",
    "SAGE_WRITE_ENABLED",
    "SAGE_PRODUCTION_WRITE_ENABLED",
  ]) {
    delete process.env[name];
  }
}

describe("Sage provider configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    clearSageEnvironment();
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults non-production runtimes to the sandbox profile", async () => {
    const { getSageProviderEnvironment } = await import("../sage-config");

    expect(getSageProviderEnvironment()).toBe("sandbox");
  });

  it("defaults a production runtime to the production profile", async () => {
    process.env.NODE_ENV = "production";
    const { getSageProviderEnvironment } = await import("../sage-config");

    expect(getSageProviderEnvironment()).toBe("production");
  });

  it("rejects an explicit unknown profile instead of choosing a credential bundle", async () => {
    process.env.SAGE_ACTIVE_PROFILE = "staging";
    const { getSageProviderEnvironment } = await import("../sage-config");

    expect(() => getSageProviderEnvironment()).toThrow(
      /SAGE_ACTIVE_PROFILE.*production.*sandbox/i
    );
  });

  it("resolves only the dedicated sandbox credential bundle", async () => {
    process.env.SAGE_CLIENT_ID = "production-client";
    process.env.SAGE_CLIENT_SECRET = "production-secret";
    process.env.SAGE_REDIRECT_URI = "https://app.opsapp.co/sage/callback";
    process.env.SAGE_SANDBOX_CLIENT_ID = "sandbox-client";
    process.env.SAGE_SANDBOX_CLIENT_SECRET = "sandbox-secret";
    process.env.SAGE_SANDBOX_REDIRECT_URI =
      "https://sandbox.ops.test/sage/callback";
    const { getSageCredentials } = await import("../sage-config");

    expect(getSageCredentials("sandbox")).toEqual({
      clientId: "sandbox-client",
      clientSecret: "sandbox-secret",
      redirectUri: "https://sandbox.ops.test/sage/callback",
      environment: "sandbox",
    });
  });

  it("never falls back from missing sandbox credentials to production credentials", async () => {
    process.env.SAGE_CLIENT_ID = "production-client";
    process.env.SAGE_CLIENT_SECRET = "production-secret";
    process.env.SAGE_REDIRECT_URI = "https://app.opsapp.co/sage/callback";
    const { getSageCredentials } = await import("../sage-config");

    expect(() => getSageCredentials("sandbox")).toThrow(
      /SAGE_SANDBOX_CLIENT_ID/
    );
  });

  it("uses the canonical callback when a profile redirect URI is absent", async () => {
    process.env.SAGE_SANDBOX_CLIENT_ID = "sandbox-client";
    process.env.SAGE_SANDBOX_CLIENT_SECRET = "sandbox-secret";
    const { getSageCredentials } = await import("../sage-config");

    expect(getSageCredentials("sandbox").redirectUri).toBe(
      "https://app.opsapp.co/api/integrations/sage/callback"
    );
  });

  it("normalizes, deduplicates, and freezes the sandbox business allow-list", async () => {
    process.env.SAGE_SANDBOX_BUSINESS_IDS =
      " business-a, business-b,business-a, ,BUSINESS-C ";
    const { getAllowedSageBusinessIds } = await import("../sage-config");

    const ids = getAllowedSageBusinessIds("sandbox");
    expect(ids).toEqual(["business-a", "business-b", "BUSINESS-C"]);
    expect(Object.isFrozen(ids)).toBe(true);
    expect(getAllowedSageBusinessIds("production")).toEqual([]);
  });

  it("blocks sandbox writes until both write gates and the exact business allow-list pass", async () => {
    process.env.SAGE_SANDBOX_BUSINESS_IDS = "sandbox-business";
    const { assertSageWriteAllowed } = await import("../sage-config");

    expect(() =>
      assertSageWriteAllowed({
        environment: "sandbox",
        businessId: "sandbox-business",
      })
    ).toThrow(/ACCOUNTING_WRITE_ENABLED/);

    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    expect(() =>
      assertSageWriteAllowed({
        environment: "sandbox",
        businessId: "sandbox-business",
      })
    ).toThrow(/SAGE_WRITE_ENABLED/);

    process.env.SAGE_WRITE_ENABLED = "true";
    expect(() =>
      assertSageWriteAllowed({
        environment: "sandbox",
        businessId: "different-business",
      })
    ).toThrow(/allow-list/i);

    expect(
      assertSageWriteAllowed({
        environment: "sandbox",
        businessId: "sandbox-business",
      })
    ).toEqual({ environment: "sandbox", businessId: "sandbox-business" });
  });

  it("requires a separate production write gate", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    process.env.SAGE_WRITE_ENABLED = "true";
    const { assertSageWriteAllowed } = await import("../sage-config");

    expect(() =>
      assertSageWriteAllowed({
        environment: "production",
        businessId: "production-business",
      })
    ).toThrow(/SAGE_PRODUCTION_WRITE_ENABLED/);

    process.env.SAGE_PRODUCTION_WRITE_ENABLED = "true";
    expect(
      assertSageWriteAllowed({
        environment: "production",
        businessId: "production-business",
      })
    ).toEqual({
      environment: "production",
      businessId: "production-business",
    });
  });
});
