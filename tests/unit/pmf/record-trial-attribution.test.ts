import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordTrialAttribution } from "@/lib/pmf/trial-attribution";
import type { FirstTouch } from "@/lib/pmf/utm-capture";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

let rpcCalls: RpcCall[] = [];
let rpcError: { message: string } | null = null;
let throwOnRpc = false;

function makeDb() {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      if (throwOnRpc) throw new Error("connection exploded");
      rpcCalls.push({ fn, args });
      return { data: { status: "recorded" }, error: rpcError };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => makeDb() as any;

const touch = (overrides: Partial<FirstTouch> = {}): FirstTouch => ({
  version: 1,
  anonymous_id: "11111111-1111-4111-8111-111111111111",
  captured_at: "2026-08-06T00:00:00.000Z",
  landing_path: "/plans",
  ...overrides,
});

function payload(): Record<string, unknown> {
  return rpcCalls[0].args.p_touch as Record<string, unknown>;
}

beforeEach(() => {
  rpcCalls = [];
  rpcError = null;
  throwOnRpc = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordTrialAttribution", () => {
  it("uses one atomic RPC for the attribution row and touchpoint", async () => {
    await recordTrialAttribution(
      db(),
      "22222222-2222-4222-8222-222222222222",
      touch({ utm_source: "google", utm_medium: "cpc", gclid: "Cj0KCQ" })
    );

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      fn: "record_first_touch_attribution",
      args: {
        p_company_id: "22222222-2222-4222-8222-222222222222",
      },
    });
    expect(payload()).toMatchObject({
      channel: "google_ads",
      basis: "verified_click_id",
      confidence: 1,
      reason: "gclid_present",
      landing_path: "/plans",
    });
  });

  it("records an untagged landing as direct, not unknown", async () => {
    await recordTrialAttribution(db(), "company-1", touch());
    expect(payload()).toMatchObject({
      channel: "direct",
      basis: "direct",
      reason: "no_campaign_or_external_referrer",
    });
  });

  it("classifies a Google referrer as organic search", async () => {
    await recordTrialAttribution(
      db(),
      "company-1",
      touch({ referrer_domain: "google.ca" })
    );
    expect(payload()).toMatchObject({
      channel: "organic_search",
      basis: "utm_referrer",
      reason: "search_engine_referrer",
    });
  });

  it("never copies an arbitrary query string or identity field", async () => {
    await recordTrialAttribution(
      db(),
      "company-1",
      touch({
        landing_path: "/plans",
        utm_campaign: "spring",
      })
    );
    const serialized = JSON.stringify(payload());
    expect(serialized).not.toContain("?");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("name");
  });

  it("does nothing without a first-touch cookie", async () => {
    await recordTrialAttribution(db(), "company-1", null);
    expect(rpcCalls).toHaveLength(0);
  });

  it("does not throw when the database returns an error", async () => {
    rpcError = { message: "permission denied" };
    await expect(
      recordTrialAttribution(db(), "company-1", touch({ gclid: "x" }))
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("does not throw when the client itself fails", async () => {
    throwOnRpc = true;
    await expect(
      recordTrialAttribution(db(), "company-1", touch({ gclid: "x" }))
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
