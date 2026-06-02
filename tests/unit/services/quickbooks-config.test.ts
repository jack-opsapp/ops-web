/**
 * Unit tests for the shared QuickBooks environment-config helper.
 * The helper centralizes QB_CLIENT_ID / QB_CLIENT_SECRET / QB_REDIRECT_URI /
 * QB_ENVIRONMENT resolution and the API base-host selection so every QB
 * surface (OAuth init, callback, pull service, import route) reads ONE
 * source of truth and fails loud on misconfiguration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("getQuickBooksConfig", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.QB_CLIENT_ID = "AB_test_client_id";
    process.env.QB_CLIENT_SECRET = "test_client_secret";
    process.env.QB_REDIRECT_URI =
      "https://app.opsapp.co/api/integrations/quickbooks/callback";
    process.env.QB_ENVIRONMENT = "production";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("resolves production config and the production API host", async () => {
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    const cfg = getQuickBooksConfig();
    expect(cfg.clientId).toBe("AB_test_client_id");
    expect(cfg.clientSecret).toBe("test_client_secret");
    expect(cfg.redirectUri).toBe(
      "https://app.opsapp.co/api/integrations/quickbooks/callback"
    );
    expect(cfg.environment).toBe("production");
    expect(cfg.apiBaseHost).toBe("https://quickbooks.api.intuit.com");
  });

  it("selects the sandbox API host when QB_ENVIRONMENT=sandbox", async () => {
    process.env.QB_ENVIRONMENT = "sandbox";
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(getQuickBooksConfig().apiBaseHost).toBe(
      "https://sandbox-quickbooks.api.intuit.com"
    );
  });

  it("throws a loud error when QB_CLIENT_ID is missing", async () => {
    delete process.env.QB_CLIENT_ID;
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(() => getQuickBooksConfig()).toThrow(/QB_CLIENT_ID/);
  });

  it("throws when QB_ENVIRONMENT is an invalid value", async () => {
    process.env.QB_ENVIRONMENT = "staging";
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(() => getQuickBooksConfig()).toThrow(/QB_ENVIRONMENT/);
  });

  it("defaults to sandbox host only when QB_ENVIRONMENT is unset (dev safety)", async () => {
    delete process.env.QB_ENVIRONMENT;
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(getQuickBooksConfig().environment).toBe("sandbox");
    expect(getQuickBooksConfig().apiBaseHost).toBe(
      "https://sandbox-quickbooks.api.intuit.com"
    );
  });
});
