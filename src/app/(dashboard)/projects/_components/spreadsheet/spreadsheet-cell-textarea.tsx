"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellTextareaProps {
  value: string | null;
  canEdit: boolean;
  onCommit: (value: string | null) => void;
}

export function SpreadsheetCellTextarea({ value, canEdit, onCommit }: SpreadsheetCellTextareaProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  useEffect(() => { setDraft(value ?? ""); }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    const newVal = trimmed || null;
    if (newVal !== (value ?? null)) {
      onCommit(newVal);
    }
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setEditing(false); setDraft(value ?? ""); }
        }}
        rows={3}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(89,119,148,0.3)] rounded-sm font-mohave text-body-sm text-text-primary focus:outline-none resize-none"
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
