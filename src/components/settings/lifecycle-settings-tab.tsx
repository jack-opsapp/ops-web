"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_FOLLOW_UP_TEMPLATE_BODY,
  DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
} from "@/lib/email/opportunity-lifecycle-evaluator";

interface LeadLifecycleConfig {
  follow_up_after_days: number;
  second_follow_up_archive_after_days: number;
  no_correspondence_archive_days: number;
  inbound_unreplied_lost_days: number;
  follow_up_template_subject: string;
  follow_up_template_body: string;
  auto_archive_enabled: boolean;
  auto_lost_enabled: boolean;
}

const DEFAULT_CONFIG: LeadLifecycleConfig = {
  follow_up_after_days: 7,
  second_follow_up_archive_after_days: 7,
  no_correspondence_archive_days: 14,
  inbound_unreplied_lost_days: 30,
  follow_up_template_subject: DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
  follow_up_template_body: DEFAULT_FOLLOW_UP_TEMPLATE_BODY,
  auto_archive_enabled: true,
  auto_lost_enabled: true,
};

type NumericKey =
  | "follow_up_after_days"
  | "second_follow_up_archive_after_days"
  | "no_correspondence_archive_days"
  | "inbound_unreplied_lost_days";

const NUMERIC_FIELDS: Array<{
  key: NumericKey;
  label: string;
  helper: string;
}> = [
  {
    key: "follow_up_after_days",
    label: "Draft follow-up after",
    helper: "Creates the local follow-up draft when outbound goes unanswered.",
  },
  {
    key: "second_follow_up_archive_after_days",
    label: "Second follow-up archive window",
    helper: "Marks a lead ready for reviewed archive after two unanswered follow-ups.",
  },
  {
    key: "no_correspondence_archive_days",
    label: "No-correspondence archive window",
    helper: "Marks untouched leads ready for reviewed archive.",
  },
  {
    key: "inbound_unreplied_lost_days",
    label: "Inbound no-response lost window",
    helper: "Marks unanswered inbound leads ready for reviewed lost handling.",
  },
];

function normalizeConfig(value: unknown): LeadLifecycleConfig {
  const source =
    value && typeof value === "object" ? (value as Partial<LeadLifecycleConfig>) : {};
  const positiveInteger = (next: unknown, fallback: number) => {
    const parsed = Number.parseInt(String(next ?? ""), 10);
    return Number.isFinite(parsed) ? Math.max(1, parsed) : fallback;
  };
  return {
    ...DEFAULT_CONFIG,
    ...source,
    follow_up_after_days: positiveInteger(
      source.follow_up_after_days,
      DEFAULT_CONFIG.follow_up_after_days
    ),
    second_follow_up_archive_after_days: positiveInteger(
      source.second_follow_up_archive_after_days,
      DEFAULT_CONFIG.second_follow_up_archive_after_days
    ),
    no_correspondence_archive_days: positiveInteger(
      source.no_correspondence_archive_days,
      DEFAULT_CONFIG.no_correspondence_archive_days
    ),
    inbound_unreplied_lost_days: positiveInteger(
      source.inbound_unreplied_lost_days,
      DEFAULT_CONFIG.inbound_unreplied_lost_days
    ),
    follow_up_template_subject:
      source.follow_up_template_subject?.trim() ||
      DEFAULT_CONFIG.follow_up_template_subject,
    follow_up_template_body:
      source.follow_up_template_body?.trim() ||
      DEFAULT_CONFIG.follow_up_template_body,
    auto_archive_enabled:
      typeof source.auto_archive_enabled === "boolean"
        ? source.auto_archive_enabled
        : DEFAULT_CONFIG.auto_archive_enabled,
    auto_lost_enabled:
      typeof source.auto_lost_enabled === "boolean"
        ? source.auto_lost_enabled
        : DEFAULT_CONFIG.auto_lost_enabled,
  };
}

