"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellTextProps {
  value: string;
  canEdit: boolean;
  onCommit: (value: string) => void;
}

export function SpreadsheetCellText({ value, canEdit, onCommit }: SpreadsheetCellTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onCommit(trimmed);
    }
  }, [draft, value, onCommit]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
  }, [value]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
          if (e.key === "Tab") { e.preventDefault(); commit(); }
        }}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(89,119,148,0.3)] rounded-sm font-mohave text-body-sm text-text focus:outline-none"
      />
    );
  }

  return (
    <span
      className={`truncate block ${canEdit ? "cursor-text" : ""}`}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {value || "—"}
    </span>
  );
}
