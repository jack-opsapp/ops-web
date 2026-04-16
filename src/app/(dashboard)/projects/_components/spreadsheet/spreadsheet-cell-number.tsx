"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellNumberProps {
  value: number | null;
  suffix?: string;
  canEdit: boolean;
  onCommit: (value: number | null) => void;
}

export function SpreadsheetCellNumber({ value, suffix = "", canEdit, onCommit }: SpreadsheetCellNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => { setDraft(String(value ?? "")); }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = draft.trim() === "" ? null : parseInt(draft, 10);
    if (parsed !== value && (!isNaN(parsed as number) || parsed === null)) {
      onCommit(parsed);
    }
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setEditing(false); setDraft(String(value ?? "")); }
        }}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(89,119,148,0.3)] rounded-sm font-mono text-data-sm text-text focus:outline-none"
      />
    );
  }

  return (
    <span
      className={`font-mono text-data-sm ${canEdit ? "cursor-text" : ""}`}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {value != null ? `${value}${suffix}` : "—"}
    </span>
  );
}
