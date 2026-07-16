"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDictionary } from "@/i18n/client";
import type {
  EligibleRoleAssignmentTarget,
  StrandedRoleAssignment,
} from "@/lib/api/services/guarded-permission-types";

export interface LeadResponsibilityResolutionPrompt {
  stranded: StrandedRoleAssignment[];
  eligibleAssignees: EligibleRoleAssignmentTarget[];
}

const UNASSIGNED_DESTINATION = "__unassigned__";

function assignmentTargetName(target: EligibleRoleAssignmentTarget): string {
  return (
    [target.first_name, target.last_name].filter(Boolean).join(" ").trim() ||
    target.role ||
    target.id
  );
}

export function LeadResponsibilityResolutionDialog({
  pending,
  loading,
  onCancel,
  onConfirm,
}: {
  pending: LeadResponsibilityResolutionPrompt | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (destinations: ReadonlyMap<string, string | null>) => void;
}) {
  const { t } = useDictionary("settings");
  const [destinations, setDestinations] = useState<Map<string, string | null>>(
    new Map()
  );

  useEffect(() => {
    setDestinations(new Map());
  }, [pending]);

  const complete =
    pending !== null &&
    pending.stranded.length > 0 &&
    pending.stranded.every((lead) => destinations.has(lead.opportunity_id));

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>{t("roles.assignmentResolutionTitle")}</DialogTitle>
          <DialogDescription>
            {t("roles.assignmentResolutionDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {pending?.stranded.map((lead) => {
            const selected = destinations.has(lead.opportunity_id)
              ? (destinations.get(lead.opportunity_id) ??
                UNASSIGNED_DESTINATION)
              : "";
            return (
              <div
                key={lead.opportunity_id}
                className="glass-surface flex flex-col items-stretch justify-between gap-2 rounded-panel p-2 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-mohave text-body-sm text-text">
                    {lead.title || t("roles.assignmentUntitledLead")}
                  </p>
                  <p className="font-mono text-micro uppercase tracking-[0.12em] text-text-3">
                    {t("roles.assignmentDestinationLabel")}
                  </p>
                </div>
                <div className="w-full sm:w-1/2">
                  <Select
                    value={selected}
                    disabled={loading}
                    onValueChange={(value) => {
                      setDestinations((current) => {
                        const next = new Map(current);
                        next.set(
                          lead.opportunity_id,
                          value === UNASSIGNED_DESTINATION ? null : value
                        );
                        return next;
                      });
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("roles.assignmentDestinationLabel")}
                    >
                      <SelectValue
                        placeholder={t("roles.assignmentChooseDestination")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED_DESTINATION}>
                        {t("roles.assignmentUnassignedQueue")}
                      </SelectItem>
                      {pending.eligibleAssignees.map((target) => (
                        <SelectItem key={target.id} value={target.id}>
                          {assignmentTargetName(target)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {t("roles.assignmentKeepAccess")}
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(destinations)}
            disabled={!complete || loading}
            loading={loading}
          >
            {t("roles.assignmentReassignAndSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
