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
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        target.closest("[contenteditable]")
      ) {
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
        "3": "/calendar",
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
