import { describe, it, expect } from "vitest";
import {
  AVAILABILITY_LOOKBACK_DAYS,
  AVAILABILITY_WINDOW_DAYS,
  availabilityRange,
  dayKey,
  formatDayChip,
  formatSlotStamp,
  formatSlotTime,
  formatZoneLabel,
  groupSlotsByDay,
  isPlausiblePhone,
  safeTimeZone,
  type AvailableSlot,
} from "@/components/customer/booking/booking-format";
import en from "@/i18n/dictionaries/en/customer.json";
import es from "@/i18n/dictionaries/es/customer.json";

const DENVER = "America/Denver";

function slot(iso: string, id = iso): AvailableSlot {
  return { slot: `sl_${id}`, startAt: new Date(iso) };
}

describe("booking copy", () => {
  it("carries every booking key in both locales", () => {
    const bookingKeys = Object.keys(en).filter((k) => k.startsWith("book."));
    expect(bookingKeys.length).toBeGreaterThan(30);
    expect(bookingKeys.every((k) => k in es)).toBe(true);
  });

  it("never promises a booking before the outcome is known", () => {
    // Everything the visitor reads before the confirm must be true under
    // `instant` AND `request` (design §7). No pre-commit string may say booked.
    const preCommit = Object.entries(en).filter(
      ([k]) => k.startsWith("book.") && !k.startsWith("book.done.")
    );
    for (const [key, value] of preCommit) {
      expect(value.toLowerCase(), `${key} promises a booking before the outcome`).not.toMatch(
        /you're booked|confirmed for|is booked/
      );
    }
  });

  it("states plainly in the request ending that the time is not held", () => {
    expect(en["book.done.requested.next"].toLowerCase()).toContain("isn't held");
    expect(es["book.done.requested.next"].toLowerCase()).toContain("no queda reservado");
  });
});

describe("safeTimeZone", () => {
  it("passes a real zone through and falls back to UTC for anything else", () => {
    expect(safeTimeZone(DENVER)).toBe(DENVER);
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone(null)).toBe("UTC");
    expect(safeTimeZone("")).toBe("UTC");
  });
});

describe("times render in the business's timezone, never the visitor's", () => {
  const instant = new Date("2026-09-08T15:00:00.000Z"); // 09:00 in Denver (MDT)

  it("formats the hour against the policy zone", () => {
    expect(formatSlotTime(instant, DENVER, "en")).toBe("9:00 AM");
    expect(formatSlotTime(instant, "UTC", "en")).toBe("3:00 PM");
  });

  it("follows the locale's own clock convention for Spanish (es-MX: 12-hour)", () => {
    // Whatever the locale's convention is, the hour is still the policy's.
    expect(formatSlotTime(instant, DENVER, "es")).toMatch(/^9:00/);
    expect(formatSlotTime(instant, "UTC", "es")).toMatch(/^3:00/);
  });

  it("keys the day by the policy zone, not UTC", () => {
    // 01:30 UTC on the 9th is still the 8th in Denver — the day chip must agree.
    const lateNight = new Date("2026-09-09T01:30:00.000Z");
    expect(dayKey(lateNight, DENVER)).toBe("2026-09-08");
    expect(dayKey(lateNight, "UTC")).toBe("2026-09-09");
  });

  it("renders the day chip and the appointment stamp", () => {
    expect(formatDayChip(instant, DENVER, "en")).toEqual({ weekday: "Tue", date: "Sep 8" });
    expect(formatSlotStamp(instant, DENVER, "en")).toBe("Tue, Sep 8 · 9:00 AM");
  });

  it("names the zone in a way a visitor can read, in either language", () => {
    expect(formatZoneLabel(instant, DENVER, "en")).toBe("MDT");
    expect(formatZoneLabel(instant, "UTC", "en")).toBe("UTC");
    // es-MX has no abbreviation for Mountain time and would say "GMT-6";
    // a name beats a bare offset for someone deciding when to be home.
    const spanish = formatZoneLabel(instant, DENVER, "es");
    expect(spanish).not.toMatch(/^GMT/);
    expect(spanish.toLowerCase()).toContain("denver");
  });

  it("survives a DST boundary without shifting the wall clock", () => {
    // 09:00 Denver on either side of the 2026-11-01 fallback: 15:00Z then 16:00Z.
    expect(formatSlotTime(new Date("2026-10-30T15:00:00.000Z"), DENVER, "en")).toBe("9:00 AM");
    expect(formatSlotTime(new Date("2026-11-03T16:00:00.000Z"), DENVER, "en")).toBe("9:00 AM");
  });
});

describe("groupSlotsByDay", () => {
  it("groups into chronological days, each with its own times", () => {
    const days = groupSlotsByDay(
      [
        slot("2026-09-09T16:00:00.000Z"),
        slot("2026-09-08T15:00:00.000Z"),
        slot("2026-09-08T17:00:00.000Z"),
      ],
      DENVER
    );
    expect(days.map((d) => d.key)).toEqual(["2026-09-08", "2026-09-09"]);
    expect(days[0].slots.map((s) => formatSlotTime(s.startAt, DENVER, "en"))).toEqual([
      "9:00 AM",
      "11:00 AM",
    ]);
  });

  it("has no concept of an unavailable day — absent days are simply absent", () => {
    const days = groupSlotsByDay([slot("2026-09-08T15:00:00.000Z")], DENVER);
    expect(days).toHaveLength(1);
    expect(days[0].slots).toHaveLength(1);
  });

  it("collapses two descriptors for the same instant to one button", () => {
    const days = groupSlotsByDay(
      [slot("2026-09-08T15:00:00.000Z", "a"), slot("2026-09-08T15:00:00.000Z", "b")],
      DENVER
    );
    expect(days[0].slots).toHaveLength(1);
  });

  it("drops an unparseable instant instead of rendering an Invalid Date", () => {
    const days = groupSlotsByDay(
      [{ slot: "sl_bad", startAt: new Date("nope") }, slot("2026-09-08T15:00:00.000Z")],
      DENVER
    );
    expect(days).toHaveLength(1);
    expect(days[0].slots.map((s) => s.slot)).toEqual(["sl_2026-09-08T15:00:00.000Z"]);
  });

  it("returns nothing for nothing", () => {
    expect(groupSlotsByDay([], DENVER)).toEqual([]);
  });
});

describe("availabilityRange", () => {
  it("asks from yesterday through five weeks out", () => {
    const { from, to } = availabilityRange(new Date("2026-09-08T12:00:00.000Z"));
    expect(from).toBe("2026-09-07");
    expect(to).toBe("2026-10-13");
    expect(AVAILABILITY_LOOKBACK_DAYS).toBe(1);
    expect(AVAILABILITY_WINDOW_DAYS).toBe(35);
  });
});

describe("isPlausiblePhone", () => {
  it("accepts blank (the field is optional) and anything dialable", () => {
    expect(isPlausiblePhone("")).toBe(true);
    expect(isPlausiblePhone("   ")).toBe(true);
    expect(isPlausiblePhone("(555) 555-5555")).toBe(true);
    expect(isPlausiblePhone("+1 403 555 0199")).toBe(true);
  });

  it("rejects a number too short or too long to dial", () => {
    expect(isPlausiblePhone("5551")).toBe(false);
    expect(isPlausiblePhone("1234567890123456")).toBe(false);
  });
});
