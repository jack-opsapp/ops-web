"use client";

/**
 * Financial Intelligence Settings Tab
 *
 * Sprint I3: Configure weekly digest, alert thresholds, and pricing
 * optimization parameters. Settings stored in companies.invoice_settings
 * JSONB under the 'financial_intelligence' key.
 */

import { useState, useEffect, useCallback } from "react";
import { Save, Loader2 } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import type { FinancialIntelligenceSettings } from "@/lib/types/approval-queue";
import { DEFAULT_FINANCIAL_SETTINGS } from "@/lib/types/approval-queue";

// ─── Component ────────────────────────────────────────────────────────────────

export function FinancialSettingsTab() {
  const { t } = useDictionary("agent-queue");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [settings, setSettings] = useState<FinancialIntelligenceSettings>(DEFAULT_FINANCIAL_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── Load settings ──────────────────────────────────────────────────────
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
        const fin = data.config?.financial_intelligence;
        if (fin) {
          setSettings({ ...DEFAULT_FINANCIAL_SETTINGS, ...fin });
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

  // ── Save settings ──────────────────────────────────────────────────────
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
        body: JSON.stringify({
          companyId,
          config: { financial_intelligence: settings },
        }),
      });

      if (res.ok) {
        toast.success(t("financial.settings.saved"));
        setDirty(false);
      } else {
        toast.error(t("financial.settings.error"));
      }
    } catch {
      toast.error(t("financial.settings.error"));
    } finally {
      setSaving(false);
    }
  }

  function update(partial: Partial<FinancialIntelligenceSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mohave text-[16px] text-text uppercase tracking-wider">
            {t("financial.settings.title")}
          </h2>
          <p className="font-mono text-[12px] text-text-3 mt-1">
            [{t("financial.settings.description")}]
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex items-center gap-2 px-4 min-h-[56px] rounded-[8px] border font-mohave text-[14px] uppercase tracking-wider transition-colors duration-150"
          style={{
            backgroundColor: dirty ? "#6F94B0" : "transparent",
            borderColor: dirty ? "#6F94B0" : "rgba(255,255,255,0.08)",
            color: dirty ? "#fff" : "var(--text-tertiary)",
            opacity: saving ? 0.6 : 1,
            cursor: dirty && !saving ? "pointer" : "default",
          }}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? t("financial.settings.saving") : t("financial.settings.save")}
        </button>
      </div>

      {/* Enable/disable toggle */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4">
        <label className="flex items-center justify-between min-h-[56px] cursor-pointer">
          <span className="font-mohave text-[14px] text-text">
            {t("financial.settings.enableDigest")}
          </span>
          <button
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => update({ enabled: !settings.enabled })}
            className="relative w-[44px] h-[24px] rounded-full border transition-colors duration-150"
            style={{
              backgroundColor: settings.enabled ? "#6F94B0" : "rgba(255,255,255,0.06)",
              borderColor: settings.enabled ? "#6F94B0" : "rgba(255,255,255,0.12)",
            }}
          >
            <span
              className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform duration-150"
              style={{
                transform: settings.enabled ? "translateX(22px)" : "translateX(2px)",
              }}
            />
          </button>
        </label>
      </div>

      {/* Alert thresholds */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4 space-y-4">
        <h3 className="font-mohave text-[13px] text-text-3 uppercase tracking-wider">
          {t("financial.settings.alertThresholds")}
        </h3>

        {/* Overdue threshold */}
        <ThresholdInput
          label={t("financial.settings.overdueThreshold")}
          suffix={t("financial.settings.overdueThresholdSuffix")}
          value={settings.overdue_pct_threshold}
          min={1}
          max={100}
          onChange={(v) => update({ overdue_pct_threshold: v })}
        />

        {/* Concentration threshold */}
        <ThresholdInput
          label={t("financial.settings.concentrationThreshold")}
          suffix={t("financial.settings.concentrationThresholdSuffix")}
          value={settings.concentration_pct_threshold}
          min={1}
          max={100}
          onChange={(v) => update({ concentration_pct_threshold: v })}
        />

        {/* Aging threshold */}
        <ThresholdInput
          label={t("financial.settings.agingThreshold")}
          suffix={t("financial.settings.agingThresholdSuffix")}
          value={settings.aging_days_threshold}
          min={1}
          max={365}
          onChange={(v) => update({ aging_days_threshold: v })}
        />

        {/* Aging min count */}
        <ThresholdInput
          label={t("financial.settings.agingMinCount")}
          suffix={t("financial.settings.agingMinCountSuffix")}
          value={settings.aging_min_count}
          min={1}
          max={50}
          onChange={(v) => update({ aging_min_count: v })}
        />
      </div>

      {/* Pricing optimization */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4 space-y-4">
        <h3 className="font-mohave text-[13px] text-text-3 uppercase tracking-wider">
          {t("financial.settings.pricingTitle")}
        </h3>

        {/* Win rate increase threshold */}
        <ThresholdInput
          label={t("financial.settings.winRateIncrease")}
          suffix="%"
          value={settings.win_rate_increase_threshold}
          min={1}
          max={100}
          onChange={(v) => update({ win_rate_increase_threshold: v })}
        />

        {/* Win rate decrease threshold */}
        <ThresholdInput
          label={t("financial.settings.winRateDecrease")}
          suffix="%"
          value={settings.win_rate_decrease_threshold}
          min={1}
          max={100}
          onChange={(v) => update({ win_rate_decrease_threshold: v })}
        />

        {/* Min estimates */}
        <ThresholdInput
          label={t("financial.settings.minEstimates")}
          suffix={t("financial.settings.agingMinCountSuffix")}
          value={settings.min_estimates_for_analysis}
          min={1}
          max={100}
          onChange={(v) => update({ min_estimates_for_analysis: v })}
        />
      </div>
    </div>
  );
}

// ─── Threshold Input ──────────────────────────────────────────────────────────

function ThresholdInput({
  label,
  suffix,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-[56px]">
      <span className="font-mohave text-[13px] text-text-2 flex-1">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Math.max(min, Math.min(max, Number(e.target.value) || min));
            onChange(v);
          }}
          className="w-[72px] h-[56px] px-3 rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] font-mono text-[13px] text-text text-right outline-none focus:border-[#6F94B0] transition-colors duration-150"
        />
        <span className="font-mono text-[11px] text-text-3 min-w-[60px]">
          {suffix}
        </span>
      </div>
    </div>
  );
}
