import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { ScheduleStrip } from "@/components/ops/projects/workspace/viewing/schedule-strip";
import { ProjectStatus } from "@/lib/types/models";

// Pure UI atom — pulse glow is opacity-only and gated by status === InProgress
// AND !prefers-reduced-motion. We mock useReducedMotion to false at the top so
// the happy path (glow renders) is testable; the !reducedMotion branch is
// trivial boolean math and well-covered by the framer-motion library itself.

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

// Use LOCAL-midnight Dates so the display + math don't drift across timezones
// when the test runs (UTC midnight in PT = previous day, which we don't want).
const TODAY = new Date(2026, 4, 7); // May 7, 2026 (month index 4 = May)
const START = new Date(2026, 4, 1); // May 1
const END = new Date(2026, 4, 15); // May 15

describe("<ScheduleStrip>", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders both start and end dates in tactical mono", () => {
    render(<ScheduleStrip startDate={START} endDate={END} status={ProjectStatus.Accepted} />);
    expect(screen.getByText("MAY 1")).toBeInTheDocument();
    expect(screen.getByText("MAY 15")).toBeInTheDocument();
  });

  it("renders an em-dash placeholder when start or end is missing", () => {
    render(<ScheduleStrip startDate={null} endDate={null} status={ProjectStatus.RFQ} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("places the today-tick proportionally between start and end", () => {
    render(<ScheduleStrip startDate={START} endDate={END} status={ProjectStatus.Accepted} />);
    const tick = screen.getByTestId("schedule-strip-tick") as HTMLElement;
    // 6 elapsed days / 14 total days ≈ 42.86%
    expect(tick.style.left).toMatch(/^4[0-9]\.\d+%$/);
  });

  it("omits the tick when today is before start", () => {
    vi.setSystemTime(new Date(2026, 3, 15));
    render(<ScheduleStrip startDate={START} endDate={END} status={ProjectStatus.Accepted} />);
    expect(screen.queryByTestId("schedule-strip-tick")).not.toBeInTheDocument();
  });

  it("omits the tick when today is after end", () => {
    vi.setSystemTime(new Date(2026, 5, 1));
    render(<ScheduleStrip startDate={START} endDate={END} status={ProjectStatus.Completed} />);
    expect(screen.queryByTestId("schedule-strip-tick")).not.toBeInTheDocument();
  });

  it("renders the today-tick glow ONLY when status is InProgress", () => {
    render(<ScheduleStrip startDate={START} endDate={END} status={ProjectStatus.InProgress} />);
    expect(screen.getByTestId("schedule-strip-glow")).toBeInTheDocument();
    expect(
      screen.getByTestId("schedule-strip").getAttribute("data-glow"),
    ).toBe("true");
  });

  it("suppresses the glow when status is Accepted (not InProgress)", () => {
    render(<ScheduleStrip startDate={START} endDate={END} status={ProjectStatus.Accepted} />);
    expect(screen.queryByTestId("schedule-strip-glow")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("schedule-strip").getAttribute("data-glow"),
    ).toBe("false");
  });

  it("uses the InProgress status hex on the tick (jsdom rgb form)", () => {
    render(<ScheduleStrip startDate={START} endDate={END} status={ProjectStatus.InProgress} />);
    const tick = screen.getByTestId("schedule-strip-tick") as HTMLElement;
    // jsdom normalises #D99A3E → rgb(217, 154, 62)
    expect(tick.style.background.toLowerCase()).toMatch(
      /(#d99a3e|rgb\(217,\s*154,\s*62\))/,
    );
  });
});
