"use client";

import { useEffect } from "react";

/**
 * Pure helper: given a flat ordered list of thread ids and the currently
 * selected one, return the prev/next ids (null when at edges).
 *
 * Exported for unit testing — does not require React.
 */
export function getNextPrevThreadIds(
  orderedIds: readonly string[],
  currentId: string | null,
): { prevId: string | null; nextId: string | null } {
  if (!currentId || orderedIds.length === 0) {
    return { prevId: null, nextId: null };
  }
  const i = orderedIds.indexOf(currentId);
  if (i === -1) return { prevId: null, nextId: null };
  return {
    prevId: i > 0 ? orderedIds[i - 1] : null,
    nextId: i < orderedIds.length - 1 ? orderedIds[i + 1] : null,
  };
}

/**
 * Resolve flat ordered ids by walking groups in canonical order. Used by the
 * routing layer to compute prev/next from the same grouping the list
 * renders, so navigation matches what the user sees.
 */
export function flattenGroupedIds<T extends { id: string }>(
  groupKeys: readonly string[],
  groups: Map<string, T[]>,
): string[] {
  const out: string[] = [];
  for (const key of groupKeys) {
    const items = groups.get(key) ?? [];
    for (const item of items) out.push(item.id);
  }
  return out;
}

interface UseThreadKeyboardOptions {
  onPrev?: () => void;
  onNext?: () => void;
  /** Cmd+K — typically opens the command palette. */
  onCommandPalette?: () => void;
  /** Skip when the user is typing in an input/textarea/contenteditable. */
  skipInTyping?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Wires window-level keyboard shortcuts for the inbox detail surface.
 *   J → onNext
 *   K → onPrev
 *   ⌘K / Ctrl+K → onCommandPalette
 *
 * Suppressed inside text inputs / textareas / contenteditable when
 * skipInTyping is true (default).
 */
export function useThreadKeyboard({
  onPrev,
  onNext,
  onCommandPalette,
  skipInTyping = true,
}: UseThreadKeyboardOptions) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && (e.key === "k" || e.key === "K")) {
        if (onCommandPalette) {
          e.preventDefault();
          onCommandPalette();
        }
        return;
      }

      if (cmd || e.altKey) return;
      if (skipInTyping && isTypingTarget(e.target)) return;

      if (e.key === "j" || e.key === "J") {
        if (onNext) {
          e.preventDefault();
          onNext();
        }
      } else if (e.key === "k" || e.key === "K") {
        if (onPrev) {
          e.preventDefault();
          onPrev();
        }
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onPrev, onNext, onCommandPalette, skipInTyping]);
}
