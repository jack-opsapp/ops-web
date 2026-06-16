"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useScheduleStore } from "@/stores/schedule-store";
import { useUpdateTask } from "@/lib/hooks";

/**
 * InlineEditor — renders an absolutely-positioned input overlaying a task block
 * when `inlineEdit` state is set in the Zustand store.
 *
 * T18 — portal-rendered to document.body so it escapes any parent
 * `overflow:hidden` clipping (calendar cells, side-panels, etc).
 * Z-layer: var(--z-floating-ui) (1500) — above the dropdown layer
 * because it's a focused editing affordance.
 *
 * Supports:
 *  - Enter → save
 *  - Escape → cancel
 *  - Tab   → save and close
 *  - Click outside → cancel
 */
export function InlineEditor() {
  const { inlineEdit, setInlineEdit } = useScheduleStore();
  const updateMutation = useUpdateTask();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const originalValueRef = useRef("");

  // Find the task element and position the input over it
  useEffect(() => {
    if (!inlineEdit) {
      setRect(null);
      return;
    }

    const el = document.querySelector(
      `[data-task-id="${inlineEdit.taskId}"]`
    ) as HTMLElement | null;

    if (!el) {
      // If we can't find the element, bail out
      setInlineEdit(null);
      return;
    }

    const domRect = el.getBoundingClientRect();
    setRect(domRect);

    // Pre-fill with the current value from the DOM. The unified card mapping
    // (T8) renders the primary title in a Cake Mono Light or Mohave element
    // depending on view; we accept either. Falls back to the data attr title.
    const titleEl =
      el.querySelector(".font-cakemono") ||
      el.querySelector(".font-mohave");
    const currentValue = titleEl?.textContent?.trim() ?? "";
    setValue(currentValue);
    originalValueRef.current = currentValue;
  }, [inlineEdit, setInlineEdit]);

  // Auto-focus when the input becomes visible
  useEffect(() => {
    if (rect && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [rect]);

  const handleSave = useCallback(() => {
    if (!inlineEdit) return;

    const trimmed = value.trim();
    // Only save if the value actually changed and is non-empty
    if (trimmed && trimmed !== originalValueRef.current) {
      // Map field names: "title" on the inline edit maps to "customTitle" on the task
      const fieldName = inlineEdit.field === "title" ? "customTitle" : inlineEdit.field;
      updateMutation.mutate({
        id: inlineEdit.taskId,
        data: { [fieldName]: trimmed },
      });
    }

    setInlineEdit(null);
  }, [inlineEdit, value, updateMutation, setInlineEdit]);

  const handleCancel = useCallback(() => {
    setInlineEdit(null);
  }, [setInlineEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "Enter":
          e.preventDefault();
          handleSave();
          break;
        case "Escape":
          e.preventDefault();
          handleCancel();
          break;
        case "Tab":
          e.preventDefault();
          // Currently only title is editable inline. Save and close on Tab.
          handleSave();
          break;
      }
    },
    [handleSave, handleCancel]
  );

  // Click outside → cancel
  useEffect(() => {
    if (!inlineEdit) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        // Save on click-outside (same behavior as blur)
        handleCancel();
      }
    }

    // Use a small delay to avoid the click that opened the editor from immediately closing it
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [inlineEdit, handleCancel]);

  if (!inlineEdit || !rect) return null;
  if (typeof document === "undefined") return null;

  // Portal to document.body so we escape any parent overflow:hidden clipping.
  return createPortal(
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleSave}
      className="z-floating-ui outline-none"
      style={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        background: "var(--surface-input)",
        border: "1.5px solid var(--ops-accent)",
        borderRadius: 4,
        color: "var(--text)",
        fontFamily: "var(--font-cakemono), var(--font-mohave), sans-serif",
        fontWeight: 300,
        fontSize: 13,
        padding: "0 8px",
        // Match the task block's internal padding (3px left stripe + 8px padding)
        paddingLeft: 11,
        textTransform: "uppercase",
        letterSpacing: 0,
      }}
    />,
    document.body
  );
}
