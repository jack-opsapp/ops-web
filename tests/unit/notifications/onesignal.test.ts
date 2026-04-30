/**
 * Unit tests for src/lib/notifications/onesignal.ts
 *
 * Verifies:
 *   - Retry: 5xx triggers retry up to 3 attempts with exponential delay.
 *   - Non-retryable: 4xx returns immediately.
 *   - Network error: fetch throws → category 'network'.
 *   - Success: 200 returns {ok: true, status: 200}.
 *   - Empty playerIds: returns {ok: true} immediately without fetching.
 *   - Missing env: returns {ok: false, category: 'env_missing'} without fetching.
 *
 * Uses MSW handlers to intercept the OneSignal endpoint — matches the
 * project pattern. `server` from `tests/setup.ts` is already running.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../mocks/server";

const ONESIGNAL_URL = "https://onesignal.com/api/v1/notifications";

const { sendOneSignalPush } = await import(
  "@/lib/notifications/onesignal"
);

const PARAMS = {
  playerIds: ["player-1", "player-2"],
  title: "Test push",
  body: "Test body",
  data: { type: "test" },
};

// Track requests received by MSW so we can assert call counts and bodies.
let requestCount = 0;
let lastRequestBody: Record<string, unknown> | null = null;

beforeEach(() => {
  requestCount = 0;
  lastRequestBody = null;
  vi.stubEnv("ONESIGNAL_APP_ID", "test-app-id");
  vi.stubEnv("ONESIGNAL_REST_API_KEY", "test-key");
  // Only fake setTimeout — leave microtasks alone so awaited Promises resolve.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  server.resetHandlers();
});

/**
 * Install an MSW handler that returns the given status codes in order.
 * Each invocation pops the next status from `statuses`. After exhaustion,
 * subsequent calls return 200 (shouldn't happen in well-formed tests).
 */
function mockOneSignalSequence(statuses: number[]): void {
  const seq = [...statuses];
  server.use(
    http.post(ONESIGNAL_URL, async ({ request }) => {
      requestCount += 1;
      lastRequestBody = (await request.json()) as Record<string, unknown>;
      const status = seq.shift() ?? 200;
      return new HttpResponse(status >= 400 ? "error" : null, { status });
    })
  );
}

describe("sendOneSignalPush", () => {
  it("returns {ok: true} on 200", async () => {
    mockOneSignalSequence([200]);
    const result = await sendOneSignalPush(PARAMS);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(requestCount).toBe(1);
  });

  it("returns {ok: false, category: 'non_retryable'} on 400 without retrying", async () => {
    mockOneSignalSequence([400]);
    const result = await sendOneSignalPush(PARAMS);
    expect(result.ok).toBe(false);
    expect(result.category).toBe("non_retryable");
    expect(result.status).toBe(400);
    expect(requestCount).toBe(1);
  });

  it("retries up to 3 times on 500 then returns {ok: false, category: 'retryable'}", async () => {
    mockOneSignalSequence([500, 500, 500]);

    const resultPromise = sendOneSignalPush(PARAMS);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.category).toBe("retryable");
    expect(requestCount).toBe(3);
  });

  it("succeeds on 2nd attempt after 5xx", async () => {
    mockOneSignalSequence([503, 200]);

    const resultPromise = sendOneSignalPush(PARAMS);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(requestCount).toBe(2);
  });

  it("returns {ok: false, category: 'network'} when fetch throws", async () => {
    server.use(
      http.post(ONESIGNAL_URL, () => HttpResponse.error())
    );
    const resultPromise = sendOneSignalPush(PARAMS);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.category).toBe("network");
  });

  it("returns {ok: true} immediately for empty playerIds without calling fetch", async () => {
    mockOneSignalSequence([200]);
    const result = await sendOneSignalPush({ ...PARAMS, playerIds: [] });
    expect(result.ok).toBe(true);
    expect(requestCount).toBe(0);
  });

  it("returns {ok: false, category: 'env_missing'} when env vars absent", async () => {
    vi.unstubAllEnvs();
    mockOneSignalSequence([200]);
    const result = await sendOneSignalPush(PARAMS);
    expect(result.ok).toBe(false);
    expect(result.category).toBe("env_missing");
    expect(requestCount).toBe(0);
  });

  it("sends correct JSON body including ios_badgeType when iosBadgeIncrement > 0", async () => {
    mockOneSignalSequence([200]);
    await sendOneSignalPush({ ...PARAMS, iosBadgeIncrement: 1 });

    expect(lastRequestBody).toBeTruthy();
    expect(lastRequestBody!.ios_badgeType).toBe("Increase");
    expect(lastRequestBody!.ios_badgeCount).toBe(1);
    expect(lastRequestBody!.include_player_ids).toEqual(PARAMS.playerIds);
  });

  it("omits ios_badgeType when iosBadgeIncrement is 0", async () => {
    mockOneSignalSequence([200]);
    await sendOneSignalPush({ ...PARAMS, iosBadgeIncrement: 0 });

    expect(lastRequestBody).toBeTruthy();
    expect(lastRequestBody!.ios_badgeType).toBeUndefined();
    expect(lastRequestBody!.ios_badgeCount).toBeUndefined();
  });
});
