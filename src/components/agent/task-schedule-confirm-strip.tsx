"use client";

/**
 * S2 Amendment: TaskScheduleConfirmStrip
 *
 * Self-contained wrapper around ConfirmScheduleButton that fetches the
 * company's phase_c status and appointment_confirmation settings. Embedded
 * in task-form edit mode (and anywhere a single task detail lives). Renders
 * nothing when phase_c is off or level === "off".
 */

import { useEffect, useState } from "react";
import type { ProjectTask } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { ConfirmScheduleButton } from "./confirm-schedule-button";
import type {
  AppointmentConfirmationLevel,
  ConfirmMode,
  ClientCommsSettings,
} from "@/lib/types/approval-queue";

interface Props {
  task: ProjectTask;
  onChanged?: () => void;
  className?: string;
}

export function TaskScheduleConfirmStrip({ task, onChanged, className }: Props) {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? null;
  const userId = currentUser?.id ?? null;

  const [phaseCEnabled, setPhaseCEnabled] = useState<boolean | null>(null);
  const [level, setLevel] = useState<AppointmentConfirmationLevel>("off");
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>("explicit");
  const [autoConfirmAfterHours, setAutoConfirmAfterHours] = useState<number>(4);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    (async () => {
      try {
        const { getIdToken } = await import("@/lib/firebase/auth");
        const idToken = await getIdToken();

        // Phase C status via the comms-wizard gating endpoint
        const gatingRes = await fetch(`/api/agent/comms-wizard/gating`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const gatingData = gatingRes.ok ? await gatingRes.json() : null;
        const enabled = Boolean(gatingData?.phaseCEnabled);
        if (cancelled) return;
        setPhaseCEnabled(enabled);

        if (!enabled) return;

        // Settings
        const settingsRes = await fetch(
          `/api/settings/client-comms?companyId=${companyId}`,
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        if (!settingsRes.ok) return;
        const settingsBody = (await settingsRes.json()) as {
          config: ClientCommsSettings;
        };
        if (cancelled) return;

        const cfg = settingsBody.config.appointment_confirmation;
        setLevel(cfg.level);
        setConfirmMode(cfg.confirm_mode);
        setAutoConfirmAfterHours(cfg.auto_confirm_after_hours);
      } catch {
        // Silent — if fetch fails, we just don't render the strip
        if (!cancelled) setPhaseCEnabled(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (phaseCEnabled !== true) return null;
  if (level === "off") return null;

  return (
    <div className={className}>
      <ConfirmScheduleButton
        taskId={task.id}
        hasStartDate={!!task.startDate}
        scheduleConfirmedAt={task.scheduleConfirmedAt ?? null}
        scheduleConfirmedBy={task.scheduleConfirmedBy ?? null}
        currentUserId={userId}
        phaseCEnabled={phaseCEnabled}
        level={level}
        confirmMode={confirmMode}
        autoConfirmAfterHours={autoConfirmAfterHours}
        taskUpdatedAt={task.updatedAt ?? null}
        onChanged={onChanged}
      />
    </div>
  );
}
