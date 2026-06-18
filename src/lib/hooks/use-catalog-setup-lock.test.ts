import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the network layer (the lock substrate read/write) ───────────────────
const maybeSingle = vi.fn();
const selectEq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq: selectEq }));
const upsert = vi.fn(
  (
    _row: Record<string, unknown>,
    _opts: { onConflict: string },
  ): Promise<{ error: Error | null }> => Promise.resolve({ error: null }),
);
const delEq2 = vi.fn((): Promise<{ error: Error | null }> =>
  Promise.resolve({ error: null }),
);
const delEq1 = vi.fn(() => ({ eq: delEq2 }));
const del = vi.fn(() => ({ eq: delEq1 }));
const from = vi.fn(() => ({ select, upsert, delete: del }));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ from }),
}));

import { createSupabaseLockStore } from "./use-catalog-setup-lock";

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ error: null });
  delEq2.mockResolvedValue({ error: null });
});

describe("createSupabaseLockStore.read", () => {
  it("returns null when there is no lock row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await createSupabaseLockStore().read("co")).toBeNull();
  });

  it("maps a row to a LockState (session + parsed heartbeat)", async () => {
    maybeSingle.mockResolvedValue({
      data: { session_id: "cw_x", heartbeat_at: "2026-06-14T12:00:00.000Z" },
      error: null,
    });
    const lock = await createSupabaseLockStore().read("co");
    expect(lock).toEqual({
      sessionId: "cw_x",
      heartbeatAt: Date.parse("2026-06-14T12:00:00.000Z"),
    });
  });

  it("throws on a supabase error (the service turns this into fail-open)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error("rls") });
    await expect(createSupabaseLockStore().read("co")).rejects.toThrow();
  });
});

describe("createSupabaseLockStore.write", () => {
  it("upserts the lock keyed on company_id", async () => {
    await createSupabaseLockStore("user-1").write(
      "co",
      "cw_x",
      Date.parse("2026-06-14T12:00:00.000Z"),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({
      company_id: "co",
      session_id: "cw_x",
      user_id: "user-1",
      heartbeat_at: "2026-06-14T12:00:00.000Z",
    });
    expect(opts).toEqual({ onConflict: "company_id" });
  });

  it("throws on a supabase error", async () => {
    upsert.mockResolvedValueOnce({ error: new Error("rls") });
    await expect(
      createSupabaseLockStore().write("co", "cw_x", Date.now()),
    ).rejects.toThrow();
  });
});

describe("createSupabaseLockStore.release", () => {
  it("deletes the row by company + session", async () => {
    await createSupabaseLockStore().release("co", "cw_x");
    expect(del).toHaveBeenCalledTimes(1);
    expect(delEq1).toHaveBeenCalledWith("company_id", "co");
    expect(delEq2).toHaveBeenCalledWith("session_id", "cw_x");
  });
});
