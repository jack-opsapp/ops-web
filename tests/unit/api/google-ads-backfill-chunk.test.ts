/**
 * Unit tests for the Google Ads backfill chunk worker + dispatch reliability.
 *
 * Production incident 2026-08-05: the original worker processed one chunk per
 * invocation and handed off via an UNCHECKED fetch — a single non-2xx handoff
 * ended the chain silently, freezing the status at `running` (16%, no error).
 * These tests pin the redesign:
 *   - multi-chunk loop per invocation (handoffs are the exception, not the rule)
 *   - handoff verified (non-2xx = failure) and retried with backoff
 *   - exhausted retries mark the run `failed` — never a frozen `running`
 *   - superseded/canceled runs stop the loop instead of double-writing
 *
 * Mocking: sync engine + status store are in-memory fakes; `after()` callbacks
 * are captured and awaited explicitly; global fetch is scripted per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

// ── next/server: real NextResponse, controllable after() ─────────────────────
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (cb: () => Promise<void>) => {
      afterCallbacks.push(cb);
    },
  };
});

// ── in-memory status store ───────────────────────────────────────────────────
interface StatusRow {
  status: string;
  last_synced_date?: string | null;
  error?: string | null;
  backfill_progress?: {
    currentDate: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    completedDays: number;
  } | null;
  updated_at: string;
}
let statusStore: Record<string, StatusRow>;
const statusWrites: Array<{ id: string; patch: Partial<StatusRow> }> = [];

vi.mock("@/lib/admin/ads-history-queries", () => ({
  getSyncStatus: vi.fn(async (id: string) => statusStore[id] ?? null),
  updateSyncStatus: vi.fn(async (id: string, patch: Partial<StatusRow>) => {
    statusWrites.push({ id, patch });
    statusStore[id] = {
      ...(statusStore[id] ?? { status: "idle", updated_at: new Date().toISOString() }),
      ...patch,
      updated_at: new Date().toISOString(),
    } as StatusRow;
  }),
}));

// ── sync engine fake ─────────────────────────────────────────────────────────
const syncChunkMock = vi.fn(async (_start: Date, _end: Date) => 0);
vi.mock("@/lib/admin/ads-history-sync", () => ({
  syncChunk: (start: Date, end: Date) => syncChunkMock(start, end),
  syncDay: vi.fn(async () => undefined),
}));

// ── cron plumbing fakes (watchdog tests exercise the real route handler) ─────
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: vi.fn(() => ({})),
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: class CronDatabaseOperationError extends Error {},
  runWithCronWorkloadControl: vi.fn(
    async ({ work }: { work: () => Promise<unknown> }) => ({
      status: "ran",
      value: await work(),
    })
  ),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function makeRequest(url: string, secret = "cron-secret"): NextRequest {
  return {
    url,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? `Bearer ${secret}` : null,
    },
  } as unknown as NextRequest;
}

function runningBackfill(currentDate: string, completedDays: number, updatedAt?: string) {
  statusStore["backfill"] = {
    status: "running",
    backfill_progress: {
      currentDate,
      startDate: "2026-01-01",
      endDate: "2026-03-01",
      totalDays: 60,
      completedDays,
    },
    updated_at: updatedAt ?? new Date().toISOString(),
  };
}

async function drainAfterCallbacks() {
  while (afterCallbacks.length) {
    const cb = afterCallbacks.shift()!;
    await cb();
  }
}

async function importChunkRoute() {
  return import("@/app/api/admin/google-ads/backfill/chunk/route");
}
async function importCronRoute() {
  return import("@/app/api/cron/ads-sync/route");
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  statusStore = {};
  statusWrites.length = 0;
  afterCallbacks.length = 0;
  syncChunkMock.mockClear();
  syncChunkMock.mockImplementation(async () => 0);
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("ADS_BACKFILL_BUDGET_MS", "");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("backfill chunk worker", () => {
  it("processes the whole range in one invocation within budget and completes", async () => {
    runningBackfill("2026-01-01", 0);
    const { POST } = await importChunkRoute();
    const res = await POST(makeRequest("https://app.example.com/api/admin/google-ads/backfill/chunk"));
    const body = await res.json();

    expect(body.status).toBe("complete");
    // 60 days at 30/chunk = 2 chunks, no handoff fetches at all
    expect(syncChunkMock).toHaveBeenCalledTimes(2);
    expect(afterCallbacks).toHaveLength(0);
    expect(statusStore["backfill"].status).toBe("complete");
    expect(statusStore["backfill"].backfill_progress?.completedDays).toBe(60);
  });

  it("hands off with a verified dispatch when the budget is exhausted", async () => {
    vi.stubEnv("ADS_BACKFILL_BUDGET_MS", "0"); // force handoff after first chunk
    runningBackfill("2026-01-01", 0);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await importChunkRoute();
    const res = await POST(makeRequest("https://app.example.com/api/admin/google-ads/backfill/chunk"));
    const body = await res.json();

    expect(body).toMatchObject({ status: "running", handedOff: true, chunksProcessed: 1 });
    expect(syncChunkMock).toHaveBeenCalledTimes(1);
    expect(statusStore["backfill"].status).toBe("running");
    expect(statusStore["backfill"].backfill_progress?.currentDate).toBe("2026-01-31");

    await drainAfterCallbacks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/admin/google-ads/backfill/chunk");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer cron-secret");
  });

  it("retries a failed handoff and keeps the run alive when a retry succeeds", async () => {
    vi.stubEnv("ADS_BACKFILL_BUDGET_MS", "0");
    runningBackfill("2026-01-01", 0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => "bad gateway" })
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await importChunkRoute();
    await POST(makeRequest("https://app.example.com/api/admin/google-ads/backfill/chunk"));
    await drainAfterCallbacks();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(statusStore["backfill"].status).toBe("running");
  }, 15_000);

  it("marks the run failed loudly when every handoff attempt fails", async () => {
    vi.stubEnv("ADS_BACKFILL_BUDGET_MS", "0");
    runningBackfill("2026-01-01", 0);
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await importChunkRoute();
    await POST(makeRequest("https://app.example.com/api/admin/google-ads/backfill/chunk"));
    await drainAfterCallbacks();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(statusStore["backfill"].status).toBe("failed");
    expect(statusStore["backfill"].error).toMatch(/Failed to dispatch chunk worker.*HTTP 500/);
  }, 15_000);

  it("stops without writing when the run was canceled or superseded mid-loop", async () => {
    runningBackfill("2026-01-01", 0);
    // First chunk succeeds, then someone cancels the run.
    syncChunkMock.mockImplementationOnce(async () => {
      return 0;
    });
    const { POST } = await importChunkRoute();
    // Cancel after the first heartbeat write by flipping status from a hook on
    // the second getSyncStatus read: simulate via a one-shot interceptor.
    const queries = await import("@/lib/admin/ads-history-queries");
    let reads = 0;
    vi.mocked(queries.getSyncStatus).mockImplementation(async (id) => {
      reads += 1;
      if (reads === 2) {
        statusStore["backfill"] = { ...statusStore["backfill"], status: "failed" };
      }
      return (statusStore[id] ?? null) as Awaited<
        ReturnType<typeof queries.getSyncStatus>
      >;
    });

    const res = await POST(makeRequest("https://app.example.com/api/admin/google-ads/backfill/chunk"));
    const body = await res.json();

    expect(body).toMatchObject({ stopped: true, reason: "not running", chunksProcessed: 1 });
    expect(syncChunkMock).toHaveBeenCalledTimes(1);
    expect(statusStore["backfill"].status).toBe("failed");
  });

  it("marks the run failed when a chunk sync throws", async () => {
    runningBackfill("2026-01-01", 0);
    syncChunkMock.mockRejectedValueOnce(new Error("REQUESTED_METRICS_FOR_MANAGER"));
    const { POST } = await importChunkRoute();
    const res = await POST(makeRequest("https://app.example.com/api/admin/google-ads/backfill/chunk"));

    expect(res.status).toBe(500);
    expect(statusStore["backfill"].status).toBe("failed");
    expect(statusStore["backfill"].error).toMatch(/Chunk 2026-01-01→2026-01-30 failed/);
  });
});

describe("ads-sync cron watchdog", () => {
  it("re-dispatches a stalled running backfill", async () => {
    const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    runningBackfill("2026-02-01", 31, staleTime);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await importCronRoute();
    const res = await GET(makeRequest("https://app.example.com/api/cron/ads-sync"));
    const body = await res.json();

    expect(body.revivedBackfill).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [watchdogUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(String(watchdogUrl)).toContain("/api/admin/google-ads/backfill/chunk");
  });

  it("leaves a fresh running backfill alone", async () => {
    runningBackfill("2026-02-01", 31, new Date().toISOString());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await importCronRoute();
    const res = await GET(makeRequest("https://app.example.com/api/cron/ads-sync"));
    const body = await res.json();

    expect(body.revivedBackfill).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when no backfill is running", async () => {
    statusStore["backfill"] = {
      status: "complete",
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await importCronRoute();
    const res = await GET(makeRequest("https://app.example.com/api/cron/ads-sync"));
    const body = await res.json();

    expect(body.revivedBackfill).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
