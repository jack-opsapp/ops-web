"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSidebarStore } from "@/stores/sidebar-store";

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

      // Cmd/Ctrl shortcuts (no shift)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key.toLowerCase() === "b") {
          e.preventDefault();
          const state = useSidebarStore.getState();
          state.setHoverExpanded(!state.isHoverExpanded);
          return;
        }
      }

      // Skip if any modifier is pressed (for number shortcuts)
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      // Number key navigation
      const routes: Record<string, string> = {
        "1": "/dashboard",
        "2": "/projects",
        "3": "/schedule",
        "4": "/clients",
        "5": "/team",
        "6": "/map",
        "7": "/pipeline",
        "8": "/invoices",
      };

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
