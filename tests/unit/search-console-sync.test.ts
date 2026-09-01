import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSyncStore } from "@/lib/admin/analytics-sync-store";
import {
  aggregateSearchConsoleFacts,
  planSearchConsoleSync,
  runSearchConsoleSync,
  toSearchConsoleFact,
} from "@/lib/admin/search-console-sync";

function storeMock() {
  return {
    latest: vi.fn().mockResolvedValue(null),
    begin: vi.fn().mockResolvedValue("run-id"),
    annotate: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    replaceSearchConsoleDate: vi.fn().mockImplementation(async ({ rows }) => rows.length),
  } as unknown as AnalyticsSyncStore;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Search Console sync", () => {
  it("replays D-7 through D-3 and advances a bounded historical cursor", () => {
    const plan = planSearchConsoleSync({
      today: "2026-08-30",
      latestState: {
        cursor: "2025-05-01",
        metadata: { backfill_complete: false },
      },
      backfillDaysPerRun: 2,
    });

    expect(plan.dates).toEqual([
      "2025-05-01",
      "2025-05-02",
      "2026-08-23",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ]);
    expect(plan.latestFinalizedDate).toBe("2026-08-27");
    expect(plan.nextCursor).toBe("2025-05-03");
    expect(plan.backfillComplete).toBe(false);
  });

  it("sanitizes page query strings without inventing hidden query rows", () => {
    const fact = toSearchConsoleFact(
      {
        keys: [
          "2026-08-27",
          "field service app",
          "https://opsapp.co/blog/field-service?private=1#fragment",
          "can",
          "MOBILE",
        ],
        clicks: 3,
        impressions: 120,
        ctr: 0.025,
        position: 8.5,
      },
      "sc-domain:opsapp.co",
      "2026-08-27",
      "2026-08-30T20:00:00.000Z"
    );

    expect(fact.page).toBe("https://opsapp.co/blog/field-service");
    expect(fact.query).toBe("field service app");
  });

  it("re-aggregates rows that collapse after query-string removal", () => {
    const base = toSearchConsoleFact(
      {
        keys: [
          "2026-08-27",
          "ops",
          "https://opsapp.co/?a=1",
          "can",
          "MOBILE",
        ],
        clicks: 1,
        impressions: 10,
        ctr: 0.1,
        position: 4,
      },
      "sc-domain:opsapp.co",
      "2026-08-27",
      "2026-08-30T20:00:00.000Z"
    );
    const rows = aggregateSearchConsoleFacts([
      base,
      { ...base, clicks: 2, impressions: 20, ctr: 0.1, position: 7 },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({ clicks: 3, impressions: 30, ctr: 0.1, position: 6 })
    );
  });

  it("atomically replaces each date and records finalized state", async () => {
    const store = storeMock();
    const fetchDate = vi.fn().mockImplementation(async (reportingDate) => [
      {
        keys: [
          reportingDate,
          "ops",
          "https://opsapp.co/",
          "can",
          "DESKTOP",
        ],
        clicks: 1,
        impressions: 10,
        ctr: 0.1,
        position: 4,
      },
    ]);

    const result = await runSearchConsoleSync({
      store,
      now: new Date("2026-08-30T20:00:00.000Z"),
      siteUrl: "sc-domain:opsapp.co",
      backfillStartDate: "2026-08-23",
      fetchDate,
    });

    expect(result.finalizedThrough).toBe("2026-08-27");
    expect(store.replaceSearchConsoleDate).toHaveBeenCalledTimes(5);
    expect(store.complete).toHaveBeenCalledWith(
      "run-id",
      expect.objectContaining({
        sourceMaxDate: "2026-08-27",
        rowCount: 5,
        cursor: null,
      })
    );
  });

  it("records permission failures and never converts them to an empty day", async () => {
    const store = storeMock();
    const denied = Object.assign(new Error("Search Console query failed (403)"), {
      status: 403,
    });

    await expect(
      runSearchConsoleSync({
        store,
        now: new Date("2026-08-30T20:00:00.000Z"),
        siteUrl: "sc-domain:opsapp.co",
        backfillStartDate: "2026-08-23",
        fetchDate: vi.fn().mockRejectedValue(denied),
      })
    ).rejects.toThrow(/403/);

    expect(store.fail).toHaveBeenCalledWith("run-id", denied);
    expect(store.replaceSearchConsoleDate).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("records a failed run when preflight throws before any fetch (bug 6d61591c)", async () => {
    const store = storeMock();
    // An empty SEARCH_CONSOLE_SITE_URL is exactly the 2026-08-31 06:20 UTC
    // production state: the site-url read threw before the run record existed,
    // so the failure left no analytics_sync_runs row to diagnose.
    vi.stubEnv("SEARCH_CONSOLE_SITE_URL", "");

    await expect(
      runSearchConsoleSync({
        store,
        now: new Date("2026-08-31T06:20:05.000Z"),
        fetchDate: vi.fn(),
      })
    ).rejects.toThrow(/SEARCH_CONSOLE_SITE_URL/);

    expect(store.begin).toHaveBeenCalledTimes(1);
    expect(store.begin).toHaveBeenCalledWith("search_console", {
      phase: "preflight",
    });
    // Nothing fallible ran before the record was open.
    expect(store.latest).not.toHaveBeenCalled();
    expect(store.annotate).not.toHaveBeenCalled();
    expect(store.replaceSearchConsoleDate).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.fail).mock.calls[0][0]).toBe("run-id");
    expect(String(vi.mocked(store.fail).mock.calls[0][1])).toMatch(
      /SEARCH_CONSOLE_SITE_URL/
    );
  });

  it("records a failed run when the cursor read throws after the record opens", async () => {
    const store = storeMock();
    const readFailure = new Error("Analytics sync state read failed: timeout");
    vi.mocked(store.latest).mockRejectedValue(readFailure);

    await expect(
      runSearchConsoleSync({
        store,
        now: new Date("2026-08-31T06:20:05.000Z"),
        siteUrl: "sc-domain:opsapp.co",
        fetchDate: vi.fn(),
      })
    ).rejects.toThrow(/state read failed/);

    expect(store.begin).toHaveBeenCalledWith("search_console", {
      phase: "preflight",
    });
    expect(store.fail).toHaveBeenCalledWith("run-id", readFailure);
    expect(store.annotate).not.toHaveBeenCalled();
  });

  it("annotates the run with site_url and requested dates once preflight passes", async () => {
    const store = storeMock();

    await runSearchConsoleSync({
      store,
      now: new Date("2026-08-30T20:00:00.000Z"),
      siteUrl: "sc-domain:opsapp.co",
      backfillStartDate: "2026-08-23",
      fetchDate: vi.fn().mockResolvedValue([]),
    });

    expect(store.annotate).toHaveBeenCalledTimes(1);
    expect(store.annotate).toHaveBeenCalledWith("run-id", {
      site_url: "sc-domain:opsapp.co",
      requested_dates: [
        "2026-08-23",
        "2026-08-24",
        "2026-08-25",
        "2026-08-26",
        "2026-08-27",
      ],
    });
    expect(store.fail).not.toHaveBeenCalled();
  });
});
