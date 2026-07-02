import { describe, expect, it } from "vitest";
import {
  normalizeSiteAddress,
  resolveVerifiedParcelRecord,
} from "@/lib/decks/zoning/parcel-records";

type ZoningRecord = {
  company_id: string | null;
  jurisdiction_id: string | null;
  normalized_site_address: string;
  parcel_zoning: Record<string, unknown>;
  deleted_at?: string | null;
};

function makeSupabaseDouble(records: ZoningRecord[]) {
  class Query {
    private readonly filters: Array<(record: ZoningRecord) => boolean> = [];

    select() {
      return this;
    }

    eq(column: keyof ZoningRecord, value: unknown) {
      this.filters.push((record) => record[column] === value);
      return this;
    }

    is(column: keyof ZoningRecord, value: unknown) {
      this.filters.push((record) => record[column] === value);
      return this;
    }

    order() {
      return this;
    }

    limit() {
      return this;
    }

    async maybeSingle() {
      return {
        data:
          records.find((record) =>
            this.filters.every((filter) => filter(record))
          ) ?? null,
        error: null,
      };
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

describe("zoning parcel records", () => {
  it("normalizes site addresses the same way as DeckKit lookup keys", () => {
    expect(normalizeSiteAddress(" 123   Cedar\tSt, Surrey, BC ")).toBe(
      "123 cedar st, surrey, bc"
    );
  });

  it("prefers a company-specific verified record over a global record", async () => {
    const globalParcel = { status: "available", siteAddress: "global" };
    const companyParcel = { status: "available", siteAddress: "company" };

    const result = await resolveVerifiedParcelRecord({
      db: makeSupabaseDouble([
        {
          company_id: null,
          jurisdiction_id: "CA-BC-SURREY",
          normalized_site_address: "123 cedar st",
          parcel_zoning: globalParcel,
          deleted_at: null,
        },
        {
          company_id: "company-1",
          jurisdiction_id: "CA-BC-SURREY",
          normalized_site_address: "123 cedar st",
          parcel_zoning: companyParcel,
          deleted_at: null,
        },
      ]) as never,
      companyId: "company-1",
      siteAddress: "123 Cedar St",
      jurisdictionId: "CA-BC-SURREY",
    });

    expect(result?.parcelZoning).toBe(companyParcel);
  });

  it("uses a global verified record when there is no company-specific match", async () => {
    const globalParcel = { status: "partial", siteAddress: "global" };

    const result = await resolveVerifiedParcelRecord({
      db: makeSupabaseDouble([
        {
          company_id: null,
          jurisdiction_id: "CA-BC-SURREY",
          normalized_site_address: "123 cedar st",
          parcel_zoning: globalParcel,
          deleted_at: null,
        },
      ]) as never,
      companyId: "company-1",
      siteAddress: "123 Cedar St",
      jurisdictionId: "CA-BC-SURREY",
    });

    expect(result?.parcelZoning).toBe(globalParcel);
  });

  it("does not return unavailable parcel zoning as verified criteria", async () => {
    const result = await resolveVerifiedParcelRecord({
      db: makeSupabaseDouble([
        {
          company_id: "company-1",
          jurisdiction_id: "CA-BC-SURREY",
          normalized_site_address: "123 cedar st",
          parcel_zoning: { status: "unavailable" },
          deleted_at: null,
        },
      ]) as never,
      companyId: "company-1",
      siteAddress: "123 Cedar St",
      jurisdictionId: "CA-BC-SURREY",
    });

    expect(result).toBeNull();
  });
});
