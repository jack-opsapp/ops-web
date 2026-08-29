import { describe, expect, it } from "vitest";

import { measureP2SerializedCharacters } from "../../shared/result-budget";
import { createTeamDirectoryCursorService } from "../team-cursor";
import { listTeamMembers } from "../team-reads";
import { createSupabaseTeamDirectoryRepository } from "../team-repository";
import {
  TEAM_MEMBER_ID,
  TEAM_SECOND_MEMBER_ID,
  teamDirectoryAuthorization,
  teamDirectoryRawSnapshot,
  teamMember,
} from "./team-fixtures";

class StubRpcClient {
  readonly calls: Array<{ functionName: string }> = [];
  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}
  rpc(functionName: string) {
    this.calls.push({ functionName });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected team-directory RPC");
    return Promise.resolve(next);
  }
}

function cursors(seed = 7) {
  return createTeamDirectoryCursorService({
    keyId: "team-service",
    key: Buffer.alloc(32, seed),
  });
}

describe("P2 list_team_members service", () => {
  it("returns a frozen, proof-coupled active directory and signs only the retained predecessor", async () => {
    const authorization = await teamDirectoryAuthorization({ limit: 1 });
    const raw = teamDirectoryRawSnapshot({
      authorization,
      sourceInspected: 2,
      sourceHasMore: true,
    });
    const repository = createSupabaseTeamDirectoryRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    const result = await listTeamMembers({
      authorization,
      repository,
      cursors: cursors(),
    });

    expect(result).toMatchObject({
      items: [{ member_ref: { id: TEAM_MEMBER_ID }, state: "active" }],
      item_proofs: [{ proof_ref: raw.rows[0]!.proof_ref }],
      evidence: [{ evidence_ref: raw.rows[0]!.evidence_ref }],
      collection_proof: {
        proof_ref: raw.collection_proof_ref,
        returned_count: 1,
        has_more: true,
      },
    });
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps an empty directory proof-coupled without inventing a cursor", async () => {
    const authorization = await teamDirectoryAuthorization();
    const raw = teamDirectoryRawSnapshot({ authorization, items: [] });
    const repository = createSupabaseTeamDirectoryRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    const result = await listTeamMembers({
      authorization,
      repository,
      cursors: cursors(8),
    });
    expect(result).toMatchObject({
      items: [],
      item_proofs: [],
      evidence: [],
      collection_proof: { returned_count: 0, has_more: false },
      next_cursor: null,
    });
  });

  it("rejects forged cursors before data access and maps exact stale/bound states", async () => {
    const forgedAuthorization = await teamDirectoryAuthorization({
      cursor: "forged.cursor.value",
    });
    const forgedClient = new StubRpcClient([]);
    await expect(
      listTeamMembers({
        authorization: forgedAuthorization,
        repository: createSupabaseTeamDirectoryRepository(forgedClient),
        cursors: cursors(9),
      })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(forgedClient.calls).toHaveLength(0);

    for (const [error, code] of [
      [
        { code: "40001", message: "agent_team_snapshot_stale" },
        "STALE_CONTEXT",
      ],
      [
        { code: "54000", message: "agent_team_source_query_bound" },
        "RESULT_TOO_LARGE",
      ],
    ] as const) {
      const authorization = await teamDirectoryAuthorization();
      const repository = createSupabaseTeamDirectoryRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        listTeamMembers({ authorization, repository, cursors: cursors(10) })
      ).rejects.toMatchObject({ code });
    }
  });

  it("atomically trims serializer pressure and re-proves the retained members", async () => {
    const authorization = await teamDirectoryAuthorization({ limit: 25 });
    const items = Array.from({ length: 25 }, (_, index) => {
      const serial = String(index + 1).padStart(12, "0");
      const id = `33333333-3333-4333-8333-${serial}`;
      return {
        ...teamMember({
          id,
          displayName: `${String(index + 1).padStart(2, "0")}-${"N".repeat(230)}`,
        }),
        display_image: {
          state: "available" as const,
          url: `https://assets.opsapp.co/team/${"a".repeat(1_900)}${serial}`,
        },
      };
    });
    const raw = teamDirectoryRawSnapshot({ authorization, items });
    const repository = createSupabaseTeamDirectoryRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    const result = await listTeamMembers({
      authorization,
      repository,
      cursors: cursors(11),
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(items.length);
    expect(result.collection_proof.returned_count).toBe(result.items.length);
    expect(result.collection_proof.has_more).toBe(true);
    expect(result.collection_proof.proof_ref).not.toBe(
      raw.collection_proof_ref
    );
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(result.items[0]!.member_ref.id).not.toBe(TEAM_SECOND_MEMBER_ID);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
  });
});
