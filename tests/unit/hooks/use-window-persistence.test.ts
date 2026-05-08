import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useWindowPersistence } from "@/components/ops/projects/workspace/shell/use-window-persistence";

// `useWindowPersistence` — localStorage round-trip for window pos+size.
//
// On mount: reads `opsWin:<key>` and returns the parsed snapshot to the
// caller, or null if absent / corrupt.
// On change: writes the new snapshot back, debounced 200ms so dragging
// 60+ frames in a second doesn't spam localStorage.
// CRITICAL: skips the FIRST write after mount so we don't immediately
// overwrite the loaded snapshot with the same value (the original
// handoff comment notes this stalled main-thread when 20+ windows
// were open).

const KEY = "test-project-J-4821";
const STORAGE_KEY = `opsWin:${KEY}`;

describe("useWindowPersistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("returns null when storage is empty", () => {
    const { result } = renderHook(() =>
      useWindowPersistence({
        key: KEY,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
      }),
    );
    expect(result.current.loaded).toBeNull();
  });

  it("hydrates from existing snapshot on mount", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ position: { x: 200, y: 100 }, size: { width: 800, height: 600 } }),
    );
    const { result } = renderHook(() =>
      useWindowPersistence({
        key: KEY,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
      }),
    );
    expect(result.current.loaded).toEqual({
      position: { x: 200, y: 100 },
      size: { width: 800, height: 600 },
    });
  });

  it("returns null when the stored value is corrupt JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not-valid-json");
    const { result } = renderHook(() =>
      useWindowPersistence({
        key: KEY,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
      }),
    );
    expect(result.current.loaded).toBeNull();
  });

  it("does NOT write on the first mount (skip-initial guarantee)", () => {
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    renderHook(() =>
      useWindowPersistence({
        key: KEY,
        position: { x: 100, y: 50 },
        size: { width: 800, height: 600 },
      }),
    );
    // Before any debounce window elapses…
    expect(setSpy).not.toHaveBeenCalled();
    // …and after the debounce window flushes — still no write.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("writes on the second render with new position (debounced 200ms)", () => {
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const initialProps = {
      key: KEY,
      position: { x: 100, y: 50 },
      size: { width: 800, height: 600 },
    };
    const { rerender } = renderHook((p) => useWindowPersistence(p), {
      initialProps,
    });
    rerender({ ...initialProps, position: { x: 200, y: 100 } });

    // Just before 200ms — no write yet.
    act(() => vi.advanceTimersByTime(199));
    expect(setSpy).not.toHaveBeenCalled();

    // After the debounce — write fires once with the latest snapshot.
    act(() => vi.advanceTimersByTime(2));
    expect(setSpy).toHaveBeenCalledOnce();
    expect(setSpy.mock.calls[0][0]).toBe(STORAGE_KEY);
    expect(JSON.parse(setSpy.mock.calls[0][1])).toEqual({
      position: { x: 200, y: 100 },
      size: { width: 800, height: 600 },
    });
  });

  it("debounces rapid position changes — only the last value is written", () => {
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const initialProps = {
      key: KEY,
      position: { x: 100, y: 50 },
      size: { width: 800, height: 600 },
    };
    const { rerender } = renderHook((p) => useWindowPersistence(p), { initialProps });

    // Three changes in quick succession (mimics drag frames).
    rerender({ ...initialProps, position: { x: 110, y: 50 } });
    act(() => vi.advanceTimersByTime(50));
    rerender({ ...initialProps, position: { x: 120, y: 50 } });
    act(() => vi.advanceTimersByTime(50));
    rerender({ ...initialProps, position: { x: 130, y: 50 } });

    // No write yet (timer keeps resetting).
    expect(setSpy).not.toHaveBeenCalled();

    // Flush the debounce — exactly one write with the LAST value.
    act(() => vi.advanceTimersByTime(250));
    expect(setSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(setSpy.mock.calls[0][1])).toEqual({
      position: { x: 130, y: 50 },
      size: { width: 800, height: 600 },
    });
  });

  it("writes when size changes too (not just position)", () => {
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const initialProps = {
      key: KEY,
      position: { x: 100, y: 50 },
      size: { width: 800, height: 600 },
    };
    const { rerender } = renderHook((p) => useWindowPersistence(p), { initialProps });
    rerender({ ...initialProps, size: { width: 900, height: 700 } });
    act(() => vi.advanceTimersByTime(250));
    expect(setSpy).toHaveBeenCalledOnce();
  });

  it("flushes the pending write on unmount", () => {
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const initialProps = {
      key: KEY,
      position: { x: 100, y: 50 },
      size: { width: 800, height: 600 },
    };
    const { rerender, unmount } = renderHook((p) => useWindowPersistence(p), {
      initialProps,
    });
    rerender({ ...initialProps, position: { x: 200, y: 100 } });
    // Unmount before debounce flushes.
    unmount();
    expect(setSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(setSpy.mock.calls[0][1])).toEqual({
      position: { x: 200, y: 100 },
      size: { width: 800, height: 600 },
    });
  });
});
