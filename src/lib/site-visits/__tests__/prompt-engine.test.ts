import { describe, it, expect } from "vitest";

import {
  DEFAULT_SITE_VISIT_REMINDER_LEAD_MINUTES,
  START_PROMPT_GRACE_MINUTES,
  dueSiteVisitPrompts,
  scheduledAtEpochSeconds,
  siteVisitPromptDedupeKey,
  type PromptAssigneePreference,
  type PromptCandidateVisit,
} from "@/lib/site-visits/prompt-engine";

// Fixed appointment instant: epoch seconds chosen first so expected dedupe
// keys can carry the literal value instead of re-deriving the floor formula.
const SCHEDULED_EPOCH = 1_800_000_000;
const SCHEDULED_AT = new Date(SCHEDULED_EPOCH * 1000).toISOString();

const MINUTE_MS = 60_000;

function minutesFromScheduled(offsetMinutes: number): Date {
  return new Date(SCHEDULED_EPOCH * 1000 + offsetMinutes * MINUTE_MS);
}

function makeVisit(
  overrides: Partial<PromptCandidateVisit> = {}
): PromptCandidateVisit {
  return {
    id: "v-1",
    status: "scheduled",
    bookedAt: "2026-08-10T12:00:00.000Z",
    deletedAt: null,
    scheduledAt: SCHEDULED_AT,
    reminderLeadMinutes: null,
    assigneeIds: ["u-1"],
    ...overrides,
  };
}

function prefs(
  entries: Array<[string, number | null]>
): PromptAssigneePreference[] {
  return entries.map(([userId, siteVisitReminderLeadMinutes]) => ({
    userId,
    siteVisitReminderLeadMinutes,
  }));
}

describe("constants", () => {
  it("locks the product defaults the spec defines", () => {
    expect(DEFAULT_SITE_VISIT_REMINDER_LEAD_MINUTES).toBe(30);
    expect(START_PROMPT_GRACE_MINUTES).toBe(15);
  });
});

describe("scheduledAtEpochSeconds", () => {
  it("returns whole epoch seconds for an exact-second timestamp", () => {
    expect(scheduledAtEpochSeconds(SCHEDULED_AT)).toBe(SCHEDULED_EPOCH);
  });

  it("floors sub-second timestamps so reschedules to the same second share a key", () => {
    const fractional = new Date(SCHEDULED_EPOCH * 1000 + 500).toISOString();
    expect(scheduledAtEpochSeconds(fractional)).toBe(SCHEDULED_EPOCH);
  });
});

describe("siteVisitPromptDedupeKey", () => {
  it("builds the exact heads_up key contract", () => {
    expect(siteVisitPromptDedupeKey("v-1", "heads_up", "u-1", SCHEDULED_EPOCH)).toBe(
      `site_visit:v-1:heads_up:u-1:${SCHEDULED_EPOCH}`
    );
  });

  it("builds the exact start key contract", () => {
    expect(siteVisitPromptDedupeKey("v-1", "start", "u-1", SCHEDULED_EPOCH)).toBe(
      `site_visit:v-1:start:u-1:${SCHEDULED_EPOCH}`
    );
  });
});

describe("dueSiteVisitPrompts — heads-up window", () => {
  it("is due exactly at scheduled_at minus the default 30-minute lead", () => {
    const due = dueSiteVisitPrompts(
      makeVisit(),
      prefs([["u-1", null]]),
      minutesFromScheduled(-30)
    );
    expect(due).toEqual([
      {
        userId: "u-1",
        kind: "heads_up",
        dedupeKey: `site_visit:v-1:heads_up:u-1:${SCHEDULED_EPOCH}`,
      },
    ]);
  });

  it("is due one second before scheduled_at", () => {
    const now = new Date(SCHEDULED_EPOCH * 1000 - 1000);
    const due = dueSiteVisitPrompts(makeVisit(), prefs([["u-1", null]]), now);
    expect(due.map((p) => p.kind)).toEqual(["heads_up"]);
  });

  it("is not due one second before the window opens", () => {
    const now = new Date(SCHEDULED_EPOCH * 1000 - 30 * MINUTE_MS - 1000);
    expect(dueSiteVisitPrompts(makeVisit(), prefs([["u-1", null]]), now)).toEqual(
      []
    );
  });

  it("hands over to the start prompt at scheduled_at — heads-up never fires late", () => {
    const due = dueSiteVisitPrompts(
      makeVisit(),
      prefs([["u-1", null]]),
      minutesFromScheduled(0)
    );
    expect(due.map((p) => p.kind)).toEqual(["start"]);
  });
});

describe("dueSiteVisitPrompts — start window", () => {
  it("is due exactly at scheduled_at", () => {
    const due = dueSiteVisitPrompts(
      makeVisit(),
      prefs([["u-1", null]]),
      minutesFromScheduled(0)
    );
    expect(due).toEqual([
      {
        userId: "u-1",
        kind: "start",
        dedupeKey: `site_visit:v-1:start:u-1:${SCHEDULED_EPOCH}`,
      },
    ]);
  });

  it("is still due one second before the 15-minute grace closes", () => {
    const now = new Date(
      SCHEDULED_EPOCH * 1000 + START_PROMPT_GRACE_MINUTES * MINUTE_MS - 1000
    );
    const due = dueSiteVisitPrompts(makeVisit(), prefs([["u-1", null]]), now);
    expect(due.map((p) => p.kind)).toEqual(["start"]);
  });

  it("never fires at or after the grace boundary", () => {
    const due = dueSiteVisitPrompts(
      makeVisit(),
      prefs([["u-1", null]]),
      minutesFromScheduled(START_PROMPT_GRACE_MINUTES)
    );
    expect(due).toEqual([]);
  });
});

