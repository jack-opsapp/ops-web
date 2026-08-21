import { afterEach, describe, expect, it, vi } from "vitest";

const CURSOR_KEY_ENV = "OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server-client");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("MCP production runtime", () => {
  it("constructs and caches the complete eleven-repository graph without reading", async () => {
    vi.resetModules();
    vi.stubEnv(CURSOR_KEY_ENV, "ab".repeat(32));
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server-client", () => ({
      getServiceRoleClient: () => ({ rpc }),
    }));
    const runtimeModule = await import("../runtime");

    expect(runtimeModule.mcpRuntimeConfigured()).toBe(true);
    const runtime = runtimeModule.getMcpServerRuntime();
    expect(runtimeModule.getMcpServerRuntime()).toBe(runtime);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.keys(runtime.domainService)).toEqual([
      "getJobConversationContext",
      "listScheduledJobs",
      "listJobReadinessIssues",
      "getJobCommunicationContext",
      "resolveJobParticipants",
      "listCustomerJobs",
      "getJobSummary",
      "searchJobHistory",
      "getCorrespondenceEvidence",
      "searchCustomers",
      "searchJobs",
    ]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("remains unusable without an exact cursor key", async () => {
    vi.resetModules();
    vi.stubEnv(CURSOR_KEY_ENV, "not-a-key");
    vi.doMock("@/lib/supabase/server-client", () => ({
      getServiceRoleClient: vi.fn(),
    }));
    const runtimeModule = await import("../runtime");

    expect(runtimeModule.mcpRuntimeConfigured()).toBe(false);
    expect(() => runtimeModule.getMcpServerRuntime()).toThrow(TypeError);
  });
});
