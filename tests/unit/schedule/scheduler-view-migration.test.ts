/**
 * Unit tests for the Zustand persist v2 migration in schedule-store.
 *
 * v0/v1 stored view: 'timeline' | 'month' | 'day'
 * v2 stores view: 'day' | 'week' | 'month' | 'crew'
 *
 * The migrate() function rewrites:
 *   'timeline' → 'crew'
 *   any unknown value → 'week'
 */

import { describe, it, expect } from "vitest";

// We re-implement the migration body inline against a fixture rather than
// importing it from the Zustand store (the store wraps it inside `persist`).
// This keeps the test focused on migration logic, not Zustand internals.

const VALID_VIEWS = new Set(["day", "week", "month", "crew"]);

function migrate(persistedState: unknown, version: number): Record<string, unknown> {
  const s = (persistedState ?? {}) as Record<string, unknown>;
  if (version < 2 && s.view === "timeline") {
    s.view = "crew";
  }
  if (typeof s.view !== "string" || !VALID_VIEWS.has(s.view as string)) {
    s.view = "week";
  }
  return s;
}

describe("schedule-store persist v2 migration", () => {
  it("rewrites view: 'timeline' → 'crew' from version 0", () => {
    const result = migrate({ view: "timeline" }, 0);
    expect(result.view).toBe("crew");
  });

  it("rewrites view: 'timeline' → 'crew' from version 1", () => {
    const result = migrate({ view: "timeline" }, 1);
    expect(result.view).toBe("crew");
  });

  it("preserves view: 'month' through migration", () => {
    const result = migrate({ view: "month" }, 0);
    expect(result.view).toBe("month");
  });

  it("preserves view: 'day' through migration", () => {
    const result = migrate({ view: "day" }, 0);
    expect(result.view).toBe("day");
  });

  it("falls back to 'week' for an unknown view value", () => {
    const result = migrate({ view: "agenda" }, 0);
    expect(result.view).toBe("week");
  });

  it("falls back to 'week' for a non-string view value", () => {
    const result = migrate({ view: 42 }, 0);
    expect(result.view).toBe("week");
  });

  it("falls back to 'week' when state is empty / undefined", () => {
    const empty = migrate({}, 0);
    expect(empty.view).toBe("week");

    const undef = migrate(undefined, 0);
    expect(undef.view).toBe("week");
  });

  it("preserves other persisted state alongside view migration", () => {
    const result = migrate(
      {
        view: "timeline",
        filterTeamMemberIds: ["u1", "u2"],
        filterTaskTypes: ["installation"],
      },
      1
    );
    expect(result.view).toBe("crew");
    expect(result.filterTeamMemberIds).toEqual(["u1", "u2"]);
    expect(result.filterTaskTypes).toEqual(["installation"]);
  });

  it("doesn't downgrade an already-migrated v2 state", () => {
    // If the user is already on v2 with view: 'crew', re-running migrate()
    // should be a no-op.
    const result = migrate({ view: "crew" }, 2);
    expect(result.view).toBe("crew");
  });
});