export function LifecycleSettingsTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const [config, setConfig] = useState<LeadLifecycleConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();
      const res = await fetch(
        `/api/settings/lifecycle?companyId=${companyId}`,
        {
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );

      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setConfig(normalizeConfig(data.config));
      setDirty(false);
    } catch {
      toast.error(t("lifecycle.toast.loadFailed", "SYS :: SETTINGS LOAD FAILED"));
      setConfig(DEFAULT_CONFIG);
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateConfig(partial: Partial<LeadLifecycleConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();
      const res = await fetch("/api/settings/lifecycle", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId, config }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      setConfig(normalizeConfig(data.config));
      setDirty(false);
      toast.success(t("lifecycle.toast.saved", "SYS :: SETTINGS SAVED"));
    } catch {
      toast.error(t("lifecycle.toast.saveFailed", "SYS :: SETTINGS SAVE FAILED"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2
          className="h-5 w-5 animate-spin text-text-3"
          strokeWidth={1.5}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[720px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("lifecycle.title", "Lead lifecycle")}
          </span>
          <p className="mt-0.5 font-mono text-micro text-text-3">
            [{t("lifecycle.subtitle", "local drafts, rail alerts, reviewed exits")}]
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="default"
            onClick={() => {
              setConfig(DEFAULT_CONFIG);
              setDirty(true);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("lifecycle.resetDefaults", "RESET")}
          </Button>
          {dirty && (
            <Button
              variant="primary"
              size="default"
              onClick={handleSave}
              loading={saving}
            >
              <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
              {t("lifecycle.save", "SAVE")}
            </Button>
          )}
        </div>
      </div>

      <section className="glass-surface space-y-3 rounded-panel p-4">
        <SectionHeader
          label={t("lifecycle.windowsLabel", "Windows")}
          body={t(
            "lifecycle.windowsBody",
            "Days are positive integers. Destructive exits still require guarded approval."
          )}
        />
        <div className="grid gap-3 md:grid-cols-2">
          {NUMERIC_FIELDS.map((field) => (
            <NumericField
              key={field.key}
              label={t(`lifecycle.${field.key}.label`, field.label)}
              helper={t(`lifecycle.${field.key}.helper`, field.helper)}
              value={config[field.key]}
              dayLabel={t("lifecycle.days", "DAYS")}
              onChange={(value) =>
                updateConfig({ [field.key]: value } as Partial<LeadLifecycleConfig>)
              }
            />
          ))}
        </div>
      </section>

      <section className="glass-surface space-y-3 rounded-panel p-4">
        <SectionHeader
          label={t("lifecycle.automationLabel", "Automation")}
          body={t(
            "lifecycle.automationBody",
            "These toggles decide whether reviewed archive/lost candidates are produced."
          )}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <ToggleRow
            label={t("lifecycle.autoArchive", "Auto-archive candidates")}
            checked={config.auto_archive_enabled}
            onChange={(checked) => updateConfig({ auto_archive_enabled: checked })}
          />
          <ToggleRow
            label={t("lifecycle.autoLost", "Lost candidates")}
            checked={config.auto_lost_enabled}
            onChange={(checked) => updateConfig({ auto_lost_enabled: checked })}
          />
        </div>
      </section>

      <section className="glass-surface space-y-3 rounded-panel p-4">
        <SectionHeader
          label={t("lifecycle.templateLabel", "Template")}
          body={t(
            "lifecycle.templateBody",
            "Local inbox draft only. No provider draft is created here."
          )}
        />
        <Input
          label={t("lifecycle.subject", "Subject")}
          value={config.follow_up_template_subject}
          onChange={(event) =>
            updateConfig({ follow_up_template_subject: event.target.value })
          }
        />
        <Textarea
          label={t("lifecycle.body", "Body")}
          value={config.follow_up_template_body}
          onChange={(event) =>
            updateConfig({ follow_up_template_body: event.target.value })
          }
          rows={5}
          className="min-h-[132px] leading-relaxed"
        />
      </section>
    </div>
  );
}

function SectionHeader({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <span className="block font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">{"// "}</span>
        {label}
      </span>
      <p className="mt-1 font-mono text-micro leading-relaxed text-text-2">
        {body}
      </p>
    </div>
  );
}

function NumericField({
  label,
  helper,
  value,
  dayLabel,
  onChange,
}: {
  label: string;
  helper: string;
  value: number;
  dayLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-[5px] border border-border bg-transparent p-3">
      <span className="block font-mohave text-body-sm uppercase text-text">
        {label}
      </span>
      <span className="mt-1 block min-h-[34px] font-mono text-micro leading-relaxed text-text-3">
        {helper}
      </span>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(event) =>
            onChange(Math.max(1, Number.parseInt(event.target.value, 10) || 1))
          }
          className="w-[88px] min-h-[36px] rounded-[5px] border border-border bg-surface-input px-3 py-1.5 text-center font-mono text-data-sm tabular-nums text-text outline-none transition-colors focus:border-[rgba(255,255,255,0.20)] [color-scheme:dark]"
        />
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-text-3">
          {dayLabel}
        </span>
      </div>
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[5px] border border-border bg-transparent px-3 py-2">
      <span className="font-mohave text-body-sm uppercase text-text-2">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
