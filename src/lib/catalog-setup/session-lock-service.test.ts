import { describe, it, expect, vi } from "vitest";
import {
  probeSessionLock,
  acquireSessionLock,
  heartbeatSessionLock,
  releaseSessionLock,
  type LockStore,
} from "./session-lock-service";
import type { LockState } from "./session-lock";

const now = Date.parse("2026-06-14T12:00:00Z");
const mine = "cw_mine";

/** A mock store whose read/write/release are spies; the network read is mocked. */
function makeStore(over: Partial<LockStore> = {}): LockStore {
  return {
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    ...over,
  };
}

describe("probeSessionLock", () => {
  it("reports free when no lock row exists", async () => {
    const store = makeStore({ read: vi.fn(async () => null) });
    const r = await probeSessionLock(store, "co", mine, now);
    expect(r.heldByOther).toBe(false);
  });

  it("reports held when another live session owns it", async () => {
    const lock: LockState = { sessionId: "cw_other", heartbeatAt: now - 5000 };
    const store = makeStore({ read: vi.fn(async () => lock) });
    const r = await probeSessionLock(store, "co", mine, now);
    expect(r.heldByOther).toBe(true);
  });

  it("reports free when the lock is mine", async () => {
    const lock: LockState = { sessionId: mine, heartbeatAt: now - 1000 };
    const store = makeStore({ read: vi.fn(async () => lock) });
    expect((await probeSessionLock(store, "co", mine, now)).heldByOther).toBe(false);
  });

  it("reports free when another session's lock is stale", async () => {
    const lock: LockState = { sessionId: "cw_other", heartbeatAt: now - 121_000 };
    const store = makeStore({ read: vi.fn(async () => lock) });
    expect((await probeSessionLock(store, "co", mine, now)).heldByOther).toBe(false);
  });

  it("FAILS OPEN (not held) when the read throws", async () => {
    const store = makeStore({
      read: vi.fn(async () => {
        throw new Error("table missing");
      }),
    });
    const r = await probeSessionLock(store, "co", mine, now);
    expect(r.heldByOther).toBe(false);
    expect(r.current).toBeNull();
  });
});

describe("acquireSessionLock", () => {
  it("claims the lock (writes my session) when free", async () => {
    const write = vi.fn(async () => {});
    const store = makeStore({ read: vi.fn(async () => null), write });
    const r = await acquireSessionLock(store, "co", mine, now);
    expect(r.heldByOther).toBe(false);
    expect(write).toHaveBeenCalledWith("co", mine, now);
  });

  it("does NOT overwrite when another live session holds it", async () => {
    const write = vi.fn(async () => {});
    const lock: LockState = { sessionId: "cw_other", heartbeatAt: now - 5000 };
    const store = makeStore({ read: vi.fn(async () => lock), write });
    const r = await acquireSessionLock(store, "co", mine, now);
    expect(r.heldByOther).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("FAILS OPEN (acquired) when the read throws — never walls the operator out", async () => {
    const store = makeStore({
      read: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const r = await acquireSessionLock(store, "co", mine, now);
    expect(r.heldByOther).toBe(false);
  });

  it("still resolves acquired when the write throws (fail-open)", async () => {
    const store = makeStore({
      read: vi.fn(async () => null),
      write: vi.fn(async () => {
        throw new Error("rls");
      }),
    });
    const r = await acquireSessionLock(store, "co", mine, now);
    expect(r.heldByOther).toBe(false);
  });
});

describe("heartbeatSessionLock", () => {
  it("refreshes my lock timestamp", async () => {
    const write = vi.fn(async () => {});
    const store = makeStore({ write });
    await heartbeatSessionLock(store, "co", mine, now);
    expect(write).toHaveBeenCalledWith("co", mine, now);
  });

  it("never throws when the write fails (best-effort)", async () => {
    const store = makeStore({
      write: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await expect(
      heartbeatSessionLock(store, "co", mine, now),
    ).resolves.toBeUndefined();
  });
});

describe("releaseSessionLock", () => {
  it("releases my lock", async () => {
    const release = vi.fn(async () => {});
    const store = makeStore({ release });
    await releaseSessionLock(store, "co", mine);
    expect(release).toHaveBeenCalledWith("co", mine);
  });

  it("never throws when release fails", async () => {
    const store = makeStore({
      release: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(releaseSessionLock(store, "co", mine)).resolves.toBeUndefined();
  });
});
