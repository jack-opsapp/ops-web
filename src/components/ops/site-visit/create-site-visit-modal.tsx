"use client";

/**
 * OPS Web - Create Site Visit Modal
 *
 * Form for scheduling a site visit. Creates:
 *   1. SiteVisit row in Supabase
 *   2. CalendarEvent in Bubble (eventType: 'site_visit')
 *   3. Activity on opportunity timeline (type: 'site_visit_scheduled')
 *   4. Advances opportunity from 'new_lead' → 'qualifying' if applicable
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarDays, Clock, Users, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useCreateSiteVisit } from "@/lib/hooks/use-site-visits";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { CalendarService } from "@/lib/api/services";
import { OpportunityService } from "@/lib/api/services";
import { ActivityType, OpportunityStage, SiteVisitStatus } from "@/lib/types/pipeline";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";

// ─── Validation Schema ────────────────────────────────────────────────────────

const schema = z.object({
  scheduledDate: z.string().min(1, "Date is required"),
  scheduledTime: z.string().min(1, "Time is required"),
  durationMinutes: z
    .number({ coerce: true })
    .min(15, "Minimum 15 minutes")
    .max(480, "Maximum 8 hours"),
  notes: z.string().optional(),
  assigneeIds: z.array(z.string()).default([]),
});

type FormValues = z.infer<typeof schema>;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CreateSiteVisitModalProps {
  opportunityId?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  currentStage?: OpportunityStage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (siteVisitId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateSiteVisitModal({
  opportunityId,
  projectId,
  clientId,
  currentStage,
  open,
  onOpenChange,
  onCreated,
}: CreateSiteVisitModalProps) {
  const queryClient = useQueryClient();
  const { company, currentUser: user } = useAuthStore();
  const createSiteVisit = useCreateSiteVisit();
  const { data: teamData } = useTeamMembers();
  const teamMembers = teamData?.users ?? [];

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      scheduledDate: new Date().toISOString().split("T")[0],
      scheduledTime: "09:00",
      durationMinutes: 60,
      notes: "",
      assigneeIds: [],
    },
  });

  const assigneeIds = watch("assigneeIds");

  const toggleAssignee = (memberId: string) => {
    const current = assigneeIds;
    if (current.includes(memberId)) {
      setValue("assigneeIds", current.filter((id) => id !== memberId));
    } else {
      setValue("assigneeIds", [...current, memberId]);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!company?.id || !user?.id) return;

    try {
      const scheduledAt = new Date(`${values.scheduledDate}T${values.scheduledTime}:00`);

      // 1. Create the site visit
      const siteVisit = await createSiteVisit.mutateAsync({
        companyId: company.id,
        opportunityId: opportunityId ?? null,
        projectId: projectId ?? null,
        clientId: clientId ?? null,
        scheduledAt,
        durationMinutes: values.durationMinutes,
        assigneeIds: values.assigneeIds,
        status: SiteVisitStatus.Scheduled,
        notes: values.notes || null,
        internalNotes: null,
        measurements: null,
        photos: [],
        calendarEventId: null,
        createdBy: user.id,
      });

      // 2. Create calendar event in Bubble (fire-and-forget)
      CalendarService.createCalendarEvent({
        companyId: company.id,
        projectId: projectId ?? "",
        taskId: null,
        title: `Site Visit${clientId ? " — Client" : ""}`,
        color: "#417394",
        duration: 1,
        startDate: scheduledAt,
        endDate: new Date(scheduledAt.getTime() + values.durationMinutes * 60_000),
        teamMemberIds: values.assigneeIds,
        eventType: "site_visit",
        opportunityId: opportunityId ?? null,
        siteVisitId: siteVisit.id,
        needsSync: true,
      }).catch(() => {/* non-fatal */});

      // 3. Log activity on opportunity timeline
      if (opportunityId) {
        OpportunityService.createActivity({
          companyId: company.id,
          opportunityId,
          clientId: clientId ?? null,
          estimateId: null,
          invoiceId: null,
          projectId: projectId ?? null,
          siteVisitId: siteVisit.id,
          type: ActivityType.SiteVisitScheduled,
          subject: `Site visit scheduled for ${scheduledAt.toLocaleDateString()}`,
          content: values.notes || null,
          outcome: null,
          direction: null,
          durationMinutes: values.durationMinutes,
          attachments: [],
          emailThreadId: null,
          emailMessageId: null,
          isRead: true,
          createdBy: user.id,
        }).catch(() => {/* non-fatal */});

        // 4. Advance from new_lead to qualifying
        if (currentStage === OpportunityStage.NewLead) {
          OpportunityService.moveOpportunityStage(
            opportunityId,
            OpportunityStage.Qualifying,
            user.id
          ).catch(() => {/* non-fatal */});
        }
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });

      toast.success("Site visit scheduled");
      onOpenChange(false);
      onCreated?.(siteVisit.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule site visit");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0A0A0A] border border-[#2A2A2A] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#E5E5E5] font-['Mohave'] text-lg">
            Book Site Visit
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-2">
          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#9CA3AF] flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> Date
              </Label>
              <Input
                type="date"
                {...register("scheduledDate")}
                className="bg-[#111] border-[#333] text-[#E5E5E5]"
              />
              {errors.scheduledDate && (
                <p className="text-xs text-[#93321A]">{errors.scheduledDate.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#9CA3AF] flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Time
              </Label>
              <Input
                type="time"
                {...register("scheduledTime")}
                className="bg-[#111] border-[#333] text-[#E5E5E5]"
              />
              {errors.scheduledTime && (
                <p className="text-xs text-[#93321A]">{errors.scheduledTime.message}</p>
              )}
            </div>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[#9CA3AF]">Duration (minutes)</Label>
            <Input
              type="number"
              min={15}
              step={15}
              {...register("durationMinutes", { valueAsNumber: true })}
              className="bg-[#111] border-[#333] text-[#E5E5E5]"
            />
            {errors.durationMinutes && (
              <p className="text-xs text-[#93321A]">{errors.durationMinutes.message}</p>
            )}
          </div>

          {/* Assignees */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[#9CA3AF] flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Assignees
            </Label>
            <div className="flex flex-wrap gap-2">
              {teamMembers.map((member) => {
                const selected = assigneeIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleAssignee(member.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      selected
                        ? "bg-[#417394] text-white"
                        : "bg-[#1A1A1A] text-[#9CA3AF] hover:text-[#E5E5E5]"
                    }`}
                  >
                    {member.firstName} {member.lastName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[#9CA3AF]">Notes (optional)</Label>
            <Textarea
              {...register("notes")}
              placeholder="Anything to note before the visit…"
              rows={3}
              className="bg-[#111] border-[#333] text-[#E5E5E5] resize-none text-sm"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="flex-1 text-[#9CA3AF]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-[#417394] hover:bg-[#4f8aae] text-white"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Book Site Visit"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
