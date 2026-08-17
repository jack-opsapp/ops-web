"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, Loader2 } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SegmentControl } from "@/components/ui/segment-control";

// ─── Types ──────────────────────────────────────────────────────────────────

interface InvoiceConfig {
  default_payment_terms: string;
  default_tax_rate: number;
  auto_suggest_on_completion: boolean;
  auto_suggest_from_estimate: boolean;
  high_value_threshold: number;
  include_cover_email: boolean;
}

const DEFAULT_CONFIG: InvoiceConfig = {
  default_payment_terms: "NET-30",
  default_tax_rate: 0,
  auto_suggest_on_completion: true,
  auto_suggest_from_estimate: true,
  high_value_threshold: 5000,
  include_cover_email: true,
};

const PAYMENT_TERMS_OPTIONS = [
  { value: "NET-15", labelKey: "invoiceSettings.terms.net15" },
  { value: "NET-30", labelKey: "invoiceSettings.terms.net30" },
  { value: "NET-45", labelKey: "invoiceSettings.terms.net45" },
  { value: "NET-60", labelKey: "invoiceSettings.terms.net60" },
];

function projectInvoiceConfig(value: unknown): InvoiceConfig {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<InvoiceConfig>)
      : {};
  return {
    default_payment_terms:
      typeof source.default_payment_terms === "string"
        ? source.default_payment_terms
        : DEFAULT_CONFIG.default_payment_terms,
    default_tax_rate:
      typeof source.default_tax_rate === "number"
        ? source.default_tax_rate
        : DEFAULT_CONFIG.default_tax_rate,
    auto_suggest_on_completion:
      typeof source.auto_suggest_on_completion === "boolean"
        ? source.auto_suggest_on_completion
        : DEFAULT_CONFIG.auto_suggest_on_completion,
    auto_suggest_from_estimate:
      typeof source.auto_suggest_from_estimate === "boolean"
        ? source.auto_suggest_from_estimate
        : DEFAULT_CONFIG.auto_suggest_from_estimate,
    high_value_threshold:
      typeof source.high_value_threshold === "number"
        ? source.high_value_threshold
        : DEFAULT_CONFIG.high_value_threshold,
    include_cover_email:
      typeof source.include_cover_email === "boolean"
        ? source.include_cover_email
        : DEFAULT_CONFIG.include_cover_email,
  };
}

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

      const res = await fetch(`/api/settings/invoice?companyId=${companyId}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(projectInvoiceConfig(data.config));
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-[20px] w-[20px] animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="max-w-[640px] space-y-8">
      {/* Header + Save */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-mohave text-body-lg uppercase text-text">
            {t("invoiceSettings.title")}
          </h2>
          <p className="mt-0.5 font-mono text-[13px] text-text-2">
            {t("invoiceSettings.subtitle")}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || saving}
          loading={saving}
          className="shrink-0 gap-2"
        >
          {!saving && <Save className="h-[16px] w-[16px]" />}
          {t("invoiceSettings.save")}
        </Button>
      </div>

      {/* Default Payment Terms */}
      <div className="space-y-2">
        <label className="block font-mohave text-body-sm uppercase text-text">
          {t("invoiceSettings.paymentTerms")}
        </label>
        <p className="font-mono text-[12px] text-text-3">
          {t("invoiceSettings.paymentTermsDesc")}
        </p>
        <div className="mt-2">
          <SegmentControl
            options={PAYMENT_TERMS_OPTIONS.map((opt) => ({
              value: opt.value,
              label: t(opt.labelKey),
            }))}
            value={config.default_payment_terms}
            onChange={(v) => updateConfig({ default_payment_terms: v })}
          />
        </div>
      </div>

      {/* Default Tax Rate */}
      <div className="space-y-2">
        <label className="block font-mohave text-body-sm uppercase text-text">
          {t("invoiceSettings.taxRate")}
        </label>
        <p className="font-mono text-[12px] text-text-3">
          {t("invoiceSettings.taxRateDesc")}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="w-[120px]">
            <Input
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
              className="text-right font-mono tabular-nums [color-scheme:dark]"
            />
          </div>
          <span className="font-mono text-[13px] text-text-3">%</span>
        </div>
      </div>

      {/* High-Value Threshold */}
      <div className="space-y-2">
        <label className="block font-mohave text-body-sm uppercase text-text">
          {t("invoiceSettings.highValueThreshold")}
        </label>
        <p className="font-mono text-[12px] text-text-3">
          {t("invoiceSettings.highValueThresholdDesc")}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[13px] text-text-3">$</span>
          <div className="w-[160px]">
            <Input
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
              className="text-right font-mono tabular-nums [color-scheme:dark]"
            />
          </div>
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
      <div className="min-w-0 flex-1">
        <span className="block font-mohave text-body-sm uppercase text-text">
          {label}
        </span>
        <p className="mt-0.5 font-mono text-[12px] text-text-3">
          {description}
        </p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
