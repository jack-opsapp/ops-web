import { beforeEach, describe, expect, it, vi } from "vitest";

const runSyncForConnection = vi.fn();
const notFilter = vi.fn();

vi.mock("@/lib/api/services/sync-orchestrator", () => ({
  runSyncForConnection,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: (column: string, operator: string, value: string) => {
          notFilter(column, operator, value);
          return Promise.resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

describe("GET /api/cron/accounting-sync Sage ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
  });

  it("excludes both queue-owned providers from the ambiguous legacy orchestrator", async () => {
    const { GET } = await import("@/app/api/cron/accounting-sync/route");
    const response = await GET(
      new Request("http://localhost/api/cron/accounting-sync", {
        headers: { authorization: "Bearer cron-secret" },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(notFilter).toHaveBeenCalledWith(
      "provider",
      "in",
      '("quickbooks","sage")'
    );
    expect(runSyncForConnection).not.toHaveBeenCalled();
  });
});
