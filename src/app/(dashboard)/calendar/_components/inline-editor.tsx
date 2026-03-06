"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useCalendarStore } from "@/stores/calendar-store";
import { useUpdateCalendarEvent } from "@/lib/hooks";

/**
 * InlineEditor — renders an absolutely-positioned input overlaying a task block
 * when `inlineEdit` state is set in the Zustand store.
 *
 * Supports:
 *  - Enter → save
 *  - Escape → cancel
 *  - Tab → cycle field (title → close, since notes is not yet a model field)
 *  - Click outside → cancel
 */
export function InlineEditor() {
  const { inlineEdit, setInlineEdit } = useCalendarStore();
  const updateMutation = useUpdateCalendarEvent();
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

    // Pre-fill with the current value from the DOM (title text)
    const titleEl = el.querySelector(".font-mohave.font-semibold");
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
      updateMutation.mutate({
        id: inlineEdit.taskId,
        data: { [inlineEdit.field]: trimmed },
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
          // Currently only title is editable (no notes field on CalendarEvent).
          // Close the editor on Tab.
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

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleSave}
      className="fixed z-[100] outline-none"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        background: "transparent",
        border: "1px solid rgba(89, 119, 148, 0.5)",
        borderRadius: 3,
        color: "#FFFFFF",
        fontFamily: "var(--font-mohave), sans-serif",
        fontWeight: 600,
        fontSize: 11,
        padding: "0 8px",
        // Match the task block's internal padding (3px left stripe + 8px padding)
        paddingLeft: 11,
      }}
    />
  );
}
