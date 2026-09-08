import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({ from: fromMock }),
}));

import { getCapacityEditRows } from "../spec-capacity-queries";

/** The three live rows as prod holds them (2026-09-05), deliberately unsorted. */
const PROD_ROWS = [
  {
    tier: "spec03",
    slot_ceiling: 1,
    discovery_days_min: 10,
    discovery_days_max: 15,
    build_days_min: 30,
    build_days_max: 60,
    support_window_days: 90,
    subscription_multiplier_estimate: "0.00",
    retainer_monthly_cents: 75000,
    polish_hours_budget: "8.00",
    is_accepting_bookings: true,
    manual_next_start_override: null,
    public_note: null,
    admin_notes: "v2 PROPRIETARY",
    updated_at: "2026-07-15T03:58:35.524148+00:00",
  },
  {
    tier: "spec01",
    slot_ceiling: 6,
    discovery_days_min: 2,
    discovery_days_max: 4,
    build_days_min: 3,
    build_days_max: 7,
    support_window_days: 30,
    subscription_multiplier_estimate: "0.00",
    retainer_monthly_cents: 0,
    polish_hours_budget: "2.00",
    is_accepting_bookings: true,
    manual_next_start_override: null,
    public_note: null,
    admin_notes: "v2 WORKFLOWS",
    updated_at: "2026-07-15T03:58:35.524148+00:00",
  },
  {
    tier: "spec02",
    slot_ceiling: 3,
    discovery_days_min: 5,
    discovery_days_max: 10,
    build_days_min: 15,
    build_days_max: 25,
    support_window_days: 60,
    subscription_multiplier_estimate: "0.00",
    retainer_monthly_cents: 39500,
    polish_hours_budget: "4.00",
    is_accepting_bookings: true,
    manual_next_start_override: null,
    public_note: null,
    admin_notes: "v2 SYSTEMS",
    updated_at: "2026-07-15T03:58:35.524148+00:00",
  },
];

beforeEach(() => {
  selectMock.mockReset();
  fromMock.mockClear();
});

describe("getCapacityEditRows", () => {
  it("keeps every v2 slug and orders the editor SPEC-01 → SPEC-02 → SPEC-03", async () => {
    selectMock.mockResolvedValue({ data: PROD_ROWS, error: null });

    const rows = await getCapacityEditRows();

    expect(fromMock).toHaveBeenCalledWith("spec_capacity");
    expect(rows.map((r) => r.tier)).toEqual(["spec01", "spec02", "spec03"]);
    expect(rows.map((r) => r.slotCeiling)).toEqual([6, 3, 1]);
    expect(rows.map((r) => r.retainerMonthlyCents)).toEqual([0, 39500, 75000]);
    expect(rows[2]).toMatchObject({
      tier: "spec03",
      discoveryDaysMin: 10,
      discoveryDaysMax: 15,
      buildDaysMin: 30,
      buildDaysMax: 60,
      supportWindowDays: 90,
      polishHoursBudget: 8,
      isAcceptingBookings: true,
      manualNextStartOverride: null,
      publicNote: null,
      adminNotes: "v2 PROPRIETARY",
    });
  });

  it("surfaces a read failure instead of rendering an empty editor", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(getCapacityEditRows()).rejects.toThrow(/permission denied/);
  });
});
