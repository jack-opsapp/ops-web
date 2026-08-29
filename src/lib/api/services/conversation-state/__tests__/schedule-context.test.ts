import { describe, expect, it } from "vitest";

import {
  buildScheduleContextBlock,
  formatScheduleClock,
  formatScheduleDate,
  SCHEDULE_CONTEXT_RULES,
  type ScheduleContextFacts,
} from "../schedule-context";

const TZ = "America/Vancouver";

function facts(over: Partial<ScheduleContextFacts> = {}): ScheduleContextFacts {
  return {
    timezone: TZ,
    generatedAt: "2026-09-01T17:00:00.000Z", // Tue Sep 1, 10:00 in Vancouver
    customerTasks: [],
    customerVisits: [],
    companyBusyDays: [],
    ...over,
  };
}

describe("buildScheduleContextBlock — header", () => {
  it("names the generation day and the company timezone", () => {
    const block = buildScheduleContextBlock(facts());
    expect(block.split("\n")[0]).toBe(
      "SERVER-VERIFIED SCHEDULE (generated Tue, Sep 1 · timezone America/Vancouver):"
    );
  });

  it("renders the generation day in the company timezone, not UTC", () => {
    // 2026-09-02T05:00Z is still Sep 1 in Vancouver (UTC-7).
    const block = buildScheduleContextBlock(
      facts({ generatedAt: "2026-09-02T05:00:00.000Z" })
    );
    expect(block).toContain("generated Tue, Sep 1");
  });
});

describe("buildScheduleContextBlock — this customer's bookings", () => {
  it("renders a confirmed task with its day and clock time", () => {
    const block = buildScheduleContextBlock(
      facts({
        customerTasks: [
          {
            title: "Deck framing",
            startDate: "2026-09-03",
            endDate: null,
            startTime: "09:00:00",
            allDay: false,
            confirmed: true,
          },
        ],
      })
    );
    expect(block).toContain(
      "- Deck framing — Thu, Sep 3 at 9:00 AM — confirmed"
    );
  });

  it("renders a multi-day tentative task with its end day", () => {
    const block = buildScheduleContextBlock(
      facts({
        customerTasks: [
          {
            title: "Vinyl install",
            startDate: "2026-09-03",
            endDate: "2026-09-05",
            startTime: null,
            allDay: true,
            confirmed: false,
          },
        ],
      })
    );
    expect(block).toContain(
      "- Vinyl install — Thu, Sep 3 through Sat, Sep 5 — tentative"
    );
  });

  it("omits the clock time on an all-day task", () => {
    const block = buildScheduleContextBlock(
      facts({
        customerTasks: [
          {
            title: "Site prep",
            startDate: "2026-09-03",
            endDate: "2026-09-03",
            startTime: "07:30",
            allDay: true,
            confirmed: false,
          },
        ],
      })
    );
    expect(block).toContain("- Site prep — Thu, Sep 3 — tentative");
    expect(block).not.toContain("7:30 AM");
  });

  it("renders a site visit with duration and status", () => {
    const block = buildScheduleContextBlock(
      facts({
        customerVisits: [
          {
            title: "Site visit",
            scheduledAt: "2026-09-02T21:00:00.000Z", // 2:00 PM Vancouver
            durationMinutes: 60,
            status: "scheduled",
          },
        ],
      })
    );
    expect(block).toContain(
      "- Site visit — Wed, Sep 2 at 2:00 PM (60 min) — scheduled"
    );
  });

  it("states an empty customer calendar explicitly — a verified fact", () => {
    const block = buildScheduleContextBlock(facts());
    expect(block).toContain("THIS CUSTOMER'S BOOKINGS:\n- none on the calendar");
  });
});

describe("buildScheduleContextBlock — company calendar", () => {
  it("pluralizes booking counts and orders days ascending", () => {
    const block = buildScheduleContextBlock(
      facts({
        companyBusyDays: [
          { date: "2026-09-02", bookedCount: 3 },
          { date: "2026-09-03", bookedCount: 1 },
        ],
      })
    );
    expect(block).toContain("- Wed, Sep 2: 3 bookings");
    expect(block).toContain("- Thu, Sep 3: 1 booking");
    expect(block.indexOf("Wed, Sep 2: 3")).toBeLessThan(
      block.indexOf("Thu, Sep 3: 1")
    );
  });

  it("states an empty company calendar explicitly", () => {
    const block = buildScheduleContextBlock(facts());
    expect(block).toContain("- no bookings in the next 14 days");
  });
});

describe("buildScheduleContextBlock — rules", () => {
  it("always carries the never-confirm-a-new-time contract", () => {
    const block = buildScheduleContextBlock(facts());
    expect(block).toContain(SCHEDULE_CONTEXT_RULES);
    expect(block).toContain("NEVER present a new date or time as confirmed.");
    expect(block).toContain(
      "Days absent from the booked list are not guaranteed free."
    );
    expect(block.trimEnd().endsWith(SCHEDULE_CONTEXT_RULES)).toBe(true);
  });

  it("is deterministic — the same facts render the same block", () => {
    const input = facts({
      customerTasks: [
        {
          title: "Deck framing",
          startDate: "2026-09-03",
          endDate: null,
          startTime: "09:00",
          allDay: false,
          confirmed: true,
        },
      ],
      companyBusyDays: [{ date: "2026-09-03", bookedCount: 2 }],
    });
    expect(buildScheduleContextBlock(input)).toBe(
      buildScheduleContextBlock(input)
    );
  });
});

describe("date + clock helpers", () => {
  it("never shifts a bare date across a timezone boundary", () => {
    // Read through America/Vancouver, UTC midnight would render as Sep 2.
    expect(formatScheduleDate("2026-09-03", TZ)).toBe("Thu, Sep 3");
    expect(formatScheduleDate("2026-01-01", "Pacific/Auckland")).toBe(
      "Thu, Jan 1"
    );
  });

  it("converts a true timestamp into the company timezone", () => {
    expect(formatScheduleDate("2026-09-02T21:00:00.000Z", TZ)).toBe("Wed, Sep 2");
  });

  it("renders stored clock strings in 12-hour form without timezone math", () => {
    expect(formatScheduleClock("09:00:00")).toBe("9:00 AM");
    expect(formatScheduleClock("13:05")).toBe("1:05 PM");
    expect(formatScheduleClock("00:30")).toBe("12:30 AM");
    expect(formatScheduleClock("12:00")).toBe("12:00 PM");
    expect(formatScheduleClock("nonsense")).toBeNull();
  });
});
