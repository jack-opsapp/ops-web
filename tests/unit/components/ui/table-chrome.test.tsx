import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TableChrome } from "@/components/ui/table-shell";

let notifyResize: ResizeObserverCallback;
const observeResize = vi.fn();
const disconnectResize = vi.fn();

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    notifyResize = callback;
  }

  observe = observeResize;
  unobserve() {}
  disconnect = disconnectResize;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TableChrome", () => {
  it("publishes the exact toolbar border-box height for sticky header positioning", () => {
    const { unmount } = render(
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <TableChrome toolbar={<div data-testid="toolbar-content" />} />
      </div>
    );

    const scroller = screen.getByTestId("scroller");
    const toolbar = screen.getByTestId("toolbar-content").parentElement;
    expect(toolbar).not.toBeNull();

    Object.defineProperty(toolbar, "offsetHeight", {
      configurable: true,
      value: 45,
    });
    toolbar!.getBoundingClientRect = () =>
      ({
        bottom: 45.5,
        height: 45.5,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) satisfies DOMRect;

    expect(observeResize).toHaveBeenCalledOnce();
    expect(observeResize).toHaveBeenCalledWith(toolbar);

    act(() => {
      notifyResize([], {} as ResizeObserver);
    });

    expect(scroller.style.getPropertyValue("--shell-header-top")).toBe(
      "45.5px"
    );

    unmount();
    expect(disconnectResize).toHaveBeenCalledOnce();
    expect(scroller.style.getPropertyValue("--shell-header-top")).toBe("");
  });
});
