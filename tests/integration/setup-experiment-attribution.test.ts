// @vitest-environment node
import "next/dist/server/node-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AfterContext } from "next/dist/server/after/after-context";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), find: vi.fn(), service: vi.fn(), firstTouch: vi.fn() }));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAuthToken: mocks.verify }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: mocks.find }));
vi.mock("@/lib/supabase/server-client", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("@/lib/pmf/trial-attribution", () => ({ recordTrialAttribution: mocks.firstTouch }));
import { POST } from "@/app/api/setup/progress/route";
const actor = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const snapshot = { version: 1, channel: "organic_search", basis: "utm_referrer", recorded_at: "2026-09-14T12:00:00Z" };
const user = { id: actor, auth_id: "firebase-only-identity", email: "qa@opsapp.co", company_id: null, setup_progress: { signup_attribution: snapshot, steps: { identity: true } } };
function setup(options: { stageFailure?: boolean; stageFailures?: number; attachFailure?: boolean; createFailure?: boolean; checkpointFailure?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<Record<string, unknown>> = [];
  let stages = 0;
  let durableBinding = false;
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (!name.includes("demo")) calls.push({ name, args });
    if (name === "retry_tryops_demo_trial") return { abortSignal: async () => ({ data: { status: "absent" }, error: null }) };
    let result: { data: unknown; error: unknown } = { data: null, error: null };
    if (name === "stage_tryops_experiment_signup") {
      const failed = options.stageFailure || ++stages <= (options.stageFailures ?? 0);
      if (!failed) durableBinding = true;
      result = failed ? { data: null, error: { code: "PGRST202" } } : { data: { status: "staged" }, error: null };
    }
    if (name === "create_company_for_owner_by_id") result = options.createFailure ? { data: null, error: { message: "NO_USER_ROW" } } : { data: { company_id: company, already_existed: false }, error: null };
    if (name === "retry_tryops_experiment_trial") result = options.attachFailure ? { data: null, error: { code: "57014" } } : { data: { status: "attached", assignment_id: actor, experiment_id: actor, arm_id: actor, trial_started_at: "2026-09-14T12:00:01Z" }, error: null };
    return { ...Promise.resolve(result), then: Promise.resolve(result).then.bind(Promise.resolve(result)), abortSignal: async () => result };
  };
  const client = { rpc, from: (table: string) => ({ update: (value: Record<string, unknown>) => {
    updates.push(value);
    return { eq: async () => ({ error: options.checkpointFailure && table === "users" ? { message: "checkpoint rejected" } : null }) };
  } }) };
  mocks.service.mockReturnValue(client);
  return { calls, updates, client, hasDurableBinding: () => durableBinding };
}
function request(step = "company", cookie = `__ops_experiment=${token}`, extra = {}) {
  return new NextRequest("https://app.opsapp.co/api/setup/progress", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ token: "verified-session", step, data: { companyName: "Test local company" }, ...extra }) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("VERCEL_ENV", "production"); mocks.verify.mockResolvedValue({ uid: "firebase-only-identity", email: user.email }); mocks.find.mockResolvedValue(user); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("server signup experiment integration", () => {
  it("uses actual Next after lifetime to persist failed staging after a successful company response without a revisit", async () => {
    const fixture = setup({ stageFailures: 1, attachFailure: true });
    const lifetime: Promise<unknown>[] = [];
    let closeResponse: (() => void) | undefined;
    const onTaskError = vi.fn();
    const afterContext = new AfterContext({
      waitUntil: promise => { lifetime.push(promise); },
      onClose: callback => { closeResponse = callback; }, onTaskError,
    });
    const response = await workAsyncStorage.run({ afterContext } as WorkStore, () => POST(request()));
    expect(response.status).toBe(200);
    expect(fixture.calls.map(call => call.name)).toEqual([
      "stage_tryops_experiment_signup", "create_company_for_owner_by_id", "retry_tryops_experiment_trial",
    ]);
    expect(fixture.hasDurableBinding()).toBe(false);
    expect(lifetime).toHaveLength(1);
    expect(closeResponse).toBeTypeOf("function");
    closeResponse!(); await Promise.all(lifetime);
    expect(fixture.hasDurableBinding()).toBe(true);
    expect(fixture.calls.at(-1)).toEqual({ name: "stage_tryops_experiment_signup", args: { p_token: token, p_actor_id: actor } });
    expect(onTaskError).not.toHaveBeenCalled();
    expect(fixture.calls.some(call => call.name === "report_tryops_collection_failure")).toBe(false);
    expect(JSON.stringify(fixture.updates)).not.toContain(token);
  });
  it("stages before creating a company, then attaches only the returned company and preserves signup source", async () => {
    const { calls, updates } = setup();
    const res = await POST(request("company", undefined, { companyId: "spoofed", actorId: "spoofed", signup_complete: true, arm: "winner" }));
    expect(res.status).toBe(200);
    expect(calls.map(c => c.name)).toEqual(["stage_tryops_experiment_signup", "create_company_for_owner_by_id", "retry_tryops_experiment_trial"]);
    expect(calls[0].args).toEqual({ p_token: token, p_actor_id: actor });
    expect(calls[2].args).toEqual({ p_actor_id: actor, p_company_id: company });
    expect(updates.at(-1)?.setup_progress).toEqual({ signup_attribution: snapshot, steps: { identity: true, company: true } });
    expect(JSON.stringify(await res.json())).not.toContain(token);
    expect(JSON.stringify(updates)).not.toContain(token);
    expect(mocks.firstTouch).toHaveBeenCalledOnce();
  });
  it("an account-only identity save stages but cannot manufacture a trial", async () => {
    const { calls } = setup();
    expect((await POST(request("identity"))).status).toBe(200);
    expect(calls.map(c => c.name)).toEqual(["stage_tryops_experiment_signup"]);
  });
  it("missing cookie keeps source unknown while still allowing durable recovery", async () => {
    const { calls } = setup();
    expect((await POST(request("company", ""))).status).toBe(200);
    expect(calls.map(c => c.name)).toEqual(["create_company_for_owner_by_id", "retry_tryops_experiment_trial"]);
  });
  it("failed company creation never invokes trial attachment", async () => {
    const { calls } = setup({ createFailure: true });
    expect((await POST(request())).status).toBe(409);
    expect(calls.map(c => c.name)).toEqual(["stage_tryops_experiment_signup", "create_company_for_owner_by_id"]);
  });
  it("attachment failure does not roll back the trial or report signup failure", async () => {
    const { calls } = setup({ attachFailure: true });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect((await res.json()).experimentAttribution).toEqual({ status: "pending", reason: "storage_unavailable" });
    expect(calls.some(c => c.name === "stage_tryops_experiment_signup")).toBe(true);
  });
  it("staging failure is observable while signup continues", async () => {
    setup({ stageFailure: true, attachFailure: true });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect((await res.json()).experimentAttribution).toEqual({ status: "pending", reason: "storage_unavailable" });
    expect(console.error).toHaveBeenCalled();
  });
  it("checkpoint failure remains a failed save even after attachment succeeds", async () => {
    setup({ checkpointFailure: true });
    expect((await POST(request())).status).toBe(500);
  });
  it("resumed setup retries the existing company without creating a new trial", async () => {
    mocks.find.mockResolvedValue({ ...user, company_id: company });
    const { calls } = setup();
    expect((await POST(request("starfield", ""))).status).toBe(200);
    expect(calls).toEqual([{ name: "retry_tryops_experiment_trial", args: { p_actor_id: actor, p_company_id: company } }]);
  });
  it("unverified requests cannot stage or attach", async () => {
    mocks.verify.mockRejectedValue(new Error("Token invalid"));
    const { calls } = setup();
    expect((await POST(request())).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("an email-fallback row bound to another identity cannot authorize experiment writes", async () => {
    mocks.find.mockResolvedValue({ ...user, auth_id: "someone-else", company_id: company });
    const { calls } = setup();
    expect((await POST(request("starfield"))).status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});
