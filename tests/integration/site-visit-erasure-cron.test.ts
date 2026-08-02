import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const DELETED_A = "22222222-2222-4222-8222-222222222222";
const DELETED_B = "33333333-3333-4333-8333-333333333333";

const eraseSiteVisitPrefixMock = vi.fn();
vi.mock("@/lib/s3/site-visit-prefix-erasure", () => ({
  eraseSiteVisitPrefix: (companyId: string) =>
    eraseSiteVisitPrefixMock(companyId),
}));

let companyRows: Array<{ id: string; deleted_at: string | null }> = [];
const rangeMock = vi.fn(async (from: number, to: number) => ({
  data: companyRows.slice(from, to + 1),
  error: null,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "companies") throw new Error(`unexpected table: ${table}`);
      const builder = {
        select: () => builder,
        not: () => builder,
        order: () => builder,
        range: rangeMock,
      };
      return builder;
    },
  }),
}));

import { GET } from "@/app/api/cron/storage/site-visit-erasure/route";

function request(secret?: string): NextRequest {
  return new Request("http://localhost/api/cron/storage/site-visit-erasure", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }) as unknown as NextRequest;
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  companyRows = [];
  rangeMock.mockClear();
  eraseSiteVisitPrefixMock.mockReset().mockResolvedValue({
    prefix: "site-visits/company/",
    pages: 1,
    deleted: 2,
  });
});

describe("site-visit storage erasure cron", () => {
  it("fails closed when the secret is missing or wrong", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(request())).status).toBe(500);
    process.env.CRON_SECRET = "cron-secret";
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(eraseSiteVisitPrefixMock).not.toHaveBeenCalled();
  });

  it("sweeps only soft-deleted companies and never an active tenant", async () => {
    companyRows = [
      { id: ACTIVE, deleted_at: null },
      { id: DELETED_A, deleted_at: "2026-08-01T00:00:00.000Z" },
      { id: DELETED_B, deleted_at: "2026-08-01T00:01:00.000Z" },
    ];

    const response = await GET(request("cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(eraseSiteVisitPrefixMock.mock.calls).toEqual([
      [DELETED_A],
      [DELETED_B],
    ]);
    expect(body).toMatchObject({
      ok: true,
      scanned: 3,
      eligible: 2,
      erasedCompanies: 2,
      deletedObjects: 4,
      failures: [],
    });
  });

  it("reports a partial storage failure so the same company is retried next run", async () => {
    companyRows = [
      { id: DELETED_A, deleted_at: "2026-08-01T00:00:00.000Z" },
      { id: DELETED_B, deleted_at: "2026-08-01T00:01:00.000Z" },
    ];
    eraseSiteVisitPrefixMock
      .mockRejectedValueOnce(new Error("site_visit_prefix_delete_incomplete"))
      .mockResolvedValueOnce({ prefix: "site-visits/b/", pages: 1, deleted: 1 });

    const response = await GET(request("cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(eraseSiteVisitPrefixMock).toHaveBeenCalledTimes(2);
    expect(body.failures).toEqual([
      {
        companyId: DELETED_A,
        error: "site_visit_prefix_delete_incomplete",
      },
    ]);
  });

  it("paginates every deleted company so older empty prefixes cannot starve newer cleanup", async () => {
    companyRows = Array.from({ length: 27 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      deleted_at: "2026-08-01T00:00:00.000Z",
    }));
    eraseSiteVisitPrefixMock.mockResolvedValue({
      prefix: "site-visits/company/",
      pages: 1,
      deleted: 0,
    });

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(200);
    expect(rangeMock.mock.calls).toEqual([
      [0, 24],
      [25, 49],
    ]);
    expect(eraseSiteVisitPrefixMock).toHaveBeenCalledTimes(27);
  });
});
