"use client";

import { useState, useCallback } from "react";
import {
  Clock,
  Calendar as CalendarIcon,
  User,
  MapPin,
  Trash2,
  Pencil,
  ExternalLink,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  useCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
} from "@/lib/hooks";
import {
  getEventColors,
  deriveTaskType,
  formatTime24,
} from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";
import { useRouter } from "next/navigation";

export function EventDetailPanel() {
  const router = useRouter();
  const { selectedEventId, isDetailPanelOpen, closeDetailPanel } =
    useCalendarStore();

  const { data: apiEvent } = useCalendarEvent(selectedEventId ?? undefined);
  const updateMutation = useUpdateCalendarEvent();
  const deleteMutation = useDeleteCalendarEvent();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");

  const startEditing = useCallback(() => {
    if (!apiEvent) return;
    setEditTitle(apiEvent.title);
    setEditStartDate(
      apiEvent.startDate
        ? format(new Date(apiEvent.startDate), "yyyy-MM-dd'T'HH:mm")
        : ""
    );
    setEditEndDate(
      apiEvent.endDate
        ? format(new Date(apiEvent.endDate), "yyyy-MM-dd'T'HH:mm")
        : ""
    );
    setIsEditing(true);
  }, [apiEvent]);

  const handleSave = useCallback(() => {
    if (!selectedEventId || !editTitle.trim()) return;

    updateMutation.mutate(
      {
        id: selectedEventId,
        data: {
          title: editTitle.trim(),
          startDate: editStartDate ? new Date(editStartDate) : undefined,
          endDate: editEndDate ? new Date(editEndDate) : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("Event updated");
          setIsEditing(false);
        },
        onError: (err) => {
          toast.error("Failed to update event", { description: err.message });
        },
      }
    );
  }, [selectedEventId, editTitle, editStartDate, editEndDate, updateMutation]);

  const handleDelete = useCallback(() => {
    if (!selectedEventId) return;

    deleteMutation.mutate(selectedEventId, {
      onSuccess: () => {
        toast.success("Event deleted");
        closeDetailPanel();
      },
      onError: (err) => {
        toast.error("Failed to delete event", { description: err.message });
      },
    });
  }, [selectedEventId, deleteMutation, closeDetailPanel]);

  // Derive display data from apiEvent
  const title = apiEvent?.title ?? "";
  const startDate = apiEvent?.startDate ? new Date(apiEvent.startDate) : null;
  const endDate = apiEvent?.endDate ? new Date(apiEvent.endDate) : null;
  const projectTitle = apiEvent?.project?.title;
  const projectId = apiEvent?.projectId;
  const teamMemberIds = apiEvent?.teamMemberIds ?? [];
  const color = apiEvent?.color ?? "#59779F";

  const taskType = deriveTaskType(title, color);
  const colors = getEventColors(taskType);

  return (
    <Sheet open={isDetailPanelOpen} onOpenChange={(open) => !open && closeDetailPanel()}>
      <SheetContent side="right">
        <SheetHeader>
          <div className="flex items-center gap-[8px]">
            <div
              className="w-[10px] h-[10px] rounded-full shrink-0"
              style={{ backgroundColor: colors.border }}
            />
            <SheetTitle className="flex-1 truncate">
              {isEditing ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="font-mohave text-heading"
                  autoFocus
                />
              ) : (
                title
              )}
            </SheetTitle>
          </div>
          <SheetDescription>
            <span
              className="inline-block font-kosugi text-[9px] uppercase tracking-widest px-[6px] py-[2px] rounded-sm"
              style={{
                backgroundColor: colors.bg,
                color: colors.text,
                border: `1px solid ${colors.border}40`,
              }}
            >
              {taskType}
            </span>
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          <div className="space-y-3">
            {/* Time */}
            <div className="flex items-start gap-[8px]">
              <Clock className="w-[16px] h-[16px] text-text-tertiary mt-[2px] shrink-0" />
              <div className="flex-1">
                <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest block mb-[4px]">
                  Time
                </span>
                {isEditing ? (
                  <div className="space-y-1">
                    <Input
                      type="datetime-local"
                      value={editStartDate}
                      onChange={(e) => setEditStartDate(e.target.value)}
                    />
                    <Input
                      type="datetime-local"
                      value={editEndDate}
                      onChange={(e) => setEditEndDate(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="font-mono text-data-sm text-text-primary">
                    {startDate && (
                      <>
                        {format(startDate, "EEE, MMM d, yyyy")}
                        <br />
                        <span className="text-text-secondary">
                          {formatTime24(startDate)}
                          {endDate && ` - ${formatTime24(endDate)}`}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Project */}
            {projectTitle && (
              <div className="flex items-start gap-[8px]">
                <CalendarIcon className="w-[16px] h-[16px] text-text-tertiary mt-[2px] shrink-0" />
                <div className="flex-1">
                  <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest block mb-[4px]">
                    Project
                  </span>
                  <button
                    onClick={() => {
                      if (projectId) {
                        router.push(`/projects/${projectId}`);
                      }
                    }}
                    className="font-mohave text-body text-ops-accent hover:underline flex items-center gap-[4px]"
                  >
                    {projectTitle}
                    <ExternalLink className="w-[12px] h-[12px]" />
                  </button>
                </div>
              </div>
            )}

            {/* Team Members */}
            {teamMemberIds.length > 0 && (
              <div className="flex items-start gap-[8px]">
                <User className="w-[16px] h-[16px] text-text-tertiary mt-[2px] shrink-0" />
                <div className="flex-1">
                  <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest block mb-[4px]">
                    Team
                  </span>
                  <div className="flex flex-wrap gap-[4px]">
                    {teamMemberIds.map((memberId) => (
                      <span
                        key={memberId}
                        className="font-mono text-[11px] text-text-secondary bg-background-elevated px-[8px] py-[3px] rounded-sm"
                      >
                        {memberId.slice(0, 8)}...
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Color */}
            <div className="flex items-start gap-[8px]">
              <div
                className="w-[16px] h-[16px] rounded-sm mt-[2px] shrink-0"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1">
                <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest block mb-[4px]">
                  Color
                </span>
                <span className="font-mono text-[11px] text-text-secondary">
                  {color}
                </span>
              </div>
            </div>
          </div>
        </SheetBody>

        <SheetFooter>
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={updateMutation.isPending || !editTitle.trim()}
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="w-[14px] h-[14px] mr-[4px]" />
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
              <Button variant="secondary" size="sm" onClick={startEditing}>
                <Pencil className="w-[14px] h-[14px] mr-[4px]" />
                Edit
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
