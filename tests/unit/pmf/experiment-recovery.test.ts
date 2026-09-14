import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
const jobs = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>>, after: vi.fn() }));
vi.mock("next/server", () => ({ after: jobs.after }));
import { stageSignupExperiment } from "@/lib/pmf/experiment-attribution";

const actor = "11111111-1111-4111-8111-111111111111";
const token = "a".repeat(43);
const request = () => new Request("https://app.opsapp.co/api/setup/progress", { headers: { cookie: `__ops_experiment=${token}` } });
function database(stageResults: Array<unknown>, report: unknown = { status: "recorded" }) {
  let index = 0;
  const rpc = vi.fn((name: string) => ({ abortSignal: vi.fn(async () => {
    const data = name === "stage_tryops_experiment_signup" ? stageResults[Math.min(index++, stageResults.length - 1)] : report;
    return data instanceof Error ? { data: null, error: data } : { data, error: null };
  }) }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv("VERCEL_ENV", "production");
  jobs.callbacks.length = 0;
  jobs.after.mockReset().mockImplementation(callback => jobs.callbacks.push(callback));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function drain() {
  const completion = Promise.all(jobs.callbacks.map(callback => callback()));
  await vi.runAllTimersAsync(); await completion;
}

describe("post-response signup staging recovery", () => {
  it("registers recovery without delaying the response and stops after a successful retry", async () => {
    const { db, rpc } = database([new Error(token), { status: "staged" }]);
    expect(await stageSignupExperiment(db, request(), actor)).toEqual({ status: "pending", reason: "storage_unavailable" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(jobs.callbacks).toHaveLength(1);
    await drain();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.every(([name]) => name === "stage_tryops_experiment_signup")).toBe(true);
  });
  it("records exhausted recovery once with exact hash and server actor, without a raw bearer", async () => {
    const { db, rpc } = database([new Error(token)]);
    await stageSignupExperiment(db, request(), actor); await drain();
    const reports = rpc.mock.calls.filter(([name]) => name === "report_tryops_collection_failure");
    expect(rpc.mock.calls.filter(([name]) => name === "stage_tryops_experiment_signup")).toHaveLength(4);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(["report_tryops_collection_failure", {
      p_key: expect.any(String), p_reason: "signup_staging_failed", p_assignment_id: null,
      p_token_hash: createHash("sha256").update(token).digest("hex"), p_actor_id: actor,
    }]);
    expect(console.error).toHaveBeenCalledWith("[tryops/attribution] measurement loss", { reason: "signup_staging_failed", persisted: true, key: expect.any(String) });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(token);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(actor);
  });
  it("marks an unavailable loss recorder explicitly unpersisted", async () => {
    const { db } = database([new Error(token)], new Error(token));
    await stageSignupExperiment(db, request(), actor); await drain();
    expect(console.error).toHaveBeenCalledWith("[tryops/attribution] measurement loss", { reason: "signup_staging_failed", persisted: false, key: expect.any(String) });
  });
  it.each(["invalid_assignment", "invalid_actor"])("does not claim a recorded loss for rejected %s", async reason => {
    const { db } = database([new Error(token)], { status: "rejected", reason });
    await stageSignupExperiment(db, request(), actor); await drain();
    expect(console.warn).toHaveBeenCalledWith("[tryops/attribution] loss excluded", { reason, key: expect.any(String) });
    expect(vi.mocked(console.error).mock.calls.some(([message]) => message === "[tryops/attribution] measurement loss")).toBe(false);
  });
  it("does not report loss after a definitive rejection or durable exposure-race acknowledgement", async () => {
    for (const acknowledgement of [{ status: "rejected", reason: "invalid_token" }, { status: "pending", reason: "no_exposure" }]) {
      const { db, rpc } = database([new Error(token), acknowledgement]);
      jobs.callbacks.length = 0;
      await stageSignupExperiment(db, request(), actor); await drain();
      expect(rpc).toHaveBeenCalledTimes(2);
    }
  });
  it("deduplicates repeated callback execution and uses the same durable key on another request", async () => {
    const { db, rpc } = database([new Error(token)]);
    await stageSignupExperiment(db, request(), actor);
    const callback = jobs.callbacks[0];
    const first = callback(); const duplicate = callback();
    await vi.runAllTimersAsync(); await Promise.all([first, duplicate]);
    expect(rpc.mock.calls.filter(([name]) => name === "report_tryops_collection_failure")).toHaveLength(1);
    jobs.callbacks.length = 0;
    await stageSignupExperiment(db, request(), actor); await drain();
    const reports = rpc.mock.calls.filter(([name]) => name === "report_tryops_collection_failure");
    expect(reports).toHaveLength(2); expect(reports[0]).toEqual(reports[1]);
  });
  it("keeps signup available and explicitly flags loss if the runtime cannot schedule after", async () => {
    jobs.after.mockImplementation(() => { throw new Error(token); });
    const { db } = database([new Error(token)]);
    expect((await stageSignupExperiment(db, request(), actor)).status).toBe("pending");
    expect(console.error).toHaveBeenCalledWith("[tryops/attribution] measurement loss", { reason: "scheduler_unavailable", persisted: false, key: expect.any(String) });
  });
});
