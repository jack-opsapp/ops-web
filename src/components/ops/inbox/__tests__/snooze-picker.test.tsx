import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const snoozeMutate = vi.fn();
const unsnoozeMutate = vi.fn();
const enqueueMock = vi.fn();

vi.mock("@/lib/hooks/use-inbox-threads", () => ({
  useThreadActions: () => ({
    snooze: { mutate: snoozeMutate },
    unsnooze: { mutate: unsnoozeMutate },
  }),
}));

vi.mock("../undo-toast", () => ({
  enqueueUndoToast: (input: unknown) => enqueueMock(input),
}));

import { SnoozePicker } from "../snooze-picker";

describe("<SnoozePicker>", () => {
  beforeEach(() => {
    snoozeMutate.mockReset();
    unsnoozeMutate.mockReset();
    enqueueMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the // SNOOZE slash title and instructional body", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T10:00:00")); // weekday morning
    render(
      <SnoozePicker threadId="t-1" trigger={<button>Snooze</button>} open={true} />,
    );
    expect(screen.getByText("// SNOOZE")).toBeInTheDocument();
    expect(
      screen.getByText(/hide until · returns to inbox automatically/i),
    ).toBeInTheDocument();
  });

  it("renders preset rows in bracketed JetBrains Mono uppercase form", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T10:00:00"));
    render(
      <SnoozePicker threadId="t-1" trigger={<button>Snooze</button>} open={true} />,
    );
    expect(screen.getByText("[LATER TODAY]")).toBeInTheDocument();
    expect(screen.getByText("[TOMORROW 8AM]")).toBeInTheDocument();
    expect(screen.getByText("[WEEKEND]")).toBeInTheDocument();
    expect(screen.getByText("[NEXT MON]")).toBeInTheDocument();
    expect(screen.getByText("[NEXT MONTH]")).toBeInTheDocument();
  });

  it("hides the [LATER TODAY] preset when current time is past 18:00", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T19:30:00")); // 7:30pm
    render(
      <SnoozePicker threadId="t-1" trigger={<button>Snooze</button>} open={true} />,
    );
    expect(screen.queryByText("[LATER TODAY]")).toBeNull();
    // tomorrow still shows
    expect(screen.getByText("[TOMORROW 8AM]")).toBeInTheDocument();
  });

  it("hides the [WEEKEND] preset when today is Saturday", () => {
    vi.useFakeTimers();
    // 2026-05-09 is a Saturday
    vi.setSystemTime(new Date("2026-05-09T10:00:00"));
    render(
      <SnoozePicker threadId="t-1" trigger={<button>Snooze</button>} open={true} />,
    );
    expect(screen.queryByText("[WEEKEND]")).toBeNull();
  });

  it("renders the custom datetime row with 'pick a date and time…'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T10:00:00"));
    render(
      <SnoozePicker threadId="t-1" trigger={<button>Snooze</button>} open={true} />,
    );
    expect(screen.getByText(/pick a date and time/i)).toBeInTheDocument();
  });

  it("clicking a preset commits via useThreadActions().snooze.mutate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T10:00:00"));
    render(
      <SnoozePicker threadId="t-1" trigger={<button>Snooze</button>} open={true} />,
    );
    fireEvent.click(screen.getByText("[TOMORROW 8AM]"));
    expect(snoozeMutate).toHaveBeenCalledTimes(1);
    const arg = snoozeMutate.mock.calls[0][0] as { threadId: string; until: Date };
    expect(arg.threadId).toBe("t-1");
    expect(arg.until).toBeInstanceOf(Date);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });
});
