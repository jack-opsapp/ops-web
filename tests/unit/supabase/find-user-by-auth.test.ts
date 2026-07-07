import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceRoleClientMock } = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

type Row = Record<string, unknown>;
interface UpdateCall {
  payload: Row;
  filters: Record<string, unknown>;
}
interface DbState {
  rows: Row[];
  updates: UpdateCall[];
}

/**
 * In-memory `users` double supporting the select chain
 * (`.select().eq().is().maybeSingle()`) and the awaited update chain
 * (`.update().eq().is()`), so a test can assert exactly which opportunistic
 * backfill writes the resolver issued. `.is(col, null)` is modelled as
 * `col === null`, matching Postgres, so a NULL-guarded update only touches a
 * row whose column is still null.
 */
function makeDb(state: DbState) {
  class Query {
    private op: "select" | "update" = "select";
    private payload: Row | null = null;
    private filters: Record<string, unknown> = {};
    constructor(private readonly table: string) {}

    select() {
      this.op = "select";
      return this;
    }
    update(payload: Row) {
      this.op = "update";
      this.payload = payload;
      return this;
    }
    eq(column?: string, value?: unknown) {
      if (column) this.filters[column] = value;
      return this;
    }
    is(column?: string, value?: unknown) {
      if (column) this.filters[column] = value ?? null;
      return this;
    }

    private match(): Row[] {
      if (this.table !== "users") return [];
      return state.rows.filter((r) =>
        Object.entries(this.filters).every(
          ([column, value]) => (r[column] ?? null) === (value ?? null)
        )
      );
    }

    maybeSingle() {
      return { data: this.match()[0] ?? null, error: null };
    }

    // The update chain is awaited directly (no terminal maybeSingle/single),
    // so Query is a thenable: awaiting it applies the update.
    then(resolve: (x: { data: null; error: null }) => unknown) {
      if (this.op === "update" && this.payload) {
        state.updates.push({
          payload: this.payload,
          filters: { ...this.filters },
        });
        for (const r of this.match()) Object.assign(r, this.payload);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
  }
  return { from: (table: string) => new Query(table) };
}

function wire(state: DbState) {
  getServiceRoleClientMock.mockReturnValue(makeDb(state));
}

describe("findUserByAuth — CRIT-3 Phase A opportunistic backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the auth_id-matched row without writing anything (already linked)", async () => {
    const state: DbState = {
      rows: [
        {
          id: "u1",
          auth_id: "sub1",
          firebase_uid: null,
          company_id: "c1",
          deleted_at: null,
        },
      ],
      updates: [],
    };
    wire(state);

    const row = await findUserByAuth("sub1");

    expect(row).toMatchObject({ id: "u1" });
    expect(state.updates).toHaveLength(0);
  });

  it("backfills auth_id = sub when a firebase_uid match has a NULL auth_id", async () => {
    const state: DbState = {
      rows: [
        {
          id: "u2",
          auth_id: null,
          firebase_uid: "sub2",
          company_id: "c2",
          deleted_at: null,
        },
      ],
      updates: [],
    };
    wire(state);

    const row = await findUserByAuth("sub2");

    expect(row).toMatchObject({ id: "u2", auth_id: "sub2" });
    // Exactly one NULL-guarded update against this row.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].payload).toEqual({ auth_id: "sub2" });
    expect(state.updates[0].filters).toMatchObject({ id: "u2", auth_id: null });
  });

  it("does NOT touch auth_id on a firebase_uid match whose auth_id is already set", async () => {
    const state: DbState = {
      rows: [
        {
          id: "u3",
          auth_id: "some-other-sub",
          firebase_uid: "sub3",
          company_id: "c3",
          deleted_at: null,
        },
      ],
      updates: [],
    };
    wire(state);

    const row = await findUserByAuth("sub3");

    expect(row).toMatchObject({ id: "u3" });
    expect(state.updates).toHaveLength(0);
  });

  it("NEVER backfills identity on an email-only (non-cryptographic) match", async () => {
    const state: DbState = {
      rows: [
        {
          id: "u4",
          auth_id: null,
          firebase_uid: null,
          email: "legacy@example.com",
          company_id: "c4",
          deleted_at: null,
        },
      ],
      updates: [],
    };
    wire(state);

    const row = await findUserByAuth("sub4", "legacy@example.com");

    expect(row).toMatchObject({ id: "u4" });
    // The CRIT-3 invariant: an email match is not proof of possession, so no
    // auth_id/firebase_uid is written.
    expect(state.updates).toHaveLength(0);
  });

  it("returns null when nothing matches", async () => {
    const state: DbState = { rows: [], updates: [] };
    wire(state);

    expect(await findUserByAuth("nobody", "nobody@example.com")).toBeNull();
    expect(state.updates).toHaveLength(0);
  });

  it("drops the email fallback entirely when CRIT3_SUB_IDENTITY is on (Phase D)", async () => {
    const prev = process.env.CRIT3_SUB_IDENTITY;
    process.env.CRIT3_SUB_IDENTITY = "true";
    try {
      const state: DbState = {
        rows: [
          {
            id: "u5",
            auth_id: null,
            firebase_uid: null,
            email: "legacy@example.com",
            company_id: "c5",
            deleted_at: null,
          },
        ],
        updates: [],
      };
      wire(state);

      // Post-re-key, resolution is cryptographic only — an email-only row is
      // no longer returned (and certainly never backfilled).
      expect(await findUserByAuth("sub5", "legacy@example.com")).toBeNull();
      expect(state.updates).toHaveLength(0);
    } finally {
      process.env.CRIT3_SUB_IDENTITY = prev;
    }
  });
});
