import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  handleSocialEditorialCron,
  type SocialEditorialCronDependencies,
} from "@/app/api/cron/social-editorial/handler";
import type {
  CronWorkloadControlResult,
  RunWithCronWorkloadControlOptions,
} from "@/lib/api/services/cron-workload-control-service";

const CRON_SECRET = "cron-secret-with-at-least-32-characters";

const COPYWRITING_REFERENCE = {
  path: "docs/social/voice/ops-copywriting-guide.md",
  sha256: "a".repeat(64),
};

const PREPARED_RESULT = {
  state: "prepared",
  date: "2026-09-07",
  copywriting_reference: COPYWRITING_REFERENCE,
};

function request(secret?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/social-editorial", {
    method: "GET",
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

type RunWithControl = SocialEditorialCronDependencies["runWithControl"];

/**
 * The durable guard runs the leased work immediately, exactly like the real
 * service does once a lease is acquired.
 */
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

function dependencies(
  overrides: Partial<SocialEditorialCronDependencies> = {}
): SocialEditorialCronDependencies {
  return {
    run: vi.fn().mockResolvedValue(PREPARED_RESULT),
    loadRuntime: () => ({ supabase }),
    runWithControl: acquiredLease(),
    ...overrides,
  };
}

describe("social editorial cron", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when CRON_SECRET is absent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const deps = dependencies();
    const response = await handleSocialEditorialCron(request(), deps);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "CRON_AUTH_NOT_CONFIGURED",
    });
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.runWithControl).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token before touching the lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies();
    const response = await handleSocialEditorialCron(request("wrong"), deps);

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ code: "UNAUTHORIZED" });
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.runWithControl).not.toHaveBeenCalled();
  });

  it("runs the editorial worker inside the shared durable lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies();
    const response = await handleSocialEditorialCron(
      request(CRON_SECRET),
      deps
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(PREPARED_RESULT);
    expect(deps.runWithControl).toHaveBeenCalledTimes(1);
    expect(deps.runWithControl).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        workloadKey: "social-editorial",
        leaseSeconds: 360,
        work: expect.any(Function),
      })
    );
    expect(deps.run).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: "outside_window", copywriting_reference: COPYWRITING_REFERENCE },
    {
      state: "idle",
      date: "2026-09-07",
      copywriting_reference: COPYWRITING_REFERENCE,
    },
  ])(
    "completes the lease as a successful idle run for $state",
    async (idleResult) => {
      vi.stubEnv("CRON_SECRET", CRON_SECRET);
      const deps = dependencies({
        run: vi.fn().mockResolvedValue(idleResult),
      });
      const response = await handleSocialEditorialCron(
        request(CRON_SECRET),
        deps
      );

      // The acquired-lease double only reports "completed" when the leased
      // work resolves, so a 200 here proves an off-mode or no-slot tick
      // completes the lease as a success instead of a workload failure.
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(idleResult);
      expect(deps.runWithControl).toHaveBeenCalledTimes(1);
    }
  );

  it("skips with 200 already_running while another run holds the lease", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runWithControl: skippedLease({ status: "skipped", reason: "lease_held" }),
    });
    const response = await handleSocialEditorialCron(
      request(CRON_SECRET),
      deps
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("fails closed with 503 while the database pressure circuit is open", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runWithControl: skippedLease({
        status: "skipped",
        reason: "circuit_open",
      }),
    });
    const response = await handleSocialEditorialCron(
      request(CRON_SECRET),
      deps
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      ran: false,
      reason: "circuit_open",
    });
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when workload control is unreachable", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      runWithControl: skippedLease({
        status: "skipped",
        reason: "control_unavailable",
        error: new Error("database password was visible here"),
      }),
    });
    const response = await handleSocialEditorialCron(
      request(CRON_SECRET),
      deps
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      ok: false,
      ran: false,
      reason: "control_unavailable",
    });
    expect(body).not.toContain("database password");
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("returns 500 without exposing an internal worker error", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      run: vi.fn().mockRejectedValue(new Error("SECRET_PROVIDER_PAYLOAD")),
    });
    const response = await handleSocialEditorialCron(
      request(CRON_SECRET),
      deps
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ code: "EDITORIAL_WORKER_FAILED" });
    expect(body).not.toContain("SECRET_PROVIDER");
  });

  it("returns 500 without exposing a runtime configuration error", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const deps = dependencies({
      loadRuntime: () => {
        throw new Error(
          "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
        );
      },
    });
    const response = await handleSocialEditorialCron(
      request(CRON_SECRET),
      deps
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ code: "EDITORIAL_WORKER_FAILED" });
    expect(body).not.toContain("SUPABASE");
    expect(deps.runWithControl).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });
});
