import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { KeyboardShortcuts } from "@/components/ops/keyboard-shortcuts";
import { useWindowStore } from "@/stores/window-store";

// Cmd+Shift+C repoint (create-entry consistency 2026-07-04). Only
// `next/navigation` is mocked — the window store is REAL, so these
// assertions pin the actual singleton contract (repeat opens refocus the
// same window, never duplicate) inside a unit test, exactly as production
// wires it. `router.push` is spied so we can prove the shortcut no longer
// hops through the /clients/new route.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Dispatch the real Cmd+Shift+C chord. `bubbles: true` so a press on a
// focused field still reaches the window-level listener (the guard has to
// catch it from there), matching how the browser propagates the event.
function pressCmdShiftC(target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "c",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  });
}

describe("<KeyboardShortcuts /> — Cmd+Shift+C", () => {
  beforeEach(() => {
    pushMock.mockClear();
    // Reset the real window store between tests (mirrors window-store.test.ts).
    useWindowStore.setState({ windows: [], nextZIndex: 2000 });
  });

  it("opens the client-workspace create window in place (no /clients/new hop)", () => {
    render(<KeyboardShortcuts />);
    pressCmdShiftC();

    const windows = useWindowStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0].id).toBe("client-workspace:new");
    expect(windows[0].type).toBe("client-workspace");
    expect(windows[0].meta).toEqual({
      clientId: null,
      initialMode: "creating",
    });
    // The whole point of the repoint: no route hop.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("refocuses the same window on a second press — singleton, never a duplicate", () => {
    render(<KeyboardShortcuts />);
    pressCmdShiftC();
    const firstZ = useWindowStore.getState().windows[0].zIndex;

    pressCmdShiftC();

    const windows = useWindowStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0].id).toBe("client-workspace:new");
    expect(windows[0].zIndex).toBeGreaterThan(firstZ);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does nothing while an editable element has focus (guard preserved)", () => {
    render(
      <>
        <input data-testid="field" />
        <KeyboardShortcuts />
      </>,
    );
    const input = screen.getByTestId("field");
    input.focus();

    pressCmdShiftC(input);

    expect(useWindowStore.getState().windows).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
