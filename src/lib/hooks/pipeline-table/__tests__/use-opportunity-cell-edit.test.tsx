import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpportunityStage } from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";

// useUpdateOpportunity calls OpportunityService.updateOpportunity (via the
// "@/lib/api/services" barrel). Mock just that method; the rest of the barrel
// is irrelevant to this hook.
const { updateOpportunity } = vi.hoisted(() => ({
  updateOpportunity: vi.fn(),
}));

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: { updateOpportunity },
}));

import {
  getRowEditValue,
  mapEditToUpdate,
  useOpportunityCellEdit,
} from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";

const baseRow: PipelineTableRow = {
  id: "opp-1",
  companyId: "co-1",
  title: "Deck rebuild",
  stage: "qualifying" as OpportunityStage,
  clientId: null,
  clientName: null,
  estimatedValue: 5000,
  winProbability: 20,
  weightedValue: 1000,
  ageInStageDays: 3,
  lastActivityAt: null,
  nextFollowUpAt: "2026-06-10T00:00:00.000Z",
  expectedCloseDate: "2026-07-01T00:00:00.000Z",
  assignedTo: "user-9",
  assignmentVersion: 3,
  assigneeName: "Sam",
  source: null,
  priority: null,
  correspondenceCount: 0,
  lastInboundAt: null,
  lastMessageDirection: null,
  handledAt: null,
  stageEnteredAt: null,
  projectId: null,
  updatedAt: "2026-06-01T00:00:00.000Z",
  staleThresholdDays: null,
  winProbabilityIsFallback: false,
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  updateOpportunity.mockReset();
});

// ─── Pure helper: mapEditToUpdate ──────────────────────────────────────────────

describe("mapEditToUpdate", () => {
  it("maps value → estimatedValue (number)", () => {
    expect(mapEditToUpdate("value", 12000)).toEqual({ estimatedValue: 12000 });
  });

  it("maps value → estimatedValue (null clears)", () => {
    expect(mapEditToUpdate("value", null)).toEqual({ estimatedValue: null });
  });

  it("coerces a numeric string value → estimatedValue number", () => {
    expect(mapEditToUpdate("value", "12000")).toEqual({
      estimatedValue: 12000,
    });
  });

  it("treats an empty/non-numeric value string as a clear", () => {
    expect(mapEditToUpdate("value", "")).toEqual({ estimatedValue: null });
    expect(mapEditToUpdate("value", "abc")).toEqual({ estimatedValue: null });
  });

  it("maps next_follow_up → nextFollowUpAt as a Date at the right instant", () => {
    const result = mapEditToUpdate("next_follow_up", "2026-06-15");
    expect(result.nextFollowUpAt).toBeInstanceOf(Date);
    expect((result.nextFollowUpAt as Date).getTime()).toBe(
      new Date("2026-06-15").getTime()
    );
  });

  it("maps next_follow_up → nextFollowUpAt null clears", () => {
    expect(mapEditToUpdate("next_follow_up", null)).toEqual({
      nextFollowUpAt: null,
    });
  });

  it("maps expected_close → expectedCloseDate as a Date at the right instant", () => {
    const result = mapEditToUpdate("expected_close", "2026-07-01");
    expect(result.expectedCloseDate).toBeInstanceOf(Date);
    expect((result.expectedCloseDate as Date).getTime()).toBe(
      new Date("2026-07-01").getTime()
    );
  });

  it("maps expected_close → expectedCloseDate null clears", () => {
    expect(mapEditToUpdate("expected_close", null)).toEqual({
      expectedCloseDate: null,
    });
  });

  it("treats an unparseable date string as a clear", () => {
    expect(mapEditToUpdate("next_follow_up", "not-a-date")).toEqual({
      nextFollowUpAt: null,
    });
  });

  it("maps client → clientId (string)", () => {
    expect(mapEditToUpdate("client", "client-42")).toEqual({
      clientId: "client-42",
    });
  });

  it("maps client → clientId (null unlinks)", () => {
    expect(mapEditToUpdate("client", null)).toEqual({ clientId: null });
  });

  it("treats an empty client string as an unlink", () => {
    expect(mapEditToUpdate("client", "")).toEqual({ clientId: null });
  });
});

// ─── Pure helper: getRowEditValue ──────────────────────────────────────────────

