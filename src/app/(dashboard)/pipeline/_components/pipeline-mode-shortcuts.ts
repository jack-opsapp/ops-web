"use client";

import { useEffect } from "react";
import { usePipelineModeStore } from "./pipeline-mode-store";

export type PipelineModeShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "target" | "altKey" | "ctrlKey" | "metaKey" | "isComposing"
>;

function isTypingOrScopedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const editable = target.closest("[contenteditable]");
  if (
    editable instanceof HTMLElement &&
    editable.getAttribute("contenteditable") !== "false"
  ) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [data-keyboard-scope='modal-or-menu']"
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

export function usePipelineModeShortcut(isDragging: boolean, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (isDragging) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!shouldHandlePipelineModeShortcut(event, false)) return;

      event.preventDefault();
      usePipelineModeStore.getState().toggleMode();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, isDragging]);
}
