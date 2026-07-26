import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn(),
}));

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe("checkPermissionByIdStrict", () => {
  it("returns the permission result when Supabase succeeds", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const { checkPermissionByIdStrict } = await import(
      "@/lib/supabase/check-permission"
    );

    await expect(
      checkPermissionByIdStrict("user-1", "pipeline.manage")
    ).resolves.toBe(true);
  });

  it("retains the raw Supabase cause for cron pressure detection", async () => {
    const raw = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    mocks.rpc.mockResolvedValue({ data: null, error: raw });
    const { checkPermissionByIdStrict } = await import(
      "@/lib/supabase/check-permission"
    );
    const { CronDatabaseOperationError } = await import(
      "@/lib/api/services/cron-workload-control-service"
    );

    const failure = await checkPermissionByIdStrict(
      "user-1",
      "pipeline.manage"
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
  });
});
