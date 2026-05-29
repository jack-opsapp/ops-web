"use client";

/**
 * Schedule Optimization Settings Tab
 *
 * Sprint S1.7: Configure daily schedule optimization, travel routing,
 * conflict detection, weather awareness, cascade detection, and
 * outdoor task type selection. Settings stored in companies.schedule_settings JSONB.
 */

import { useState, useEffect, useCallback } from "react";
import { Save, Loader2, X } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import type { ScheduleOptimizationSettings } from "@/lib/types/approval-queue";
import { DEFAULT_SCHEDULE_SETTINGS } from "@/lib/types/approval-queue";

// ─── Task Type for multi-select ─────────────────────────────────────────────

interface TaskTypeOption {
  id: string;
  display: string;
  color: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScheduleSettingsTab() {
  const { t } = useDictionary("scheduling");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [settings, setSettings] = useState<ScheduleOptimizationSettings>(DEFAULT_SCHEDULE_SETTINGS);
  const [taskTypes, setTaskTypes] = useState<TaskTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── Load settings + task types ────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      // Load settings and task types in parallel
      const [settingsRes, typesRes] = await Promise.all([
        fetch(`/api/settings/schedule?companyId=${companyId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
        fetch(`/api/task-types?companyId=${companyId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        if (data.config) {
          setSettings({ ...DEFAULT_SCHEDULE_SETTINGS, ...data.config });
        }
      }

      if (typesRes.ok) {
        const data = await typesRes.json();
        const types = (data.taskTypes ?? data ?? []) as Array<Record<string, unknown>>;
        setTaskTypes(
          types.map((tt) => ({
            id: (tt.id as string) ?? "",
            display: (tt.display as string) ?? (tt.name as string) ?? "",
            color: (tt.color as string) ?? "#417394",
          }))
        );
      }
    } catch {
      // Use defaults on error
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Save settings ──────────────────────────────────────────────────────
  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch("/api/settings/schedule", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId, config: settings }),
      });

      if (res.ok) {
        toast.success(t("settings.saved"));
        setDirty(false);
      } else {
        toast.error(t("settings.error"));
      }
    } catch {
      toast.error(t("settings.error"));
    } finally {
      setSaving(false);
    }
  }

  function update(partial: Partial<ScheduleOptimizationSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }

  function toggleOutdoorTaskType(taskTypeId: string) {
    setSettings((prev) => {
      const current = prev.outdoor_task_type_ids;
      const next = current.includes(taskTypeId)
        ? current.filter((id) => id !== taskTypeId)
        : [...current, taskTypeId];
      return { ...prev, outdoor_task_type_ids: next };
    });
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
            {t("settings.title")}
          </h2>
          <p className="font-mono text-[12px] text-text-3 mt-1">
            [{t("settings.description")}]
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex items-center gap-2 px-4 min-h-[36px] rounded-[5px] border font-mohave text-[14px] uppercase tracking-wider transition-colors duration-150"
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
          {saving ? t("settings.saving") : t("settings.save")}
        </button>
      </div>

      {/* Enable/disable toggle */}
      <ToggleRow
        label={t("settings.enableOptimization")}
        checked={settings.enabled}
        onChange={(v) => update({ enabled: v })}
      />

      {/* Optimization window */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4">
        <div className="flex items-center justify-between min-h-[36px]">
          <span className="font-mohave text-[13px] text-text-2">
            {t("settings.optimizationWindow")}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              aria-label={t("settings.windowAriaLabel")}
              value={settings.optimization_window_days}
              min={1}
              max={7}
              onChange={(e) => {
                const v = Math.max(1, Math.min(7, Number(e.target.value) || 2));
                update({ optimization_window_days: v });
              }}
              className="w-[72px] min-h-[36px] px-3 rounded-[5px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] font-mono text-[13px] text-text text-right outline-none focus:border-[rgba(255,255,255,0.20)] transition-colors duration-150"
            />
            <span className="font-mono text-[11px] text-text-3 min-w-[60px]">
              {t("settings.optimizationWindowSuffix")}
            </span>
          </div>
        </div>
      </div>

      {/* Feature toggles */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4 space-y-0">
        <ToggleRowInline
          label={t("settings.travelOptimization")}
          description={t("settings.travelOptimizationDesc")}
          checked={settings.travel_optimization}
          onChange={(v) => update({ travel_optimization: v })}
        />
        <ToggleRowInline
          label={t("settings.conflictDetection")}
          description={t("settings.conflictDetectionDesc")}
          checked={settings.conflict_detection}
          onChange={(v) => update({ conflict_detection: v })}
        />
        <ToggleRowInline
          label={t("settings.cascadeDetection")}
          description={t("settings.cascadeDetectionDesc")}
          checked={settings.cascade_detection}
          onChange={(v) => update({ cascade_detection: v })}
        />
      </div>

      {/* Weather awareness */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4 space-y-4">
        <ToggleRowInline
          label={t("settings.weatherAwareness")}
          description={t("settings.weatherAwarenessDesc")}
          checked={settings.weather_awareness}
          onChange={(v) => update({ weather_awareness: v })}
        />

        {settings.weather_awareness && (
          <>
            {/* Climate zone */}
            <div className="flex items-center justify-between min-h-[36px]">
              <span className="font-mohave text-[13px] text-text-2">
                {t("settings.climateZone")}
              </span>
              <select
                value={settings.climate_zone}
                onChange={(e) =>
                  update({
                    climate_zone: e.target.value as "northern" | "southern" | "auto",
                  })
                }
                className="min-h-[36px] px-3 rounded-[5px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] font-mohave text-[13px] text-text outline-none focus:border-[rgba(255,255,255,0.20)] transition-colors duration-150 [color-scheme:dark]"
              >
                <option value="auto">{t("settings.climateZone.auto")}</option>
                <option value="northern">{t("settings.climateZone.northern")}</option>
                <option value="southern">{t("settings.climateZone.southern")}</option>
              </select>
            </div>

            {/* Outdoor task types */}
            <div>
              <span className="font-mono text-[11px] text-text-3 block mb-2">
                [{t("settings.outdoorTaskTypes")}]
              </span>
              <p className="font-mono text-[11px] text-text-3 mb-2">
                {t("settings.outdoorTaskTypesDesc")}
              </p>
              {taskTypes.length === 0 ? (
                <p className="font-mono text-[12px] text-text-mute py-2">
                  {t("settings.noTaskTypes")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {taskTypes.map((tt) => {
                    const isSelected = settings.outdoor_task_type_ids.includes(tt.id);
                    return (
                      <button
                        key={tt.id}
                        onClick={() => toggleOutdoorTaskType(tt.id)}
                        aria-pressed={isSelected}
                        className="flex items-center gap-1.5 px-3 min-h-[36px] rounded-[5px] border transition-colors duration-150"
                        style={{
                          backgroundColor: isSelected
                            ? "rgba(255,255,255,0.06)"
                            : "rgba(255,255,255,0.03)",
                          borderColor: isSelected
                            ? "rgba(255,255,255,0.24)"
                            : "rgba(255,255,255,0.08)",
                        }}
                      >
                        <div
                          className="w-[8px] h-[8px] rounded-full shrink-0"
                          style={{ backgroundColor: tt.color }}
                        />
                        <span className="font-mohave text-[12px] text-text">
                          {tt.display}
                        </span>
                        {isSelected && (
                          <X className="w-[12px] h-[12px] text-text-3" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Toggle Row (standalone card) ───────────────────────────────────────────

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4">
      <label className="flex items-center justify-between min-h-[36px] cursor-pointer">
        <span className="font-mohave text-[14px] text-text">
          {label}
        </span>
        <ToggleSwitch checked={checked} onChange={onChange} />
      </label>
    </div>
  );
}

// ─── Toggle Row (inline within card) ────────────────────────────────────────

function ToggleRowInline({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between min-h-[36px] cursor-pointer">
      <div>
        <span className="font-mohave text-[13px] text-text block">
          {label}
        </span>
        <span className="font-mono text-[11px] text-text-3 block">
          {description}
        </span>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </label>
  );
}

// ─── Toggle Switch ──────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative w-[44px] h-[24px] rounded-full border transition-colors duration-150 shrink-0"
      style={{
        backgroundColor: checked ? "#6F94B0" : "rgba(255,255,255,0.06)",
        borderColor: checked ? "#6F94B0" : "rgba(255,255,255,0.12)",
      }}
    >
      <span
        className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform duration-150"
        style={{
          transform: checked ? "translateX(22px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}
