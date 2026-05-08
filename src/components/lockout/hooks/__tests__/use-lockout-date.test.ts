import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLockoutDate } from "../use-lockout-date";
import { SubscriptionPlan } from "@/lib/types/models";

describe("useLockoutDate", () => {
  it("returns null when company is null", () => {
    const { result } = renderHook(() => useLockoutDate(null));
    expect(result.current).toBeNull();
  });

  it("returns trialEndDate when plan is Trial", () => {
    const date = new Date("2026-04-30T00:00:00Z");
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Trial,
        trialEndDate: date,
        subscriptionEnd: null,
      })
    );
    expect(result.current?.toISOString()).toBe(date.toISOString());
  });

  it("returns subscriptionEnd when plan is paid (Team)", () => {
    const subEnd = new Date("2026-05-01T00:00:00Z");
    const trialEnd = new Date("2026-04-30T00:00:00Z");
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Team,
        trialEndDate: trialEnd,
        subscriptionEnd: subEnd,
      })
    );
    expect(result.current?.toISOString()).toBe(subEnd.toISOString());
  });

  it("falls back to trialEndDate on paid plan when subscriptionEnd is null", () => {
    const trialEnd = new Date("2026-04-30T00:00:00Z");
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Business,
        trialEndDate: trialEnd,
        subscriptionEnd: null,
      })
    );
    expect(result.current?.toISOString()).toBe(trialEnd.toISOString());
  });

  it("returns null when both dates are null", () => {
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Team,
        trialEndDate: null,
        subscriptionEnd: null,
      })
    );
    expect(result.current).toBeNull();
  });

  it("parses string dates that come from JSON deserialization", () => {
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Trial,
        trialEndDate: "2026-04-30T00:00:00.000Z" as unknown as Date,
        subscriptionEnd: null,
      })
    );
    expect(result.current?.toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  it("returns null when date is invalid", () => {
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Trial,
        trialEndDate: "not-a-date" as unknown as Date,
        subscriptionEnd: null,
      })
    );
    expect(result.current).toBeNull();
  });
});
