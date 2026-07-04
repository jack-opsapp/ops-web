import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceRoleClientMock, verifyAuthTokenMock } = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  verifyAuthTokenMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

import { POST } from "@/app/api/decks/provision-company/route";

const FIREBASE_UID = "firebase-deck-123";
const COMPANY_ID = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "00000000-0000-4000-8000-0000000000b1";

interface UserFixture {
  id: string;
  company_id: string | null;
  role: string | null;
  firebase_uid: string | null;
  auth_id?: string | null;
  email?: string | null;
  deleted_at?: string | null;
}

interface DoubleState {
  userInserts: Array<Record<string, unknown>>;
  userUpdates: Array<{ row: Record<string, unknown>; id: string }>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
}

function makeSupabaseDouble(args: {
  users?: UserFixture[];
  rpcResults?: Array<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
  insertUserError?: { code?: string; message: string } | null;
  insertedUserId?: string;
}): { client: Record<string, unknown>; state: DoubleState } {
  const state: DoubleState = {
    userInserts: [],
    userUpdates: [],
    rpcCalls: [],
  };
  // Shared by reference on purpose: tests simulate concurrent writers by
  // mutating the same array between route-issued queries.
  const users = args.users ?? [];
  const rpcResults = [...(args.rpcResults ?? [])];

  class UsersQuery {
    private filters: Record<string, unknown> = {};

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters[column] = value;
      return this;
    }

    is(column: string, value: unknown) {
      this.filters[column] = value;
      return this;
    }

    async maybeSingle() {
      const match = users.find((u) =>
        Object.entries(this.filters).every(([col, val]) => {
          if (col === "deleted_at") return (u.deleted_at ?? null) === val;
          return (u as unknown as Record<string, unknown>)[col] === val;
        })
      );
      return { data: match ?? null, error: null };
    }

    insert(row: Record<string, unknown>) {
      state.userInserts.push(row);
      return {
        select: () => ({
          single: async () => {
            if (args.insertUserError) {
              return { data: null, error: args.insertUserError };
            }
            const id = args.insertedUserId ?? USER_ID;
            users.push({
              id,
              company_id: null,
              role: null,
              firebase_uid: (row.firebase_uid as string) ?? null,
              email: (row.email as string) ?? null,
            });
            return { data: { id }, error: null };
          },
        }),
      };
    }

    update(row: Record<string, unknown>) {
      return {
        eq: async (_column: string, id: string) => {
          state.userUpdates.push({ row, id });
          const target = users.find((u) => u.id === id);
          if (target && "firebase_uid" in row) {
            target.firebase_uid = row.firebase_uid as string;
          }
          return { error: null };
        },
      };
    }
  }

  const client = {
    from(table: string) {
      if (table !== "users") throw new Error(`Unexpected table ${table}`);
      return new UsersQuery();
    },
    async rpc(fn: string, rpcArgs: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args: rpcArgs });
      const result = rpcResults.shift();
      if (!result) {
        return {
          data: {
            company_id: COMPANY_ID,
            company_code: "ABCD2345",
            already_existed: false,
            user_id: USER_ID,
            role: "owner",
          },
          error: null,
        };
      }
      return result;
    },
  };

  return { client, state };
}

function makeRequest(body: Record<string, unknown>, token = "valid-token") {
  return new NextRequest("http://test.local/api/decks/provision-company", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    firebase_uid: FIREBASE_UID,
    email: "deck@example.com",
    display_name: "Jackson Sweet",
    source_app: "ops_decks",
    ...overrides,
  };
}

function stubVerifiedToken(
  overrides: Partial<{
    uid: string;
    email: string | undefined;
    email_verified: boolean;
  }> = {}
) {
  verifyAuthTokenMock.mockResolvedValue({
    uid: overrides.uid ?? FIREBASE_UID,
    email: "email" in overrides ? overrides.email : "deck@example.com",
    claims: { email_verified: overrides.email_verified ?? true },
  });
}

