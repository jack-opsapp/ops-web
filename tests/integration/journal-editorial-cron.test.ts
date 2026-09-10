import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  handleJournalEditorialCron,
  type JournalEditorialCronDependencies,
} from "@/app/api/cron/journal-editorial/handler";
import type {
  CronWorkloadControlResult,
  RunWithCronWorkloadControlOptions,
} from "@/lib/api/services/cron-workload-control-service";

const CRON_SECRET = "cron-secret-with-at-least-32-characters";
const RESULT = {
  state: "promoted",
  mode: "prepare",
  created: 0,
  missed: 0,
  promoted: 1,
  published: [],
  held: [],
  newsletter: { sent: 0, skipped: 0 },
  notified: 1,
} as const;

function request(secret?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/journal-editorial", {
    method: "GET",
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

type RunWithControl = JournalEditorialCronDependencies["runWithControl"];

function acquiredLease(): RunWithControl {
  return vi.fn(
    async <T>({ work }: RunWithCronWorkloadControlOptions<T>) =>
      ({
        status: "completed",
        value: await work({
          ownerToken: "owner-1",
          fenceToken: 1,
          globalFenceToken: 1,
          expiresAt: new Date(Date.now() + 360_000).toISOString(),
          signal: new AbortController().signal,
        }),
      }) satisfies CronWorkloadControlResult<T>
  ) as unknown as RunWithControl;
}

function skippedLease(
  result: Exclude<CronWorkloadControlResult<never>, { status: "completed" }>
): RunWithControl {
  return vi.fn(async () => result) as unknown as RunWithControl;
}

const supabase = { rpc: vi.fn() };

function dependencies(overrides: Partial<JournalEditorialCronDependencies> = {}): JournalEditorialCronDependencies {
  return {
    run: vi.fn().mockResolvedValue(RESULT),
    loadRuntime: () => ({ supabase }),
    runWithControl: acquiredLease(),
    ...overrides,
  };
}

describe("journal editorial cron", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when CRON_SECRET is absent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const deps = dependencies();
    const response = await handleJournalEditorialCron(request(), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong secret without touching the lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies();
    expect((await handleJournalEditorialCron(request(), deps)).status).toBe(401);
    expect((await handleJournalEditorialCron(request("wrong-secret-with-at-least-32-chars"), deps)).status).toBe(401);
    expect(deps.runWithControl).not.toHaveBeenCalled();
  });

  it("runs the tick inside its own durable lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies();
    const response = await handleJournalEditorialCron(request(CRON_SECRET), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESULT);
    expect(deps.runWithControl).toHaveBeenCalledWith(
      expect.objectContaining({ workloadKey: "journal-editorial", leaseSeconds: 360, supabase })
    );
  });

  it("answers 200 when another tick holds the lease and 503 when the circuit is open", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const held = await handleJournalEditorialCron(
      request(CRON_SECRET),
      dependencies({ runWithControl: skippedLease({ status: "skipped", reason: "lease_held" }) })
    );
    expect(held.status).toBe(200);
    expect(await held.json()).toEqual({ ok: true, ran: false, reason: "already_running" });
    const open = await handleJournalEditorialCron(
      request(CRON_SECRET),
      dependencies({ runWithControl: skippedLease({ status: "skipped", reason: "circuit_open" }) })
    );
    expect(open.status).toBe(503);
  });

  it("reports a failed tick as 500 without leaking the error", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleJournalEditorialCron(
      request(CRON_SECRET),
      dependencies({ run: vi.fn().mockRejectedValue(new Error("secret detail")) })
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "JOURNAL_WORKER_FAILED" });
    errorSpy.mockRestore();
  });
});
