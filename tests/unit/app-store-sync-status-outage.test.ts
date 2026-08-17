// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { updateAscSyncStatus } from "@/lib/admin/app-store-queries";
import { CronDatabaseOperationError } from "@/lib/api/services/cron-workload-error-contract";

describe("App Store sync status outage bounds", () => {
  it("checks sync-status writes and preserves the raw database error", async () => {
    const raw = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    const query = {
      upsert: vi.fn(async () => ({ data: null, error: raw })),
    };
    const client = {
      from: vi.fn(() => query),
    };

    const failure = await updateAscSyncStatus(
      "app-store-sync",
      { status: "running" },
      client as never
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
    expect(client.from).toHaveBeenCalledWith("asc_sync_status");
    expect(query.upsert).toHaveBeenCalledOnce();
  });
});
