import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useTableSelection(visibleRowIds: string[], resetKey?: string) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);
  const resetKeyRef = useRef(resetKey);

  const visibleSet = useMemo(() => new Set(visibleRowIds), [visibleRowIds]);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    lastSelectedRef.current = null;
    setSelectedIds(new Set());
  }, [resetKey]);

  useEffect(() => {
    if (lastSelectedRef.current && !visibleSet.has(lastSelectedRef.current)) {
      lastSelectedRef.current = null;
    }
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleSet.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleSet]);

  const clearSelection = useCallback(() => {
    lastSelectedRef.current = null;
    setSelectedIds(new Set());
  }, []);

  const selectAllVisible = useCallback(() => {
    lastSelectedRef.current = visibleRowIds.at(-1) ?? null;
    setSelectedIds(new Set(visibleRowIds));
  }, [visibleRowIds]);

  const toggleRow = useCallback(
    (rowId: string, mode: "single" | "toggle" | "range") => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (mode === "range" && lastSelectedRef.current) {
          const start = visibleRowIds.indexOf(lastSelectedRef.current);
          const end = visibleRowIds.indexOf(rowId);
          if (start !== -1 && end !== -1) {
            const [from, to] = start < end ? [start, end] : [end, start];
            for (let i = from; i <= to; i += 1) next.add(visibleRowIds[i]);
          }
        } else if (mode === "toggle") {
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          lastSelectedRef.current = rowId;
        } else {
          next.clear();
          next.add(rowId);
          lastSelectedRef.current = rowId;
        }
        return next;
      });
    },
    [visibleRowIds],
  );

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    toggleRow,
    clearSelection,
    selectAllVisible,
  };
}
