"use client";

import { useEffect } from "react";
import { usePipelineModeStore } from "./pipeline-mode-store";

export type PipelineModeShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "target" | "altKey" | "ctrlKey" | "metaKey" | "isComposing"
>;

function isTypingOrScopedTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;

  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable='true'], [data-keyboard-scope='modal-or-menu']"
    )
  );
}

export function shouldHandlePipelineModeShortcut(
  event: PipelineModeShortcutEvent,
  isDragging: boolean
): boolean {
  if (isDragging) return false;
  if (event.isComposing) return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.key.toLowerCase() !== "v") return false;
  if (isTypingOrScopedTarget(event.target)) return false;

  return true;
}

export function usePipelineModeShortcut(isDragging: boolean) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!shouldHandlePipelineModeShortcut(event, isDragging)) return;

      event.preventDefault();
      usePipelineModeStore.getState().toggleMode();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDragging]);
}
