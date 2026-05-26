import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";

describe("useTableSelection", () => {
  it("selects a single row", () => {
    const { result } = renderHook(() => useTableSelection(["a", "b", "c"]));
    act(() => result.current.toggleRow("b", "single"));
    expect([...result.current.selectedIds]).toEqual(["b"]);
  });

  it("toggles a row without clearing other rows", () => {
    const { result } = renderHook(() => useTableSelection(["a", "b", "c"]));
    act(() => result.current.toggleRow("a", "single"));
    act(() => result.current.toggleRow("c", "toggle"));
    expect([...result.current.selectedIds].sort()).toEqual(["a", "c"]);
  });

  it("selects a range from the last anchor", () => {
    const { result } = renderHook(() => useTableSelection(["a", "b", "c", "d"]));
    act(() => result.current.toggleRow("a", "single"));
    act(() => result.current.toggleRow("c", "range"));
    expect([...result.current.selectedIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("prunes selection when visible row ids change", () => {
    const { result, rerender } = renderHook(({ ids }) => useTableSelection(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });
    act(() => result.current.toggleRow("b", "single"));
    rerender({ ids: ["a", "c"] });
    expect([...result.current.selectedIds]).toEqual([]);
  });

  it("resets a stale range anchor when visible row ids change", () => {
    const { result, rerender } = renderHook(({ ids }) => useTableSelection(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });

    act(() => result.current.toggleRow("b", "single"));
    rerender({ ids: ["a", "c"] });
    act(() => result.current.toggleRow("c", "range"));

    expect([...result.current.selectedIds]).toEqual(["c"]);
  });
});
