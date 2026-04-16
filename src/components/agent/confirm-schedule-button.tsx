"use client";

/**
 * S2 Amendment: ConfirmScheduleButton
 *
 * Renders the "Confirm Schedule" action on a task when phase_c is enabled and
 * the company's appointment_confirmation level is NOT "off". Three display
 * states:
 *
 *   TENTATIVE        — task has start_date but no schedule_confirmed_at
 *                      Click → POST /api/agent/confirm-schedule → fires dispatcher
 *
 *   CONFIRMED        — task.scheduleConfirmedAt is set (optionally with "auto" badge)
 *                      Click → POST /api/agent/unconfirm-schedule → revert
 *
 *   AUTO_PENDING     — confirm_mode is "automatic" and task is still in grace period
 *                      Shows "AUTO-CONFIRMS IN Nh" — no click action
 *
 * Design system compliance:
 *   - 56dp height / tap target
 *   - Mohave UPPERCASE label
 *   - Kosugi [bracket] caption below
 *   - Borders-only — no shadows
 *   - Accent (#597794) ONLY on the primary tentative state (the most important
 *     action on the task sheet when unconfirmed)
 *   - Transitions use opacity + color only; reduced motion respected via 0ms.
 */

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Circle, Loader2, Timer } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

export interface ConfirmScheduleButtonProps {
  taskId: string;
  /** Whether the task has a start_date — button only makes sense if scheduled */
  hasStartDate: boolean;
  /** Current schedule_confirmed_at value (null if unconfirmed) */
  scheduleConfirmedAt: Date | null;
  /** Current user id — used to decide "auto" vs "manual" confirmed badge */
  currentUserId: string | null;
  /** Whoever confirmed (or null if auto) */
  scheduleConfirmedBy: string | null;
  /** Phase C must be enabled for this company */
  phaseCEnabled: boolean;
  /** Current appointment confirmation level from settings */
  level: "off" | "manual" | "draft_on_confirm" | "auto_send_on_confirm" | "full_auto";
  /** Explicit vs automatic confirm mode */
  confirmMode: "explicit" | "automatic";
  /** Grace period hours for automatic mode (used to show countdown) */
  autoConfirmAfterHours: number;
  /** task.updatedAt — used to compute grace period remaining */
  taskUpdatedAt: Date | null;
  /** Called when the confirm/unconfirm round trip completes */
  onChanged?: () => void;
  className?: string;
}

export function ConfirmScheduleButton({
  taskId,
  hasStartDate,
  scheduleConfirmedAt,
  scheduleConfirmedBy,
  phaseCEnabled,
  level,
  confirmMode,
  autoConfirmAfterHours,
  taskUpdatedAt,
  onChanged,
  className,
}: ConfirmScheduleButtonProps) {
  const { t } = useDictionary("comms-wizard");
  const [busy, setBusy] = useState(false);

  const isConfirmed = !!scheduleConfirmedAt;

  // Compute grace period display (confirmMode === "automatic" and not yet confirmed)
  const graceRemainingHours = useMemo(() => {
    if (isConfirmed) return null;
    if (confirmMode !== "automatic") return null;
    if (!taskUpdatedAt) return null;
    const deadline = taskUpdatedAt.getTime() + autoConfirmAfterHours * 60 * 60 * 1000;
    const ms = deadline - Date.now();
    return ms > 0 ? Math.ceil(ms / (60 * 60 * 1000)) : 0;
  }, [isConfirmed, confirmMode, taskUpdatedAt, autoConfirmAfterHours]);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch("/api/agent/confirm-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Confirm failed");
      }

      const data = await res.json();
      toast.success(
        data.actionTaken === "off" || data.actionTaken === "manual"
          ? t("confirmButton.confirmedNoAction")
          : t("confirmButton.confirmedWithAction")
      );
      onChanged?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [taskId, t, onChanged]);

  const handleUnconfirm = useCallback(async () => {
    setBusy(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch("/api/agent/unconfirm-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Unconfirm failed");
      }

      toast.success(t("confirmButton.unconfirmed"));
      onChanged?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [taskId, t, onChanged]);

  // ── Early-exit: don't render if phase_c is off, level is off, or the task
  //               has no scheduled date. Checked AFTER all hooks to satisfy
  //               react-hooks/rules-of-hooks.
  if (!phaseCEnabled) return null;
  if (level === "off") return null;
  if (!hasStartDate) return null;

  // ── Render: confirmed state ────────────────────────────────────────────
  if (isConfirmed) {
    const caption = scheduleConfirmedBy
      ? t("confirmButton.captionConfirmedManual")
      : t("confirmButton.captionConfirmedAuto");

    return (
      <button
        type="button"
        onClick={handleUnconfirm}
        disabled={busy}
        className={cn(
          "flex items-center gap-3 min-h-[56px] px-4 rounded-[8px]",
          "border border-[rgba(255,255,255,0.12)]",
          "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]",
          "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "hover:border-[rgba(255,255,255,0.24)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "motion-reduce:transition-none",
          className
        )}
      >
        {busy ? (
          <Loader2 className="w-[16px] h-[16px] text-text-2 motion-reduce:animate-none animate-spin" />
        ) : (
          <CheckCircle2 className="w-[16px] h-[16px] text-text" />
        )}
        <span className="flex flex-col items-start leading-tight">
          <span className="font-mohave text-[14px] text-text uppercase tracking-[0.04em]">
            {t("confirmButton.labelConfirmed")}
          </span>
          <span className="font-kosugi text-[11px] text-text-3">
            [{caption}]
          </span>
        </span>
      </button>
    );
  }

  // ── Render: auto-pending grace period ──────────────────────────────────
  if (graceRemainingHours !== null && graceRemainingHours > 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 min-h-[56px] px-4 rounded-[8px]",
          "border border-[rgba(255,255,255,0.08)]",
          "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]",
          className
        )}
      >
        <Timer className="w-[16px] h-[16px] text-text-3" />
        <span className="flex flex-col items-start leading-tight">
          <span className="font-mohave text-[14px] text-text-2 uppercase tracking-[0.04em]">
            {t("confirmButton.labelAutoPending")}
          </span>
          <span className="font-kosugi text-[11px] text-text-3">
            [{t("confirmButton.captionAutoIn").replace(
              "{{hours}}",
              String(graceRemainingHours)
            )}]
          </span>
        </span>
      </div>
    );
  }

  // ── Render: tentative (primary action — accent-bordered) ──────────────
  return (
    <button
      type="button"
      onClick={handleConfirm}
      disabled={busy}
      className={cn(
        "flex items-center gap-3 min-h-[56px] px-4 rounded-[8px]",
        "border border-[#597794]",
        "bg-[rgba(89,119,148,0.08)]",
        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:bg-[rgba(89,119,148,0.14)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "motion-reduce:transition-none",
        className
      )}
    >
      {busy ? (
        <Loader2 className="w-[16px] h-[16px] text-[#597794] motion-reduce:animate-none animate-spin" />
      ) : (
        <Circle className="w-[16px] h-[16px] text-[#597794]" />
      )}
      <span className="flex flex-col items-start leading-tight">
        <span className="font-mohave text-[14px] text-text uppercase tracking-[0.04em]">
          {t("confirmButton.labelTentative")}
        </span>
        <span className="font-kosugi text-[11px] text-text-3">
          [{t("confirmButton.captionTentative")}]
        </span>
      </span>
    </button>
  );
}
