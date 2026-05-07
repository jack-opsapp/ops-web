import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import {
  effectiveRailMode,
  type ViewportBreakpoint,
} from "../responsive-inbox-shell";

const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { value: w, writable: true, configurable: true });
};

beforeEach(() => {
  setWidth(1700);
});

describe("effectiveRailMode", () => {
  it("returns 'docked' on wide when user prefers open", () => {
    expect(effectiveRailMode("wide", true)).toBe("docked");
  });

  it("returns 'hidden' on wide when user toggled closed", () => {
    expect(effectiveRailMode("wide", false)).toBe("hidden");
  });

  it("returns 'hidden' on comfortable by default — user must toggle", () => {
    expect(effectiveRailMode("comfortable", false)).toBe("hidden");
    expect(effectiveRailMode("comfortable", true)).toBe("docked");
  });

  it("returns 'overlay' on compact when user opens it", () => {
    expect(effectiveRailMode("compact", true)).toBe("overlay");
    expect(effectiveRailMode("compact", false)).toBe("hidden");
  });

  it("returns 'mobile' on mobile regardless", () => {
    expect(effectiveRailMode("mobile" as ViewportBreakpoint, true)).toBe("mobile");
    expect(effectiveRailMode("mobile" as ViewportBreakpoint, false)).toBe("mobile");
  });
});

describe("<ResponsiveInboxShell>", () => {
  it("renders the desktop shell at wide widths", async () => {
    setWidth(1700);
    const { ResponsiveInboxShell } = await import("../responsive-inbox-shell");
    render(
      <ResponsiveInboxShell
        threadId="t1"
        threadList={<div data-testid="list" />}
        detail={<div data-testid="detail" />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.getByTestId("list")).toBeInTheDocument();
    expect(screen.getByTestId("detail")).toBeInTheDocument();
  });

  it("renders the mobile stacked shell at <768", async () => {
    setWidth(640);
    const { ResponsiveInboxShell } = await import("../responsive-inbox-shell");
    render(
      <ResponsiveInboxShell
        threadId="t1"
        mobilePane="list"
        onMobilePaneChange={() => {}}
        threadList={<div data-testid="list" />}
        detail={<div data-testid="detail" />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.getByTestId("list")).toBeInTheDocument();
    expect(screen.queryByTestId("detail")).not.toBeInTheDocument();
  });
});
