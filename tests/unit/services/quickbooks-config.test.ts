/**
 * Unit tests for the shared QuickBooks environment-config helper.
 * The helper centralizes active QuickBooks profile resolution, OAuth
 * credentials, redirect URI, webhook verifier, and API base-host so every QB
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
    delete process.env.QB_ACTIVE_PROFILE;
    delete process.env.QB_ACTIVE_PROFILE_DEFAULT;
    delete process.env.QB_SANDBOX_CLIENT_ID;
    delete process.env.QB_SANDBOX_CLIENT_SECRET;
    delete process.env.QB_SANDBOX_REDIRECT_URI;
    delete process.env.QB_SANDBOX_WEBHOOK_VERIFIER_TOKEN;
    delete process.env.QB_SANDBOX_ENVIRONMENT;
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
    expect(cfg.providerEnvironment).toBe("production");
    expect(cfg.apiBaseHost).toBe("https://quickbooks.api.intuit.com");
  });

  it("selects the sandbox credential bundle when active profile is sandbox", async () => {
    process.env.QB_ACTIVE_PROFILE = "sandbox";
    process.env.QB_SANDBOX_CLIENT_ID = "sandbox_client_id";
    process.env.QB_SANDBOX_CLIENT_SECRET = "sandbox_client_secret";
    process.env.QB_SANDBOX_WEBHOOK_VERIFIER_TOKEN = "sandbox_verifier";
    process.env.QB_SANDBOX_ENVIRONMENT = "sandbox";

    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    const cfg = getQuickBooksConfig();
    expect(cfg.clientId).toBe("sandbox_client_id");
    expect(cfg.clientSecret).toBe("sandbox_client_secret");
    expect(cfg.webhookVerifierToken).toBe("sandbox_verifier");
    expect(cfg.redirectUri).toBe(
      "https://app.opsapp.co/api/integrations/quickbooks/callback"
    );
    expect(cfg.environment).toBe("sandbox");
    expect(cfg.providerEnvironment).toBe("sandbox");
    expect(cfg.apiBaseHost).toBe("https://sandbox-quickbooks.api.intuit.com");
  });

  it("uses QB_ENVIRONMENT as a backwards-compatible active profile switch", async () => {
    process.env.QB_ENVIRONMENT = "sandbox";
    process.env.QB_SANDBOX_CLIENT_ID = "sandbox_client_id";
    process.env.QB_SANDBOX_CLIENT_SECRET = "sandbox_client_secret";

    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    const cfg = getQuickBooksConfig();
    expect(cfg.clientId).toBe("sandbox_client_id");
    expect(cfg.providerEnvironment).toBe("sandbox");
    expect(cfg.apiBaseHost).toBe("https://sandbox-quickbooks.api.intuit.com");
  });

  it("resolves a specific provider environment without reading the active switch", async () => {
    process.env.QB_ACTIVE_PROFILE = "production";
    process.env.QB_SANDBOX_CLIENT_ID = "sandbox_client_id";
    process.env.QB_SANDBOX_CLIENT_SECRET = "sandbox_client_secret";
    process.env.QB_SANDBOX_REDIRECT_URI =
      "https://sandbox.example.com/api/integrations/quickbooks/callback";

    const { getQuickBooksConfigForEnvironment } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    const cfg = getQuickBooksConfigForEnvironment("sandbox");
    expect(cfg.clientId).toBe("sandbox_client_id");
    expect(cfg.redirectUri).toBe(
      "https://sandbox.example.com/api/integrations/quickbooks/callback"
    );
    expect(cfg.providerEnvironment).toBe("sandbox");
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

  it("defaults to sandbox host only when all profile switches are unset (dev safety)", async () => {
    delete process.env.QB_ENVIRONMENT;
    process.env.QB_SANDBOX_CLIENT_ID = "sandbox_client_id";
    process.env.QB_SANDBOX_CLIENT_SECRET = "sandbox_client_secret";
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(getQuickBooksConfig().environment).toBe("sandbox");
    expect(getQuickBooksConfig().apiBaseHost).toBe(
      "https://sandbox-quickbooks.api.intuit.com"
    );
  });
});
