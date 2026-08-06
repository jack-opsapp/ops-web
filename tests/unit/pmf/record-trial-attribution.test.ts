/**
 * Unit tests for src/lib/pmf/record-trial-attribution.ts
 *
 * recordTrialAttribution upgrades the trial_attributions row that the
 * companies_seed_trial_attribution DB trigger already created. It is invoked
 * from POST /api/setup/progress on the company step.
 *
 * Two contracts matter most and are both pinned here:
 *   1. First-touch is never overwritten — the UPDATE is scoped to rows still
 *      sitting at attributed_channel = 'unknown'.
 *   2. It NEVER throws. Attribution is a side-effect of signup; a failure here
 *      must not fail a company's creation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordTrialAttribution } from "@/lib/pmf/record-trial-attribution";
import type { FirstTouch } from "@/lib/pmf/utm-capture";

// ─── Mock Supabase client ────────────────────────────────────────────────────

interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
  eq: Array<[string, unknown]>;
}

let updateCalls: UpdateCall[] = [];
let updateError: { message: string } | null = null;
let throwOnFrom = false;

function makeDb() {
  return {
    from(table: string) {
      if (throwOnFrom) throw new Error("connection exploded");
      return {
        update(values: Record<string, unknown>) {
          const call: UpdateCall = { table, values, eq: [] };
          updateCalls.push(call);
          const chain = {
            eq(col: string, val: unknown) {
              call.eq.push([col, val]);
              // Second .eq() resolves the builder (thenable), matching
              // supabase-js: the query fires when awaited.
              return call.eq.length >= 2
                ? Promise.resolve({ error: updateError })
                : chain;
            },
          };
          return chain;
        },
      };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => makeDb() as any;

const touch = (over: Partial<FirstTouch> = {}): FirstTouch => ({
  captured_at: "2026-08-06T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  updateCalls = [];
  updateError = null;
  throwOnFrom = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("recordTrialAttribution", () => {
  it("writes UTM values and the derived channel for a gclid touch", async () => {
    await recordTrialAttribution(
      db(),
      "company-1",
      touch({ utm_source: "google", utm_medium: "cpc", gclid: "Cj0KCQ" })
    );

    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];
    expect(call.table).toBe("trial_attributions");
    expect(call.values.utm_source).toBe("google");
    expect(call.values.utm_medium).toBe("cpc");
    expect(call.values.gclid).toBe("Cj0KCQ");
    expect(call.values.attributed_channel).toBe("google_ads");
  });

  it("scopes the update to the company AND to unknown-channel rows only", async () => {
    // This is what preserves first-touch: an already-attributed row is skipped.
    await recordTrialAttribution(db(), "company-1", touch({ fbclid: "IwAR1" }));

    expect(updateCalls[0].eq).toEqual([
      ["company_id", "company-1"],
      ["attributed_channel", "unknown"],
    ]);
  });

  it("derives meta_ads from fbclid", async () => {
    await recordTrialAttribution(db(), "company-1", touch({ fbclid: "IwAR1" }));
    expect(updateCalls[0].values.attributed_channel).toBe("meta_ads");
  });

  it("nulls absent fields rather than leaving them undefined", async () => {
    await recordTrialAttribution(db(), "company-1", touch({ gclid: "x" }));
    const v = updateCalls[0].values;
    expect(v.utm_content).toBeNull();
    expect(v.utm_term).toBeNull();
    expect(v.fbclid).toBeNull();
    expect(v.landing_url).toBeNull();
  });

  it("does nothing when there is no first-touch cookie", async () => {
    await recordTrialAttribution(db(), "company-1", null);
    expect(updateCalls).toHaveLength(0);
  });

  it("does not write when the touch carries no signal whatsoever", async () => {
    // No UTM, no click id, no landing URL — nothing to record.
    await recordTrialAttribution(db(), "company-1", touch({}));
    expect(updateCalls).toHaveLength(0);
  });

  it("records an untagged landing as 'direct' rather than discarding it", async () => {
    // A visitor who typed the URL is genuinely 'direct'. That is real
    // information and must not be conflated with 'unknown' (no web session
    // at all, e.g. an iOS signup).
    await recordTrialAttribution(
      db(),
      "company-1",
      touch({ landing_url: "https://opsapp.co/" })
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.attributed_channel).toBe("direct");
    expect(updateCalls[0].values.landing_url).toBe("https://opsapp.co/");
  });

  it("keeps UTM data even when the channel does not classify", async () => {
    // Regression guard: skipping on channel === 'unknown' would silently throw
    // away utm_source for every unrecognized source.
    await recordTrialAttribution(
      db(),
      "company-1",
      touch({ utm_source: "newsletter", utm_campaign: "june-blast" })
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.utm_source).toBe("newsletter");
    expect(updateCalls[0].values.utm_campaign).toBe("june-blast");
    expect(updateCalls[0].values.attributed_channel).toBe("unknown");
  });

  it("does not throw when the update returns an error", async () => {
    updateError = { message: "permission denied" };
    await expect(
      recordTrialAttribution(db(), "company-1", touch({ gclid: "x" }))
    ).resolves.toBeUndefined();
  });

  it("does not throw when the client itself blows up", async () => {
    throwOnFrom = true;
    await expect(
      recordTrialAttribution(db(), "company-1", touch({ gclid: "x" }))
    ).resolves.toBeUndefined();
  });
});
