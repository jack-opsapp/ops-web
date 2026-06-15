"use client";

/**
 * S2 Amendment: Client Scheduling Communications Settings Tab
 *
 * Displays the current per-email-type configuration for every autonomous
 * communication the agent can send. Provides a prominent "Re-run Setup
 * Wizard" button that routes to /agent/comms-config pre-populated with
 * current settings. Each section shows current config as read-only summary
 * with an "Edit" link that jumps into the corresponding wizard step.
 *
 * Design system (spec v2):
 *   - glass-surface panels, // TITLE section headers (mono micro)
 *   - JetBrains Mono [bracket] captions + tabular summaries
 *   - Shared Button kit: primary (Re-run, the one CTA) + secondary (Edit)
 *   - Borders-only — no shadows
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { useDictionary } from "@/i18n/client";
import {
  DEFAULT_CLIENT_COMMS_SETTINGS,
  type ClientCommsSettings,
} from "@/lib/types/approval-queue";

export function ClientCommsSettingsTab() {
  const { t } = useDictionary("client-comms");
  const { company } = useAuthStore();
  const router = useRouter();

  const companyId = company?.id ?? "";
  const [settings, setSettings] = useState<ClientCommsSettings>(
    DEFAULT_CLIENT_COMMS_SETTINGS
  );
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch(
        `/api/settings/client-comms?companyId=${companyId}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (res.ok) {
        const data = (await res.json()) as { config: ClientCommsSettings };
        setSettings(data.config);
      }
    } catch {
      // Use defaults on error
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const configuredAt = useMemo(() => {
    if (!settings.comms_wizard_completed_at) return null;
    const d = new Date(settings.comms_wizard_completed_at);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [settings.comms_wizard_completed_at]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-[18px] h-[18px] animate-spin motion-reduce:animate-none text-text-3" />
      </div>
    );
  }

  const sections: Array<{
    id: string;
    title: string;
    summary: string;
    wizardStep: number;
  }> = [
    {
      id: "status_update",
      title: t("settings.statusUpdate"),
      summary: formatStatusUpdate(settings.status_update, t),
      wizardStep: 2,
    },
    {
      id: "appointment_confirmation",
      title: t("settings.appointmentConfirmationSingular"),
      summary: formatAppointmentConfirmation(
        settings.appointment_confirmation,
        t
      ),
      wizardStep: 3,
    },
    {
      id: "appointment_reminder",
      title: t("settings.appointmentReminderSingular"),
      summary: formatAppointmentReminder(settings.appointment_reminder, t),
      wizardStep: 4,
    },
    {
      id: "payment_reminder",
      title: t("settings.paymentReminder"),
      summary: formatPaymentReminder(settings.payment_reminder, t),
      wizardStep: 5,
    },
    {
      id: "invoice_cover",
      title: t("settings.invoiceCover"),
      summary: formatInvoiceCover(settings.invoice_cover, t),
      wizardStep: 6,
    },
    {
      id: "reschedule_request",
      title: t("settings.rescheduleRequestSingular"),
      summary: formatRescheduleRequest(settings.reschedule_request, t),
      wizardStep: 7,
    },
    {
      id: "subcontractor_coordination",
      title: t("settings.subcontractorCoordination"),
      summary: formatSubcontractor(settings.subcontractor_coordination, t),
      wizardStep: 8,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("settings.title")}
          </span>
          <p className="font-mono text-micro text-text-3 mt-1">
            [
            {configuredAt
              ? t("settings.configuredOn").replace("{{date}}", configuredAt)
              : t("settings.notConfigured")}
            ]
          </p>
        </div>
        <Button
          variant="primary"
          size="default"
          onClick={() => router.push("/agent/comms-config")}
        >
          <Settings2 className="w-[14px] h-[14px]" />
          {t("settings.rerunWizard")}
        </Button>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {sections.map((section) => (
          <div
            key={section.id}
            className="glass-surface rounded-panel p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                  <span className="text-text-mute">{"// "}</span>
                  {section.title}
                </span>
                <div className="font-mono text-data-sm text-text mt-1 tabular-nums">
                  {section.summary}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  router.push(
                    `/agent/comms-config?step=${section.wizardStep}`
                  )
                }
              >
                {t("settings.edit")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Formatters ─────────────────────────────────────────────────────────────
//
// Each formatter takes a section of the ClientCommsSettings and returns a
// user-friendly summary string built from i18n keys. No hardcoded English.

type T = (key: string) => string;

function formatStatusUpdate(
  s: ClientCommsSettings["status_update"],
  t: T
): string {
  if (s.cadence === "off") return `[${t("settings.disabled")}]`;
  const cadenceLabel = t(`settings.cadence.${s.cadence}`);
  const autonomyLabel = t(`settings.autonomyValue.${s.autonomy}`);
  return `[${cadenceLabel}] · [${autonomyLabel}]`;
}

function formatAppointmentConfirmation(
  s: ClientCommsSettings["appointment_confirmation"],
  t: T
): string {
  if (s.level === "off") return `[${t("settings.disabled")}]`;
  const levelLabel = t(`settings.confirmationLevel.${s.level}`);
  if (s.level === "manual") return `[${levelLabel}]`;
  if (s.level === "full_auto") {
    return `[${levelLabel}] · [${t("settings.sendDelayShort").replace(
      "{{n}}",
      String(s.send_delay_minutes)
    )}]`;
  }
  const modeLabel = t(`settings.confirmMode.${s.confirm_mode}`);
  const modeDetail =
    s.confirm_mode === "automatic"
      ? `${modeLabel}: ${s.auto_confirm_after_hours}h`
      : modeLabel;
  return `[${levelLabel}] · [${modeDetail}]`;
}

function formatAppointmentReminder(
  s: ClientCommsSettings["appointment_reminder"],
  t: T
): string {
  if (!s.enabled) return `[${t("settings.disabled")}]`;
  const leadLabel =
    s.lead_days === 0
      ? t("settings.dayOf")
      : `${s.lead_days}d ${t("settings.before")}`;
  const hour = formatHour(s.send_hour_local);
  const autonomyLabel = t(`settings.autonomyValue.${s.autonomy}`);
  return `[${leadLabel} · ${hour}] · [${autonomyLabel}]`;
}

function formatPaymentReminder(
  s: ClientCommsSettings["payment_reminder"],
  t: T
): string {
  if (!s.enabled) return `[${t("settings.disabled")}]`;
  const presetLabel = t(`settings.paymentPreset.${s.preset}`);
  const autonomyLabel = t(`settings.autonomyValue.${s.autonomy}`);
  return `[${presetLabel}] · [${t("settings.maxN").replace(
    "{{n}}",
    String(s.max_reminders)
  )}] · [${autonomyLabel}]`;
}

function formatInvoiceCover(
  s: ClientCommsSettings["invoice_cover"],
  t: T
): string {
  if (!s.enabled) return `[${t("settings.disabled")}]`;
  const autonomyLabel = t(`settings.autonomyValue.${s.autonomy}`);
  const thresholdText =
    s.threshold > 0
      ? t("settings.thresholdOver").replace("{{n}}", String(s.threshold))
      : t("settings.thresholdAny");
  return `[${thresholdText}] · [${autonomyLabel}]`;
}

function formatRescheduleRequest(
  s: ClientCommsSettings["reschedule_request"],
  t: T
): string {
  if (!s.enabled) return `[${t("settings.disabled")}]`;
  const behaviorLabel = t(`settings.rescheduleBehavior.${s.behavior}`);
  const conf = `${Math.round(s.min_confidence * 100)}%`;
  return `[${behaviorLabel}] · [${t("settings.confidenceLabel").replace(
    "{{pct}}",
    conf
  )}]`;
}

function formatSubcontractor(
  s: ClientCommsSettings["subcontractor_coordination"],
  t: T
): string {
  if (!s.enabled) return `[${t("settings.disabled")}]`;
  const triggerLabel = t(`settings.subcontractorTrigger.${s.trigger}`);
  return `[${triggerLabel}]`;
}

function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 || hour === 24 ? "AM" : "PM";
  return `${h12}${suffix}`;
}
