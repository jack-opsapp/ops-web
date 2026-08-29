import { describe, expect, it } from "vitest";

import { measureP2SerializedCharacters } from "../../shared/result-budget";
import { createTeamAvailabilityCursorService } from "../availability-cursor";
import { listTeamAvailability } from "../availability-reads";
import { createSupabaseTeamAvailabilityRepository } from "../availability-repository";
import {
  AVAILABILITY_ACTOR_ID,
  AVAILABILITY_MEMBER_ID,
  availabilityAuthorization,
  availabilityRawSnapshot,
  companyAvailabilityQuery,
} from "./availability-fixtures";

class StubRpcClient {
  readonly calls: Array<{ functionName: string }> = [];
  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}
  rpc(functionName: string) {
    this.calls.push({ functionName });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected team-availability RPC");
    return Promise.resolve(next);
  }
}

function cursors(seed = 13) {
  return createTeamAvailabilityCursorService({
    keyId: "availability-service",
    key: Buffer.alloc(32, seed),
  });
}

describe("P2 list_team_availability service", () => {
  it("returns frozen, proof-coupled company-local capacity and a signed next page", async () => {
    const authorization = await availabilityAuthorization(
      companyAvailabilityQuery({ limit: 1 })
    );
    const raw = availabilityRawSnapshot({
      authorization,
      sourceHasMore: true,
    });
    const repository = createSupabaseTeamAvailabilityRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );

    const result = await listTeamAvailability({
      authorization,
      repository,
      cursors: cursors(),
    });

    expect(result).toMatchObject({
      view: "company",
      window: {
        starts_on: "2026-11-01",
        ends_on: "2026-11-03",
        timezone: "America/Vancouver",
      },
      items: [
        {
          member_ref: { id: AVAILABILITY_MEMBER_ID },
          days: [
            { state: "unavailable" },
            { state: "available" },
            { state: "limited" },
          ],
        },
      ],
      item_proofs: [{ proof_ref: raw.rows[0]!.proof_ref }],
      evidence: [{ evidence_ref: raw.rows[0]!.evidence_ref }],
      collection_proof: { returned_count: 1, has_more: true },
    });
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("calendar_event_title");
    expect(serialized).not.toContain("client_name");
    expect(serialized).not.toContain("appointment_location");
  });

  it("returns only the current member in self view without pagination", async () => {
    const authorization = await availabilityAuthorization({
      view: "self",
      starts_on: "2026-11-01",
      ends_on: "2026-11-03",
    });
    const raw = availabilityRawSnapshot({ authorization });
    const repository = createSupabaseTeamAvailabilityRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );

    const result = await listTeamAvailability({
      authorization,
      repository,
      cursors: cursors(14),
    });

    expect(result.view).toBe("self");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.member_ref.id).toBe(AVAILABILITY_ACTOR_ID);
    expect(result.collection_proof).toMatchObject({
      returned_count: 1,
      has_more: false,
    });
    expect(result.next_cursor).toBeNull();
  });

  it("rejects a forged company cursor before data access", async () => {
    const authorization = await availabilityAuthorization(
      companyAvailabilityQuery({ cursor: "forged.cursor.value" })
    );
    const client = new StubRpcClient([]);

    await expect(
      listTeamAvailability({
        authorization,
        repository: createSupabaseTeamAvailabilityRepository(client),
        cursors: cursors(15),
      })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(client.calls).toHaveLength(0);
  });

  it("maps exact stale, source-bound, and invalid-source states safely", async () => {
    for (const [error, code] of [
      [
        { code: "40001", message: "agent_availability_snapshot_stale" },
        "STALE_CONTEXT",
      ],
      [
        {
          code: "54000",
          message: "agent_availability_member_source_query_bound",
        },
        "RESULT_TOO_LARGE",
      ],
      [
        {
          code: "54000",
          message: "agent_availability_schedule_source_query_bound",
        },
        "RESULT_TOO_LARGE",
      ],
      [
        { code: "22000", message: "agent_availability_source_data_invalid" },
        "TEMPORARILY_UNAVAILABLE",
      ],
    ] as const) {
      const authorization = await availabilityAuthorization();
      const repository = createSupabaseTeamAvailabilityRepository(
        new StubRpcClient([{ data: null, error }])
      );

      await expect(
        listTeamAvailability({
          authorization,
          repository,
          cursors: cursors(16),
        })
      ).rejects.toMatchObject({ code });
    }
  });
});
