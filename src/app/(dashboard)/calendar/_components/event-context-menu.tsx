"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Pencil,
  Copy,
  Trash2,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import { addDays, nextMonday, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import {
  useCreateTask,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/hooks";
import { useCascade } from "@/lib/hooks/use-cascade";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  type InternalCalendarEvent,
} from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EventContextMenuProps {
  event: InternalCalendarEvent | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  /** All visible events — needed for cascade calculation */
  allEvents?: InternalCalendarEvent[];
}

type MenuItemId =
  | "edit"
  | "push-1-day"
  | "push-1-day-cascade"
  | "push-next-week"
  | "duplicate"
  | "delete";

// Items in order — used for keyboard navigation.
const MENU_ITEMS: MenuItemId[] = [
  "edit",
  "push-1-day",
  "push-1-day-cascade",
  "push-next-week",
  "duplicate",
  "delete",
];

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * T16 — Portal-rendered context menu via Radix Popover with a virtual anchor.
 *
 * Why portal: the menu must escape the calendar cell's `overflow:hidden`
 * (load-bearing for the drop indicator and hover border on day cells).
 *
 * Anchor strategy: we render a 0×0 invisible div positioned at {x, y} and
 * use it as <Popover.Anchor>'s child. This lets us keep the existing
 * position-based API while letting Radix handle focus, escape, click-away,
 * and portal lifecycle.
 *
 * Z-layer: `z-dropdown` (1000) per spec v2.
 * Surface: glass-dense (popovers stack above panels).
 */
export function EventContextMenu({
  event,
  position,
  onClose,
  allEvents = [],
}: EventContextMenuProps) {
  const { company } = useAuthStore();
  const { setSidePanelTask } = useCalendarStore();
  const deleteMutation = useDeleteTask();
  const duplicateMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const { previewCascade } = useCascade();
  const [focusedIndex, setFocusedIndex] = useState(0);

  const open = !!event && !!position;

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleEdit = useCallback(() => {
    if (!event) return;
    setSidePanelTask(event.id);
    onClose();
  }, [event, setSidePanelTask, onClose]);

  const handlePush1Day = useCallback(() => {
    if (!event) return;
    const durationDays = differenceInCalendarDays(event.endDate, event.startDate);
    const newStart = addDays(event.startDate, 1);
    const newEnd = addDays(newStart, durationDays);

    updateMutation.mutate(
      { id: event.id, data: { startDate: newStart, endDate: newEnd } },
      {
        onSuccess: () => {
          toast.success("Pushed +1 day");
          onClose();
        },
        onError: (err) => {
          toast.error("Failed to push", { description: err.message });
        },
      }
    );
  }, [event, updateMutation, onClose]);

  const handlePush1DayCascade = useCallback(() => {
    if (!event) return;
    const durationDays = differenceInCalendarDays(event.endDate, event.startDate);
    const newStart = addDays(event.startDate, 1);
    const newEnd = addDays(newStart, durationDays);

    const schedulableTasks = allEvents.map((e) => ({
      id: e.id,
      taskTypeId: e.taskType,
      startDate: e.startDate,
      endDate: e.endDate,
      duration: differenceInCalendarDays(e.endDate, e.startDate),
      effectiveDependencies: [],
      displayOrder: 0,
      teamMemberIds: e.teamMemberIds,
    }));

    updateMutation.mutate(
      { id: event.id, data: { startDate: newStart, endDate: newEnd } },
      {
        onSuccess: () => {
          previewCascade(event.id, newStart, newEnd, schedulableTasks, false);
          toast.success("Pushed +1 day (cascade preview shown)");
          onClose();
        },
        onError: (err) => {
          toast.error("Failed to push", { description: err.message });
        },
      }
    );
  }, [event, allEvents, updateMutation, previewCascade, onClose]);

  const handlePushNextWeek = useCallback(() => {
    if (!event) return;
    const durationDays = differenceInCalendarDays(event.endDate, event.startDate);
    const newStart = nextMonday(event.startDate);
    const newEnd = addDays(newStart, durationDays);

    updateMutation.mutate(
      { id: event.id, data: { startDate: newStart, endDate: newEnd } },
      {
        onSuccess: () => {
          toast.success("Pushed to next Monday");
          onClose();
        },
        onError: (err) => {
          toast.error("Failed to push", { description: err.message });
        },
      }
    );
  }, [event, updateMutation, onClose]);

  const handleDuplicate = useCallback(() => {
    if (!event || !company?.id) return;

    duplicateMutation.mutate(
      {
        customTitle: `${event.title} (Copy)`,
        projectId: event.projectId ?? "",
        companyId: company.id,
        taskTypeId: event.taskType || "",
        startDate: event.startDate,
        endDate: event.endDate,
        taskColor: event.color,
        teamMemberIds: event.teamMemberIds,
      },
      {
        onSuccess: () => {
          toast.success("Task duplicated");
          onClose();
        },
        onError: (err) => {
          toast.error("Failed to duplicate", { description: err.message });
        },
      }
    );
  }, [event, company?.id, duplicateMutation, onClose]);

  const handleDelete = useCallback(() => {
    if (!event) return;
    deleteMutation.mutate(
      { id: event.id },
      {
        onSuccess: () => {
          toast.success("Task deleted");
          onClose();
        },
        onError: (err) => {
          toast.error("Failed to delete", { description: err.message });
        },
      }
    );
  }, [event, deleteMutation, onClose]);

  const actions: Record<MenuItemId, () => void> = {
    edit: handleEdit,
    "push-1-day": handlePush1Day,
    "push-1-day-cascade": handlePush1DayCascade,
    "push-next-week": handlePushNextWeek,
    duplicate: handleDuplicate,
    delete: handleDelete,
  };

  // ── Reset focus on open ──
  useEffect(() => {
    if (open) setFocusedIndex(0);
  }, [open]);

  // ── Keyboard navigation (arrow + enter inside the open popover) ──
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % MENU_ITEMS.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex(
            (prev) => (prev - 1 + MENU_ITEMS.length) % MENU_ITEMS.length
          );
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          actions[MENU_ITEMS[focusedIndex]]();
          break;
        // Escape handled by Radix DismissableLayer.
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, focusedIndex, actions]);

  if (!open) return null;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Virtual anchor: 0×0 invisible div at the click coordinates.
          Radix anchors the floating Content to this. */}
      <Popover.Anchor
        style={{
          position: "fixed",
          top: position.y,
          left: position.x,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      />

      <Popover.Portal>
        <Popover.Content
          className="z-dropdown"
          sideOffset={6}
          align="start"
          aria-label={`Actions for ${event.title}`}
          // Prevent the trigger element from auto-focusing — there's no real
          // trigger here, just a virtual anchor.
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{
            minWidth: 220,
            maxWidth: 260,
            padding: "4px",
            background: "var(--glass-bg-dense)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid var(--glass-border)",
            borderRadius: 12,
            outline: "none",
          }}
        >
          {/* Event title header */}
          <div
            className="px-2 py-1.5"
            style={{
              borderBottom: "1px solid var(--line)",
              marginBottom: 4,
            }}
          >
            <div className="flex items-center gap-[6px]">
              <div
                className="w-[8px] h-[8px] shrink-0"
                style={{
                  background: event.typeColors.border,
                  borderRadius: 2,
                }}
              />
              <span
                className="font-cakemono font-light text-[11px] uppercase truncate"
                style={{
                  color: "var(--text)",
                  letterSpacing: "0.04em",
                }}
              >
                {event.projectTitle ?? event.taskTitle}
              </span>
            </div>
          </div>

          {/* Edit */}
          <ContextMenuItem
            onClick={handleEdit}
            focused={focusedIndex === 0}
            onHover={() => setFocusedIndex(0)}
          >
            <Pencil className="w-[14px] h-[14px]" />
            {"// EDIT"}
          </ContextMenuItem>

          {/* Push +1 Day */}
          <ContextMenuItem
            onClick={handlePush1Day}
            focused={focusedIndex === 1}
            onHover={() => setFocusedIndex(1)}
          >
            <ChevronRight className="w-[14px] h-[14px]" />
            {"// PUSH +1 DAY"}
          </ContextMenuItem>

          {/* Push +1 Day (Cascade) */}
          <ContextMenuItem
            onClick={handlePush1DayCascade}
            focused={focusedIndex === 2}
            onHover={() => setFocusedIndex(2)}
          >
            <ChevronRight className="w-[14px] h-[14px]" />
            {"// PUSH +1 DAY [CASCADE]"}
          </ContextMenuItem>

          {/* Push to Next Week */}
          <ContextMenuItem
            onClick={handlePushNextWeek}
            focused={focusedIndex === 3}
            onHover={() => setFocusedIndex(3)}
          >
            <CalendarDays className="w-[14px] h-[14px]" />
            {"// PUSH TO NEXT WEEK"}
          </ContextMenuItem>

          {/* Separator */}
          <div
            role="separator"
            style={{
              height: 1,
              background: "var(--line)",
              margin: "4px 4px",
            }}
          />

          {/* Duplicate */}
          <ContextMenuItem
            onClick={handleDuplicate}
            focused={focusedIndex === 4}
            onHover={() => setFocusedIndex(4)}
          >
            <Copy className="w-[14px] h-[14px]" />
            {"// DUPLICATE"}
          </ContextMenuItem>

          {/* Separator */}
          <div
            role="separator"
            style={{
              height: 1,
              background: "var(--line)",
              margin: "4px 4px",
            }}
          />

          {/* Delete */}
          <ContextMenuItem
            onClick={handleDelete}
            focused={focusedIndex === 5}
            onHover={() => setFocusedIndex(5)}
            destructive
          >
            <Trash2 className="w-[14px] h-[14px]" />
            {"// DELETE"}
          </ContextMenuItem>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── ContextMenuItem ────────────────────────────────────────────────────────

function ContextMenuItem({
  children,
  onClick,
  destructive,
  focused,
  onHover,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  focused?: boolean;
  onHover?: () => void;
}) {
  return (
    <button
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      onMouseEnter={(e) => {
        onHover?.();
        if (!destructive) {
          (e.currentTarget as HTMLElement).style.background =
            "rgba(255, 255, 255, 0.05)";
          (e.currentTarget as HTMLElement).style.color = "var(--text)";
        } else {
          (e.currentTarget as HTMLElement).style.background = "var(--rose-soft)";
          (e.currentTarget as HTMLElement).style.color = "var(--rose)";
        }
      }}
      onMouseLeave={(e) => {
        if (focused) return;
        if (!destructive) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--text-2)";
        } else {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--rose)";
        }
      }}
      className={cn(
        "w-full flex items-center gap-[8px] px-2 py-1.5 text-left",
        "font-mono uppercase tracking-wider"
      )}
      style={{
        fontSize: 11,
        letterSpacing: "0.06em",
        color: destructive ? "var(--rose)" : "var(--text-2)",
        background: focused
          ? destructive
            ? "var(--rose-soft)"
            : "rgba(255, 255, 255, 0.05)"
          : "transparent",
        borderRadius: 4,
        transitionProperty: "background-color, color",
        transitionDuration: "150ms",
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {children}
    </button>
  );
}
