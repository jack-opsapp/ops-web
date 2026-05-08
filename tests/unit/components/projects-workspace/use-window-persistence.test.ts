/**
 * useWindowPersistence — localStorage round-trip for window pos+size.
 *
 * Smoke coverage:
 *   - reads `opsWin:<key>` once on mount and exposes the parsed snapshot
 *   - returns null when storage is empty or corrupt
 *   - skips the first write after mount (so it doesn't overwrite the
 *     loaded snapshot with itself on re-render)
 *   - debounces subsequent writes (200ms) so drag spam doesn't thrash
 *   - flushes the latest pending snapshot on unmount so the most recent
 *     state is durable even when the component tears down mid-debounce
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWindowPersistence } from "@/components/ops/projects/workspace/shell/use-window-persistence";

const BASE_PROPS = {
  key: "project-workspace:p_42",
  position: { x: 100, y: 80 },
  size: { width: 1080, height: 760 },
};

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWindowPersistence", () => {
  it("returns null loaded when localStorage is empty", () => {
    const { result } = renderHook(() => useWindowPersistence(BASE_PROPS));
    expect(result.current.loaded).toBeNull();
  });

  it("returns the parsed snapshot when localStorage has a valid entry", () => {
    window.localStorage.setItem(
      `opsWin:${BASE_PROPS.key}`,
      JSON.stringify({
        position: { x: 250, y: 150 },
        size: { width: 1100, height: 700 },
      }),
    );

    const { result } = renderHook(() => useWindowPersistence(BASE_PROPS));
    expect(result.current.loaded).toEqual({
      position: { x: 250, y: 150 },
      size: { width: 1100, height: 700 },
    });
  });

  it("returns null when the stored payload is malformed", () => {
    window.localStorage.setItem(`opsWin:${BASE_PROPS.key}`, "{not-json");
    const { result } = renderHook(() => useWindowPersistence(BASE_PROPS));
    expect(result.current.loaded).toBeNull();
  });

  it("returns null when the stored payload is missing required fields", () => {
    window.localStorage.setItem(
      `opsWin:${BASE_PROPS.key}`,
      JSON.stringify({ position: { x: 1 } }),
    );
    const { result } = renderHook(() => useWindowPersistence(BASE_PROPS));
    expect(result.current.loaded).toBeNull();
  });

  it("skips the first write on mount — does not clobber the loaded snapshot", () => {
    const setSpy = vi.spyOn(window.localStorage.__proto__, "setItem");
    renderHook(() => useWindowPersistence(BASE_PROPS));

    // Run timers — initial mount should NOT trigger setItem.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("writes (debounced 200ms) when position or size changes after mount", () => {
    const setSpy = vi.spyOn(window.localStorage.__proto__, "setItem");
    const { rerender } = renderHook((p: typeof BASE_PROPS) => useWindowPersistence(p), {
      initialProps: BASE_PROPS,
    });

    // Drain the initial mount effect.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    setSpy.mockClear();

    // Change position; advance < 200ms — write must not have fired yet.
    rerender({ ...BASE_PROPS, position: { x: 300, y: 200 } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(setSpy).not.toHaveBeenCalled();

    // Tick past the debounce — the write should have landed.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      `opsWin:${BASE_PROPS.key}`,
      JSON.stringify({
        position: { x: 300, y: 200 },
        size: BASE_PROPS.size,
      }),
    );

    setSpy.mockRestore();
  });

  it("flushes the latest pending snapshot on unmount even if the timer hasn't fired", () => {
    const setSpy = vi.spyOn(window.localStorage.__proto__, "setItem");
    const { rerender, unmount } = renderHook(
      (p: typeof BASE_PROPS) => useWindowPersistence(p),
      { initialProps: BASE_PROPS },
    );

    // Skip past the initial mount effect.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    setSpy.mockClear();

    rerender({ ...BASE_PROPS, position: { x: 999, y: 999 } });
    // Unmount BEFORE the 200ms debounce elapses — flush must still write.
    act(() => {
      vi.advanceTimersByTime(50);
    });

    unmount();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      `opsWin:${BASE_PROPS.key}`,
      JSON.stringify({
        position: { x: 999, y: 999 },
        size: BASE_PROPS.size,
      }),
    );

    setSpy.mockRestore();
  });
});
