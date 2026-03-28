"use client";

/**
 * OPS Web - Create Site Visit Modal
 *
 * Form for scheduling a site visit. Creates:
 *   1. SiteVisit row in Supabase
 *   2. CalendarEvent in Supabase (eventType: 'site_visit')
 *   3. Activity on opportunity timeline (type: 'site_visit_scheduled')
 *   4. Advances opportunity from 'new_lead' → 'qualifying' if applicable
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarDays, Clock, Users, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { useCreateSiteVisit } from "@/lib/hooks/use-site-visits";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { CalendarService } from "@/lib/api/services";
import { OpportunityService } from "@/lib/api/services";
import { ActivityType, OpportunityStage, SiteVisitStatus } from "@/lib/types/pipeline";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { getUserFullName, getInitials } from "@/lib/types/models";

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

      // 2. Create calendar event (fire-and-forget)
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">
            Book Site Visit
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-2 mt-1">
          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              label="Date"
              type="date"
              prefixIcon={<CalendarDays className="w-[16px] h-[16px]" />}
              {...register("scheduledDate")}
              error={errors.scheduledDate?.message}
            />
            <Input
              label="Time"
              type="time"
              prefixIcon={<Clock className="w-[16px] h-[16px]" />}
              {...register("scheduledTime")}
              error={errors.scheduledTime?.message}
            />
          </div>

          {/* Duration */}
          <Input
            label="Duration (minutes)"
            type="number"
            min={15}
            step={15}
            {...register("durationMinutes", { valueAsNumber: true })}
            error={errors.durationMinutes?.message}
          />

          {/* Assignees */}
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest flex items-center gap-[6px]">
              <Users className="w-[14px] h-[14px]" /> Assignees
            </label>
            <div className="flex flex-wrap gap-1">
              {teamMembers.map((member) => {
                const selected = assigneeIds.includes(member.id);
                const fullName = getUserFullName(member);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleAssignee(member.id)}
                    className={cn(
                      "flex items-center gap-[6px] px-1.5 py-[6px] rounded-sm border transition-all",
                      "font-mohave text-body-sm",
                      selected
                        ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                        : "bg-background-input border-border text-text-tertiary hover:text-text-secondary hover:border-border-medium"
                    )}
                  >
                    <span
                      className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[9px] font-mohave text-white shrink-0"
                      style={{ backgroundColor: member.userColor ?? "#59779F" }}
                    >
                      {selected ? (
                        <Check className="w-[12px] h-[12px]" />
                      ) : (
                        getInitials(fullName)
                      )}
                    </span>
                    {fullName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <Textarea
            label="Notes (optional)"
            {...register("notes")}
            placeholder="Anything to note before the visit..."
            rows={3}
          />

          <div className="flex items-center justify-end gap-1 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting}
              className="gap-[6px]"
            >
              Book Site Visit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
