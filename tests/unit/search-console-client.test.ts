import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SEARCH_CONSOLE_DIMENSIONS,
  SearchConsoleApiError,
  buildSearchConsoleRequest,
  fetchSearchConsoleDate,
  getSearchConsoleSiteUrl,
} from "@/lib/analytics/search-console-client";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "tests/fixtures/analytics/search-console/page-1.json"
    ),
    "utf8"
  )
);

describe("Search Console client", () => {
  it("locks the finalized native-grain daily request", () => {
    expect(buildSearchConsoleRequest("2026-08-27", 25_000)).toEqual({
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      dimensions: [...SEARCH_CONSOLE_DIMENSIONS],
      type: "web",
      aggregationType: "auto",
      dataState: "final",
      rowLimit: 25_000,
      startRow: 25_000,
    });
  });

  it("requires an exact Search Console property identity", () => {
    expect(
      getSearchConsoleSiteUrl({ SEARCH_CONSOLE_SITE_URL: "sc-domain:opsapp.co" })
    ).toBe("sc-domain:opsapp.co");
    expect(() =>
      getSearchConsoleSiteUrl({
        SEARCH_CONSOLE_SITE_URL: "sc-domain:opsapp.co\n",
      })
    ).toThrow(/whitespace-padded/);
    expect(() =>
      getSearchConsoleSiteUrl({ SEARCH_CONSOLE_SITE_URL: "opsapp.co" })
    ).toThrow(/property identity/);
  });

  it("paginates with stable offsets and preserves Google's privacy-suppressed rows", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixture), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [] }), { status: 200 })
      );

    const rows = await fetchSearchConsoleDate("2026-08-27", {
      siteUrl: "sc-domain:opsapp.co",
      rowLimit: 2,
      fetchImpl,
      accessToken: async () => "read-only-token",
    });

    expect(rows).toEqual(fixture.rows);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(first.startRow).toBe(0);
    expect(second.startRow).toBe(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer read-only-token" })
    );
  });

  it("surfaces a denied property instead of returning zero rows", async () => {
    await expect(
      fetchSearchConsoleDate("2026-08-27", {
        siteUrl: "sc-domain:opsapp.co",
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response("forbidden", { status: 403 })
        ),
        accessToken: async () => "read-only-token",
      })
    ).rejects.toEqual(
      expect.objectContaining({ status: 403 }) as SearchConsoleApiError
    );
  });
});