describe("getRowEditValue", () => {
  it("reads estimatedValue for value", () => {
    expect(getRowEditValue(baseRow, "value")).toBe(5000);
  });

  it("reads clientId for client", () => {
    expect(
      getRowEditValue({ ...baseRow, clientId: "client-7" }, "client")
    ).toBe("client-7");
    expect(getRowEditValue(baseRow, "client")).toBeNull();
  });

  it("reads the ISO string for next_follow_up", () => {
    expect(getRowEditValue(baseRow, "next_follow_up")).toBe(
      "2026-06-10T00:00:00.000Z"
    );
  });

  it("reads the ISO string for expected_close", () => {
    expect(getRowEditValue(baseRow, "expected_close")).toBe(
      "2026-07-01T00:00:00.000Z"
    );
  });

  it("round-trips a date value back through mapEditToUpdate", () => {
    const iso = getRowEditValue(baseRow, "next_follow_up");
    const update = mapEditToUpdate("next_follow_up", iso);
    expect(update.nextFollowUpAt).toBeInstanceOf(Date);
    expect((update.nextFollowUpAt as Date).toISOString()).toBe(
      "2026-06-10T00:00:00.000Z"
    );
  });
});

// ─── Hook: save-state transitions ──────────────────────────────────────────────

describe("useOpportunityCellEdit — save states", () => {
  it("transitions idle → saving → saved on a successful commit", async () => {
    let resolve: (value: unknown) => void = () => {};
    updateOpportunity.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        })
    );

    const { result } = renderHook(
      () => useOpportunityCellEdit({ rows: [baseRow] }),
      {
        wrapper: makeWrapper(),
      }
    );

    // idle: no entry
    expect(result.current.saveStates.get("opp-1:value")).toBeUndefined();

    let commit!: Promise<void>;
    act(() => {
      commit = result.current.commitEdit("opp-1", "value", 9000);
    });

    // saving while the mutation is in flight
    await waitFor(() =>
      expect(result.current.saveStates.get("opp-1:value")).toBe("saving")
    );

    await act(async () => {
      resolve({ id: "opp-1" });
      await commit;
    });

    // saved on resolve
    expect(result.current.saveStates.get("opp-1:value")).toBe("saved");
    expect(updateOpportunity).toHaveBeenCalledWith("opp-1", {
      estimatedValue: 9000,
    });
  });

  it("transitions to error when the mutation rejects", async () => {
    updateOpportunity.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(
      () => useOpportunityCellEdit({ rows: [baseRow] }),
      {
        wrapper: makeWrapper(),
      }
    );

    await act(async () => {
      await result.current.commitEdit("opp-1", "value", 9000);
    });

    expect(result.current.saveStates.get("opp-1:value")).toBe("error");
  });

  it("no-ops (idle, no mutation) when the value is unchanged", async () => {
    const { result } = renderHook(
      () => useOpportunityCellEdit({ rows: [baseRow] }),
      {
        wrapper: makeWrapper(),
      }
    );

    await act(async () => {
      await result.current.commitEdit("opp-1", "value", 5000);
    });

    expect(updateOpportunity).not.toHaveBeenCalled();
    expect(result.current.saveStates.get("opp-1:value")).toBeUndefined();
  });
});

// ─── Hook: undo ────────────────────────────────────────────────────────────────

describe("useOpportunityCellEdit — undo", () => {
  it("captures an undo entry on success and re-commits the prior value on undo", async () => {
    updateOpportunity.mockResolvedValue({ id: "opp-1" });

    // The hook reads the CURRENT value off `rows` to diff against. After a
    // successful save the real table re-renders with the freshly-fetched row,
    // so we model that by feeding the new value back in via rerender before
    // undoing — otherwise undo-to-old-value would (correctly) no-op against a
    // stale row that still shows the old value.
    const { result, rerender } = renderHook(
      ({ rows }: { rows: PipelineTableRow[] }) =>
        useOpportunityCellEdit({ rows }),
      { wrapper: makeWrapper(), initialProps: { rows: [baseRow] } }
    );

    await act(async () => {
      await result.current.commitEdit("opp-1", "value", 9000);
    });

    expect(result.current.latestUndo).not.toBeNull();
    expect(result.current.latestUndo?.before).toBe(5000);
    expect(result.current.latestUndo?.after).toBe(9000);
    expect(result.current.undoStack).toHaveLength(1);

    // Post-save row state now reflects the committed value.
    rerender({ rows: [{ ...baseRow, estimatedValue: 9000 }] });
    updateOpportunity.mockClear();

    await act(async () => {
      await result.current.undoLatest();
    });

    // undo re-commits the BEFORE value and pops the entry (does not push a new one)
    expect(updateOpportunity).toHaveBeenCalledWith("opp-1", {
      estimatedValue: 5000,
    });
    expect(result.current.undoStack).toHaveLength(0);
  });

  it("clearLatestUndo hides the visible-undo entry", async () => {
    updateOpportunity.mockResolvedValue({ id: "opp-1" });

    const { result } = renderHook(
      () => useOpportunityCellEdit({ rows: [baseRow] }),
      {
        wrapper: makeWrapper(),
      }
    );

    await act(async () => {
      await result.current.commitEdit("opp-1", "client", "client-42");
    });

    expect(result.current.latestUndo).not.toBeNull();

    act(() => {
      result.current.clearLatestUndo();
    });

    expect(result.current.latestUndo).toBeNull();
  });
});
