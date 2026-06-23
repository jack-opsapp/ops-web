// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedRow } from "@/lib/analytics/app-store-parse";

// ── Mocks ────────────────────────────────────────────────────────────────────
const ascPost = vi.fn();
vi.mock("@/lib/analytics/app-store-client", () => ({
  ascPost: (...a: unknown[]) => ascPost(...a),
  ascGet: vi.fn(),
  downloadSegment: vi.fn(),
  getAscAppId: () => "999888777",
}));

let existingRequests: { access_type: string; created_at: string }[] = [];
const inserts: { table: string; row: unknown }[] = [];
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => ({
      select: () => Promise.resolve({ data: existingRequests, error: null }),
      insert: (row: unknown) => {
        inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
}));

import {
  buildReportRequestBody,
  toEngagementFact,
  toDownloadFact,
  bootstrapIfNeeded,
} from "@/lib/admin/app-store-sync";

const row = (fields: Record<string, string | number>): ParsedRow => ({ raw: {}, ...fields });

beforeEach(() => {
  ascPost.mockReset();
  ascPost.mockImplementation(() => Promise.resolve({ data: { id: "req_" + (ascPost.mock.calls.length) } }));
  existingRequests = [];
  inserts.length = 0;
});

describe("buildReportRequestBody", () => {
  it("scopes the request to the app via the apps relationship + numeric id", () => {
    expect(buildReportRequestBody("ONGOING", "999888777")).toEqual({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: "999888777" } } },
      },
    });
  });
});

describe("toEngagementFact / toDownloadFact", () => {
  it("maps engagement fields, normalizes channel, and carries segment id", () => {
    const f = toEngagementFact(
      row({ reporting_date: "2026-06-10", engagement_type: "Impression", source_type: "App Store Search", territory: "US", counts: 100, unique_counts: 80 }),
      "seg-1",
    );
    expect(f).toMatchObject({
      reporting_date: "2026-06-10",
      engagement_type: "Impression",
      source_type: "App Store Search",
      channel: "app_store_search",
      territory: "US",
      counts: 100,
      unique_counts: 80,
      segment_id: "seg-1",
      granularity: "DAILY",
    });
    expect(f.page_type).toBeNull(); // absent dimension → null
  });

  it("maps download rows and normalizes an unknown source to 'other'", () => {
    const f = toDownloadFact(
      row({ reporting_date: "2026-06-10", download_type: "Total Downloads", source_type: "Mystery", counts: 5, unique_counts: 5 }),
      "seg-2",
    );
    expect(f).toMatchObject({ download_type: "Total Downloads", channel: "other", counts: 5, segment_id: "seg-2" });
  });
});

describe("bootstrapIfNeeded (idempotent)", () => {
  it("creates ONGOING + ONE_TIME_SNAPSHOT when no requests exist", async () => {
    existingRequests = [];
    await bootstrapIfNeeded();
    expect(ascPost).toHaveBeenCalledTimes(2);
    const types = inserts.map((i) => (i.row as { access_type: string }).access_type).sort();
    expect(types).toEqual(["ONE_TIME_SNAPSHOT", "ONGOING"]);
  });

  it("does nothing when ONGOING + a fresh snapshot already exist", async () => {
    const now = new Date().toISOString();
    existingRequests = [
      { access_type: "ONGOING", created_at: now },
      { access_type: "ONE_TIME_SNAPSHOT", created_at: now },
    ];
    await bootstrapIfNeeded();
    expect(ascPost).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("creates only the missing ONGOING when a snapshot already exists", async () => {
    existingRequests = [{ access_type: "ONE_TIME_SNAPSHOT", created_at: new Date().toISOString() }];
    await bootstrapIfNeeded();
    expect(ascPost).toHaveBeenCalledTimes(1);
    expect((inserts[0].row as { access_type: string }).access_type).toBe("ONGOING");
  });
});
