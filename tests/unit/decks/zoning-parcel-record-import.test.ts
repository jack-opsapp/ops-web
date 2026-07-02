import { describe, expect, it } from "vitest";
import {
  importVerifiedParcelRecords,
  prepareVerifiedParcelRecordImport,
} from "@/lib/decks/zoning/parcel-record-import";

interface StoredRecord {
  id: string;
  company_id: string | null;
  jurisdiction_id: string | null;
  normalized_site_address: string;
  parcel_zoning: Record<string, unknown>;
  source_status: string;
  provider: string | null;
  source_url: string | null;
  retrieved_at: string;
  expires_at: string | null;
  deleted_at: string | null;
}

function makeParcelZoning(status: "available" | "partial" | "userEntered") {
  return {
    siteAddress: "123 Cedar St, Surrey, BC",
    source: {
      provider: "City GIS",
      jurisdictionId: "CA-BC-SURREY",
      sourceURL: "https://surrey.example.test/parcel/42",
    },
    status,
    parcel: {
      parcelId: "parcel-42",
      boundary: [
        [0, 0],
        [480, 0],
        [480, 360],
        [0, 360],
      ],
    },
    criteria: {
      maxLotCoveragePercent: 40,
      rearSetbackFeet: 5,
    },
  };
}

function makeDbDouble(records: StoredRecord[]) {
  const writes = {
    inserts: [] as Record<string, unknown>[],
    updates: [] as Array<{ id: string; row: Record<string, unknown> }>,
  };

  class Query {
    private readonly filters: Array<(record: StoredRecord) => boolean> = [];
    private updateRow: Record<string, unknown> | null = null;

    constructor(private readonly table: string) {}

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
      return {
        data: match ? { id: match.id } : null,
        error: null,
      };
    }

    insert(row: Record<string, unknown>) {
      writes.inserts.push(row);
      records.push({
        id: `insert-${writes.inserts.length}`,
        company_id: (row.company_id as string | null) ?? null,
        jurisdiction_id: (row.jurisdiction_id as string | null) ?? null,
        normalized_site_address: row.normalized_site_address as string,
        parcel_zoning: row.parcel_zoning as Record<string, unknown>,
        source_status: row.source_status as string,
        provider: (row.provider as string | null) ?? null,
        source_url: (row.source_url as string | null) ?? null,
        retrieved_at: row.retrieved_at as string,
        expires_at: (row.expires_at as string | null) ?? null,
        deleted_at: null,
      });
      return Promise.resolve({ error: null });
    }

    update(row: Record<string, unknown>) {
      this.updateRow = row;
      return this;
    }

    async then(
      resolve: (value: { error: { message: string } | null }) => void,
      reject?: (reason: unknown) => void
    ) {
      try {
        const idFilter = this.filters.find(() => true);
        const match = records.find((record) =>
          this.filters.every((filter) => filter(record))
        );
        if (!idFilter || !match || !this.updateRow) {
          resolve({ error: { message: "Update target not found" } });
          return;
        }

        writes.updates.push({ id: match.id, row: this.updateRow });
        Object.assign(match, this.updateRow);
        resolve({ error: null });
      } catch (error) {
        reject?.(error);
      }
    }
  }

  return {
    writes,
    client: {
      from(table: string) {
        if (table !== "deck_zoning_parcel_records") {
          throw new Error(`Unexpected table ${table}`);
        }
        return new Query(table);
      },
    },
  };
}

