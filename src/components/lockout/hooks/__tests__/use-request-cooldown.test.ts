import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRequestCooldown } from "../use-request-cooldown";

describe("useRequestCooldown", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("returns isActive=false when no record exists", () => {
    const { result } = renderHook(() => useRequestCooldown("user-1"));
    expect(result.current.isActive).toBe(false);
  });

  it("returns isActive=true after setCooldown for the same user", () => {
    const { result } = renderHook(() => useRequestCooldown("user-1"));
    act(() => result.current.setCooldown("subscription_expired"));
    expect(result.current.isActive).toBe(true);
  });

  it("does NOT trigger cooldown across different userIds", () => {
    const a = renderHook(() => useRequestCooldown("user-1"));
    act(() => a.result.current.setCooldown("subscription_expired"));
    const b = renderHook(() => useRequestCooldown("user-2"));
    expect(b.result.current.isActive).toBe(false);
  });

  it("uses the storage key shape ops-lockout-request-${userId}", () => {
    const { result } = renderHook(() => useRequestCooldown("user-99"));
    act(() => result.current.setCooldown("unseated"));
    expect(localStorage.getItem("ops-lockout-request-user-99")).not.toBeNull();
  });

  it("expires after 24 hours (on next mount)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T10:00:00Z"));
    const first = renderHook(() => useRequestCooldown("user-1"));
    act(() => first.result.current.setCooldown("subscription_expired"));
    expect(first.result.current.isActive).toBe(true);
    first.unmount();

    // 24h + 1s later, a fresh mount sees the cooldown as expired.
    vi.setSystemTime(new Date("2026-05-08T10:00:01Z"));
    const second = renderHook(() => useRequestCooldown("user-1"));
    expect(second.result.current.isActive).toBe(false);
  });
});
