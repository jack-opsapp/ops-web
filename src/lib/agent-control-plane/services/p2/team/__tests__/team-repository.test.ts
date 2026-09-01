import { describe, expect, it } from "vitest";

import {
  createSupabaseTeamDirectoryRepository,
  TeamDirectoryRepositoryError,
} from "../team-repository";
import {
  TEAM_ACTOR_ID,
  TEAM_CLIENT_ID,
  TEAM_COMPANY_ID,
  TEAM_GRANT_ID,
  TEAM_MEMBER_ID,
  TEAM_PERMISSION_REVISION,
  TEAM_READ_AT,
  teamDirectoryAuthorization,
  teamDirectoryRawSnapshot,
} from "./team-fixtures";

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
    if (!next) throw new Error("Unexpected team-directory RPC");
    return Promise.resolve(next);
  }
}

describe("P2 team-directory repository", () => {
  it("calls only the fixed RPC with exact authority, active-only scope, and physical bounds", async () => {
    const authorization = await teamDirectoryAuthorization();
    const raw = teamDirectoryRawSnapshot({ authorization });
    const client = new StubRpcClient([{ data: raw, error: null }]);
    const repository = createSupabaseTeamDirectoryRepository(client);

    const result = await repository.list({ authorization, cursor: null });

    expect(result).toMatchObject({
      state: "found",
      page: {
        units: [
          { item: { member_ref: { id: TEAM_MEMBER_ID }, state: "active" } },
        ],
        readAt: TEAM_READ_AT,
        sourceHasMore: false,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      functionName: "read_agent_team_members_as_system",
      args: expect.objectContaining({
        p_actor_user_id: TEAM_ACTOR_ID,
        p_company_id: TEAM_COMPANY_ID,
        p_oauth_grant_id: TEAM_GRANT_ID,
        p_oauth_client_id: TEAM_CLIENT_ID,
        p_permission_snapshot_revision: TEAM_PERMISSION_REVISION,
        p_capability_id: "list_team_members",
        p_team_scope: "all",
        p_item_limit: 25,
        p_page_fetch_limit: 26,
        p_source_limit: 501,
        p_cursor_read_at: null,
        p_after_display_name: null,
        p_after_member_id: null,
      }),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects authority, privacy, ordering, active-state, proof, collision, bound, and cursor-echo tampering", async () => {
    const authorization = await teamDirectoryAuthorization();
    const exact = teamDirectoryRawSnapshot({ authorization });
    const row = exact.rows[0]!;
    const invalid = [
      { ...exact, actor_user_id: "99999999-9999-4999-8999-999999999999" },
      { ...exact, source_inspected: 501 },
      { ...exact, cursor_read_at: TEAM_READ_AT },
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
            predecessor: { ...row.predecessor, order: ["Zed", TEAM_MEMBER_ID] },
          },
        ],
      },
      {
        ...exact,
        rows: [{ ...row, item: { ...row.item, state: "inactive" } }],
      },
      {
        ...exact,
        rows: [{ ...row, item: { ...row.item, email: "private@example.com" } }],
      },
      { ...exact, rows: [row, row], source_inspected: 2 },
    ];

    for (const raw of invalid) {
      const repository = createSupabaseTeamDirectoryRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toThrow(TeamDirectoryRepositoryError);
    }
  });

  it("maps only exact bound and stale database errors to safe states", async () => {
    const authorization = await teamDirectoryAuthorization();
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_team_source_query_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_team_snapshot_stale" }, "stale"],
    ] as const) {
      const repository = createSupabaseTeamDirectoryRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).resolves.toEqual({
        state,
      });
    }
    const repository = createSupabaseTeamDirectoryRepository(
      new StubRpcClient([
        { data: null, error: { code: "54000", message: "different" } },
      ])
    );
    await expect(
      repository.list({ authorization, cursor: null })
    ).rejects.toThrow(TeamDirectoryRepositoryError);
  });

  it("rejects an impossible cursor vector before any RPC", async () => {
    const authorization = await teamDirectoryAuthorization();
    const client = new StubRpcClient([]);
    const repository = createSupabaseTeamDirectoryRepository(client);
    await expect(
      repository.list({
        authorization,
        cursor: {
          readAt: TEAM_READ_AT,
          sourceRevisions: [{ domain: "team", source_revision: 12 }],
          predecessor: {
            order: ["Alex Morgan", TEAM_MEMBER_ID],
            tie_breaker: TEAM_MEMBER_ID,
          },
        },
      })
    ).rejects.toThrow(TeamDirectoryRepositoryError);
    expect(client.calls).toHaveLength(0);
  });
});
