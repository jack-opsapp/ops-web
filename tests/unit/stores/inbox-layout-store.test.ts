import { describe, it, expect, beforeEach } from "vitest";
import {
  useInboxLayoutStore,
  DEFAULT_INBOX_LAYOUT,
  migrateInboxLayoutState,
} from "@/stores/inbox-layout-store";

beforeEach(() => {
  // Reset only the data fields, not the action references.
  useInboxLayoutStore.setState({ ...DEFAULT_INBOX_LAYOUT });
});

describe("inbox-layout-store", () => {
  it("hydrates with the default layout", () => {
    const s = useInboxLayoutStore.getState();
    expect(s.leftPct).toBe(DEFAULT_INBOX_LAYOUT.leftPct);
    expect(s.rightPct).toBe(DEFAULT_INBOX_LAYOUT.rightPct);
    expect(s.rightRailOpen).toBe(true);
    expect(s.defaultRailFilter).toBe("CLIENTS");
  });

  it("setLayout updates left/right percentages", () => {
    useInboxLayoutStore.getState().setLayout({ leftPct: 25, rightPct: 24 });
    const s = useInboxLayoutStore.getState();
    expect(s.leftPct).toBe(25);
    expect(s.rightPct).toBe(24);
  });

  it("toggleRightRail flips rightRailOpen", () => {
    expect(useInboxLayoutStore.getState().rightRailOpen).toBe(true);
    useInboxLayoutStore.getState().toggleRightRail();
    expect(useInboxLayoutStore.getState().rightRailOpen).toBe(false);
    useInboxLayoutStore.getState().toggleRightRail();
    expect(useInboxLayoutStore.getState().rightRailOpen).toBe(true);
  });

  it("resetLayout returns to defaults", () => {
    useInboxLayoutStore.getState().setLayout({ leftPct: 28, rightPct: 24 });
    useInboxLayoutStore.getState().setDefaultRailFilter("EVERYTHING_ELSE");
    useInboxLayoutStore.getState().resetLayout();
    const s = useInboxLayoutStore.getState();
    expect(s.leftPct).toBe(DEFAULT_INBOX_LAYOUT.leftPct);
    expect(s.rightPct).toBe(DEFAULT_INBOX_LAYOUT.rightPct);
    expect(s.defaultRailFilter).toBe("CLIENTS");
  });

  it("clamps leftPct to [20, 30]", () => {
    useInboxLayoutStore.getState().setLayout({ leftPct: 10, rightPct: 22 });
    expect(useInboxLayoutStore.getState().leftPct).toBe(20);
    useInboxLayoutStore.getState().setLayout({ leftPct: 50, rightPct: 22 });
    expect(useInboxLayoutStore.getState().leftPct).toBe(30);
  });

  it("clamps rightPct to [20, 28]", () => {
    useInboxLayoutStore.getState().setLayout({ leftPct: 22, rightPct: 5 });
    expect(useInboxLayoutStore.getState().rightPct).toBe(20);
    useInboxLayoutStore.getState().setLayout({ leftPct: 22, rightPct: 50 });
    expect(useInboxLayoutStore.getState().rightPct).toBe(28);
  });

  it("persists the default primary rail filter", () => {
    useInboxLayoutStore.getState().setDefaultRailFilter("EVERYTHING_ELSE");
    expect(useInboxLayoutStore.getState().defaultRailFilter).toBe(
      "EVERYTHING_ELSE",
    );
    useInboxLayoutStore.getState().setDefaultRailFilter("ALL");
    expect(useInboxLayoutStore.getState().defaultRailFilter).toBe("ALL");
  });

  it("migrates v1 layout preferences without discarding panel state", () => {
    expect(
      migrateInboxLayoutState({
        leftPct: 27,
        rightPct: 24,
        rightRailOpen: false,
      }),
    ).toEqual({
      leftPct: 27,
      rightPct: 24,
      rightRailOpen: false,
      defaultRailFilter: "CLIENTS",
    });
  });

  it("sanitizes invalid migrated values", () => {
    expect(
      migrateInboxLayoutState({
        leftPct: 99,
        rightPct: 3,
        rightRailOpen: "closed",
        defaultRailFilter: "YOUR_MOVE",
      }),
    ).toEqual({
      leftPct: 30,
      rightPct: 20,
      rightRailOpen: true,
      defaultRailFilter: "CLIENTS",
    });
  });
});
