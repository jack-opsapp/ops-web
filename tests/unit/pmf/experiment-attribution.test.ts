import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readExperimentToken, stageSignupExperiment, retrySignupExperiment } from "@/lib/pmf/experiment-attribution";

const actor = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const req = (cookie = `__ops_experiment=${token}`, origin = "https://app.opsapp.co") =>
  new Request(`${origin}/api/setup/progress`, { headers: { cookie } });
function dbWith(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  return { db: { rpc } as unknown as SupabaseClient, rpc, abortSignal };
}

beforeEach(() => { vi.stubEnv("VERCEL_ENV", "production"); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("opaque assignment transport", () => {
  it("reads only one exact bounded opaque cookie, independently of marketing attribution", () => {
    expect(readExperimentToken(`other=x; __ops_first_touch=untouched; __ops_experiment=${token}`)).toBe(token);
  });
  it.each([null, "", `__ops_experiment=${"a".repeat(42)}`, `__ops_experiment=${"a".repeat(44)}`, "__ops_experiment=arm%3Dcontrol", `x__ops_experiment=${token}`, `__ops_experiment=${token}; __ops_experiment=${token}`, `__ops_experiment=${token}=`, "__ops_experiment=" + "a".repeat(20) + "." + "b".repeat(22)])("rejects malformed or ambiguous cookie %s", cookie => {
    expect(readExperimentToken(cookie)).toBeNull();
  });
});

describe("authenticated durable staging", () => {
  it("passes the opaque cookie and canonical actor to the server-only stage RPC", async () => {
    const { db, rpc, abortSignal } = dbWith({ status: "staged" });
    expect(await stageSignupExperiment(db, req(), actor)).toEqual({ status: "staged" });
    expect(rpc).toHaveBeenCalledWith("stage_tryops_experiment_signup", { p_token: token, p_actor_id: actor });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("does not interpret a cookie as proof of enrollment or a business outcome", async () => {
    const { db } = dbWith({ status: "rejected", reason: "invalid_token" });
    expect(await stageSignupExperiment(db, req(), actor)).toEqual({ status: "rejected", reason: "invalid_token" });
  });
  it("keeps exposure delivery races pending for worker recovery", async () => {
    const { db } = dbWith({ status: "pending", reason: "no_exposure" });
    expect(await stageSignupExperiment(db, req(), actor)).toEqual({ status: "pending", reason: "no_exposure" });
  });
  it.each(["http://localhost:3000", "https://preview.vercel.app", "https://app.opsapp.co.evil.test"])("never writes production measurements from %s", async origin => {
    const { db, rpc } = dbWith({ status: "staged" });
    expect(await stageSignupExperiment(db, req(undefined, origin), actor)).toEqual({ status: "excluded" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("skips missing evidence and invalid actors without making up attribution", async () => {
    const { db, rpc } = dbWith({ status: "staged" });
    expect(await stageSignupExperiment(db, req(""), actor)).toEqual({ status: "absent" });
    expect(await stageSignupExperiment(db, req(), "firebase-uid")).toEqual({ status: "excluded" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects preview and cross-origin requests even with a production URL", async () => {
    const { db, rpc } = dbWith({ status: "staged" });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await stageSignupExperiment(db, req(), actor)).toEqual({ status: "excluded" });
    vi.stubEnv("VERCEL_ENV", "production");
    const request = req(); request.headers.set("origin", "http://localhost:3000");
    expect(await stageSignupExperiment(db, request, actor)).toEqual({ status: "excluded" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, [], { status: "attached" }, { status: "rejected", reason: token }, { status: "pending", reason: "invented" }])("treats malformed acknowledgements as recoverable failure", async value => {
    const { db } = dbWith(value);
    expect(await stageSignupExperiment(db, req(), actor)).toEqual({ status: "pending", reason: "invalid_response" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(token);
  });
  it("does not fail auth when storage is missing, and never logs raw database text/token", async () => {
    const { db } = dbWith(null, { code: "PGRST202", message: `secret ${token}` });
    expect(await stageSignupExperiment(db, req(), actor)).toEqual({ status: "pending", reason: "storage_unavailable" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(token);
  });
  it("a transport rejection remains retryable", async () => {
    const { db, abortSignal } = dbWith(null); abortSignal.mockRejectedValue(new Error(token));
    expect(await stageSignupExperiment(db, req(), actor)).toEqual({ status: "pending", reason: "storage_unavailable" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(token);
  });
});

describe("company attachment through staged identity", () => {
  const attached = { status: "attached", assignment_id: actor, experiment_id: actor, arm_id: actor, trial_started_at: "2026-09-14T21:00:00Z" };
  it("recovers without a browser token and sends only server-resolved company/actor", async () => {
    const { db, rpc } = dbWith(attached);
    expect(await retrySignupExperiment(db, req(""), actor, company)).toEqual({ status: "attached" });
    expect(rpc).toHaveBeenCalledWith("retry_tryops_experiment_trial", { p_actor_id: actor, p_company_id: company });
  });
  it("handles replay without manufacturing another conversion", async () => {
    const { db } = dbWith({ ...attached, status: "already_attached" });
    expect(await retrySignupExperiment(db, req(), actor, company)).toEqual({ status: "already_attached" });
  });
  it.each(["expired_assignment", "ineligible_company", "trial_before_exposure", "outside_conversion_window", "company_already_attributed", "assignment_already_attributed"])("preserves the database exclusion %s", async reason => {
    const { db } = dbWith({ status: "rejected", reason });
    expect(await retrySignupExperiment(db, req(), actor, company)).toEqual({ status: "rejected", reason });
  });
  it("does not call attachment for an account without a company", async () => {
    const { db, rpc } = dbWith(attached);
    expect(await retrySignupExperiment(db, req(), actor, null)).toEqual({ status: "absent" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires the full verified attachment acknowledgement", async () => {
    const { db } = dbWith({ status: "attached" });
    expect(await retrySignupExperiment(db, req(), actor, company)).toEqual({ status: "pending", reason: "invalid_response" });
  });
  it("recovers from a failed attachment on a later server attempt", async () => {
    const { db, abortSignal } = dbWith(null, { code: "57014" });
    expect(await retrySignupExperiment(db, req(), actor, company)).toEqual({ status: "pending", reason: "storage_unavailable" });
    abortSignal.mockResolvedValue({ data: attached, error: null });
    expect(await retrySignupExperiment(db, req(""), actor, company)).toEqual({ status: "attached" });
  });
});