describe("zoning parcel record import", () => {
  it("normalizes accepted records into deck_zoning_parcel_records rows", () => {
    const parcelZoning = makeParcelZoning("available");

    const prepared = prepareVerifiedParcelRecordImport([
      {
        site_address: " 123   Cedar St, Surrey, BC ",
        jurisdiction_id: " CA-BC-SURREY ",
        parcel_zoning: parcelZoning,
        provider: " City GIS ",
        source_url: " https://surrey.example.test/parcel/42 ",
        retrieved_at: "2026-07-02T12:00:00.000Z",
      },
    ]);

    expect(prepared.rejected).toEqual([]);
    expect(prepared.accepted).toHaveLength(1);
    expect(prepared.accepted[0]).toMatchObject({
      index: 0,
      companyId: null,
      jurisdictionId: "CA-BC-SURREY",
      normalizedSiteAddress: "123 cedar st, surrey, bc",
      row: {
        company_id: null,
        jurisdiction_id: "CA-BC-SURREY",
        normalized_site_address: "123 cedar st, surrey, bc",
        parcel_zoning: parcelZoning,
        source_status: "available",
        provider: "City GIS",
        source_url: "https://surrey.example.test/parcel/42",
        retrieved_at: "2026-07-02T12:00:00.000Z",
        expires_at: null,
      },
    });
  });

  it("rejects invalid records before any write can happen", () => {
    const prepared = prepareVerifiedParcelRecordImport([
      {
        site_address: " ",
        parcel_zoning: makeParcelZoning("available"),
      },
      {
        site_address: "123 Cedar St",
        parcel_zoning: { status: "unavailable", siteAddress: "123 Cedar St" },
      },
      {
        site_address: "456 Cedar St",
        parcel_zoning: {
          status: "available",
          siteAddress: "456 Cedar St",
          source: { provider: "City GIS" },
        },
      },
    ]);

    expect(prepared.accepted).toEqual([]);
    expect(prepared.rejected).toEqual([
      { index: 0, reason: "site_address is required" },
      {
        index: 1,
        reason:
          "parcel_zoning.status must be available, partial, or userEntered",
      },
      {
        index: 2,
        reason:
          "available or partial parcel_zoning must include parcel or criteria",
      },
    ]);
  });

  it("accepts user-entered zoning records without provider or parcel geometry", () => {
    const prepared = prepareVerifiedParcelRecordImport([
      {
        site_address: "123 Manual St, Surrey, BC",
        jurisdiction_id: "CA-BC-SURREY",
        parcel_zoning: {
          siteAddress: "123 Manual St, Surrey, BC",
          status: "userEntered",
          criteria: {
            maxLotCoveragePercent: 40,
          },
        },
        source_status: "userEntered",
        retrieved_at: "2026-07-02T12:00:00.000Z",
      },
    ]);

    expect(prepared.rejected).toEqual([]);
    expect(prepared.accepted).toHaveLength(1);
    expect(prepared.accepted[0]).toMatchObject({
      sourceStatus: "userEntered",
      row: {
        source_status: "userEntered",
        provider: null,
        source_url: null,
      },
    });
  });

  it("updates matching active records and inserts new records", async () => {
    const existingParcelZoning = makeParcelZoning("partial");
    const importedParcelZoning = makeParcelZoning("available");
    const db = makeDbDouble([
      {
        id: "existing-1",
        company_id: null,
        jurisdiction_id: "CA-BC-SURREY",
        normalized_site_address: "123 cedar st, surrey, bc",
        parcel_zoning: existingParcelZoning,
        source_status: "partial",
        provider: "City GIS",
        source_url: "https://old.example.test/parcel/42",
        retrieved_at: "2026-06-01T00:00:00.000Z",
        expires_at: null,
        deleted_at: null,
      },
    ]);

    const prepared = prepareVerifiedParcelRecordImport([
      {
        site_address: "123 Cedar St, Surrey, BC",
        jurisdiction_id: "CA-BC-SURREY",
        parcel_zoning: importedParcelZoning,
        retrieved_at: "2026-07-02T12:00:00.000Z",
      },
      {
        site_address: "999 New Ave, Surrey, BC",
        jurisdiction_id: "CA-BC-SURREY",
        parcel_zoning: {
          ...makeParcelZoning("available"),
          siteAddress: "999 New Ave, Surrey, BC",
        },
        retrieved_at: "2026-07-02T12:00:00.000Z",
      },
    ]);

    const result = await importVerifiedParcelRecords({
      db: db.client as never,
      records: prepared.accepted,
    });

    expect(result).toEqual({ inserted: 1, updated: 1 });
    expect(db.writes.updates).toHaveLength(1);
    expect(db.writes.updates[0]).toMatchObject({
      id: "existing-1",
      row: {
        parcel_zoning: importedParcelZoning,
        source_status: "available",
        source_url: "https://surrey.example.test/parcel/42",
      },
    });
    expect(db.writes.inserts).toHaveLength(1);
    expect(db.writes.inserts[0]).toMatchObject({
      normalized_site_address: "999 new ave, surrey, bc",
      jurisdiction_id: "CA-BC-SURREY",
      source_status: "available",
    });
  });
});
