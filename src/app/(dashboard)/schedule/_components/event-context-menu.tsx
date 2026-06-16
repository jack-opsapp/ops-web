"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Pencil,
  Copy,
  Trash2,
  ChevronRight,
  CalendarDays,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { addDays, nextMonday, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import {
  useCreateTask,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/hooks";
import { useCreateProjectNote } from "@/lib/hooks/use-project-notes";
import { useCascade } from "@/lib/hooks/use-cascade";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  type InternalScheduleEvent,
} from "@/lib/utils/schedule-utils";
import { useScheduleStore } from "@/stores/schedule-store";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EventContextMenuProps {
  event: InternalScheduleEvent | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  /** All visible events — needed for cascade calculation */
  allEvents?: InternalScheduleEvent[];
}

type MenuItemId =
  | "edit"
  | "comment"
  | "push-1-day"
  | "push-1-day-cascade"
  | "push-next-week"
  | "duplicate"
  | "delete";

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
  const { company, currentUser } = useAuthStore();
  const { setSidePanelTask } = useScheduleStore();
  const deleteMutation = useDeleteTask();
  const duplicateMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const createNote = useCreateProjectNote();
  const { previewCascade } = useCascade();
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Comment composer — only visible after the user picks "// COMMENT".
  // Stays mounted inside the same Popover.Content so the menu can swap
  // between actions list and composer without remounting / repositioning.
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const open = !!event && !!position;

  // ── Comment availability ──────────────────────────────────────────────
  // Comments live on the project. Personal / time-off events have no
  // project, so the comment action is hidden for those. Events without
  // a `companyId` from the auth store also can't post (no RLS context).
  const canComment = !!(
    event?.kind === "task" &&
    event?.projectId &&
    currentUser?.id &&
    company?.id
  );

  // Items in order — recomputed each render so the comment row drops out
  // of keyboard navigation when the event has no project.
  const menuItems = useMemo<MenuItemId[]>(() => {
    const base: MenuItemId[] = ["edit"];
    if (canComment) base.push("comment");
    base.push("push-1-day", "push-1-day-cascade", "push-next-week", "duplicate", "delete");
    return base;
  }, [canComment]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleEdit = useCallback(() => {
    if (!event) return;
    setSidePanelTask(event.id);
    onClose();
  }, [event, setSidePanelTask, onClose]);

  const handleOpenComment = useCallback(() => {
    if (!canComment) return;
    setComposerOpen(true);
    setDraft("");
    // Focus the textarea after it mounts. Radix delays its own focus
    // management one tick, so a 0ms timeout lets that settle.
    setTimeout(() => composerRef.current?.focus(), 0);
  }, [canComment]);

  const handleCancelComment = useCallback(() => {
    setComposerOpen(false);
    setDraft("");
  }, []);

  const handleSubmitComment = useCallback(() => {
    if (!event || !event.projectId || !company?.id || !currentUser?.id) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (createNote.isPending) return;
    createNote.mutate(
      {
        projectId: event.projectId,
        companyId: company.id,
        authorId: currentUser.id,
        content: trimmed,
      },
      {
        onSuccess: () => {
          toast.success("Comment posted");
          setDraft("");
          setComposerOpen(false);
          onClose();
        },
        onError: (err) => {
          toast.error("Failed to post comment", { description: err.message });
        },
      }
    );
  }, [event, company?.id, currentUser?.id, draft, createNote, onClose]);

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
    comment: handleOpenComment,
    "push-1-day": handlePush1Day,
    "push-1-day-cascade": handlePush1DayCascade,
    "push-next-week": handlePushNextWeek,
    duplicate: handleDuplicate,
    delete: handleDelete,
  };

  // ── Reset focus / composer state on open ──
  useEffect(() => {
    if (open) {
      setFocusedIndex(0);
      setComposerOpen(false);
      setDraft("");
    }
  }, [open]);

  // ── Keyboard navigation (arrow + enter inside the open popover) ──
  // Suspended while the comment composer is open so arrow-keys / enter
  // inside the textarea don't fire menu shortcuts. Escape inside the
  // composer cancels the composer rather than closing the popover.
  useEffect(() => {
    if (!open) return;
    if (composerOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % menuItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex(
            (prev) => (prev - 1 + menuItems.length) % menuItems.length
          );
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          actions[menuItems[focusedIndex]]();
          break;
        // Escape handled by Radix DismissableLayer.
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, composerOpen, focusedIndex, actions, menuItems]);

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

          {composerOpen ? (
            <CommentComposer
              draft={draft}
              onChange={setDraft}
              onSubmit={handleSubmitComment}
              onCancel={handleCancelComment}
              isSubmitting={createNote.isPending}
              ref={composerRef}
            />
          ) : (
            <>
              {/* Edit */}
              <ContextMenuItem
                onClick={handleEdit}
                focused={menuItems[focusedIndex] === "edit"}
                onHover={() =>
                  setFocusedIndex(menuItems.indexOf("edit"))
                }
              >
                <Pencil className="w-[14px] h-[14px]" />
                {"// EDIT"}
              </ContextMenuItem>

              {/* Comment — only shown for events with a project. */}
              {canComment && (
                <ContextMenuItem
                  onClick={handleOpenComment}
                  focused={menuItems[focusedIndex] === "comment"}
                  onHover={() =>
                    setFocusedIndex(menuItems.indexOf("comment"))
                  }
                >
                  <MessageSquare className="w-[14px] h-[14px]" />
                  {"// COMMENT"}
                </ContextMenuItem>
              )}

              {/* Push +1 Day */}
              <ContextMenuItem
                onClick={handlePush1Day}
                focused={menuItems[focusedIndex] === "push-1-day"}
                onHover={() =>
                  setFocusedIndex(menuItems.indexOf("push-1-day"))
                }
              >
                <ChevronRight className="w-[14px] h-[14px]" />
                {"// PUSH +1 DAY"}
              </ContextMenuItem>

              {/* Push +1 Day (Cascade) */}
              <ContextMenuItem
                onClick={handlePush1DayCascade}
                focused={menuItems[focusedIndex] === "push-1-day-cascade"}
                onHover={() =>
                  setFocusedIndex(menuItems.indexOf("push-1-day-cascade"))
                }
              >
                <ChevronRight className="w-[14px] h-[14px]" />
                {"// PUSH +1 DAY [CASCADE]"}
              </ContextMenuItem>

              {/* Push to Next Week */}
              <ContextMenuItem
                onClick={handlePushNextWeek}
                focused={menuItems[focusedIndex] === "push-next-week"}
                onHover={() =>
                  setFocusedIndex(menuItems.indexOf("push-next-week"))
                }
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
                focused={menuItems[focusedIndex] === "duplicate"}
                onHover={() =>
                  setFocusedIndex(menuItems.indexOf("duplicate"))
                }
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
                focused={menuItems[focusedIndex] === "delete"}
                onHover={() =>
                  setFocusedIndex(menuItems.indexOf("delete"))
                }
                destructive
              >
                <Trash2 className="w-[14px] h-[14px]" />
                {"// DELETE"}
              </ContextMenuItem>
            </>
          )}
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
        "font-mono uppercase tracking-[0.16em]"
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

// ─── CommentComposer ────────────────────────────────────────────────────────

/**
 * Inline comment composer rendered inside the event context menu when the
 * user picks `// COMMENT`. Writes to the existing `project_notes` table via
 * `useCreateProjectNote` — the calendar event's `projectId` is the target.
 *
 * Keyboard shortcuts (composer is focused):
 *   - Escape  → cancel
 *   - ⌘/Ctrl+Enter → submit
 */
const CommentComposer = forwardRef<
  HTMLTextAreaElement,
  {
    draft: string;
    onChange: (next: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    isSubmitting: boolean;
  }
>(function CommentComposer(
  { draft, onChange, onSubmit, onCancel, isSubmitting },
  ref
) {
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }
    },
    [canSubmit, onCancel, onSubmit]
  );

  return (
    <div
      className="flex flex-col gap-[6px]"
      style={{ padding: "4px 4px 6px 4px" }}
    >
      <span
        className="font-mono uppercase tracking-[0.16em] px-1"
        style={{
          color: "var(--text-mute)",
          fontSize: 10,
          letterSpacing: "0.16em",
        }}
      >
        {"// COMMENT"}
      </span>
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment to this project..."
        rows={3}
        disabled={isSubmitting}
        className="w-full font-mohave resize-none"
        style={{
          padding: "8px 10px",
          background: "var(--surface-input)",
          border: "1px solid rgba(255, 255, 255, 0.10)",
          borderRadius: 5,
          color: "var(--text)",
          fontSize: 13,
          lineHeight: 1.4,
          outline: "none",
          transition:
            "border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.20)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.10)";
        }}
      />
      <div className="flex items-center justify-between gap-[8px]">
        <span
          className="font-mono"
          style={{
            color: "var(--text-mute)",
            fontSize: 9,
            letterSpacing: "0.04em",
          }}
        >
          [⌘↵] SAVE · [ESC] CANCEL
        </span>
        <div className="flex items-center gap-[4px]">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="font-mono uppercase tracking-[0.16em]"
            style={{
              padding: "4px 8px",
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.10)",
              borderRadius: 4,
              color: "var(--text-3)",
              fontSize: 10,
              letterSpacing: "0.06em",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              transition: "color 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
            onMouseEnter={(e) => {
              if (isSubmitting) return;
              (e.currentTarget as HTMLElement).style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-3)";
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="font-mono uppercase tracking-[0.16em] flex items-center gap-[5px]"
            style={{
              padding: "4px 10px",
              background: canSubmit
                ? "var(--ops-accent-soft)"
                : "var(--surface-input)",
              border: canSubmit
                ? "1px solid var(--ops-accent-line)"
                : "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 4,
              color: canSubmit ? "var(--ops-accent)" : "var(--text-mute)",
              fontSize: 10,
              letterSpacing: "0.06em",
              cursor: canSubmit ? "pointer" : "not-allowed",
              transition:
                "background 0.15s cubic-bezier(0.22, 1, 0.36, 1), color 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {isSubmitting && (
              <Loader2
                className="w-[10px] h-[10px] animate-spin"
                aria-hidden="true"
              />
            )}
            {isSubmitting ? "POSTING…" : "POST"}
          </button>
        </div>
      </div>
    </div>
  );
});
