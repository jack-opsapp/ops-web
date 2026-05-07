import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewportBreakpoint } from "@/lib/hooks/use-viewport-breakpoint";

const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { value: w, writable: true, configurable: true });
};

beforeEach(() => {
  setWidth(1700);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useViewportBreakpoint", () => {
  it("returns 'wide' at >= 1600", () => {
    setWidth(1700);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe("wide");
  });

  it("returns 'comfortable' at 1280–1599", () => {
    setWidth(1400);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe("comfortable");
  });

  it("returns 'compact' at 768–1279", () => {
    setWidth(900);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe("compact");
  });

  it("returns 'mobile' below 768", () => {
    setWidth(640);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe("mobile");
  });

  it("updates when the window resizes", () => {
    setWidth(1700);
    const { result } = renderHook(() => useViewportBreakpoint());
    expect(result.current).toBe("wide");

    act(() => {
      setWidth(900);
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current).toBe("compact");
  });
});
