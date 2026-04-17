"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, Loader2, RotateCcw } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LifecycleConfig {
  status_update_frequency_days: number;
  overdue_threshold_days: number;
  archive_after_days: number;
  stage_task_overrides: Record<string, string[]>;
}

const DEFAULT_CONFIG: LifecycleConfig = {
  status_update_frequency_days: 7,
  overdue_threshold_days: 1,
  archive_after_days: 30,
  stage_task_overrides: {},
};

const FREQUENCY_OPTIONS = [
  { value: 0, labelKey: "lifecycle.frequency.off" },
  { value: 7, labelKey: "lifecycle.frequency.weekly" },
  { value: 14, labelKey: "lifecycle.frequency.biweekly" },
  { value: 30, labelKey: "lifecycle.frequency.monthly" },
];

const STAGE_TRANSITIONS = [
  { key: "rfq→estimated", labelKey: "lifecycle.stage.rfqToEstimated" },
  { key: "estimated→accepted", labelKey: "lifecycle.stage.estimatedToAccepted" },
  { key: "accepted→in_progress", labelKey: "lifecycle.stage.acceptedToInProgress" },
  { key: "in_progress→completed", labelKey: "lifecycle.stage.inProgressToCompleted" },
  { key: "completed→closed", labelKey: "lifecycle.stage.completedToClosed" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function LifecycleSettingsTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [config, setConfig] = useState<LifecycleConfig>(DEFAULT_CONFIG);
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
        `/api/settings/lifecycle?companyId=${companyId}`,
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

      const res = await fetch("/api/settings/lifecycle", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId, config }),
      });

      if (!res.ok) {
        throw new Error("Failed to save settings");
      }

      setDirty(false);
      toast.success(t("lifecycle.toast.saved"));
    } catch {
      toast.error(t("lifecycle.toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(partial: Partial<LifecycleConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }

  function handleStageTaskChange(
    transitionKey: string,
    taskIndex: number,
    value: string
  ) {
    const current = config.stage_task_overrides[transitionKey] ?? [];
    const updated = [...current];
    updated[taskIndex] = value;
    updateConfig({
      stage_task_overrides: {
        ...config.stage_task_overrides,
        [transitionKey]: updated.filter(Boolean),
      },
    });
  }

  function addStageTask(transitionKey: string) {
    const current = config.stage_task_overrides[transitionKey] ?? [];
    updateConfig({
      stage_task_overrides: {
        ...config.stage_task_overrides,
        [transitionKey]: [...current, ""],
      },
    });
  }

  function removeStageTask(transitionKey: string, taskIndex: number) {
    const current = config.stage_task_overrides[transitionKey] ?? [];
    updateConfig({
      stage_task_overrides: {
        ...config.stage_task_overrides,
        [transitionKey]: current.filter((_, i) => i !== taskIndex),
      },
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-[20px] h-[20px] text-text-3 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[640px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mohave text-body-lg text-text uppercase">
            {t("lifecycle.title")}
          </h3>
          <p className="font-mono text-[12px] text-text-3 mt-0.5">
            [{t("lifecycle.subtitle")}]
          </p>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 min-h-[56px] px-4 rounded-[4px] bg-[rgba(111, 148, 176,0.15)] text-[#6F94B0] font-mohave text-body-sm uppercase hover:bg-[rgba(111, 148, 176,0.25)] transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
            ) : (
              <Save className="w-[14px] h-[14px]" />
            )}
            {t("lifecycle.save")}
          </button>
        )}
      </div>

      {/* Status Update Frequency */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2] p-4">
        <span className="font-mono text-[11px] text-text-3 uppercase block mb-2">
          [{t("lifecycle.statusUpdates")}]
        </span>
        <p className="font-mono text-[12px] text-text-2 mb-3">
          {t("lifecycle.statusUpdatesDesc")}
        </p>
        <div className="flex gap-2 flex-wrap">
          {FREQUENCY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() =>
                updateConfig({ status_update_frequency_days: opt.value })
              }
              className={`min-h-[56px] px-4 rounded-[4px] font-mohave text-body-sm uppercase transition-colors ${
                config.status_update_frequency_days === opt.value
                  ? "bg-[rgba(111, 148, 176,0.15)] text-[#6F94B0] border border-[#6F94B0]"
                  : "bg-[rgba(255,255,255,0.03)] text-text-2 border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.16)]"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Overdue Task Detection */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2] p-4">
        <span className="font-mono text-[11px] text-text-3 uppercase block mb-2">
          [{t("lifecycle.overdueDetection")}]
        </span>
        <p className="font-mono text-[12px] text-text-2 mb-3">
          {t("lifecycle.overdueDetectionDesc")}
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-text-2">
            {t("lifecycle.flagAfter")}
          </span>
          <input
            type="number"
            min={0}
            max={30}
            value={config.overdue_threshold_days}
            onChange={(e) =>
              updateConfig({
                overdue_threshold_days: Math.max(
                  0,
                  parseInt(e.target.value) || 0
                ),
              })
            }
            className="w-[80px] min-h-[56px] font-mohave text-body-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 text-text text-center outline-none focus:border-[rgba(255,255,255,0.3)] [color-scheme:dark]"
          />
          <span className="font-mono text-[12px] text-text-2">
            {t("lifecycle.days")}
          </span>
          {config.overdue_threshold_days === 0 && (
            <span className="font-mono text-[11px] text-text-3">
              ({t("lifecycle.disabled")})
            </span>
          )}
        </div>
      </div>

      {/* Auto-Archive */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2] p-4">
        <span className="font-mono text-[11px] text-text-3 uppercase block mb-2">
          [{t("lifecycle.autoArchive")}]
        </span>
        <p className="font-mono text-[12px] text-text-2 mb-3">
          {t("lifecycle.autoArchiveDesc")}
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-text-2">
            {t("lifecycle.archiveAfter")}
          </span>
          <input
            type="number"
            min={0}
            max={365}
            value={config.archive_after_days}
            onChange={(e) =>
              updateConfig({
                archive_after_days: Math.max(
                  0,
                  parseInt(e.target.value) || 0
                ),
              })
            }
            className="w-[80px] min-h-[56px] font-mohave text-body-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 text-text text-center outline-none focus:border-[rgba(255,255,255,0.3)] [color-scheme:dark]"
          />
          <span className="font-mono text-[12px] text-text-2">
            {t("lifecycle.daysAfterCompletion")}
          </span>
          {config.archive_after_days === 0 && (
            <span className="font-mono text-[11px] text-text-3">
              ({t("lifecycle.disabled")})
            </span>
          )}
        </div>
      </div>

      {/* Stage-to-Task Mapping */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[11px] text-text-3 uppercase">
            [{t("lifecycle.stageTaskMapping")}]
          </span>
          <button
            onClick={() => updateConfig({ stage_task_overrides: {} })}
            className="flex items-center gap-1 font-mono text-[11px] text-text-3 hover:text-text-2 transition-colors min-h-[56px] min-w-[56px] justify-center -my-4"
            title={t("lifecycle.resetDefaults")}
          >
            <RotateCcw className="w-[12px] h-[12px]" />
            {t("lifecycle.resetDefaults")}
          </button>
        </div>
        <p className="font-mono text-[12px] text-text-2 mb-4">
          {t("lifecycle.stageTaskMappingDesc")}
        </p>

        <div className="space-y-4">
          {STAGE_TRANSITIONS.map(({ key, labelKey }) => {
            const tasks =
              config.stage_task_overrides[key] ?? [];
            const hasOverrides = tasks.length > 0;

            return (
              <div
                key={key}
                className="border-t border-[rgba(255,255,255,0.04)] pt-3 first:border-t-0 first:pt-0"
              >
                <span className="font-mohave text-body-sm text-text uppercase block mb-2">
                  {t(labelKey)}
                </span>
                {hasOverrides ? (
                  <div className="space-y-1.5">
                    {tasks.map((task, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={task}
                          onChange={(e) =>
                            handleStageTaskChange(key, i, e.target.value)
                          }
                          placeholder={t("lifecycle.taskNamePlaceholder")}
                          className="flex-1 min-h-[56px] font-mono text-[12px] bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 text-text outline-none focus:border-[rgba(255,255,255,0.3)] placeholder:text-text-mute"
                        />
                        <button
                          onClick={() => removeStageTask(key, i)}
                          className="min-h-[56px] min-w-[56px] flex items-center justify-center text-text-3 hover:text-[#93321A] transition-colors"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addStageTask(key)}
                      className="font-mono text-[11px] text-text-3 hover:text-text-2 transition-colors min-h-[56px]"
                    >
                      + {t("lifecycle.addTask")}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-text-3">
                      {t("lifecycle.usingDefaults")}
                    </span>
                    <button
                      onClick={() => addStageTask(key)}
                      className="font-mono text-[11px] text-text-2 hover:text-text transition-colors min-h-[56px]"
                    >
                      {t("lifecycle.customize")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
