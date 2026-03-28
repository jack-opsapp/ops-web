"use client";

import { useEffect } from "react";
import {
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
} from "date-fns";
import { useCalendarStore } from "@/stores/calendar-store";
import { useDeleteTask, useUpdateTask } from "@/lib/hooks";

/**
 * Keyboard shortcuts hook for the scheduler.
 *
 * Navigation:
 *   T          → Timeline view
 *   M          → Month view
 *   D          → Day view
 *   ← / →     → prev/next period (timeline = week, month = month, day = day)
 *   Ctrl+T / Home → jump to today
 *
 * Task actions (when selectedTaskId is set):
 *   E          → open in side panel
 *   Enter      → inline edit mode (title)
 *   Delete/Backspace → delete with confirmation
 *   ]          → push +1 day
 *   Shift+]    → push +1 day with cascade (placeholder — same as regular push for now)
 *   [          → pull -1 day
 *
 * Multi-select / panels:
 *   Escape     → clear selection + close side panel
 *
 * Other:
 *   F          → toggle filter panel
 *   /          → focus search (placeholder)
 *   Ctrl+A     → auto-schedule (placeholder)
 */
export function useSchedulerShortcuts() {
  const deleteMutation = useDeleteTask();
  const updateMutation = useUpdateTask();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip if typing in inputs / textareas / contenteditable
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      const state = useCalendarStore.getState();
      const { view, selectedTaskId, inlineEdit } = state;

      // While inline-editing, only allow Escape through
      if (inlineEdit && e.key !== "Escape") return;

      const key = e.key;
      const keyLower = key.toLowerCase();
      const hasCtrl = e.ctrlKey || e.metaKey;

      // ── Escape — always available ─────────────────────────────────────
      if (key === "Escape") {
        state.clearSelection();
        state.closeSidePanel();
        if (inlineEdit) state.setInlineEdit(null);
        return;
      }

      // ── Ctrl+T / Home → jump to today ─────────────────────────────────
      if ((hasCtrl && keyLower === "t") || key === "Home") {
        e.preventDefault();
        state.goToToday();
        return;
      }

      // ── Ctrl+A → auto-schedule (placeholder) ─────────────────────────
      if (hasCtrl && keyLower === "a") {
        e.preventDefault();
        // eslint-disable-next-line no-console
        console.log("[scheduler] auto-schedule triggered (not yet implemented)");
        return;
      }

      // ── Skip single-letter shortcuts when Ctrl/Cmd held ───────────────
      // (except the explicit combos above which already returned)
      if (hasCtrl) return;

      // ── Arrow navigation ──────────────────────────────────────────────
      if (key === "ArrowLeft") {
        e.preventDefault();
        const d = state.currentDate;
        if (view === "month") state.setCurrentDate(subMonths(d, 1));
        else if (view === "timeline") state.setCurrentDate(subWeeks(d, 1));
        else state.setCurrentDate(subDays(d, 1));
        return;
      }

      if (key === "ArrowRight") {
        e.preventDefault();
        const d = state.currentDate;
        if (view === "month") state.setCurrentDate(addMonths(d, 1));
        else if (view === "timeline") state.setCurrentDate(addWeeks(d, 1));
        else state.setCurrentDate(addDays(d, 1));
        return;
      }

      // ── View switching ────────────────────────────────────────────────
      if (keyLower === "t") {
        state.setView("timeline");
        return;
      }
      if (keyLower === "m") {
        state.setView("month");
        return;
      }
      if (keyLower === "d") {
        state.setView("day");
        return;
      }

      // ── Filter toggle ─────────────────────────────────────────────────
      if (keyLower === "f") {
        state.toggleFilterSidebar();
        return;
      }

      // ── Search focus (placeholder) ────────────────────────────────────
      if (key === "/") {
        e.preventDefault();
        // eslint-disable-next-line no-console
        console.log("[scheduler] search focus triggered (not yet implemented)");
        return;
      }

      // ── Task-specific shortcuts (require selectedTaskId) ──────────────
      if (!selectedTaskId) return;

      // E → open in side panel
      if (keyLower === "e") {
        state.setSidePanelTask(selectedTaskId);
        return;
      }

      // Enter → inline edit mode
      if (key === "Enter") {
        e.preventDefault();
        state.setInlineEdit({ taskId: selectedTaskId, field: "title" });
        return;
      }

      // Delete / Backspace → delete with confirmation
      if (key === "Delete" || key === "Backspace") {
        e.preventDefault();
        const confirmed = window.confirm(
          "Are you sure you want to delete this task?"
        );
        if (confirmed) {
          deleteMutation.mutate({ id: selectedTaskId });
          state.closeSidePanel();
          state.clearSelection();
        }
        return;
      }

      // ] → push +1 day  |  Shift+] → push +1 day with cascade
      if (key === "]" || key === "}") {
        e.preventDefault();
        // Shift+] produces "}" on most keyboards, so both are handled
        // For now cascade push does the same as regular push
        pushTask(selectedTaskId, 1, updateMutation);
        return;
      }

      // [ → pull -1 day
      if (key === "[") {
        e.preventDefault();
        pushTask(selectedTaskId, -1, updateMutation);
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteMutation, updateMutation]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Push/pull a task's dates by `daysDelta` days.
 * Fetches current event from the query cache isn't possible here,
 * so we rely on the update mutation with relative date shifts.
 */
function pushTask(
  taskId: string,
  daysDelta: number,
  updateMutation: ReturnType<typeof useUpdateTask>
) {
  // Fetch current task dates, compute new ones, then mutate.
  import("@/lib/api/services").then(({ TaskService }) => {
    TaskService.fetchTask(taskId).then((task) => {
      if (!task?.startDate || !task?.endDate) return;

      const newStart = daysDelta > 0
        ? addDays(new Date(task.startDate), daysDelta)
        : subDays(new Date(task.startDate), Math.abs(daysDelta));

      const newEnd = daysDelta > 0
        ? addDays(new Date(task.endDate), daysDelta)
        : subDays(new Date(task.endDate), Math.abs(daysDelta));

      updateMutation.mutate({
        id: taskId,
        data: {
          startDate: newStart,
          endDate: newEnd,
        },
      });
    });
  });
}
