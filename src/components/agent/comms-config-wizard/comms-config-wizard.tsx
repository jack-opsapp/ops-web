"use client";

/**
 * S2 Amendment — Communications Configuration Wizard
 *
 * 10-step wizard that walks the user through setting up every autonomous
 * email type the agent can send. Appears:
 *   - When writing profile confidence crosses 0.75 (milestone notification)
 *   - When phase_c is first enabled for the company
 *   - When the user clicks "Re-run Setup Wizard" in settings
 *
 * State is held in-memory until Step 10 "Finish", at which point it persists
 * to client_comms_settings with comms_wizard_completed_at + comms_wizard_version
 * set. Re-running pre-populates from the current stored settings.
 *
 * Design system: full-height dark page, frosted-glass panel max-w-640, Mohave
 * UPPERCASE headings, Kosugi bracket captions, 56dp tap targets everywhere.
 * Transitions: opacity+translateX 250ms, reduced-motion falls back to fade.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarCheck,
  CalendarDays,
  Check,
  DollarSign,
  FileText,
  Loader2,
  Repeat,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { useDictionary } from "@/i18n/client";
import {
  DEFAULT_CLIENT_COMMS_SETTINGS,
  CURRENT_COMMS_WIZARD_VERSION,
  type ClientCommsSettings,
  type AppointmentConfirmationLevel,
  type ConfirmMode,
  type RescheduleBehavior,
  type SimpleAutonomy,
  type StatusUpdateCadence,
  type PaymentReminderPreset,
  type RescheduleRequestBehavior,
  type SubcontractorTrigger,
} from "@/lib/types/approval-queue";
import { EmailCategoryAutonomy } from "@/components/settings/email-category-autonomy";
import {
  StepShell,
  OptionCard,
  Toggle,
  StepSlider,
  StepDropdown,
  PreviewPanel,
  WarningBanner,
} from "./shared";

const TOTAL_STEPS = 10;

// Full-auto gating thresholds — must stay in sync with the gating endpoint
const FULL_AUTO_MIN_CONFIDENCE = 0.85;
const FULL_AUTO_MIN_PRIORS = 50;

// ─── Main component ─────────────────────────────────────────────────────────

export function CommsConfigWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useDictionary("comms-wizard");
  const { company } = useAuthStore();
  const reduceMotion = useReducedMotion();

  const companyId = company?.id ?? null;

  // Deep-link support: `?step=N` (1-10). Invalid/missing → start at step 1.
  const initialStep = useMemo(() => {
    const raw = searchParams?.get("step");
    if (!raw) return 1;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    const clamped = Math.max(1, Math.min(TOTAL_STEPS, Math.round(n)));
    return clamped;
  }, [searchParams]);

  const [step, setStep] = useState(initialStep);
  const [settings, setSettings] = useState<ClientCommsSettings>(
    DEFAULT_CLIENT_COMMS_SETTINGS
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Scroll to top on step change (including initial deep-link arrival).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [step, reduceMotion]);

  // Gating for FULL AUTO appointment confirmation
  const [gating, setGating] = useState({
    writingProfileConfidence: 0,
    priorConfirmationsSent: 0,
  });

  // ─── Initial load: settings + gating ─────────────────────────────────────
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const { getIdToken } = await import("@/lib/firebase/auth");
        const idToken = await getIdToken();

        const [settingsRes, gatingRes] = await Promise.all([
          fetch(`/api/settings/client-comms?companyId=${companyId}`, {
            headers: { Authorization: `Bearer ${idToken}` },
          }),
          fetch(`/api/agent/comms-wizard/gating`, {
            headers: { Authorization: `Bearer ${idToken}` },
          }),
        ]);

        if (cancelled) return;

        if (settingsRes.ok) {
          const data = (await settingsRes.json()) as {
            config: ClientCommsSettings;
          };
          setSettings(data.config);
        }

        if (gatingRes.ok) {
          const data = await gatingRes.json();
          setGating({
            writingProfileConfidence:
              Number(data.writingProfileConfidence) || 0,
            priorConfirmationsSent: Number(data.priorConfirmationsSent) || 0,
          });
        }
      } catch {
        // Use defaults on error — user can still complete the wizard
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // ─── FULL AUTO gating ────────────────────────────────────────────────────
  const fullAutoUnlocked = useMemo(() => {
    return (
      gating.writingProfileConfidence >= FULL_AUTO_MIN_CONFIDENCE &&
      gating.priorConfirmationsSent >= FULL_AUTO_MIN_PRIORS
    );
  }, [gating]);

  // ─── Navigation ──────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (step > 1) setStep(step - 1);
  }, [step]);

  const handleNext = useCallback(() => {
    if (step < TOTAL_STEPS) setStep(step + 1);
  }, [step]);

  // ─── Save + finish ───────────────────────────────────────────────────────
  const persistAndExit = useCallback(
    async (redirectTo: string) => {
      if (!companyId) return;
      setSaving(true);
      try {
        const { getIdToken } = await import("@/lib/firebase/auth");
        const idToken = await getIdToken();

        const payload: ClientCommsSettings = {
          ...settings,
          comms_wizard_completed_at: new Date().toISOString(),
          comms_wizard_version: CURRENT_COMMS_WIZARD_VERSION,
        };

        const res = await fetch("/api/settings/client-comms", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ companyId, config: payload }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          // Prefer the server-provided error; fall back to the i18n save-failed
          // message so users don't see raw English even for the generic case.
          throw new Error(err.error ?? t("errors.saveFailed"));
        }

        toast.success(t("finish.saved"));
        router.push(redirectTo);
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t("errors.unknown");
        toast.error(message);
      } finally {
        setSaving(false);
      }
    },
    [companyId, settings, router, t]
  );

  // ─── Step-specific setters ───────────────────────────────────────────────
  const updateAppointmentConfirmation = (
    partial: Partial<ClientCommsSettings["appointment_confirmation"]>
  ) =>
    setSettings((s) => {
      const next = { ...s.appointment_confirmation, ...partial };
      // Invariant: reschedule_behavior = "auto_send" is contradictory with
      // level = "manual". If the user downgrades to manual, reset the
      // behavior to the recommended "draft" so the summary is consistent.
      if (next.level === "manual" && next.reschedule_behavior === "auto_send") {
        next.reschedule_behavior = "draft";
      }
      return {
        ...s,
        appointment_confirmation: next,
      };
    });

  const updateAppointmentReminder = (
    partial: Partial<ClientCommsSettings["appointment_reminder"]>
  ) =>
    setSettings((s) => ({
      ...s,
      appointment_reminder: { ...s.appointment_reminder, ...partial },
    }));

  const updateStatusUpdate = (
    partial: Partial<ClientCommsSettings["status_update"]>
  ) =>
    setSettings((s) => ({
      ...s,
      status_update: { ...s.status_update, ...partial },
    }));

  const updatePaymentReminder = (
    partial: Partial<ClientCommsSettings["payment_reminder"]>
  ) =>
    setSettings((s) => ({
      ...s,
      payment_reminder: { ...s.payment_reminder, ...partial },
    }));

  const updateInvoiceCover = (
    partial: Partial<ClientCommsSettings["invoice_cover"]>
  ) =>
    setSettings((s) => ({
      ...s,
      invoice_cover: { ...s.invoice_cover, ...partial },
    }));

  const updateRescheduleRequest = (
    partial: Partial<ClientCommsSettings["reschedule_request"]>
  ) =>
    setSettings((s) => ({
      ...s,
      reschedule_request: { ...s.reschedule_request, ...partial },
    }));

  const updateSubcontractor = (
    partial: Partial<ClientCommsSettings["subcontractor_coordination"]>
  ) =>
    setSettings((s) => ({
      ...s,
      subcontractor_coordination: {
        ...s.subcontractor_coordination,
        ...partial,
      },
    }));

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2
          className={cn(
            "w-[18px] h-[18px] text-text-3",
            !reduceMotion && "animate-spin"
          )}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col bg-black">
      {/* Progress indicator */}
      <ProgressBar step={step} />

      {/* Step body — opacity+translateX on step change, cross-fade under reduced motion */}
      <motion.div
        key={step}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        // EASE_SMOOTH = [0.22, 1, 0.36, 1] — matches system.md
        transition={{
          duration: reduceMotion ? 0.2 : 0.25,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="flex-1 flex items-start justify-center px-4 py-8"
      >
        {step === 1 && <StepWelcome t={t} onBegin={handleNext} />}
        {step === 2 && (
          <StepStatusUpdates
            t={t}
            value={settings.status_update}
            onChange={updateStatusUpdate}
          />
        )}
        {step === 3 && (
          <StepAppointmentConfirmation
            t={t}
            value={settings.appointment_confirmation}
            onChange={updateAppointmentConfirmation}
            fullAutoUnlocked={fullAutoUnlocked}
            gating={gating}
          />
        )}
        {step === 4 && (
          <StepAppointmentReminder
            t={t}
            value={settings.appointment_reminder}
            onChange={updateAppointmentReminder}
          />
        )}
        {step === 5 && (
          <StepPaymentReminder
            t={t}
            value={settings.payment_reminder}
            onChange={updatePaymentReminder}
          />
        )}
        {step === 6 && (
          <StepInvoiceCover
            t={t}
            value={settings.invoice_cover}
            onChange={updateInvoiceCover}
          />
        )}
        {step === 7 && (
          <StepRescheduleRequest
            t={t}
            value={settings.reschedule_request}
            onChange={updateRescheduleRequest}
          />
        )}
        {step === 8 && (
          <StepSubcontractor
            t={t}
            value={settings.subcontractor_coordination}
            onChange={updateSubcontractor}
          />
        )}
        {step === 9 && <StepCategories t={t} />}
        {step === 10 && (
          <StepSummary
            t={t}
            settings={settings}
            saving={saving}
            onFinish={() => persistAndExit("/agent/queue")}
            onOpenSettings={() =>
              persistAndExit("/settings?tab=client-comms")
            }
          />
        )}
      </motion.div>

      {/* Footer navigation */}
      {step < 10 && (
        <div className="border-t border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2]">
          <div className="max-w-[640px] mx-auto px-4 py-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1}
              className={cn(
                "flex items-center gap-2 min-h-[56px] px-5 rounded-[8px]",
                "border border-[rgba(255,255,255,0.12)] bg-transparent",
                "font-mohave text-[14px] text-text-2 uppercase tracking-[0.04em]",
                "transition-colors duration-150 motion-reduce:transition-none",
                "hover:border-[rgba(255,255,255,0.24)]",
                "disabled:opacity-30 disabled:cursor-not-allowed"
              )}
            >
              <ArrowLeft className="w-[14px] h-[14px]" />
              {t("nav.back")}
            </button>
            <button
              type="button"
              onClick={handleNext}
              className={cn(
                "flex items-center gap-2 min-h-[56px] px-5 rounded-[8px]",
                "border border-[#6F94B0] bg-ops-accent",
                "font-mohave text-[14px] text-text uppercase tracking-[0.04em]",
                "transition-colors duration-150 motion-reduce:transition-none",
                "hover:bg-[#6A8AA8] hover:border-[#6A8AA8]"
              )}
            >
              {step === 9 ? t("nav.review") : t("nav.next")}
              <ArrowRight className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Progress bar ───────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="border-b border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2]">
      <div className="max-w-[640px] mx-auto px-4 py-3">
        <div className="flex items-center gap-1">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const segStep = i + 1;
            const filled = segStep <= step;
            const current = segStep === step;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={cn(
                    "w-full h-[2px] rounded-full",
                    "transition-colors duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                    "motion-reduce:transition-none",
                    filled
                      ? current
                        ? "bg-ops-accent"
                        : "bg-text-primary"
                      : "bg-[rgba(255,255,255,0.08)]"
                  )}
                />
                <span
                  className={cn(
                    "font-kosugi text-micro tracking-[0.1em]",
                    current ? "text-text" : "text-text-3"
                  )}
                >
                  {String(segStep).padStart(2, "0")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Welcome ────────────────────────────────────────────────────────

type T = (key: string) => string;

function StepWelcome({ t, onBegin }: { t: T; onBegin: () => void }) {
  const emailTypes: Array<{ key: string; Icon: LucideIcon }> = [
    { key: "statusUpdates", Icon: CalendarDays },
    { key: "appointmentConfirmations", Icon: CalendarCheck },
    { key: "appointmentReminders", Icon: Bell },
    { key: "paymentReminders", Icon: DollarSign },
    { key: "invoiceCover", Icon: FileText },
    { key: "rescheduleReplies", Icon: Repeat },
    { key: "subcontractor", Icon: Users },
  ];
  return (
    <StepShell
      stepNumber={1}
      stepLabel={t("progress.label")}
      title={t("step1.title")}
      description={t("step1.description")}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {emailTypes.map(({ key, Icon }) => (
          <div
            key={key}
            className="p-3 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] flex items-start gap-3"
          >
            <div
              className="w-[32px] h-[32px] rounded-[4px] shrink-0 flex items-center justify-center bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]"
              aria-hidden="true"
            >
              <Icon className="w-[16px] h-[16px] text-text-2" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mohave text-[13px] text-text uppercase tracking-[0.04em]">
                {t(`step1.types.${key}.title`)}
              </div>
              <div className="font-kosugi text-[11px] text-text-3 mt-1">
                [{t(`step1.types.${key}.caption`)}]
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 rounded-[4px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
        <p className="font-kosugi text-[12px] text-text-2">
          [{t("step1.estimate")}]
        </p>
      </div>

      <div className="pt-2 flex justify-end">
        <button
          type="button"
          onClick={onBegin}
          className={cn(
            "flex items-center gap-2 min-h-[56px] px-6 rounded-[8px]",
            "border border-[#6F94B0] bg-ops-accent",
            "font-mohave text-[14px] text-text uppercase tracking-[0.04em]",
            "transition-colors duration-150 motion-reduce:transition-none",
            "hover:bg-[#6A8AA8] hover:border-[#6A8AA8]"
          )}
        >
          {t("step1.beginSetup")}
          <ArrowRight className="w-[14px] h-[14px]" />
        </button>
      </div>
    </StepShell>
  );
}

// ─── Step 2: Status updates ─────────────────────────────────────────────────

function StepStatusUpdates({
  t,
  value,
  onChange,
}: {
  t: T;
  value: ClientCommsSettings["status_update"];
  onChange: (partial: Partial<ClientCommsSettings["status_update"]>) => void;
}) {
  const cadences: StatusUpdateCadence[] = [
    "off",
    "weekly",
    "biweekly",
    "monthly",
    "on_stage_change",
  ];
  // Day-of-week options (Monday-Sunday). Monday is the default for business
  // cadence — most contractors send weekly updates at the start of the week.
  const weekDayOptions: Array<{ value: number; label: string }> = [
    { value: 1, label: t("step2.weekDay.monday") },
    { value: 2, label: t("step2.weekDay.tuesday") },
    { value: 3, label: t("step2.weekDay.wednesday") },
    { value: 4, label: t("step2.weekDay.thursday") },
    { value: 5, label: t("step2.weekDay.friday") },
    { value: 6, label: t("step2.weekDay.saturday") },
    { value: 0, label: t("step2.weekDay.sunday") },
  ];
  return (
    <StepShell
      stepNumber={2}
      stepLabel={t("progress.label")}
      title={t("step2.title")}
      description={t("step2.description")}
    >
      {cadences.map((c) => (
        <OptionCard
          key={c}
          title={t(`step2.cadence.${c}.title`)}
          description={t(`step2.cadence.${c}.caption`)}
          selected={value.cadence === c}
          onSelect={() => onChange({ cadence: c })}
        />
      ))}

      {value.cadence === "weekly" && (
        <StepDropdown
          label={t("step2.weeklyDayLabel")}
          value={value.weekly_day}
          options={weekDayOptions}
          onChange={(weekly_day) => onChange({ weekly_day })}
        />
      )}

      {value.cadence !== "off" && (
        <div className="pt-3 space-y-3">
          <AutonomyPicker
            t={t}
            value={value.autonomy}
            onChange={(autonomy) => onChange({ autonomy })}
            allowAutoSend={true}
          />
          {value.autonomy === "auto_send" && (
            <>
              <WarningBanner>{t("step2.autoSendWarning")}</WarningBanner>
              <StepSlider
                label={t("step2.sendDelay")}
                value={value.send_delay_minutes}
                min={0}
                max={60}
                step={5}
                valueLabel={t("minutes").replace(
                  "{{n}}",
                  String(value.send_delay_minutes)
                )}
                onChange={(send_delay_minutes) => onChange({ send_delay_minutes })}
              />
            </>
          )}
        </div>
      )}

      <PreviewPanel label={t("preview.emailLabel")}>
        {t("step2.previewBody")}
      </PreviewPanel>
    </StepShell>
  );
}

// ─── Step 3: Appointment confirmations (5 levels) ───────────────────────────

function StepAppointmentConfirmation({
  t,
  value,
  onChange,
  fullAutoUnlocked,
  gating,
}: {
  t: T;
  value: ClientCommsSettings["appointment_confirmation"];
  onChange: (
    partial: Partial<ClientCommsSettings["appointment_confirmation"]>
  ) => void;
  fullAutoUnlocked: boolean;
  gating: { writingProfileConfidence: number; priorConfirmationsSent: number };
}) {
  const levels: AppointmentConfirmationLevel[] = [
    "off",
    "manual",
    "draft_on_confirm",
    "auto_send_on_confirm",
    "full_auto",
  ];

  const confirmModes: ConfirmMode[] = ["explicit", "automatic"];
  const rescheduleOptions: RescheduleBehavior[] = [
    "do_nothing",
    "notify",
    "draft",
    "auto_send",
  ];

  const showConfirmModeSubQ =
    value.level === "draft_on_confirm" || value.level === "auto_send_on_confirm";
  const showDelaySubQ =
    value.level === "auto_send_on_confirm" || value.level === "full_auto";
  const showRescheduleSubQ = value.level !== "off";

  const lockedReason = !fullAutoUnlocked
    ? t("step3.fullAuto.lockedReason")
        .replace(
          "{{confidence}}",
          String(Math.round(gating.writingProfileConfidence * 100))
        )
        .replace(
          "{{priors}}",
          String(gating.priorConfirmationsSent)
        )
    : undefined;

  return (
    <StepShell
      stepNumber={3}
      stepLabel={t("progress.label")}
      title={t("step3.title")}
      description={t("step3.description")}
    >
      {levels.map((level) => (
        <OptionCard
          key={level}
          title={t(`step3.level.${level}.title`)}
          description={t(`step3.level.${level}.caption`)}
          selected={value.level === level}
          recommended={level === "draft_on_confirm"}
          locked={level === "full_auto" && !fullAutoUnlocked}
          lockedReason={level === "full_auto" ? lockedReason : undefined}
          onSelect={() => onChange({ level })}
        />
      ))}

      {showConfirmModeSubQ && (
        <div className="pt-3 space-y-2">
          <div className="font-mohave text-[12px] text-text-3 uppercase tracking-[0.08em]">
            {t("step3.subQ.confirmMode")}
          </div>
          {confirmModes.map((m) => (
            <OptionCard
              key={m}
              title={t(`step3.confirmMode.${m}.title`)}
              description={t(`step3.confirmMode.${m}.caption`)}
              selected={value.confirm_mode === m}
              onSelect={() => onChange({ confirm_mode: m })}
            />
          ))}
          {value.confirm_mode === "automatic" && (
            <StepSlider
              label={t("step3.subQ.gracePeriod")}
              value={value.auto_confirm_after_hours}
              min={1}
              max={24}
              step={1}
              valueLabel={t("hours").replace(
                "{{n}}",
                String(value.auto_confirm_after_hours)
              )}
              onChange={(auto_confirm_after_hours) =>
                onChange({ auto_confirm_after_hours })
              }
            />
          )}
        </div>
      )}

      {showDelaySubQ && (
        <div className="pt-3">
          <div className="font-mohave text-[12px] text-text-3 uppercase tracking-[0.08em] mb-2">
            {t("step3.subQ.sendDelay")}
          </div>
          <StepSlider
            label={t("step3.subQ.sendDelayLabel")}
            value={value.send_delay_minutes}
            min={0}
            max={60}
            step={5}
            valueLabel={t("minutes").replace(
              "{{n}}",
              String(value.send_delay_minutes)
            )}
            onChange={(send_delay_minutes) => onChange({ send_delay_minutes })}
          />
        </div>
      )}

      {showRescheduleSubQ && (
        <div className="pt-3 space-y-2">
          <div className="font-mohave text-[12px] text-text-3 uppercase tracking-[0.08em]">
            {t("step3.subQ.rescheduleBehavior")}
          </div>
          {rescheduleOptions
            // Hide the auto_send reschedule behavior when parent level is
            // manual — picking "manual only" and then "auto-send on change"
            // is internally contradictory and confuses users.
            .filter((rb) => !(rb === "auto_send" && value.level === "manual"))
            .map((rb) => (
              <OptionCard
                key={rb}
                title={t(`step3.reschedule.${rb}.title`)}
                description={t(`step3.reschedule.${rb}.caption`)}
                selected={value.reschedule_behavior === rb}
                recommended={rb === "draft"}
                onSelect={() => onChange({ reschedule_behavior: rb })}
              />
            ))}
        </div>
      )}

      {value.level === "full_auto" && (
        <WarningBanner>{t("step3.fullAuto.warning")}</WarningBanner>
      )}

      <PreviewPanel label={t("preview.emailLabel")}>
        {t("step3.previewBody")}
      </PreviewPanel>
    </StepShell>
  );
}

// ─── Step 4: Appointment reminders ──────────────────────────────────────────

function StepAppointmentReminder({
  t,
  value,
  onChange,
}: {
  t: T;
  value: ClientCommsSettings["appointment_reminder"];
  onChange: (
    partial: Partial<ClientCommsSettings["appointment_reminder"]>
  ) => void;
}) {
  return (
    <StepShell
      stepNumber={4}
      stepLabel={t("progress.label")}
      title={t("step4.title")}
      description={t("step4.description")}
    >
      <Toggle
        label={t("step4.enable")}
        checked={value.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      {value.enabled && (
        <>
          <StepSlider
            label={t("step4.leadDays")}
            value={value.lead_days}
            min={0}
            max={7}
            step={1}
            valueLabel={
              value.lead_days === 0
                ? t("step4.dayOf")
                : t("days").replace("{{n}}", String(value.lead_days))
            }
            onChange={(lead_days) => onChange({ lead_days })}
          />
          <StepSlider
            label={t("step4.sendHour")}
            value={value.send_hour_local}
            min={6}
            max={20}
            step={1}
            valueLabel={formatHour(value.send_hour_local)}
            onChange={(send_hour_local) => onChange({ send_hour_local })}
          />
          <Toggle
            label={t("step4.includeWeather")}
            checked={value.include_weather}
            onChange={(include_weather) => onChange({ include_weather })}
          />
          <AutonomyPicker
            t={t}
            value={value.autonomy}
            onChange={(autonomy) => onChange({ autonomy })}
            allowAutoSend={true}
          />
          {value.autonomy === "auto_send" && (
            <StepSlider
              label={t("sendDelay")}
              value={value.send_delay_minutes}
              min={0}
              max={60}
              step={5}
              valueLabel={t("minutes").replace(
                "{{n}}",
                String(value.send_delay_minutes)
              )}
              onChange={(send_delay_minutes) =>
                onChange({ send_delay_minutes })
              }
            />
          )}
          <PreviewPanel label={t("preview.emailLabel")}>
            {t("step4.previewBody")}
          </PreviewPanel>
        </>
      )}
    </StepShell>
  );
}

// ─── Step 5: Payment reminders ──────────────────────────────────────────────

function StepPaymentReminder({
  t,
  value,
  onChange,
}: {
  t: T;
  value: ClientCommsSettings["payment_reminder"];
  onChange: (
    partial: Partial<ClientCommsSettings["payment_reminder"]>
  ) => void;
}) {
  const presets: PaymentReminderPreset[] = [
    "standard",
    "gentle",
    "aggressive",
    "custom",
  ];
  return (
    <StepShell
      stepNumber={5}
      stepLabel={t("progress.label")}
      title={t("step5.title")}
      description={t("step5.description")}
    >
      <Toggle
        label={t("step5.enable")}
        checked={value.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      {value.enabled && (
        <>
          <div className="font-mohave text-[12px] text-text-3 uppercase tracking-[0.08em] pt-2">
            {t("step5.preset")}
          </div>
          {presets.map((p) => (
            <OptionCard
              key={p}
              title={t(`step5.preset.${p}.title`)}
              description={t(`step5.preset.${p}.caption`)}
              selected={value.preset === p}
              recommended={p === "standard"}
              onSelect={() => onChange({ preset: p })}
            />
          ))}

          {value.preset === "custom" && (
            <div className="space-y-2 pt-2">
              {[0, 1, 2, 3].map((idx) => (
                <StepSlider
                  key={idx}
                  label={t(`step5.customDay.${idx}`)}
                  value={value.custom_days[idx]}
                  min={1}
                  max={180}
                  step={1}
                  valueLabel={t("days").replace(
                    "{{n}}",
                    String(value.custom_days[idx])
                  )}
                  onChange={(n) => {
                    const next = [...value.custom_days] as [
                      number,
                      number,
                      number,
                      number,
                    ];
                    next[idx] = n;
                    onChange({ custom_days: next });
                  }}
                />
              ))}
            </div>
          )}

          <StepSlider
            label={t("step5.maxReminders")}
            value={value.max_reminders}
            min={1}
            max={4}
            step={1}
            valueLabel={String(value.max_reminders)}
            onChange={(max_reminders) => onChange({ max_reminders })}
          />

          <AutonomyPicker
            t={t}
            value={value.autonomy}
            onChange={(autonomy) => onChange({ autonomy })}
            allowAutoSend={true}
          />
          {value.autonomy === "auto_send" && (
            <>
              <WarningBanner>{t("step5.autoSendWarning")}</WarningBanner>
              <StepSlider
                label={t("sendDelay")}
                value={value.send_delay_minutes}
                min={0}
                max={60}
                step={5}
                valueLabel={t("minutes").replace(
                  "{{n}}",
                  String(value.send_delay_minutes)
                )}
                onChange={(send_delay_minutes) =>
                  onChange({ send_delay_minutes })
                }
              />
            </>
          )}
        </>
      )}
    </StepShell>
  );
}

// ─── Step 6: Invoice cover emails ───────────────────────────────────────────

function StepInvoiceCover({
  t,
  value,
  onChange,
}: {
  t: T;
  value: ClientCommsSettings["invoice_cover"];
  onChange: (partial: Partial<ClientCommsSettings["invoice_cover"]>) => void;
}) {
  return (
    <StepShell
      stepNumber={6}
      stepLabel={t("progress.label")}
      title={t("step6.title")}
      description={t("step6.description")}
    >
      <Toggle
        label={t("step6.enable")}
        checked={value.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      {value.enabled && (
        <>
          <div className="p-4 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2]">
            <div className="font-mohave text-[13px] text-text-2 uppercase tracking-[0.06em] mb-2">
              {t("step6.threshold")}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-kosugi text-[12px] text-text-3">
                $
              </span>
              <input
                type="number"
                min={0}
                step={100}
                value={value.threshold}
                onChange={(e) =>
                  onChange({ threshold: Math.max(0, Number(e.target.value) || 0) })
                }
                className="flex-1 min-h-[48px] px-3 rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] font-mono text-[14px] text-text outline-none focus:border-[#6F94B0] transition-colors motion-reduce:transition-none"
              />
            </div>
            <div className="font-kosugi text-[11px] text-text-3 mt-2">
              [{t("step6.thresholdHint")}]
            </div>
          </div>

          <AutonomyPicker
            t={t}
            value={value.autonomy}
            onChange={(autonomy) => onChange({ autonomy })}
            allowAutoSend={true}
          />
          {value.autonomy === "auto_send" && (
            <WarningBanner>{t("step6.autoSendWarning")}</WarningBanner>
          )}
        </>
      )}
    </StepShell>
  );
}

// ─── Step 7: Reschedule requests ────────────────────────────────────────────

function StepRescheduleRequest({
  t,
  value,
  onChange,
}: {
  t: T;
  value: ClientCommsSettings["reschedule_request"];
  onChange: (
    partial: Partial<ClientCommsSettings["reschedule_request"]>
  ) => void;
}) {
  const behaviors: RescheduleRequestBehavior[] = [
    "detect_only",
    "detect_and_draft",
  ];
  return (
    <StepShell
      stepNumber={7}
      stepLabel={t("progress.label")}
      title={t("step7.title")}
      description={t("step7.description")}
    >
      <Toggle
        label={t("step7.enable")}
        checked={value.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      {value.enabled && (
        <>
          {behaviors.map((b) => (
            <OptionCard
              key={b}
              title={t(`step7.behavior.${b}.title`)}
              description={t(`step7.behavior.${b}.caption`)}
              selected={value.behavior === b}
              recommended={b === "detect_and_draft"}
              onSelect={() => onChange({ behavior: b })}
            />
          ))}

          <StepSlider
            label={t("step7.confidence")}
            value={Math.round(value.min_confidence * 100)}
            min={50}
            max={90}
            step={5}
            valueLabel={`${Math.round(value.min_confidence * 100)}%`}
            onChange={(pct) => onChange({ min_confidence: pct / 100 })}
          />
          <p className="font-kosugi text-[11px] text-text-3">
            [{t("step7.confidenceHint")}]
          </p>

          {value.behavior === "detect_and_draft" && (
            <AutonomyPicker
              t={t}
              value={value.autonomy}
              onChange={(autonomy) => onChange({ autonomy })}
              allowAutoSend={true}
              recommendDraft={true}
            />
          )}
          <WarningBanner>{t("step7.warning")}</WarningBanner>
        </>
      )}
    </StepShell>
  );
}

// ─── Step 8: Subcontractor coordination ─────────────────────────────────────

function StepSubcontractor({
  t,
  value,
  onChange,
}: {
  t: T;
  value: ClientCommsSettings["subcontractor_coordination"];
  onChange: (
    partial: Partial<ClientCommsSettings["subcontractor_coordination"]>
  ) => void;
}) {
  const triggers: SubcontractorTrigger[] = ["manual", "auto_suggest"];
  return (
    <StepShell
      stepNumber={8}
      stepLabel={t("progress.label")}
      title={t("step8.title")}
      description={t("step8.description")}
    >
      <Toggle
        label={t("step8.enable")}
        checked={value.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      {value.enabled &&
        triggers.map((tr) => (
          <OptionCard
            key={tr}
            title={t(`step8.trigger.${tr}.title`)}
            description={t(`step8.trigger.${tr}.caption`)}
            selected={value.trigger === tr}
            recommended={tr === "manual"}
            onSelect={() => onChange({ trigger: tr })}
          />
        ))}
    </StepShell>
  );
}

// ─── Step 9: Per-category overrides ─────────────────────────────────────────

function StepCategories({ t }: { t: T }) {
  const { company, currentUser } = useAuthStore();
  const [connectionId, setConnectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!company?.id || !currentUser?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/integrations/email/connections?companyId=${company.id}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const conns = (data.connections ?? data.data ?? []) as Array<{
          id: string;
          user_id?: string;
          status?: string;
        }>;
        const mine =
          conns.find(
            (c) => c.user_id === currentUser.id && c.status === "connected"
          ) ?? conns.find((c) => c.status === "connected");
        if (!cancelled) setConnectionId(mine?.id ?? null);
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company?.id, currentUser?.id]);

  return (
    <StepShell
      stepNumber={9}
      stepLabel={t("progress.label")}
      title={t("step9.title")}
      description={t("step9.description")}
    >
      {connectionId ? (
        <EmailCategoryAutonomy
          connectionId={connectionId}
          autoSendFeatureEnabled={true}
        />
      ) : (
        <div className="p-4 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface">
          <p className="font-kosugi text-[12px] text-text-3">
            [{t("step9.noConnection")}]
          </p>
        </div>
      )}
    </StepShell>
  );
}

// ─── Step 10: Summary + finish ──────────────────────────────────────────────

function StepSummary({
  t,
  settings,
  saving,
  onFinish,
  onOpenSettings,
}: {
  t: T;
  settings: ClientCommsSettings;
  saving: boolean;
  onFinish: () => void;
  onOpenSettings: () => void;
}) {
  const rows: Array<{ labelKey: string; value: string }> = [
    {
      labelKey: "summary.statusUpdates",
      value: t(`summary.statusUpdateValue.${settings.status_update.cadence}`),
    },
    {
      labelKey: "summary.appointmentConfirmation",
      value: t(
        `summary.appointmentConfirmationValue.${settings.appointment_confirmation.level}`
      ),
    },
    {
      labelKey: "summary.appointmentReminder",
      value: settings.appointment_reminder.enabled
        ? (() => {
            // Pluralization: pick the right key based on day count since
            // our i18n loader doesn't do automatic plural resolution.
            //   0 → "_zero" (day of visit)
            //   1 → "_one"  (singular day)
            //   2+ → default (plural days)
            const days = settings.appointment_reminder.lead_days;
            const key =
              days === 0
                ? "summary.appointmentReminderEnabled_zero"
                : days === 1
                  ? "summary.appointmentReminderEnabled_one"
                  : "summary.appointmentReminderEnabled";
            return t(key)
              .replace("{{days}}", String(days))
              .replace(
                "{{hour}}",
                formatHour(settings.appointment_reminder.send_hour_local)
              );
          })()
        : t("summary.disabled"),
    },
    {
      labelKey: "summary.paymentReminder",
      value: settings.payment_reminder.enabled
        ? t(`summary.paymentReminderPreset.${settings.payment_reminder.preset}`)
            .replace("{{n}}", String(settings.payment_reminder.max_reminders))
        : t("summary.disabled"),
    },
    {
      labelKey: "summary.invoiceCover",
      value: settings.invoice_cover.enabled
        ? t(`summary.invoiceCoverAutonomy.${settings.invoice_cover.autonomy}`)
        : t("summary.disabled"),
    },
    {
      labelKey: "summary.rescheduleRequest",
      value: settings.reschedule_request.enabled
        ? t(`summary.rescheduleBehavior.${settings.reschedule_request.behavior}`)
        : t("summary.disabled"),
    },
    {
      labelKey: "summary.subcontractor",
      value: settings.subcontractor_coordination.enabled
        ? t(
            `summary.subcontractorTrigger.${settings.subcontractor_coordination.trigger}`
          )
        : t("summary.disabled"),
    },
  ];

  return (
    <StepShell
      stepNumber={10}
      stepLabel={t("progress.label")}
      title={t("step10.title")}
      description={t("step10.description")}
    >
      <div className="space-y-1">
        {rows.map((row) => (
          <div
            key={row.labelKey}
            className="flex items-center justify-between gap-3 min-h-[56px] px-4 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2]"
          >
            <div className="flex items-center gap-2">
              <Check className="w-[14px] h-[14px] text-text-2" />
              <span className="font-mohave text-[13px] text-text-2 uppercase tracking-[0.04em]">
                {t(row.labelKey)}
              </span>
            </div>
            <span className="font-kosugi text-[12px] text-text">
              [{row.value}]
            </span>
          </div>
        ))}
      </div>

      <p className="font-kosugi text-[12px] text-text-3 pt-2">
        [{t("step10.reminder")}]
      </p>

      <div className="flex items-center gap-3 pt-4">
        <button
          type="button"
          onClick={onOpenSettings}
          disabled={saving}
          className={cn(
            "flex-1 min-h-[56px] px-5 rounded-[8px]",
            "border border-[rgba(255,255,255,0.12)] bg-transparent",
            "font-mohave text-[14px] text-text-2 uppercase tracking-[0.04em]",
            "transition-colors duration-150 motion-reduce:transition-none",
            "hover:border-[rgba(255,255,255,0.24)]",
            "disabled:opacity-50"
          )}
        >
          {t("step10.openSettings")}
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={saving}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 min-h-[56px] px-5 rounded-[8px]",
            "border border-[#6F94B0] bg-ops-accent",
            "font-mohave text-[14px] text-text uppercase tracking-[0.04em]",
            "transition-colors duration-150 motion-reduce:transition-none",
            "hover:bg-[#6A8AA8] hover:border-[#6A8AA8]",
            "disabled:opacity-50"
          )}
        >
          {saving ? (
            <Loader2 className="w-[14px] h-[14px] animate-spin motion-reduce:animate-none" />
          ) : (
            <Check className="w-[14px] h-[14px]" />
          )}
          {t("step10.finish")}
        </button>
      </div>
    </StepShell>
  );
}

// ─── Shared: autonomy picker (off / draft_to_queue / auto_send) ─────────────

function AutonomyPicker({
  t,
  value,
  onChange,
  allowAutoSend,
  recommendDraft,
}: {
  t: T;
  value: SimpleAutonomy;
  onChange: (value: SimpleAutonomy) => void;
  allowAutoSend: boolean;
  recommendDraft?: boolean;
}) {
  const levels: SimpleAutonomy[] = allowAutoSend
    ? ["off", "draft_to_queue", "auto_send"]
    : ["off", "draft_to_queue"];
  return (
    <div className="space-y-2 pt-2">
      <div className="font-mohave text-[12px] text-text-3 uppercase tracking-[0.08em]">
        {t("autonomyPicker.label")}
      </div>
      {levels.map((lv) => (
        <OptionCard
          key={lv}
          title={t(`autonomyPicker.${lv}.title`)}
          description={t(`autonomyPicker.${lv}.caption`)}
          selected={value === lv}
          recommended={recommendDraft && lv === "draft_to_queue"}
          onSelect={() => onChange(lv)}
        />
      ))}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 || hour === 24 ? "AM" : "PM";
  return `${h12}${suffix}`;
}
