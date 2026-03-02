"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Search, X, Plus } from "lucide-react";
import { format, addHours } from "date-fns";
import { toast } from "sonner";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/lib/hooks/use-projects";
import { useCreateCalendarEvent } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCalendarStore } from "@/stores/calendar-store";

export function EventQuickCreate() {
  const { quickCreateAnchor, setQuickCreateAnchor } = useCalendarStore();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const createMutation = useCreateCalendarEvent();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  const filteredProjects = useMemo(
    () =>
      projects.filter((p) =>
        p.title.toLowerCase().includes(projectSearch.toLowerCase())
      ),
    [projects, projectSearch]
  );

  const selectedProject = projects.find((p) => p.id === projectId);

  // Populate dates from anchor
  useEffect(() => {
    if (quickCreateAnchor) {
      const start = quickCreateAnchor.date;
      const end = quickCreateAnchor.endDate ?? addHours(start, 1);
      setStartDate(format(start, "yyyy-MM-dd'T'HH:mm"));
      setEndDate(format(end, "yyyy-MM-dd'T'HH:mm"));
      setTitle("");
      setProjectId(null);
      setProjectSearch("");
    }
  }, [quickCreateAnchor]);

  const handleCreate = useCallback(() => {
    if (!title.trim()) {
      toast.error("Please enter an event title");
      return;
    }
    if (!projectId) {
      toast.error("Please select a project");
      return;
    }
    if (!companyId) {
      toast.error("No company found");
      return;
    }

    createMutation.mutate(
      {
        title: title.trim(),
        projectId,
        companyId,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : undefined,
        color: "#59779F",
        teamMemberIds: [],
      },
      {
        onSuccess: () => {
          toast.success("Event created");
          setQuickCreateAnchor(null);
        },
        onError: (err) => {
          toast.error("Failed to create event", { description: err.message });
        },
      }
    );
  }, [title, projectId, companyId, startDate, endDate, createMutation, setQuickCreateAnchor]);

  if (!quickCreateAnchor) return null;

  return (
    <PopoverPrimitive.Root
      open={!!quickCreateAnchor}
      onOpenChange={(open) => {
        if (!open) setQuickCreateAnchor(null);
      }}
    >
      <PopoverPrimitive.Anchor
        style={{
          position: "fixed",
          left: quickCreateAnchor.x,
          top: quickCreateAnchor.y,
        }}
      />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={8}
          className={cn(
            "z-50 w-[320px] p-2 rounded-lg",
            "bg-[rgba(13,13,13,0.92)] backdrop-blur-xl",
            "border border-[rgba(255,255,255,0.12)] shadow-floating",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            setTimeout(() => titleRef.current?.focus(), 50);
          }}
        >
          <div className="space-y-1.5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="font-mohave text-body text-text-primary flex items-center gap-[6px]">
                <Plus className="w-[14px] h-[14px] text-ops-accent" />
                New Event
              </span>
              <button
                onClick={() => setQuickCreateAnchor(null)}
                className="text-text-tertiary hover:text-text-secondary"
              >
                <X className="w-[14px] h-[14px]" />
              </button>
            </div>

            {/* Title */}
            <div>
              <label className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest block mb-[4px]">
                Title
              </label>
              <Input
                ref={titleRef}
                placeholder="Event title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim() && projectId) {
                    handleCreate();
                  }
                }}
              />
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-1">
              <div>
                <label className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest block mb-[4px]">
                  Start
                </label>
                <Input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest block mb-[4px]">
                  End
                </label>
                <Input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="text-[12px]"
                />
              </div>
            </div>

            {/* Project Selector */}
            <div>
              <label className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest block mb-[4px]">
                Project
              </label>
              {selectedProject ? (
                <div className="flex items-center justify-between bg-background-input border border-[rgba(255,255,255,0.2)] rounded px-1.5 py-1">
                  <span className="font-mohave text-body-sm text-text-primary truncate">
                    {selectedProject.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectId(null);
                      setProjectSearch("");
                    }}
                    className="text-text-tertiary hover:text-text-secondary shrink-0"
                  >
                    <X className="w-[14px] h-[14px]" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Search projects..."
                    value={projectSearch}
                    onChange={(e) => {
                      setProjectSearch(e.target.value);
                      setShowProjectDropdown(true);
                    }}
                    onFocus={() => setShowProjectDropdown(true)}
                    onBlur={() =>
                      setTimeout(() => setShowProjectDropdown(false), 200)
                    }
                    prefixIcon={<Search className="w-[14px] h-[14px]" />}
                  />
                  {showProjectDropdown && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.95)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded shadow-floating max-h-[160px] overflow-y-auto">
                      {filteredProjects.length === 0 ? (
                        <div className="px-1.5 py-1">
                          <p className="font-mohave text-body-sm text-text-tertiary">
                            No matching projects
                          </p>
                        </div>
                      ) : (
                        filteredProjects.slice(0, 10).map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            onMouseDown={() => {
                              setProjectId(project.id);
                              setShowProjectDropdown(false);
                              setProjectSearch("");
                            }}
                            className="w-full px-1.5 py-1 text-left font-mohave text-body-sm text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                          >
                            {project.title}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Create Button */}
            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={handleCreate}
              disabled={
                createMutation.isPending || !title.trim() || !projectId
              }
            >
              {createMutation.isPending ? "Creating..." : "Create Event"}
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
