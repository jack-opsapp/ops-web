import { describe, expect, it, vi } from "vitest";

import { getCompanyManagerUserIds } from "@/lib/api/services/company-managers";

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

describe("getCompanyManagerUserIds", () => {
  it("distinguishes an unconfigured company from a transient read failure", async () => {
    const unavailable = {
      from: vi.fn(() =>
        query({ data: null, error: { message: "database unavailable" } })
      ),
    };
    await expect(
      getCompanyManagerUserIds(unavailable as never, "company-1")
    ).rejects.toThrow("database unavailable");

    const unconfigured = {
      from: vi.fn(() => query({ data: null, error: null })),
    };
    await expect(
      getCompanyManagerUserIds(unconfigured as never, "company-1")
    ).resolves.toEqual([]);
  });
});
