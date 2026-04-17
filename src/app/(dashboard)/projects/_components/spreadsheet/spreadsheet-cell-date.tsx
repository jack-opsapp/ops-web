"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellDateProps {
  value: Date | null;
  canEdit: boolean;
  onCommit: (value: Date | null) => void;
}

function formatDisplayDate(date: Date | null): string {
  if (!date) return "—";
  const now = new Date();
  const d = new Date(date);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  if (d.getFullYear() !== now.getFullYear()) {
    return `${month} ${day} '${String(d.getFullYear()).slice(2)}`;
  }
  return `${month} ${day}`;
}

function toInputValue(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

export function SpreadsheetCellDate({ value, canEdit, onCommit }: SpreadsheetCellDateProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback((inputValue: string) => {
    setEditing(false);
    const newDate = inputValue ? new Date(inputValue + "T00:00:00") : null;
    const oldStr = toInputValue(value);
    if (inputValue !== oldStr) {
      onCommit(newDate);
    }
  }, [value, onCommit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        defaultValue={toInputValue(value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setEditing(false); }
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(111, 148, 176,0.3)] rounded-sm font-mono text-data-sm text-text focus:outline-none [color-scheme:dark]"
      />
    );
  }

  return (
    <span
      className={`font-mono text-data-sm ${canEdit ? "cursor-text" : ""}`}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {formatDisplayDate(value)}
    </span>
  );
}
