import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMode, getAdminSupabaseMock, writes } = vi.hoisted(() => ({
  authMode: { value: "admin" as "admin" | "forbidden" | "unauthorized" },
  getAdminSupabaseMock: vi.fn(),
  writes: {
    inserts: [] as Record<string, unknown>[],
    updates: [] as Array<{ id: string; row: Record<string, unknown> }>,
  },
}));

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdmin: async () => {
    if (authMode.value === "unauthorized") {
      throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authMode.value === "forbidden") {
      throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return { uid: "admin-1", email: "admin@opsapp.co", claims: {} };
  },
  withAdmin:
    (handler: (req: NextRequest) => Promise<NextResponse>) =>
    async (req: NextRequest) => {
      try {
        return await handler(req);
      } catch (error) {
        if (error instanceof NextResponse) return error;
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      }
    },
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: getAdminSupabaseMock,
}));

import { POST } from "@/app/api/admin/decks/zoning/parcel-records/import/route";

interface StoredRecord {
  id: string;
  company_id: string | null;
  jurisdiction_id: string | null;
  normalized_site_address: string;
  deleted_at: string | null;
}

function makeDbDouble(records: StoredRecord[]) {
  class Query {
    private readonly filters: Array<(record: StoredRecord) => boolean> = [];
    private updateRow: Record<string, unknown> | null = null;

    select() {
      return this;
    }

    eq(column: keyof StoredRecord, value: unknown) {
      this.filters.push((record) => record[column] === value);
      return this;
    }

    is(column: keyof StoredRecord, value: unknown) {
      this.filters.push((record) => record[column] === value);
      return this;
    }

    limit() {
      return this;
    }

    async maybeSingle() {
      const match =
        records.find((record) =>
          this.filters.every((filter) => filter(record))
        ) ?? null;
      return { data: match ? { id: match.id } : null, error: null };
    }

    insert(row: Record<string, unknown>) {
      writes.inserts.push(row);
      return Promise.resolve({ error: null });
    }

    update(row: Record<string, unknown>) {
      this.updateRow = row;
      return this;
    }

    async then(resolve: (value: { error: null }) => void) {
      const match = records.find((record) =>
        this.filters.every((filter) => filter(record))
      );
      if (!match || !this.updateRow) {
        throw new Error("Update target not found");
      }
      writes.updates.push({ id: match.id, row: this.updateRow });
      resolve({ error: null });
    }
  }

  return {
    from(table: string) {
      if (table !== "deck_zoning_parcel_records") {
        throw new Error(`Unexpected table ${table}`);
      }
      return new Query();
    },
  };
}

function makeParcelZoning() {
  return {
    siteAddress: "123 Cedar St, Surrey, BC",
    source: {
      provider: "City GIS",
      jurisdictionId: "CA-BC-SURREY",
      sourceURL: "https://surrey.example.test/parcel/42",
    },
    status: "available",
    criteria: {
      maxLotCoveragePercent: 40,
      rearSetbackFeet: 5,
    },
  };
}

function makeRequest(body: unknown) {
  return new NextRequest(
    "http://test.local/api/admin/decks/zoning/parcel-records/import",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/admin/decks/zoning/parcel-records/import", () => {
  beforeEach(() => {
    authMode.value = "admin";
    writes.inserts.length = 0;
    writes.updates.length = 0;
    getAdminSupabaseMock.mockClear();
    getAdminSupabaseMock.mockReturnValue(makeDbDouble([]));
  });

  it("returns a dry-run preview without writing records", async () => {
    const response = await POST(
      makeRequest({
        dry_run: true,
        records: [
          {
            site_address: " 123   Cedar St, Surrey, BC ",
            jurisdiction_id: " CA-BC-SURREY ",
            parcel_zoning: makeParcelZoning(),
            retrieved_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      dryRun: true,
      accepted: 1,
      rejected: [],
      records: [
        {
          index: 0,
          companyId: null,
          jurisdictionId: "CA-BC-SURREY",
          normalizedSiteAddress: "123 cedar st, surrey, bc",
          sourceStatus: "available",
        },
      ],
    });
    expect(writes.inserts).toEqual([]);
    expect(writes.updates).toEqual([]);
  });

  it("rejects the whole batch when any record is invalid", async () => {
    const response = await POST(
      makeRequest({
        records: [
          {
            site_address: "123 Cedar St",
            parcel_zoning: makeParcelZoning(),
          },
          {
            site_address: " ",
            parcel_zoning: makeParcelZoning(),
          },
        ],
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid zoning records",
      accepted: 1,
      rejected: [{ index: 1, reason: "site_address is required" }],
    });
    expect(writes.inserts).toEqual([]);
    expect(writes.updates).toEqual([]);
  });

  it("imports valid records into the service-role zoning cache", async () => {
    getAdminSupabaseMock.mockReturnValue(
      makeDbDouble([
        {
          id: "existing-1",
          company_id: null,
          jurisdiction_id: "CA-BC-SURREY",
          normalized_site_address: "123 cedar st, surrey, bc",
          deleted_at: null,
        },
      ])
    );

    const response = await POST(
      makeRequest({
        records: [
          {
            site_address: "123 Cedar St, Surrey, BC",
            jurisdiction_id: "CA-BC-SURREY",
            parcel_zoning: makeParcelZoning(),
            retrieved_at: "2026-07-02T12:00:00.000Z",
          },
          {
            site_address: "999 New Ave, Surrey, BC",
            jurisdiction_id: "CA-BC-SURREY",
            parcel_zoning: {
              ...makeParcelZoning(),
              siteAddress: "999 New Ave, Surrey, BC",
            },
            retrieved_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      dryRun: false,
      accepted: 2,
      rejected: [],
      inserted: 1,
      updated: 1,
    });
    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0].id).toBe("existing-1");
    expect(writes.inserts).toHaveLength(1);
  });

  it("uses the shared admin auth guard", async () => {
    authMode.value = "forbidden";

    const response = await POST(
      makeRequest({
        dry_run: true,
        records: [
          {
            site_address: "123 Cedar St",
            parcel_zoning: makeParcelZoning(),
          },
        ],
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(getAdminSupabaseMock).not.toHaveBeenCalled();
  });
});
