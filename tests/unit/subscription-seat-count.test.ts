/**
 * Unit test — seat counting in `getSubscriptionInfo`.
 *
 * The owner legitimately appears in BOTH `adminIds` and `seatedEmployeeIds`:
 * `create_company_for_owner` (iOS) has always written both, and as of
 * 2026-08-18 `create_company_for_owner_by_id` (web) does too.
 *
 * `currentSeats` used to SUM the two arrays, so the owner consumed two seats on
 * every company that seated them — every iOS-created company read one seat over
 * its true usage. It now counts distinct people.
 *
 * This matters beyond cosmetics: `currentSeats` drives `canAddSeat`,
 * `shouldShowUpgrade` and `shouldShowBanner`, so a double-count nagged owners to
 * upgrade a seat early and could refuse a seat they were entitled to.
 */

import { describe, expect, it } from "vitest";
import {
  canAddSeat,
  getSubscriptionInfo,
  shouldShowBanner,
} from "@/lib/subscription";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CREW_A = "22222222-2222-4222-8222-222222222222";
const CREW_B = "33333333-3333-4333-8333-333333333333";

/** A live trial so seat math is the only thing under test. */
function company(overrides: {
  seatedEmployeeIds?: string[];
  adminIds?: string[];
  maxSeats?: number;
}) {
  return {
    subscriptionPlan: "trial",
    subscriptionStatus: "trialing",
    trialEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    seatedEmployeeIds: overrides.seatedEmployeeIds ?? [],
    adminIds: overrides.adminIds ?? [],
    maxSeats: overrides.maxSeats ?? 10,
  } as unknown as Parameters<typeof getSubscriptionInfo>[0];
}

describe("getSubscriptionInfo — seat counting", () => {
  it("counts an owner who is both seated and an admin exactly once", () => {
    const info = getSubscriptionInfo(
      company({ seatedEmployeeIds: [OWNER], adminIds: [OWNER] })
    );
    expect(info.currentSeats).toBe(1);
  });

  it("counts a solo owner the same whether or not they hold a seat row", () => {
    // Pre-2026-08-18 web companies had admin_ids only; iOS companies had both.
    // The same one-person company must not read differently by platform.
    const webShape = getSubscriptionInfo(company({ adminIds: [OWNER] }));
    const iosShape = getSubscriptionInfo(
      company({ seatedEmployeeIds: [OWNER], adminIds: [OWNER] })
    );
    expect(webShape.currentSeats).toBe(iosShape.currentSeats);
  });

  it("counts owner plus crew as distinct people", () => {
    const info = getSubscriptionInfo(
      company({
        seatedEmployeeIds: [OWNER, CREW_A, CREW_B],
        adminIds: [OWNER],
      })
    );
    expect(info.currentSeats).toBe(3);
  });

  it("does not refuse a seat the company is entitled to", () => {
    // 2 real people against a 3-seat cap. Summing gave 3 and blocked the add.
    const info = getSubscriptionInfo(
      company({
        seatedEmployeeIds: [OWNER, CREW_A],
        adminIds: [OWNER],
        maxSeats: 3,
      })
    );
    expect(info.currentSeats).toBe(2);
    expect(canAddSeat(info)).toBe(true);
  });

  it("does not nag a one-person company to upgrade", () => {
    const info = getSubscriptionInfo(
      company({ seatedEmployeeIds: [OWNER], adminIds: [OWNER], maxSeats: 3 })
    );
    expect(shouldShowBanner(info)).toBe(false);
  });

  it("tolerates null seat arrays", () => {
    const info = getSubscriptionInfo(
      company({
        seatedEmployeeIds: undefined as unknown as string[],
        adminIds: undefined as unknown as string[],
      })
    );
    expect(info.currentSeats).toBe(0);
  });
});
