"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, Loader2 } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReminderSettings {
  enabled: boolean;
  reminder_days: [number, number, number, number];
  max_reminders: number;
  skip_weekends: boolean;
  excluded_client_ids: string[];
  late_payment_threshold: number;
}

interface InvoiceConfig {
  default_payment_terms: string;
  default_tax_rate: number;
  auto_suggest_on_completion: boolean;
  auto_suggest_from_estimate: boolean;
  high_value_threshold: number;
  include_cover_email: boolean;
  reminder_settings?: ReminderSettings;
}

const DEFAULT_REMINDER: ReminderSettings = {
  enabled: true,
  reminder_days: [7, 14, 30, 45],
  max_reminders: 4,
  skip_weekends: false,
  excluded_client_ids: [],
  late_payment_threshold: 50,
};

const DEFAULT_CONFIG: InvoiceConfig = {
  default_payment_terms: "NET-30",
  default_tax_rate: 0,
  auto_suggest_on_completion: true,
  auto_suggest_from_estimate: true,
  high_value_threshold: 5000,
  include_cover_email: true,
  reminder_settings: DEFAULT_REMINDER,
};

const PAYMENT_TERMS_OPTIONS = [
  { value: "NET-15", labelKey: "invoiceSettings.terms.net15" },
  { value: "NET-30", labelKey: "invoiceSettings.terms.net30" },
  { value: "NET-45", labelKey: "invoiceSettings.terms.net45" },
  { value: "NET-60", labelKey: "invoiceSettings.terms.net60" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function InvoiceSettingsTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [config, setConfig] = useState<InvoiceConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── Load settings ─────────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch(
        `/api/settings/invoice?companyId=${companyId}`,
        {
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig({ ...DEFAULT_CONFIG, ...data.config });
        }
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

  // ── Save settings ─────────────────────────────────────────────────────
  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch("/api/settings/invoice", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId, config }),
      });

      if (res.ok) {
        toast.success(t("invoiceSettings.toast.saved"));
        setDirty(false);
      } else {
        toast.error(t("invoiceSettings.toast.saveFailed"));
      }
    } catch {
      toast.error(t("invoiceSettings.toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(partial: Partial<InvoiceConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }

  const reminder = config.reminder_settings ?? DEFAULT_REMINDER;

  function updateReminder(partial: Partial<ReminderSettings>) {
    setConfig((prev) => ({
      ...prev,
      reminder_settings: { ...(prev.reminder_settings ?? DEFAULT_REMINDER), ...partial },
    }));
    setDirty(true);
  }

  function updateReminderDay(index: number, value: number) {
    const days = [...reminder.reminder_days] as [number, number, number, number];
    days[index] = Math.max(1, Math.min(365, value));
    updateReminder({ reminder_days: days });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-[20px] h-[20px] text-text-3 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-[640px]">
      {/* Header + Save */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mohave text-body-lg text-text uppercase">
            {t("invoiceSettings.title")}
          </h2>
          <p className="font-kosugi text-[13px] text-text-2 mt-0.5">
            {t("invoiceSettings.subtitle")}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`
            flex items-center gap-2 px-4 rounded-[4px] font-mohave text-body-sm uppercase transition-colors min-h-[56px]
            ${dirty
              ? "bg-[rgba(89,119,148,0.15)] text-[#597794] hover:bg-[rgba(89,119,148,0.25)]"
              : "bg-[rgba(255,255,255,0.03)] text-text-mute cursor-not-allowed"
            }
          `}
        >
          {saving ? (
            <Loader2 className="w-[16px] h-[16px] animate-spin" />
          ) : (
            <Save className="w-[16px] h-[16px]" />
          )}
          {t("invoiceSettings.save")}
        </button>
      </div>

      {/* Default Payment Terms */}
      <div className="space-y-2">
        <label className="font-mohave text-body-sm text-text uppercase block">
          {t("invoiceSettings.paymentTerms")}
        </label>
        <p className="font-kosugi text-[12px] text-text-3">
          {t("invoiceSettings.paymentTermsDesc")}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {PAYMENT_TERMS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateConfig({ default_payment_terms: opt.value })}
              className={`
                px-4 rounded-[4px] font-mohave text-body-sm transition-colors min-h-[56px]
                ${config.default_payment_terms === opt.value
                  ? "bg-[rgba(89,119,148,0.15)] text-[#597794] border border-[#597794]"
                  : "bg-[rgba(255,255,255,0.03)] text-text-2 border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.16)]"
                }
              `}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Default Tax Rate */}
      <div className="space-y-2">
        <label className="font-mohave text-body-sm text-text uppercase block">
          {t("invoiceSettings.taxRate")}
        </label>
        <p className="font-kosugi text-[12px] text-text-3">
          {t("invoiceSettings.taxRateDesc")}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <input
            type="number"
            value={config.default_tax_rate}
            onChange={(e) =>
              updateConfig({
                default_tax_rate: Math.max(
                  0,
                  Math.min(100, Number(e.target.value) || 0)
                ),
              })
            }
            min={0}
            max={100}
            step={0.01}
            className="w-[120px] font-mono text-body-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 py-2 text-text outline-none focus:border-[rgba(255,255,255,0.3)] min-h-[56px] text-right [color-scheme:dark]"
          />
          <span className="font-kosugi text-[13px] text-text-3">%</span>
        </div>
      </div>

      {/* High-Value Threshold */}
      <div className="space-y-2">
        <label className="font-mohave text-body-sm text-text uppercase block">
          {t("invoiceSettings.highValueThreshold")}
        </label>
        <p className="font-kosugi text-[12px] text-text-3">
          {t("invoiceSettings.highValueThresholdDesc")}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className="font-kosugi text-[13px] text-text-3">$</span>
          <input
            type="number"
            value={config.high_value_threshold}
            onChange={(e) =>
              updateConfig({
                high_value_threshold: Math.max(
                  0,
                  Number(e.target.value) || 0
                ),
              })
            }
            min={0}
            step={100}
            className="w-[160px] font-mono text-body-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 py-2 text-text outline-none focus:border-[rgba(255,255,255,0.3)] min-h-[56px] text-right [color-scheme:dark]"
          />
        </div>
      </div>

      {/* Toggle: Auto-suggest on project completion */}
      <ToggleSetting
        label={t("invoiceSettings.autoSuggestCompletion")}
        description={t("invoiceSettings.autoSuggestCompletionDesc")}
        checked={config.auto_suggest_on_completion}
        onChange={(v) => updateConfig({ auto_suggest_on_completion: v })}
      />

      {/* Toggle: Auto-suggest from accepted estimate */}
      <ToggleSetting
        label={t("invoiceSettings.autoSuggestEstimate")}
        description={t("invoiceSettings.autoSuggestEstimateDesc")}
        checked={config.auto_suggest_from_estimate}
        onChange={(v) => updateConfig({ auto_suggest_from_estimate: v })}
      />

      {/* Toggle: Include cover email */}
      <ToggleSetting
        label={t("invoiceSettings.includeCoverEmail")}
        description={t("invoiceSettings.includeCoverEmailDesc")}
        checked={config.include_cover_email}
        onChange={(v) => updateConfig({ include_cover_email: v })}
      />

      {/* ── Payment Reminders Section ── */}
      <div className="border-t border-[rgba(255,255,255,0.06)] pt-8 space-y-6">
        <div>
          <h3 className="font-mohave text-body-lg text-text uppercase">
            {t("invoiceSettings.reminders")}
          </h3>
          <p className="font-kosugi text-[13px] text-text-2 mt-0.5">
            {t("invoiceSettings.remindersDesc")}
          </p>
        </div>

        {/* Toggle: Enable reminders */}
        <ToggleSetting
          label={t("invoiceSettings.enableReminders")}
          description={t("invoiceSettings.enableRemindersDesc")}
          checked={reminder.enabled}
          onChange={(v) => updateReminder({ enabled: v })}
        />

        {/* Reminder schedule — 4 numeric inputs */}
        {reminder.enabled && (
          <>
            <div className="space-y-3">
              <label className="font-mohave text-body-sm text-text uppercase block">
                {t("invoiceSettings.reminderSchedule")}
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "invoiceSettings.level1Days", index: 0 },
                  { key: "invoiceSettings.level2Days", index: 1 },
                  { key: "invoiceSettings.level3Days", index: 2 },
                  { key: "invoiceSettings.level4Days", index: 3 },
                ].map(({ key, index }) => (
                  <div key={index}>
                    <span className="font-kosugi text-[11px] text-text-3 block mb-1">
                      {t(key)}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={reminder.reminder_days[index]}
                        onChange={(e) =>
                          updateReminderDay(index, Number(e.target.value) || 1)
                        }
                        min={1}
                        max={365}
                        className="w-[80px] font-mono text-body-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 py-2 text-text outline-none focus:border-[rgba(255,255,255,0.3)] min-h-[56px] text-right [color-scheme:dark]"
                      />
                      <span className="font-kosugi text-[12px] text-text-3">
                        {t("invoiceSettings.days")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Max reminders per invoice */}
            <div className="space-y-2">
              <label className="font-mohave text-body-sm text-text uppercase block">
                {t("invoiceSettings.maxReminders")}
              </label>
              <div className="flex flex-wrap gap-2 mt-1">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => updateReminder({ max_reminders: n })}
                    className={`
                      w-[56px] rounded-[4px] font-mono text-body-sm transition-colors min-h-[56px]
                      ${reminder.max_reminders === n
                        ? "bg-[rgba(89,119,148,0.15)] text-[#597794] border border-[#597794]"
                        : "bg-[rgba(255,255,255,0.03)] text-text-2 border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.16)]"
                      }
                    `}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Toggle: Skip weekends */}
            <ToggleSetting
              label={t("invoiceSettings.skipWeekends")}
              description={t("invoiceSettings.skipWeekendsDesc")}
              checked={reminder.skip_weekends}
              onChange={(v) => updateReminder({ skip_weekends: v })}
            />

            {/* Late payment threshold */}
            <div className="space-y-2">
              <label className="font-mohave text-body-sm text-text uppercase block">
                {t("invoiceSettings.lateThreshold")}
              </label>
              <p className="font-kosugi text-[12px] text-text-3">
                {t("invoiceSettings.lateThresholdDesc")}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  value={reminder.late_payment_threshold}
                  onChange={(e) =>
                    updateReminder({
                      late_payment_threshold: Math.max(
                        0,
                        Math.min(100, Number(e.target.value) || 0)
                      ),
                    })
                  }
                  min={0}
                  max={100}
                  className="w-[80px] font-mono text-body-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 py-2 text-text outline-none focus:border-[rgba(255,255,255,0.3)] min-h-[56px] text-right [color-scheme:dark]"
                />
                <span className="font-kosugi text-[13px] text-text-3">
                  {t("invoiceSettings.lateThresholdSuffix")}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Toggle Component ───────────────────────────────────────────────────────

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <span className="font-mohave text-body-sm text-text uppercase block">
          {label}
        </span>
        <p className="font-kosugi text-[12px] text-text-3 mt-0.5">
          {description}
        </p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="shrink-0 mt-1 min-w-[56px] min-h-[56px] flex items-center justify-center -my-3"
        role="switch"
        aria-checked={checked}
      >
        <div
          className={`
            w-[44px] h-[24px] rounded-[12px] transition-colors motion-reduce:transition-none relative
            ${checked
              ? "bg-[rgba(89,119,148,0.4)]"
              : "bg-[rgba(255,255,255,0.08)]"
            }
          `}
        >
          <div
            className={`
              absolute top-[2px] w-[20px] h-[20px] rounded-[12px] transition-transform duration-150 motion-reduce:transition-none
              ${checked
                ? "translate-x-[22px] bg-[#597794]"
                : "translate-x-[2px] bg-[rgba(255,255,255,0.3)]"
              }
            `}
          />
        </div>
      </button>
    </div>
  );
}
