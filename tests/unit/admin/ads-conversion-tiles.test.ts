/**
 * Unit tests for the Google Ads conversion tiles.
 *
 * Pins the 2026-08-05 findings from the live account: three separate SIGNUP
 * actions must sum (the old .find() took one and undercounted 226 → 202), and
 * the install action is named "OPS APP First open" — the old substring hunt
 * for "install" matched nothing, so the tile was permanently blank.
 */
import { describe, it, expect } from "vitest";
import {
  conversionTile,
  SIGNUP_TILE,
  INSTALL_TILE,
} from "@/lib/admin/ads-conversion-tiles";
import type { ConversionBreakdown } from "@/lib/analytics/google-ads-types";

const TOTAL_SPEND = 4777.8;

/** The real shape returned for 2025-02-20 → 2026-03-09. */
const LIVE_ROWS: ConversionBreakdown[] = [
  { actionName: "Join Ops SIgnup", category: "SIGNUP", conversions: 202, cpa: 23.65, cost: TOTAL_SPEND },
  { actionName: "OPS APP First open", category: "DOWNLOAD", conversions: 129, cpa: 37.04, cost: TOTAL_SPEND },
  { actionName: "Quiz Signup v2", category: "SIGNUP", conversions: 18, cpa: 265.43, cost: TOTAL_SPEND },
  { actionName: "Homepage Signup", category: "SIGNUP", conversions: 6, cpa: 796.3, cost: TOTAL_SPEND },
];

describe("conversionTile", () => {
  it("sums every signup action rather than picking one", () => {
    const tile = conversionTile(LIVE_ROWS, TOTAL_SPEND, SIGNUP_TILE);

    expect(tile.conversions).toBe(226); // 202 + 18 + 6
    expect(tile.cpa).toBeCloseTo(TOTAL_SPEND / 226, 6);
    expect(tile.actions).toEqual(["Join Ops SIgnup", "Quiz Signup v2", "Homepage Signup"]);
  });

  it("finds the install action by category even though its name says 'First open'", () => {
    const tile = conversionTile(LIVE_ROWS, TOTAL_SPEND, INSTALL_TILE);

    expect(tile.conversions).toBe(129);
    expect(tile.cpa).toBeCloseTo(TOTAL_SPEND / 129, 6);
    expect(tile.actions).toEqual(["OPS APP First open"]);
  });

  it("never counts one action toward both tiles", () => {
    const signups = conversionTile(LIVE_ROWS, TOTAL_SPEND, SIGNUP_TILE);
    const installs = conversionTile(LIVE_ROWS, TOTAL_SPEND, INSTALL_TILE);
    const overlap = signups.actions.filter((a) => installs.actions.includes(a));

    expect(overlap).toEqual([]);
    expect(signups.conversions + installs.conversions).toBe(355); // account total
  });

  it("falls back to name matching when Google returns no category", () => {
    const rows: ConversionBreakdown[] = [
      { actionName: "Website sign_up", category: null, conversions: 10, cpa: 0, cost: 100 },
      { actionName: "App install (legacy)", category: null, conversions: 4, cpa: 0, cost: 100 },
      { actionName: "Newsletter", category: null, conversions: 99, cpa: 0, cost: 100 },
    ];

    expect(conversionTile(rows, 100, SIGNUP_TILE).conversions).toBe(10);
    expect(conversionTile(rows, 100, INSTALL_TILE).conversions).toBe(4);
  });

  it("prefers the category over a misleading name", () => {
    const rows: ConversionBreakdown[] = [
      // Named like a signup, categorized by Google as a download.
      { actionName: "Signup after install", category: "DOWNLOAD", conversions: 7, cpa: 0, cost: 100 },
    ];

    expect(conversionTile(rows, 100, SIGNUP_TILE).conversions).toBe(0);
    expect(conversionTile(rows, 100, INSTALL_TILE).conversions).toBe(7);
  });

  it("returns a null cpa (not a divide-by-zero) when nothing converted", () => {
    const tile = conversionTile([], 500, SIGNUP_TILE);

    expect(tile.conversions).toBe(0);
    expect(tile.cpa).toBeNull();
    expect(tile.actions).toEqual([]);
  });

  it("reports zero cpa windows honestly when spend is zero", () => {
    const rows: ConversionBreakdown[] = [
      { actionName: "Join Ops SIgnup", category: "SIGNUP", conversions: 5, cpa: 0, cost: 0 },
    ];
    const tile = conversionTile(rows, 0, SIGNUP_TILE);

    expect(tile.conversions).toBe(5);
    expect(tile.cpa).toBe(0);
  });
});
