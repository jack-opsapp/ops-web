import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUserByAuthMock, getServiceRoleClientMock, verifyAuthTokenMock } =
  vi.hoisted(() => ({
    findUserByAuthMock: vi.fn(),
    getServiceRoleClientMock: vi.fn(),
    verifyAuthTokenMock: vi.fn(),
  }));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

import { POST } from "@/app/api/decks/zoning/parcel/route";

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

function makeRequest(body: Record<string, unknown>, token = "valid-token") {
  return new NextRequest("http://test.local/api/decks/zoning/parcel", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/decks/zoning/parcel", () => {
  beforeEach(() => {
    verifyAuthTokenMock.mockResolvedValue({
      uid: "auth-1",
      email: "deck@example.com",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
    });
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble([]));
  });

  it("returns 401 when the standalone app omits a bearer token", async () => {
    const response = await POST(
      new NextRequest("http://test.local/api/decks/zoning/parcel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_address: "123 Cedar St",
          source_app: "ops_decks",
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Missing Authorization bearer token",
    });
  });

  it("returns 400 when the address is blank", async () => {
    const response = await POST(
      makeRequest({ site_address: "   ", source_app: "ops_decks" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "site_address is required",
    });
  });

  it("returns a cached verified parcel record in the DeckKit resolution shape", async () => {
    const parcelZoning = {
      siteAddress: "123 Cedar St, Surrey, BC",
      source: {
        provider: "OPS verified zoning cache",
        jurisdictionId: "CA-BC-SURREY",
        sourceURL: "https://surrey.example.test/parcel/42",
      },
      status: "available",
      parcel: {
        parcelId: "parcel-42",
        boundary: [
          [0, 0],
          [480, 0],
          [480, 360],
          [0, 360],
        ],
        lotLines: [
          {
            id: "rear",
            role: "rear",
            start: [0, 0],
            end: [480, 0],
            requiredSetbackFeet: 5,
            sourceLabel: "Rear setback",
          },
        ],
      },
      criteria: {
        maxLotCoveragePercent: 40,
        maxStructureHeightFeet: 14,
      },
    };
    getServiceRoleClientMock.mockReturnValue(
      makeSupabaseDouble([
        {
          company_id: "company-1",
          jurisdiction_id: "CA-BC-SURREY",
          normalized_site_address: "123 cedar st, surrey, bc",
          parcel_zoning: parcelZoning,
          deleted_at: null,
        },
      ])
    );

    const response = await POST(
      makeRequest({
        site_address: " 123  Cedar St, Surrey, BC ",
        jurisdiction_id: " CA-BC-SURREY ",
        source_app: "ops_decks",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      request: {
        siteAddress: "123  Cedar St, Surrey, BC",
        jurisdictionId: "CA-BC-SURREY",
      },
      parcelZoning,
    });
  });

  it("returns 404 when no verified record exists so the app can use manual criteria", async () => {
    const response = await POST(
      makeRequest({
        site_address: "999 Missing Ave",
        jurisdiction_id: "CA-BC-SURREY",
        source_app: "ops_decks",
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Parcel zoning record not found",
    });
  });
});
