import { describe, expect, it } from "vitest";

import {
  createSupabaseTeamAvailabilityRepository,
  TeamAvailabilityRepositoryError,
} from "../availability-repository";
import {
  AVAILABILITY_ACTOR_ID,
  AVAILABILITY_CLIENT_ID,
  AVAILABILITY_COMPANY_ID,
  AVAILABILITY_GRANT_ID,
  AVAILABILITY_MEMBER_ID,
  AVAILABILITY_PERMISSION_REVISION,
  AVAILABILITY_READ_AT,
  AVAILABILITY_SOURCE_REVISIONS,
  availabilityAuthorization,
  availabilityMember,
  availabilityRawSnapshot,
} from "./availability-fixtures";

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected team-availability RPC");
    return Promise.resolve(next);
  }
}

describe("P2 team-availability repository", () => {
  it("calls only the fixed RPC with exact company authority, window, cursor, and physical bounds", async () => {
    const authorization = await availabilityAuthorization();
    const raw = availabilityRawSnapshot({ authorization });
    const client = new StubRpcClient([{ data: raw, error: null }]);
    const repository = createSupabaseTeamAvailabilityRepository(client);

    const result = await repository.list({ authorization, cursor: null });

    expect(result).toMatchObject({
      state: "found",
      page: {
        units: [{ item: { member_ref: { id: AVAILABILITY_MEMBER_ID } } }],
        view: "company",
        timezone: "America/Vancouver",
        readAt: AVAILABILITY_READ_AT,
        sourceHasMore: false,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      functionName: "read_agent_team_availability_as_system",
      args: expect.objectContaining({
        p_actor_user_id: AVAILABILITY_ACTOR_ID,
        p_company_id: AVAILABILITY_COMPANY_ID,
        p_oauth_grant_id: AVAILABILITY_GRANT_ID,
        p_oauth_client_id: AVAILABILITY_CLIENT_ID,
        p_permission_snapshot_revision: AVAILABILITY_PERMISSION_REVISION,
        p_capability_id: "list_team_availability",
        p_view: "company",
        p_team_scope: "all",
        p_calendar_scope: "all",
        p_starts_on: "2026-11-01",
        p_ends_on: "2026-11-03",
        p_item_limit: 10,
        p_page_fetch_limit: 11,
        p_member_source_limit: 501,
        p_schedule_source_limit: 501,
        p_cursor_read_at: null,
        p_after_display_name: null,
        p_after_member_id: null,
      }),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("sends self-only authority as one member and rejects any cross-member row", async () => {
    const authorization = await availabilityAuthorization({
      view: "self",
      starts_on: "2026-11-01",
      ends_on: "2026-11-03",
    });
    const raw = availabilityRawSnapshot({ authorization });
    const client = new StubRpcClient([{ data: raw, error: null }]);
    const repository = createSupabaseTeamAvailabilityRepository(client);
    await expect(
      repository.list({ authorization, cursor: null })
    ).resolves.toMatchObject({
      state: "found",
      page: { view: "self", sourceHasMore: false },
    });
    expect(client.calls[0]!.args).toMatchObject({
      p_view: "self",
      p_team_scope: null,
      p_calendar_scope: "own",
      p_item_limit: 1,
      p_page_fetch_limit: 2,
    });

    const foreign = availabilityMember();
    const invalid = availabilityRawSnapshot({
      authorization,
      items: [foreign],
    });
    await expect(
      createSupabaseTeamAvailabilityRepository(
        new StubRpcClient([{ data: invalid, error: null }])
      ).list({ authorization, cursor: null })
    ).rejects.toThrow(TeamAvailabilityRepositoryError);
  });

  it("rejects authority, privacy, capacity, order, proof, bound, and cursor-echo tampering", async () => {
    const authorization = await availabilityAuthorization();
    const exact = availabilityRawSnapshot({ authorization });
    const row = exact.rows[0]!;
    const second = availabilityMember({
      id: "44444444-4444-4444-8444-444444444444",
      displayName: "Zed Morgan",
    });
    const invalid = [
      { ...exact, actor_user_id: "99999999-9999-4999-8999-999999999999" },
      { ...exact, view: "self" },
      { ...exact, starts_on: "2026-11-02" },
      { ...exact, company_timezone: "PST" },
      { ...exact, member_source_inspected: 501 },
      { ...exact, schedule_source_inspected: 501 },
      { ...exact, cursor_read_at: AVAILABILITY_READ_AT },
      { ...exact, collection_proof_ref: row.proof_ref },
      {
        ...exact,
        rows: [{ ...row, proof_ref: `ops_proof:v1:${"f".repeat(64)}` }],
      },
      {
        ...exact,
        rows: [{ ...row, evidence_ref: `ops_evidence:v1:${"e".repeat(64)}` }],
      },
      {
        ...exact,
        rows: [
          {
            ...row,
            predecessor: {
              order: ["Zed", AVAILABILITY_MEMBER_ID],
              tie_breaker: AVAILABILITY_MEMBER_ID,
            },
          },
        ],
      },
      {
        ...exact,
        rows: [
          {
            ...row,
            item: { ...row.item, event_count: 2 },
          },
        ],
      },
      {
        ...exact,
        rows: [
          row,
          {
            ...row,
            item: second,
            predecessor: {
              order: [second.display_name, second.member_ref.id],
              tie_breaker: second.member_ref.id,
            },
          },
        ],
        member_source_inspected: 2,
      },
      { ...exact, rows: [row, row], member_source_inspected: 2 },
      {
        ...exact,
        source_revisions: [
          { domain: "availability", source_revision: 3 },
          { domain: "tasks", source_revision: 7 },
          { domain: "team", source_revision: 11 },
        ],
      },
    ];

    for (const raw of invalid) {
      const repository = createSupabaseTeamAvailabilityRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toThrow(TeamAvailabilityRepositoryError);
    }
  });

  it("maps only exact member/schedule bounds, stale, and source-invalid database errors", async () => {
    const authorization = await availabilityAuthorization();
    for (const [error, state] of [
      [
        {
          code: "54000",
          message: "agent_availability_member_source_query_bound",
        },
        "source_bound",
      ],
      [
        {
          code: "54000",
          message: "agent_availability_schedule_source_query_bound",
        },
        "source_bound",
      ],
      [
        { code: "40001", message: "agent_availability_snapshot_stale" },
        "stale",
      ],
      [
        { code: "22000", message: "agent_availability_source_data_invalid" },
        "source_invalid",
      ],
    ] as const) {
      const repository = createSupabaseTeamAvailabilityRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).resolves.toEqual({ state });
    }
    const repository = createSupabaseTeamAvailabilityRepository(
      new StubRpcClient([
        { data: null, error: { code: "54000", message: "different" } },
      ])
    );
    await expect(
      repository.list({ authorization, cursor: null })
    ).rejects.toThrow(TeamAvailabilityRepositoryError);
  });

  it("rejects an impossible cursor vector before any RPC", async () => {
    const authorization = await availabilityAuthorization();
    const client = new StubRpcClient([]);
    const repository = createSupabaseTeamAvailabilityRepository(client);
    await expect(
      repository.list({
        authorization,
        cursor: {
          readAt: AVAILABILITY_READ_AT,
          sourceRevisions: [{ domain: "team", source_revision: 11 }],
          predecessor: {
            order: ["Alex Morgan", AVAILABILITY_MEMBER_ID],
            tie_breaker: AVAILABILITY_MEMBER_ID,
          },
        },
      })
    ).rejects.toThrow(TeamAvailabilityRepositoryError);
    expect(client.calls).toHaveLength(0);
    expect(AVAILABILITY_SOURCE_REVISIONS).toHaveLength(4);
  });

  it("rejects a cursor page whose returned snapshot time or revisions drift", async () => {
    const authorization = await availabilityAuthorization();
    const predecessor = {
      order: ["A", "00000000-0000-4000-8000-000000000001"] as const,
      tie_breaker: "00000000-0000-4000-8000-000000000001",
    };
    const cursor = {
      readAt: "2026-11-01T11:59:59.000Z",
      sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
      predecessor,
    };
    const driftedTime = availabilityRawSnapshot({ authorization, cursor });
    await expect(
      createSupabaseTeamAvailabilityRepository(
        new StubRpcClient([{ data: driftedTime, error: null }])
      ).list({ authorization, cursor })
    ).rejects.toThrow(TeamAvailabilityRepositoryError);

    const driftedRevisionsCursor = {
      readAt: AVAILABILITY_READ_AT,
      sourceRevisions: [
        { domain: "availability" as const, source_revision: 4 },
        ...AVAILABILITY_SOURCE_REVISIONS.slice(1),
      ],
      predecessor,
    };
    const driftedRevisions = availabilityRawSnapshot({
      authorization,
      cursor: driftedRevisionsCursor,
    });
    await expect(
      createSupabaseTeamAvailabilityRepository(
        new StubRpcClient([{ data: driftedRevisions, error: null }])
      ).list({ authorization, cursor: driftedRevisionsCursor })
    ).rejects.toThrow(TeamAvailabilityRepositoryError);
  });
});
