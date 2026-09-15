import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAuthToken: mocks.verify, isFirebaseIssuedToken: () => true }));
vi.mock("@/lib/supabase/server-client", () => ({ getServiceRoleClient: mocks.service }));
import { POST } from "@/app/api/auth/sync-user/route";
const actor = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const snapshot = { channel: "organic_search", basis: "utm_referrer", version: 1 };
function fakeDb(options: { existing?: boolean; raced?: boolean; stageError?: boolean; company?: boolean; demo?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const row = { id: actor, auth_id: "verified-firebase", firebase_uid: "verified-firebase", company_id: options.company ? company : null, setup_progress: { steps: {}, signup_attribution: snapshot } };
  let inserted = false;
  return {
    calls,
    client: {
      rpc(name: string, args: Record<string, unknown>) { if (name === "retry_tryops_demo_trial" && !options.demo) return { abortSignal: async () => ({ data: { status: "absent" }, error: null }) }; calls.push({ name, args }); return { abortSignal: async () => options.stageError ? { error: { code: "PGRST202", message: token } } : { data: name.startsWith("stage") ? { status: "staged" } : { status: "rejected", reason: "trial_before_exposure" }, error: null } }; },
      from(table: string) {
        let payload: Record<string, unknown> = {};
        let inserting = false;
        const q = {
          select: () => q, eq: () => q, is: () => q,
          update: (value: Record<string, unknown>) => { payload = value; return q; },
          insert: (value: Record<string, unknown>) => { payload = value; inserting = true; inserted = true; return q; },
          maybeSingle: async () => ({ data: options.existing || (options.raced && inserted) ? row : null, error: null }),
          single: async () => {
            if (table === "companies") return { data: { id: company }, error: null };
            if (inserting && options.raced) return { data: null, error: { code: "23505" } };
            return { data: { ...row, ...payload }, error: null };
          },
        };
        return q;
      },
    },
  };
}
function req(cookie = `__ops_experiment=${token}`) {
  return new NextRequest("https://app.opsapp.co/api/auth/sync-user", { method: "POST", headers: { cookie, origin: "https://app.opsapp.co", referer: "https://app.opsapp.co/register", "content-type": "application/json" }, body: JSON.stringify({ idToken: "provider-return-token", email: "person@example.test", actorId: "forged", experiment: "forged" }) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("VERCEL_ENV", "production"); vi.spyOn(console,"error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe.each(["google.com", "apple.com", "password"])("verified %s return", provider => {
  it("stages the shared HttpOnly request cookie only after resolving the saved canonical account", async () => {
    mocks.verify.mockResolvedValue({ uid: "verified-firebase", email: "person@example.test", claims: { firebase: { sign_in_provider: provider } } });
    const { calls, client } = fakeDb(); mocks.service.mockReturnValue(client);
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ name: "stage_tryops_experiment_signup", args: { p_token: token, p_actor_id: actor } }]);
    expect(JSON.stringify(await response.json())).not.toContain(token);
  });
});
it("stages the actual race winner without rewriting signup source", async () => {
  mocks.verify.mockResolvedValue({ uid: "verified-firebase", email: "person@example.test", claims: {} });
  const { calls, client } = fakeDb({ raced: true }); mocks.service.mockReturnValue(client);
  const response = await POST(req()); const body = await response.json();
  expect(response.status).toBe(200);
  expect(calls[0].args.p_actor_id).toBe(actor);
  expect(body.user.setupProgress.signup_attribution).toEqual(snapshot);
});
it("an existing company login cannot relabel a historical trial", async () => {
  mocks.verify.mockResolvedValue({ uid: "verified-firebase", email: "person@example.test", claims: {} });
  const { calls, client } = fakeDb({ existing: true, company: true }); mocks.service.mockReturnValue(client);
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect(calls.map(c => c.name)).toEqual(["stage_tryops_experiment_signup", "retry_tryops_experiment_trial"]);
  expect(calls[1].args).toEqual({ p_actor_id: actor, p_company_id: company });
  expect((await response.json()).user.setupProgress.signup_attribution).toEqual(snapshot);
});
it("missing staging migration cannot fail account creation and logs no token", async () => {
  mocks.verify.mockResolvedValue({ uid: "verified-firebase", email: "person@example.test", claims: {} });
  const { client } = fakeDb({ stageError: true }); mocks.service.mockReturnValue(client);
  expect((await POST(req())).status).toBe(200);
  expect(console.error).toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(token);
});
it("a failed provider token cannot reach staging", async () => {
  mocks.verify.mockRejectedValue(new Error("Token verification failed"));
  const { calls, client } = fakeDb(); mocks.service.mockReturnValue(client);
  expect((await POST(req())).status).toBe(401);
  expect(calls).toHaveLength(0);
});

// External token verification is injected; the real route and demo helper execute.
describe.each(["google.com", "apple.com", "password"])("demo continuity after verified %s return", provider => {
  it("uses the saved actor and request cookie while rejecting body identity claims", async () => {
    mocks.verify.mockResolvedValue({ uid: "verified-firebase", email: "person@example.test", claims: { firebase: { sign_in_provider: provider } } });
    const { calls, client } = fakeDb({ demo: true }); mocks.service.mockReturnValue(client);
    const response = await POST(req(`__ops_demo=${token}`));
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ name: "stage_tryops_demo_signup", args: { p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/), p_actor_id: actor } }]);
    expect(JSON.stringify(await response.json())).not.toContain(token);
  });
});
