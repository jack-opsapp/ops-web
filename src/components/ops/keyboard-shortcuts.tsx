"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getNumberShortcutRoutes } from "@/lib/navigation/route-registry";

/**
 * Global keyboard shortcuts handler.
 * Mounts once in the dashboard layout to handle all shortcuts.
 *
 * Number keys 1-9: Navigate to main sections
 * Cmd+Shift+P: New project
 * Cmd+Shift+C: New client
 * Cmd+B: Toggle sidebar
 * Cmd+K: Command palette (handled by CommandPalette component)
 * ?: Show keyboard shortcuts help
 */
export function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function isEditableElement(node: Element | null | undefined): boolean {
      if (!node) return false;
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        return true;
      }
      if (node instanceof HTMLElement && node.isContentEditable) {
        return true;
      }
      // Tag-name fallback for cases where instanceof fails (e.g. cross-realm
      // events dispatched from portals, iframes, or libraries that re-host the
      // node). Also covers select elements and standard form controls.
      const tag = node.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return true;
      }
      // Walk up looking for a contenteditable ancestor.
      if (node instanceof HTMLElement && node.closest("[contenteditable='true'], [contenteditable='']")) {
        return true;
      }
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture if user is typing in an input — check both the event
      // target AND the document's active element. The active-element fallback
      // catches cases where keystrokes are dispatched after a focus/blur race
      // or where the event target is the body/window rather than the field
      // itself (observed when a controlled textarea re-renders mid-keystroke).
      const target = e.target as Element | null;
      if (isEditableElement(target) || isEditableElement(document.activeElement)) {
        return;
      }

      // Cmd/Ctrl + Shift shortcuts
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "p":
            e.preventDefault();
            router.push("/projects/new");
            return;
          case "c":
            e.preventDefault();
            router.push("/clients/new");
            return;
        }
      }

      // The legacy Cmd/Ctrl+B sidebar toggle is gone — the instrument rail
      // is fixed-width and never expands (WEB OVERHAUL P2 variant B), so
      // there is nothing to toggle.

      // Skip if any modifier is pressed (for number shortcuts)
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      // Number key navigation — derived from the route registry's nav
      // order so the map can never drift from the sidebar or palette.
      const routes = getNumberShortcutRoutes();

      if (routes[e.key]) {
        e.preventDefault();
        router.push(routes[e.key]);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return null;
}
