"use client";

/**
 * Inline-editable table cells — the load-bearing interactions of the Catalog
 * flows: count/receive (QTY) and price-book upkeep (COST/PRICE/MARGIN).
 *
 * Editing state is PARENT-controlled (the segment knows which cell is active)
 * so committing one cell can advance focus to the next down the column —
 * spreadsheet-style. The cell stays presentational + local-draft only.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  fmtQty,
  fmtMoneyPrecise,
  parseQtyInput,
  parseMoneyInput,
} from "./format";

const STATUS_QTY_CLASS: Record<string, string> = {
  critical: "text-rose",
  warning: "text-tan",
  untracked: "text-text-3",
  normal: "text-text",
};

// ─── Quantity cell (set-to or signed delta) ────────────────────────────────────

export function InlineQtyCell({
  value,
  unit,
  status,
  editing,
  editable,
  onRequestEdit,
  onCommit,
  onCancel,
}: {
  value: number;
  unit: string | null;
  status: string;
  editing: boolean;
  editable: boolean;
  onRequestEdit: () => void;
  /** mode "delta" for +/- input, "set" for an absolute count. */
  onCommit: (result: { mode: "set" | "delta"; value: number }) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (editing) {
      setDraft("");
      // focus + select on next frame
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const parsed = parseQtyInput(draft);
            if (parsed) onCommit(parsed);
            else onCancel();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          const parsed = parseQtyInput(draft);
          if (parsed) onCommit(parsed);
          else onCancel();
        }}
        placeholder={fmtQty(value)}
        inputMode="numeric"
        className={cn(
          "w-[68px] rounded-[5px] border border-line-hi bg-surface-input",
          "px-2 py-[3px] text-right font-mono text-[13px] text-text tabular-nums",
          "focus:outline-none",
        )}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onRequestEdit}
      title={editable ? "Click to count or +/- receive" : undefined}
      className={cn(
        "inline-flex items-baseline gap-[3px] rounded-[4px] px-1 font-mono text-[13px] tabular-nums",
        STATUS_QTY_CLASS[status] ?? "text-text",
        editable &&
          "cursor-text border-b border-dashed border-fill-neutral hover:bg-surface-hover",
      )}
    >
      {fmtQty(value)}
      {unit && (
        <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-text-3">
          {unit}
        </span>
      )}
    </button>
  );
}

// ─── Money cell (cost / price) ─────────────────────────────────────────────────

export function InlineMoneyCell({
  value,
  editing,
  editable,
  dim,
  emptyTone,
  onRequestEdit,
  onCommit,
  onCancel,
}: {
  value: number | null;
  editing: boolean;
  editable: boolean;
  /** Render the resting value in text-3 (cost column). */
  dim?: boolean;
  /** When value is null, tint the `—` rose (a NO-COST nudge). */
  emptyTone?: "rose" | "default";
  onRequestEdit: () => void;
  onCommit: (value: number | null) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (editing) {
      setDraft(value != null ? String(value) : "");
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [editing, value]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(parseMoneyInput(draft));
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit(parseMoneyInput(draft))}
        inputMode="decimal"
        className={cn(
          "w-[72px] rounded-[5px] border border-line-hi bg-surface-input",
          "px-2 py-[3px] text-right font-mono text-[13px] text-text tabular-nums",
          "focus:outline-none",
        )}
      />
    );
  }

  const isEmpty = value == null;
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onRequestEdit}
      className={cn(
        "rounded-[4px] px-1 font-mono text-[13px] tabular-nums",
        isEmpty
          ? emptyTone === "rose"
            ? "text-rose"
            : "text-text-3"
          : dim
            ? "text-text-3"
            : "text-text",
        editable &&
          "cursor-text border-b border-dashed border-fill-neutral hover:bg-surface-hover",
      )}
    >
      {fmtMoneyPrecise(value)}
    </button>
  );
}
