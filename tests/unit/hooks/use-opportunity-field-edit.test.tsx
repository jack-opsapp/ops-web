import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  buildOpportunityFieldUpdate,
  useOpportunityFieldEdit,
} from "@/lib/hooks/use-opportunity-field-edit";

// Mock the underlying optimistic mutation — this hook composes on top of it.
const mutateAsync = vi.fn();
vi.mock("@/lib/hooks/use-opportunities", () => ({
  useUpdateOpportunity: () => ({ mutateAsync }),
}));

describe("buildOpportunityFieldUpdate", () => {
  it("maps estimatedValue, coercing blank/NaN to null", () => {
    expect(buildOpportunityFieldUpdate("estimatedValue", "1500")).toEqual({
      estimatedValue: 1500,
    });
    expect(buildOpportunityFieldUpdate("estimatedValue", 1200)).toEqual({
      estimatedValue: 1200,
    });
    expect(buildOpportunityFieldUpdate("estimatedValue", "")).toEqual({
      estimatedValue: null,
    });
    expect(buildOpportunityFieldUpdate("estimatedValue", "abc")).toEqual({
      estimatedValue: null,
    });
    expect(buildOpportunityFieldUpdate("estimatedValue", null)).toEqual({
      estimatedValue: null,
    });
  });

  it("maps source / priority enum values and null", () => {
    expect(buildOpportunityFieldUpdate("source", "referral")).toEqual({
      source: "referral",
    });
    expect(buildOpportunityFieldUpdate("source", null)).toEqual({
      source: null,
    });
    expect(buildOpportunityFieldUpdate("priority", "high")).toEqual({
      priority: "high",
    });
    expect(buildOpportunityFieldUpdate("priority", null)).toEqual({
      priority: null,
    });
  });

  it("maps assignedTo, trimming blank to null", () => {
    expect(buildOpportunityFieldUpdate("assignedTo", "user-1")).toEqual({
      assignedTo: "user-1",
    });
    expect(buildOpportunityFieldUpdate("assignedTo", "   ")).toEqual({
      assignedTo: null,
    });
  });

  it("maps expectedCloseDate from ISO string, Date, and null", () => {
    const iso = "2026-06-18T00:00:00.000Z";
    const fromIso = buildOpportunityFieldUpdate("expectedCloseDate", iso);
    expect(fromIso.expectedCloseDate).toBeInstanceOf(Date);
    expect((fromIso.expectedCloseDate as Date).toISOString()).toBe(iso);
    expect(buildOpportunityFieldUpdate("expectedCloseDate", null)).toEqual({
      expectedCloseDate: null,
    });
    expect(
      buildOpportunityFieldUpdate("expectedCloseDate", "not-a-date")
    ).toEqual({ expectedCloseDate: null });
  });

  it("maps description, trimming blank to null", () => {
    expect(buildOpportunityFieldUpdate("description", "Re-roof, 24sq")).toEqual({
      description: "Re-roof, 24sq",
    });
    expect(buildOpportunityFieldUpdate("description", "")).toEqual({
      description: null,
    });
  });

  it("maps tags, trimming and filtering empties; non-arrays → []", () => {
    expect(buildOpportunityFieldUpdate("tags", ["a", "", " b "])).toEqual({
      tags: ["a", "b"],
    });
    expect(buildOpportunityFieldUpdate("tags", "nope")).toEqual({ tags: [] });
  });

  it("maps address as an {address, latitude, longitude} triple", () => {
    expect(
      buildOpportunityFieldUpdate("address", {
        address: "142 Elgin St",
        latitude: 45.42,
        longitude: -75.69,
      })
    ).toEqual({ address: "142 Elgin St", latitude: 45.42, longitude: -75.69 });
    expect(buildOpportunityFieldUpdate("address", {})).toEqual({
      address: null,
      latitude: null,
      longitude: null,
    });
  });
});

describe("useOpportunityFieldEdit", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it("commits a mapped update and transitions saving → saved", async () => {
    mutateAsync.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOpportunityFieldEdit("opp-1"));

    expect(result.current.saveState("estimatedValue")).toBe("idle");

    await act(async () => {
      await result.current.commit("estimatedValue", "1500");
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "opp-1",
      data: { estimatedValue: 1500 },
    });
    expect(result.current.saveState("estimatedValue")).toBe("saved");
  });

  it("sets the error state when the mutation rejects", async () => {
    mutateAsync.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useOpportunityFieldEdit("opp-1"));

    await act(async () => {
      await result.current.commit("source", "referral");
    });

    expect(result.current.saveState("source")).toBe("error");
  });
});
