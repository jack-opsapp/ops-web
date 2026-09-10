import { describe, expect, it } from "vitest";
import {
  changeVerdict,
  normalCdf,
  testVerdict,
  twoProportionTest,
  DEFAULT_TEST_RULES,
} from "@/lib/ads/engine/stats";

describe("normalCdf", () => {
  it("matches the standard normal table", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 4);
    expect(normalCdf(2.575829)).toBeCloseTo(0.995, 4);
  });
});

describe("twoProportionTest", () => {
  it("computes the pooled z and two-tailed p for a known fixture", () => {
    // 120/4000 vs 170/4000: pooled p = 0.03625, se = 0.0041795, z = -2.9908, p = 0.00278
    const result = twoProportionTest({ impressions: 4000, clicks: 120 }, { impressions: 4000, clicks: 170 });
    expect(result.ctrA).toBeCloseTo(0.03, 6);
    expect(result.ctrB).toBeCloseTo(0.0425, 6);
    expect(result.z).toBeCloseTo(-2.9908, 3);
    expect(result.p).toBeCloseTo(0.00278, 4);
  });

  it("is symmetric and finds no difference for identical arms", () => {
    const result = twoProportionTest({ impressions: 3000, clicks: 90 }, { impressions: 3000, clicks: 90 });
    expect(result.z).toBe(0);
    expect(result.p).toBe(1);
  });

  it("returns p = 1 when there are no impressions on either arm", () => {
    const result = twoProportionTest({ impressions: 0, clicks: 0 }, { impressions: 0, clicks: 0 });
    expect(result.p).toBe(1);
    expect(Number.isFinite(result.z)).toBe(true);
  });
});

describe("testVerdict", () => {
  const rules = DEFAULT_TEST_RULES;

  it("keeps running below the minimum days or impressions", () => {
    expect(
      testVerdict({ control: { impressions: 5000, clicks: 150, conversions: 2 }, challenger: { impressions: 5000, clicks: 250, conversions: 2 }, days: 10, rules })
    ).toMatchObject({ state: "running", reason: expect.stringMatching(/14 days/) });
    expect(
      testVerdict({ control: { impressions: 1500, clicks: 45, conversions: 0 }, challenger: { impressions: 1500, clicks: 90, conversions: 0 }, days: 20, rules })
    ).toMatchObject({ state: "running", reason: expect.stringMatching(/2000 impressions/) });
  });

  it("declares the challenger the winner at p below 0.05", () => {
    const verdict = testVerdict({ control: { impressions: 4000, clicks: 120, conversions: 1 }, challenger: { impressions: 4000, clicks: 170, conversions: 1 }, days: 21, rules });
    expect(verdict.state).toBe("challenger_won");
    expect(verdict.stats).toMatchObject({ control: { impressions: 4000, clicks: 120, ctr: 0.03, trials: 1 }, challenger: { impressions: 4000, clicks: 170, ctr: 0.0425, trials: 1 }, days: 21 });
    expect(verdict.stats.p).toBeLessThan(0.05);
  });

  it("declares the control the winner when it has the significantly higher CTR", () => {
    const verdict = testVerdict({ control: { impressions: 4000, clicks: 170, conversions: 0 }, challenger: { impressions: 4000, clicks: 120, conversions: 0 }, days: 21, rules });
    expect(verdict.state).toBe("control_won");
  });

  it("vetoes a challenger that wins on CTR but converts nothing while the control converts", () => {
    const verdict = testVerdict({ control: { impressions: 4000, clicks: 120, conversions: 5 }, challenger: { impressions: 4000, clicks: 170, conversions: 0 }, days: 21, rules });
    expect(verdict.state).toBe("control_won");
    expect(verdict.stats.veto).toBe(true);
    expect(verdict.reason).toMatch(/trial/);
  });

  it("does not veto when the challenger has too few clicks to compare", () => {
    const verdict = testVerdict({ control: { impressions: 4000, clicks: 200, conversions: 5 }, challenger: { impressions: 4000, clicks: 60, conversions: 0 }, days: 21, rules });
    expect(verdict.stats.veto).toBe(false);
  });

  it("keeps running without significance inside the window and gives no verdict past eight weeks", () => {
    const flat = { control: { impressions: 4000, clicks: 130, conversions: 1 }, challenger: { impressions: 4000, clicks: 135, conversions: 1 } };
    expect(testVerdict({ ...flat, days: 30, rules }).state).toBe("running");
    const done = testVerdict({ ...flat, days: 57, rules });
    expect(done.state).toBe("no_verdict");
    expect(done.reason).toMatch(/56 days/);
  });
});

describe("changeVerdict", () => {
  it("reads a CTR lift of ten percent or more as better, a drop as worse, and the rest as flat", () => {
    expect(changeVerdict({ impressions: 2000, clicks: 60 }, { impressions: 2000, clicks: 70 })).toMatchObject({ verdict: "better" });
    expect(changeVerdict({ impressions: 2000, clicks: 60 }, { impressions: 2000, clicks: 50 })).toMatchObject({ verdict: "worse" });
    expect(changeVerdict({ impressions: 2000, clicks: 60 }, { impressions: 2000, clicks: 63 })).toMatchObject({ verdict: "flat", deltaPct: 5 });
  });

  it("gives no verdict under five hundred impressions on either side", () => {
    expect(changeVerdict({ impressions: 400, clicks: 20 }, { impressions: 2000, clicks: 70 })).toMatchObject({ verdict: "no_verdict" });
    expect(changeVerdict({ impressions: 2000, clicks: 70 }, { impressions: 499, clicks: 20 })).toMatchObject({ verdict: "no_verdict" });
  });
});
