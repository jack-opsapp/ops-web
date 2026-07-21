import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const monitoring = vi.hoisted(() => ({
  createFetch: vi.fn(() => vi.fn<typeof fetch>()),
}));

vi.mock("@/lib/api/services/openai-monitoring", () => ({
  createMonitoredOpenAIFetch: monitoring.createFetch,
}));

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    apiKey: string;

    constructor(options: { apiKey: string }) {
      this.apiKey = options.apiKey;
    }
  },
}));

const { getOpenAIForWorkload, resetOpenAIClientsForTests } =
  await import("@/lib/api/services/openai-clients");

beforeEach(() => {
  resetOpenAIClientsForTests();
  monitoring.createFetch.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOpenAIForWorkload", () => {
  it("labels a configured specialized key by its environment source", () => {
    vi.stubEnv("OPENAI_API_KEY_IMPORT", "sk-import");
    vi.stubEnv("OPENAI_API_KEY", "sk-shared");

    const client = getOpenAIForWorkload({
      workload: "email_import_classifier",
      primaryKeyEnvironment: "OPENAI_API_KEY_IMPORT",
      timeout: 45_000,
    });

    expect(client.apiKey).toBe("sk-import");
    expect(monitoring.createFetch).toHaveBeenCalledWith({
      keySource: "OPENAI_API_KEY_IMPORT",
      workload: "email_import_classifier",
    });
  });

  it("converges a missing specialized key on the shared fallback source", () => {
    vi.stubEnv("OPENAI_API_KEY_IMPORT", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-shared\\n  ");

    const client = getOpenAIForWorkload({
      workload: "email_import_classifier",
      primaryKeyEnvironment: "OPENAI_API_KEY_IMPORT",
    });

    expect(client.apiKey).toBe("sk-shared");
    expect(monitoring.createFetch).toHaveBeenCalledWith({
      keySource: "OPENAI_API_KEY",
      workload: "email_import_classifier",
    });
  });

  it("keeps separate workload clients while reusing the same workload singleton", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-shared");

    const first = getOpenAIForWorkload({ workload: "catalog_setup" });
    const same = getOpenAIForWorkload({ workload: "catalog_setup" });
    const other = getOpenAIForWorkload({ workload: "admin_ads_briefing" });

    expect(same).toBe(first);
    expect(other).not.toBe(first);
    expect(monitoring.createFetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed when neither specialized nor shared credentials exist", () => {
    vi.stubEnv("OPENAI_API_KEY_SYNC", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(() =>
      getOpenAIForWorkload({
        workload: "email_sync",
        primaryKeyEnvironment: "OPENAI_API_KEY_SYNC",
      })
    ).toThrow("Missing OPENAI_API_KEY_SYNC or OPENAI_API_KEY");
  });
});
