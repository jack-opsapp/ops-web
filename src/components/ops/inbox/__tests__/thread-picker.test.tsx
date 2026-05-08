import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (must be hoisted before importing the component) ─────────────────

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    prefetch: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_k: string, fallback?: string) => fallback ?? _k,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

import { ThreadPicker, type ThreadPickerThread } from "../thread-picker";
import type { StateTagResult } from "@/lib/inbox/format-wait";

const stateYours: StateTagResult = {
  kind: "yours",
  tone: "accent",
  prefix: "YOURS",
  value: "18H",
  alarmStrip: false,
};

const stateTheirs: StateTagResult = {
  kind: "theirs",
  tone: "neutral",
  prefix: "THEIRS",
  value: "2D",
  alarmStrip: false,
};

const stateFyi: StateTagResult = {
  kind: "fyi",
  tone: "neutral",
  prefix: "FYI",
  alarmStrip: false,
};

function makeThread(
  id: string,
  subject: string,
  state: StateTagResult,
  unread = false,
): ThreadPickerThread {
  return { id, subject, unread, state };
}

beforeEach(() => {
  push.mockReset();
});

describe("<ThreadPicker>", () => {
  it("renders the trigger with the count and JetBrains Mono uppercase styling when threads exist", () => {
    const threads = [
      makeThread("t1", "Quote follow-up", stateYours),
      makeThread("t2", "Inspection rescheduling", stateTheirs),
      makeThread("t3", "Final invoice", stateFyi),
    ];
    render(
      <ThreadPicker
        threads={threads}
        currentThreadId="current"
        clientName="ACME"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /3 other threads/i,
    });
    expect(trigger).toBeInTheDocument();
    // JetBrains Mono uppercase trigger label
    expect(trigger.className).toMatch(/font-mono/);
    expect(trigger.className).toMatch(/uppercase/);
    // Hairline border on active trigger
    expect(trigger.className).toMatch(/\bborder\b/);
    // The visible label text (after the chevron) shows the count
    expect(trigger).toHaveTextContent(/3 OTHER THREADS/);
  });

  it("renders the disabled mute label and no button when threads is empty", () => {
    render(
      <ThreadPicker
        threads={[]}
        currentThreadId="current"
        clientName="ACME"
      />,
    );

    expect(screen.getByText("· 0 OTHER THREADS")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("clicking the trigger opens the popover and renders rows + the slash header", async () => {
    const user = userEvent.setup();
    const threads = [
      makeThread("t1", "Quote follow-up", stateYours),
      makeThread("t2", "Inspection rescheduling", stateTheirs),
    ];
    render(
      <ThreadPicker
        threads={threads}
        currentThreadId="current"
        clientName="ACME"
      />,
    );

    await user.click(screen.getByRole("button", { name: /2 other threads/i }));

    expect(screen.getByText("Quote follow-up")).toBeInTheDocument();
    expect(screen.getByText("Inspection rescheduling")).toBeInTheDocument();
    expect(
      screen.getByText("// THREADS WITH ACME · 2"),
    ).toBeInTheDocument();
  });

  it("highlights a row whose id matches currentThreadId with the accent tint (defensive case)", async () => {
    const user = userEvent.setup();
    // Defensive: hook should normally exclude current thread, but if it appears
    // we still tint it and disable the click.
    const threads = [
      makeThread("current", "This very thread", stateYours),
      makeThread("t2", "Another thread", stateTheirs),
    ];
    render(
      <ThreadPicker
        threads={threads}
        currentThreadId="current"
        clientName="ACME"
      />,
    );

    await user.click(screen.getByRole("button", { name: /2 other threads/i }));

    const currentRow = screen.getByText("This very thread").closest("[data-thread-row]");
    expect(currentRow).not.toBeNull();
    // Accent tint marker class on the row container
    expect((currentRow as HTMLElement).className).toMatch(/bg-ops-accent\/\[0\.08\]/);

    // Clicking the current-thread row should NOT push (it has no onClick)
    await user.click(currentRow as HTMLElement);
    expect(push).not.toHaveBeenCalled();
  });

  it("clicking a non-current row pushes the router and closes the popover", async () => {
    const user = userEvent.setup();
    const threads = [
      makeThread("t1", "Quote follow-up", stateYours),
      makeThread("t2", "Inspection rescheduling", stateTheirs),
    ];
    render(
      <ThreadPicker
        threads={threads}
        currentThreadId="current"
        clientName="ACME"
      />,
    );

    await user.click(screen.getByRole("button", { name: /2 other threads/i }));
    expect(screen.getByText("Quote follow-up")).toBeInTheDocument();

    const row = screen.getByRole("button", { name: "Quote follow-up" });
    await user.click(row);

    expect(push).toHaveBeenCalledWith("/inbox/t1");
    // Popover closed → header text no longer in DOM
    expect(
      screen.queryByText("// THREADS WITH ACME · 2"),
    ).not.toBeInTheDocument();
  });
});
