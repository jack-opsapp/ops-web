"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  getEventColors,
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

// Items in order. Separators live between groups.
const MENU_ITEMS: MenuItemId[] = [
  "edit",
  "push-1-day",
  "push-1-day-cascade",
  "push-next-week",
  // separator after push-next-week (rendered via index check below)
  "duplicate",
  // separator after duplicate
  "delete",
];

// ─── Component ──────────────────────────────────────────────────────────────

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
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

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

    // Convert InternalCalendarEvents to SchedulableTask shape for the engine.
    // Dependencies are not yet on InternalCalendarEvent, so cascade will be
    // a no-op unless dependencies are wired. This is expected for now.
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

    // First, update the pushed task itself
    updateMutation.mutate(
      { id: event.id, data: { startDate: newStart, endDate: newEnd } },
      {
        onSuccess: () => {
          // Then trigger cascade preview for dependents
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

    deleteMutation.mutate({ id: event.id }, {
      onSuccess: () => {
        toast.success("Task deleted");
        onClose();
      },
      onError: (err) => {
        toast.error("Failed to delete", { description: err.message });
      },
    });
  }, [event, deleteMutation, onClose]);

  const actions: Record<MenuItemId, () => void> = {
    edit: handleEdit,
    "push-1-day": handlePush1Day,
    "push-1-day-cascade": handlePush1DayCascade,
    "push-next-week": handlePushNextWeek,
    duplicate: handleDuplicate,
    delete: handleDelete,
  };

  // ── Focus the menu container when it appears ──────────────────────────

  useEffect(() => {
    if (event && position && menuRef.current) {
      menuRef.current.focus();
      setFocusedIndex(0);
    }
  }, [event, position]);

  // ── Keyboard navigation ───────────────────────────────────────────────

  useEffect(() => {
    if (!event || !position) return;

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
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [event, position, focusedIndex, onClose, actions]);

  if (!event || !position) return null;

  const colors = getEventColors(event.taskType);

  // Separator indices: after "push-next-week" (index 3) and after "duplicate" (index 4)
  const separatorAfterIndices = new Set([3, 4]);

  return (
    <div
      className="fixed z-50"
      style={{ left: position.x, top: position.y }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Actions for ${event.title}`}
        tabIndex={-1}
        className={cn(
          "min-w-[200px] rounded py-[4px] outline-none",
          "bg-[rgba(13,13,13,0.92)] backdrop-blur-xl",
          "border border-[rgba(255,255,255,0.12)] shadow-floating",
          "animate-in fade-in-0 zoom-in-95"
        )}
      >
        {/* Event title header */}
        <div className="px-2 py-1 border-b border-border-subtle mb-[4px]">
          <div className="flex items-center gap-[6px]">
            <div
              className="w-[8px] h-[8px] rounded-full shrink-0"
              style={{ backgroundColor: colors.border }}
            />
            <span className="font-mohave text-body-sm text-text-primary truncate">
              {event.title}
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
          Edit
        </ContextMenuItem>

        {/* Push +1 Day */}
        <ContextMenuItem
          onClick={handlePush1Day}
          focused={focusedIndex === 1}
          onHover={() => setFocusedIndex(1)}
        >
          <ChevronRight className="w-[14px] h-[14px]" />
          Push +1 Day
        </ContextMenuItem>

        {/* Push +1 Day (Cascade) */}
        <ContextMenuItem
          onClick={handlePush1DayCascade}
          focused={focusedIndex === 2}
          onHover={() => setFocusedIndex(2)}
        >
          <ChevronRight className="w-[14px] h-[14px]" />
          Push +1 Day (cascade)
        </ContextMenuItem>

        {/* Push to Next Week */}
        <ContextMenuItem
          onClick={handlePushNextWeek}
          focused={focusedIndex === 3}
          onHover={() => setFocusedIndex(3)}
        >
          <CalendarDays className="w-[14px] h-[14px]" />
          Push to Next Week
        </ContextMenuItem>

        {/* Separator */}
        <div
          className="h-[1px] bg-border-subtle mx-1 my-[4px]"
          role="separator"
        />

        {/* Duplicate */}
        <ContextMenuItem
          onClick={handleDuplicate}
          focused={focusedIndex === 4}
          onHover={() => setFocusedIndex(4)}
        >
          <Copy className="w-[14px] h-[14px]" />
          Duplicate
        </ContextMenuItem>

        {/* Separator */}
        <div
          className="h-[1px] bg-border-subtle mx-1 my-[4px]"
          role="separator"
        />

        {/* Delete */}
        <ContextMenuItem
          onClick={handleDelete}
          focused={focusedIndex === 5}
          onHover={() => setFocusedIndex(5)}
          destructive
        >
          <Trash2 className="w-[14px] h-[14px]" />
          Delete
        </ContextMenuItem>
      </div>

      {/* Click-away overlay */}
      <div
        className="fixed inset-0 z-[-1]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
    </div>
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
      onMouseEnter={onHover}
      className={cn(
        "w-full flex items-center gap-[8px] px-2 py-1 text-left transition-colors",
        "font-mohave text-body-sm",
        destructive
          ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
          : "text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)]",
        focused &&
          (destructive
            ? "bg-red-500/10 text-red-300"
            : "bg-[rgba(255,255,255,0.05)] text-text-primary")
      )}
    >
      {children}
    </button>
  );
}
