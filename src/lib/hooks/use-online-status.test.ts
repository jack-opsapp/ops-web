import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "./use-online-status";

afterEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("useOnlineStatus", () => {
  it("reports the initial navigator.onLine value", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it("updates to false on an offline event", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });

  it("updates to true on an online event", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { result } = renderHook(() => useOnlineStatus());
    act(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });
});
