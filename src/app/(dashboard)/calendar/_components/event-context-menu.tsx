"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import {
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  type InternalCalendarEvent,
  getEventColors,
} from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";

interface EventContextMenuProps {
  event: InternalCalendarEvent | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

const MENU_ITEMS = ["edit", "duplicate", "delete"] as const;
type MenuItemId = (typeof MENU_ITEMS)[number];

export function EventContextMenu({ event, position, onClose }: EventContextMenuProps) {
  const { company } = useAuthStore();
  const { selectEvent } = useCalendarStore();
  const deleteMutation = useDeleteCalendarEvent();
  const duplicateMutation = useCreateCalendarEvent();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const handleEdit = useCallback(() => {
    if (!event) return;
    selectEvent(event.id);
    onClose();
  }, [event, selectEvent, onClose]);

  const handleDuplicate = useCallback(() => {
    if (!event || !company?.id) return;

    duplicateMutation.mutate(
      {
        title: `${event.title} (Copy)`,
        projectId: event.projectId ?? "",
        companyId: company.id,
        startDate: event.startDate,
        endDate: event.endDate,
        color: event.color,
        teamMemberIds: event.teamMemberIds,
      },
      {
        onSuccess: () => {
          toast.success("Event duplicated");
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

    deleteMutation.mutate(event.id, {
      onSuccess: () => {
        toast.success("Event deleted");
        onClose();
      },
      onError: (err) => {
        toast.error("Failed to delete", { description: err.message });
      },
    });
  }, [event, deleteMutation, onClose]);

  const actions: Record<MenuItemId, () => void> = {
    edit: handleEdit,
    duplicate: handleDuplicate,
    delete: handleDelete,
  };

  // Focus the menu container when it appears
  useEffect(() => {
    if (event && position && menuRef.current) {
      menuRef.current.focus();
      setFocusedIndex(0);
    }
  }, [event, position]);

  // Keyboard navigation
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
          setFocusedIndex((prev) => (prev - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
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
          "min-w-[180px] rounded-lg py-[4px] outline-none",
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

        <ContextMenuItem
          onClick={handleEdit}
          focused={focusedIndex === 0}
          onHover={() => setFocusedIndex(0)}
        >
          <Pencil className="w-[14px] h-[14px]" />
          Edit Event
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleDuplicate}
          focused={focusedIndex === 1}
          onHover={() => setFocusedIndex(1)}
        >
          <Copy className="w-[14px] h-[14px]" />
          Duplicate
        </ContextMenuItem>

        <div className="h-[1px] bg-border-subtle mx-1 my-[4px]" role="separator" />

        <ContextMenuItem
          onClick={handleDelete}
          focused={focusedIndex === 2}
          onHover={() => setFocusedIndex(2)}
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
        focused && (destructive ? "bg-red-500/10 text-red-300" : "bg-[rgba(255,255,255,0.05)] text-text-primary")
      )}
    >
      {children}
    </button>
  );
}