describe("POST /api/decks/provision-company", () => {
  beforeEach(() => {
    stubVerifiedToken();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the bearer token is missing", async () => {
    const response = await POST(
      new NextRequest("http://test.local/api/decks/provision-company", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "unauthorized",
      message: "Missing Authorization bearer token",
    });
  });

  it("rejects payloads that are not the Deckset provisioning contract", async () => {
    const { client } = makeSupabaseDouble({});
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(
      makeRequest(validBody({ source_app: "ops_ios" }))
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "bad_request",
      message: "firebase_uid, email, and source_app are required.",
    });
  });

  it("rejects a body firebase_uid that is not the authenticated subject", async () => {
    const { client, state } = makeSupabaseDouble({});
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(
      makeRequest(validBody({ firebase_uid: "someone-else" }))
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "uid_mismatch",
      message: "firebase_uid does not match the authenticated subject",
    });
    expect(state.rpcCalls).toEqual([]);
  });

  it("returns the existing company for an already-provisioned user without re-provisioning", async () => {
    const { client, state } = makeSupabaseDouble({
      users: [
        {
          id: USER_ID,
          company_id: COMPANY_ID,
          role: "crew",
          firebase_uid: FIREBASE_UID,
        },
      ],
    });
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      company_id: COMPANY_ID,
      user_id: USER_ID,
      role: "crew",
      subscription_plan: "decks",
    });
    expect(state.rpcCalls).toEqual([]);
    expect(state.userInserts).toEqual([]);
    expect(state.userUpdates).toEqual([]);
  });

  it("returns company_id lowercased even when the store returns uppercase", async () => {
    const { client } = makeSupabaseDouble({
      users: [
        {
          id: USER_ID.toUpperCase(),
          company_id: COMPANY_ID.toUpperCase(),
          role: "owner",
          firebase_uid: FIREBASE_UID,
        },
      ],
    });
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      company_id: COMPANY_ID,
      user_id: USER_ID,
      role: "owner",
      subscription_plan: "decks",
    });
  });

  it("backfills users.firebase_uid when the row was matched without it", async () => {
    const { client, state } = makeSupabaseDouble({
      users: [
        {
          id: USER_ID,
          company_id: COMPANY_ID,
          role: "owner",
          firebase_uid: null,
          email: "deck@example.com",
        },
      ],
    });
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(200);
    expect(state.userUpdates).toEqual([
      { row: { firebase_uid: FIREBASE_UID }, id: USER_ID },
    ]);
  });

  it("ignores an email match when the token email is not verified", async () => {
    stubVerifiedToken({ email_verified: false });
    const { client, state } = makeSupabaseDouble({
      users: [
        {
          id: "legacy-user",
          company_id: "legacy-company",
          role: "owner",
          firebase_uid: null,
          email: "deck@example.com",
        },
      ],
    });
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.company_id).toBe(COMPANY_ID);
    expect(state.userInserts).toHaveLength(1);
    expect(state.rpcCalls).toHaveLength(1);
  });

  it("provisions a company-of-one for a brand-new Deckset user", async () => {
    const { client, state } = makeSupabaseDouble({});
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      company_id: COMPANY_ID,
      user_id: USER_ID,
      role: "owner",
      subscription_plan: "decks",
    });
    expect(state.userInserts).toEqual([
      {
        email: "deck@example.com",
        first_name: "Jackson",
        last_name: "Sweet",
        firebase_uid: FIREBASE_UID,
      },
    ]);
    expect(state.rpcCalls).toEqual([
      {
        fn: "provision_deck_company",
        args: {
          p_firebase_uid: FIREBASE_UID,
          p_company_name: "Jackson Sweet",
          p_email: "deck@example.com",
        },
      },
    ]);
  });

  it("derives the company name from the email when display_name is absent", async () => {
    const { client, state } = makeSupabaseDouble({});
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(
      makeRequest(validBody({ display_name: null }))
    );

    expect(response.status).toBe(200);
    expect(state.rpcCalls[0]?.args.p_company_name).toBe("deck");
    expect(state.userInserts[0]).toMatchObject({
      first_name: "",
      last_name: "",
    });
  });

  it("recovers the winner row when the users insert loses a concurrent race", async () => {
    const winner: UserFixture = {
      id: "winner-user",
      company_id: null,
      role: null,
      firebase_uid: FIREBASE_UID,
    };
    const { client, state } = makeSupabaseDouble({
      insertUserError: { code: "23505", message: "duplicate key" },
      rpcResults: [
        {
          data: {
            company_id: COMPANY_ID,
            company_code: "ABCD2345",
            already_existed: false,
            user_id: "winner-user",
            role: "owner",
          },
          error: null,
        },
      ],
    });
    // The winner appears for the post-conflict re-lookup only.
    (client as { from: (t: string) => unknown }).from = ((original) =>
      function (this: unknown, table: string) {
        if (state.userInserts.length > 0) {
          // After the failed insert, surface the winner row.
          const query = (original as (t: string) => Record<string, unknown>).call(
            this,
            table
          );
          const originalMaybe = (query as { maybeSingle: () => Promise<unknown> })
            .maybeSingle;
          (query as { maybeSingle: () => Promise<unknown> }).maybeSingle =
            async function (this: { filters?: Record<string, unknown> }) {
              const filters =
                (this as unknown as { filters: Record<string, unknown> })
                  .filters ?? {};
              if (filters.firebase_uid === FIREBASE_UID) {
                return { data: winner, error: null };
              }
              return originalMaybe.call(this);
            };
          return query;
        }
        return (original as (t: string) => unknown).call(this, table);
      })((client as { from: (t: string) => unknown }).from);
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.user_id).toBe("winner-user");
    expect(state.rpcCalls).toHaveLength(1);
  });

  it("returns the joined company when provisioning races a company join", async () => {
    const users: UserFixture[] = [];
    const { client, state } = makeSupabaseDouble({
      users,
      rpcResults: [
        { data: null, error: { message: "ALREADY_IN_COMPANY" } },
      ],
    });
    getServiceRoleClientMock.mockReturnValue(client);
    // After the RPC rejects, the re-lookup must see the joined row.
    const originalRpc = (client as { rpc: (...a: unknown[]) => unknown }).rpc;
    (client as { rpc: (...a: unknown[]) => Promise<unknown> }).rpc =
      async function (...rpcArgs: unknown[]) {
        const result = await (originalRpc as (...a: unknown[]) => Promise<unknown>).apply(
          this,
          rpcArgs
        );
        // The concurrent join updated the SAME users row the route created.
        const row = users.find((u) => u.firebase_uid === FIREBASE_UID);
        if (row) {
          row.company_id = COMPANY_ID;
          row.role = "crew";
        } else {
          users.push({
            id: USER_ID,
            company_id: COMPANY_ID,
            role: "crew",
            firebase_uid: FIREBASE_UID,
          });
        }
        return result;
      };

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      company_id: COMPANY_ID,
      user_id: USER_ID,
      role: "crew",
      subscription_plan: "decks",
    });
    expect(state.rpcCalls).toHaveLength(1);
  });

  it("returns 503 when provisioning fails outright", async () => {
    const { client } = makeSupabaseDouble({
      rpcResults: [{ data: null, error: { message: "boom" } }],
    });
    getServiceRoleClientMock.mockReturnValue(client);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "provisioning_failed",
      message: "Provisioning unavailable",
    });
  });
});
