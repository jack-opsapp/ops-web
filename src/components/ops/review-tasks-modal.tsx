"use client";

/**
 * OPS Web - Review Tasks Modal
 *
 * Shown when an estimate is approved. Presents proposed tasks grouped
 * by LABOR line item. Staff can select/deselect tasks and adjust crew
 * before creating ProjectTasks in Bubble.
 *
 * Skipped if CompanySettings.autoGenerateTasks = true.
 */

import { useState, useCallback } from "react";
import { Check, X, Plus, Loader2, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { useProposedTasks } from "@/lib/hooks/use-task-templates";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { TaskService } from "@/lib/api/services";
import { OpportunityService } from "@/lib/api/services";
import { OpportunityStage } from "@/lib/types/pipeline";
import type { ProposedTask } from "@/lib/api/services/task-template-service";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewTasksModalProps {
  estimateId: string;
  projectId: string;
  projectTitle: string;
  opportunityId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

interface EditableProposedTask extends ProposedTask {
  assignedMemberIds: string[];
}

// ─── Task Row ──────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  selected,
  assignedMemberIds,
  onToggle,
  onMembersChange,
  allMembers,
}: {
  task: ProposedTask;
  selected: boolean;
  assignedMemberIds: string[];
  onToggle: () => void;
  onMembersChange: (ids: string[]) => void;
  allMembers: Array<{ id: string; firstName: string; lastName: string }>;
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className={cn(
      "flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors",
      selected ? "bg-[#1A1A1A]" : "opacity-40"
    )}>
      <button
        onClick={onToggle}
        className={cn(
          "mt-0.5 h-5 w-5 rounded border shrink-0 flex items-center justify-center transition-colors",
          selected
            ? "bg-[#417394] border-[#417394]"
            : "border-[#444] bg-transparent"
        )}
      >
        {selected && <Check className="h-3 w-3 text-white" />}
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#E5E5E5]">{task.template.title}</p>
        {task.template.estimatedHours && (
          <p className="text-xs text-[#9CA3AF]">
            ~{task.template.estimatedHours}h
          </p>
        )}
      </div>

      {/* Crew chips */}
      <div className="flex items-center gap-1 flex-wrap justify-end">
        {assignedMemberIds.map((memberId) => {
          const member = allMembers.find((m) => m.id === memberId);
          if (!member) return null;
          return (
            <span
              key={memberId}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[#417394]/20 text-[#8BB8D4]"
            >
              {member.firstName}
              <button
                onClick={() =>
                  onMembersChange(assignedMemberIds.filter((id) => id !== memberId))
                }
                className="hover:text-white transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          );
        })}
        <div className="relative">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="h-5 w-5 rounded-full border border-dashed border-[#444] flex items-center justify-center hover:border-[#417394] transition-colors"
          >
            <Plus className="h-3 w-3 text-[#9CA3AF]" />
          </button>
          {showPicker && (
            <div className="absolute right-0 top-6 z-50 w-48 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg shadow-xl py-1 max-h-40 overflow-y-auto">
              {allMembers
                .filter((m) => !assignedMemberIds.includes(m.id))
                .map((member) => (
                  <button
                    key={member.id}
                    onClick={() => {
                      onMembersChange([...assignedMemberIds, member.id]);
                      setShowPicker(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A]"
                  >
                    {member.firstName} {member.lastName}
                  </button>
                ))}
              {allMembers.filter((m) => !assignedMemberIds.includes(m.id)).length === 0 && (
                <p className="px-3 py-2 text-xs text-[#9CA3AF]">No more members</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Modal ────────────────────────────────────────────────────────────────

export function ReviewTasksModal({
  estimateId,
  projectId,
  projectTitle,
  opportunityId,
  open,
  onOpenChange,
  onComplete,
}: ReviewTasksModalProps) {
  const queryClient = useQueryClient();
  const { company, currentUser: user } = useAuthStore();
  const { data: proposed = [], isLoading } = useProposedTasks(estimateId);
  const { data: teamData } = useTeamMembers();
  const allMembers = teamData?.users ?? [];

  const [tasks, setTasks] = useState<EditableProposedTask[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [creating, setCreating] = useState(false);

  // Initialize tasks once proposed data loads
  if (!initialized && proposed.length > 0) {
    setTasks(
      proposed.map((p) => ({
        ...p,
        assignedMemberIds: p.defaultTeamMemberIds,
        selected: true,
      }))
    );
    setInitialized(true);
  }

  // Group tasks by line item
  const grouped = tasks.reduce<Record<string, EditableProposedTask[]>>(
    (acc, task) => {
      if (!acc[task.lineItemId]) acc[task.lineItemId] = [];
      acc[task.lineItemId].push(task);
      return acc;
    },
    {}
  );

  const selectedCount = tasks.filter((t) => t.selected).length;

  const toggleTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.template.id === taskId ? { ...t, selected: !t.selected } : t
      )
    );
  }, []);

  const updateMembers = useCallback((taskId: string, memberIds: string[]) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.template.id === taskId ? { ...t, assignedMemberIds: memberIds } : t
      )
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (!company?.id) return;
    setCreating(true);
    try {
      const proposals = tasks
        .filter((t) => t.selected)
        .map((t) => ({
          title: t.template.title,
          taskTypeId: t.taskTypeId,
          defaultTeamMemberIds: t.assignedMemberIds,
          lineItemId: t.lineItemId,
          estimateId,
          selected: true,
        }));

      await TaskService.createTasksFromProposals(proposals, projectId, company.id);

      // Advance opportunity to Won
      if (opportunityId) {
        try {
          await OpportunityService.moveOpportunityStage(
            opportunityId,
            OpportunityStage.Won,
            user?.id
          );
        } catch {
          // Non-fatal
        }
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });

      toast.success(`${proposals.length} task${proposals.length !== 1 ? "s" : ""} created`);
      onOpenChange(false);
      onComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create tasks");
    } finally {
      setCreating(false);
    }
  }, [tasks, company?.id, projectId, estimateId, opportunityId, user?.id, queryClient, onOpenChange, onComplete]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0A0A0A] border border-[#2A2A2A] max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-[#E5E5E5] font-['Mohave'] text-lg">
            Review Tasks — {projectTitle}
          </DialogTitle>
          <p className="text-xs text-[#9CA3AF] mt-1">
            {selectedCount} task{selectedCount !== 1 ? "s" : ""} selected
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto mt-2 space-y-4 pr-1">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#417394]" />
            </div>
          )}

          {!isLoading && Object.keys(grouped).length === 0 && (
            <div className="text-center py-8">
              <Users className="h-8 w-8 text-[#444] mx-auto mb-3" />
              <p className="text-sm text-[#9CA3AF]">
                No task templates found for this estimate.
              </p>
              <p className="text-xs text-[#6B7280] mt-1">
                Add templates in Settings → Task Types to enable auto-generation.
              </p>
            </div>
          )}

          {Object.entries(grouped).map(([lineItemId, lineTasks]) => {
            const first = lineTasks[0];
            return (
              <div key={lineItemId} className="rounded-xl border border-[#2A2A2A] overflow-hidden">
                <div className="px-4 py-2.5 bg-[#111] border-b border-[#2A2A2A]">
                  <p className="text-sm font-medium text-[#C4A868]">
                    {first.lineItemName}
                  </p>
                </div>
                <div className="p-2 space-y-1">
                  {lineTasks.map((task) => (
                    <TaskRow
                      key={task.template.id}
                      task={task}
                      selected={task.selected}
                      assignedMemberIds={task.assignedMemberIds}
                      onToggle={() => toggleTask(task.template.id)}
                      onMembersChange={(ids) => updateMembers(task.template.id, ids)}
                      allMembers={allMembers}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-[#2A2A2A] mt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="flex-1 text-[#9CA3AF] hover:text-[#E5E5E5]"
          >
            Generate tasks later
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || selectedCount === 0}
            className="flex-1 bg-[#417394] hover:bg-[#4f8aae] text-white"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Create ${selectedCount} Task${selectedCount !== 1 ? "s" : ""} →`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