describe("dueSiteVisitPrompts — candidacy guards", () => {
  const inWindow = minutesFromScheduled(-10);

  it.each(["in_progress", "completed", "cancelled"])(
    "returns nothing once the visit is %s",
    (status) => {
      expect(
        dueSiteVisitPrompts(
          makeVisit({ status }),
          prefs([["u-1", null]]),
          inWindow
        )
      ).toEqual([]);
    }
  );

  it("returns nothing for walk-up/legacy visits (booked_at null) — junk scheduled_at stays inert", () => {
    expect(
      dueSiteVisitPrompts(
        makeVisit({ bookedAt: null }),
        prefs([["u-1", null]]),
        inWindow
      )
    ).toEqual([]);
  });

  it("returns nothing for deleted visits", () => {
    expect(
      dueSiteVisitPrompts(
        makeVisit({ deletedAt: "2026-08-10T13:00:00.000Z" }),
        prefs([["u-1", null]]),
        inWindow
      )
    ).toEqual([]);
  });

  it("returns nothing when scheduled_at cannot be parsed", () => {
    expect(
      dueSiteVisitPrompts(
        makeVisit({ scheduledAt: "not-a-date" }),
        prefs([["u-1", null]]),
        inWindow
      )
    ).toEqual([]);
  });

  it("returns nothing when the visit has no assignees", () => {
    expect(
      dueSiteVisitPrompts(makeVisit({ assigneeIds: [] }), prefs([]), inWindow)
    ).toEqual([]);
    expect(
      dueSiteVisitPrompts(makeVisit({ assigneeIds: null }), prefs([]), inWindow)
    ).toEqual([]);
  });

  it("emits a single prompt when the assignee array carries duplicates", () => {
    const due = dueSiteVisitPrompts(
      makeVisit({ assigneeIds: ["u-1", "u-1"] }),
      prefs([["u-1", null]]),
      inWindow
    );
    expect(due).toHaveLength(1);
  });
});

describe("dueSiteVisitPrompts — lead resolution chain", () => {
  it("uses the per-booking override ahead of the user default", () => {
    // Visit override 60, user default 45. At T-50 only the 60-minute window is open.
    const visit = makeVisit({ reminderLeadMinutes: 60 });
    const due = dueSiteVisitPrompts(
      visit,
      prefs([["u-1", 45]]),
      minutesFromScheduled(-50)
    );
    expect(due.map((p) => p.kind)).toEqual(["heads_up"]);
  });

  it("falls back to the user default when the booking has no override", () => {
    // User default 45: due at T-45, not due at T-46.
    const due = dueSiteVisitPrompts(
      makeVisit(),
      prefs([["u-1", 45]]),
      minutesFromScheduled(-45)
    );
    expect(due.map((p) => p.kind)).toEqual(["heads_up"]);

    const early = dueSiteVisitPrompts(
      makeVisit(),
      prefs([["u-1", 45]]),
      minutesFromScheduled(-46)
    );
    expect(early).toEqual([]);
  });

  it("falls back to the product default 30 when the assignee has no preference row", () => {
    const due = dueSiteVisitPrompts(makeVisit(), [], minutesFromScheduled(-30));
    expect(due.map((p) => p.kind)).toEqual(["heads_up"]);

    const early = dueSiteVisitPrompts(makeVisit(), [], minutesFromScheduled(-31));
    expect(early).toEqual([]);
  });

  it("resolves the lead per assignee — a 60-minute user is due while a default user is not", () => {
    const visit = makeVisit({ assigneeIds: ["u-60", "u-default"] });
    const due = dueSiteVisitPrompts(
      visit,
      prefs([["u-60", 60]]),
      minutesFromScheduled(-45)
    );
    expect(due).toEqual([
      {
        userId: "u-60",
        kind: "heads_up",
        dedupeKey: `site_visit:v-1:heads_up:u-60:${SCHEDULED_EPOCH}`,
      },
    ]);
  });

  it("treats a zero lead as no heads-up at all — START still fires", () => {
    const visit = makeVisit({ reminderLeadMinutes: 0 });
    expect(
      dueSiteVisitPrompts(visit, prefs([["u-1", null]]), minutesFromScheduled(-1))
    ).toEqual([]);
    expect(
      dueSiteVisitPrompts(
        visit,
        prefs([["u-1", null]]),
        minutesFromScheduled(0)
      ).map((p) => p.kind)
    ).toEqual(["start"]);
  });
});

describe("dueSiteVisitPrompts — reschedule re-arm", () => {
  it("a rescheduled visit produces new dedupe keys for the new time", () => {
    const rescheduledEpoch = SCHEDULED_EPOCH + 24 * 60 * 60;
    const rescheduledAt = new Date(rescheduledEpoch * 1000).toISOString();

    const before = dueSiteVisitPrompts(
      makeVisit(),
      prefs([["u-1", null]]),
      minutesFromScheduled(-30)
    );
    const after = dueSiteVisitPrompts(
      makeVisit({ scheduledAt: rescheduledAt }),
      prefs([["u-1", null]]),
      new Date(rescheduledEpoch * 1000 - 30 * MINUTE_MS)
    );

    expect(before[0]?.dedupeKey).toBe(
      `site_visit:v-1:heads_up:u-1:${SCHEDULED_EPOCH}`
    );
    expect(after[0]?.dedupeKey).toBe(
      `site_visit:v-1:heads_up:u-1:${rescheduledEpoch}`
    );
    expect(before[0]?.dedupeKey).not.toBe(after[0]?.dedupeKey);
  });
});
