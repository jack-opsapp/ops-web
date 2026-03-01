"use client";

import { useState, useEffect, useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import type { LifecycleEmailConfig } from "@/lib/admin/types";
import {
  LIFECYCLE_EMAIL_META,
  STAGE_LABELS,
  STAGE_ORDER,
} from "@/lib/admin/lifecycle-email-meta";

export function LifecycleConfigPanel() {
  const [configs, setConfigs] = useState<Record<string, LifecycleEmailConfig>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/email/lifecycle-config");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      const map: Record<string, LifecycleEmailConfig> = {};
      for (const row of data.rows || []) {
        map[row.email_type_key] = row;
      }
      setConfigs(map);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  async function patchRow(
    key: string,
    updates: Partial<Pick<LifecycleEmailConfig, "enabled" | "min_days" | "max_days">>
  ) {
    setSaving((p) => ({ ...p, [key]: true }));
    setSaveErrors((p) => ({ ...p, [key]: "" }));

    try {
      const res = await fetch("/api/admin/email/lifecycle-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_type_key: key, ...updates }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }

      const data = await res.json();
      setConfigs((p) => ({ ...p, [key]: data.row }));
    } catch (err) {
      setSaveErrors((p) => ({
        ...p,
        [key]: err instanceof Error ? err.message : "Save failed",
      }));
    } finally {
      setSaving((p) => ({ ...p, [key]: false }));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-4 h-4 border-2 border-[#597794] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[#93321A]/30 bg-[#93321A]/10 p-3">
        <p className="font-kosugi text-[11px] text-[#93321A]">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        Email Configuration
      </p>

      <div className="space-y-4">
        {STAGE_ORDER.map((stage) => {
          const emails = LIFECYCLE_EMAIL_META.filter((m) => m.stage === stage);
          return (
            <div key={stage}>
              <p className="font-mohave text-[12px] uppercase tracking-wider text-[#597794] mb-2">
                {STAGE_LABELS[stage]}
              </p>

              <div className="space-y-1.5">
                {emails.map((meta) => {
                  const cfg = configs[meta.key];
                  if (!cfg) return null;

                  const isSaving = saving[meta.key] ?? false;
                  const saveError = saveErrors[meta.key] ?? "";

                  return (
                    <div
                      key={meta.key}
                      className="border border-white/[0.08] rounded-lg px-3 py-2.5 bg-white/[0.02]"
                    >
                      {/* Row: toggle + label */}
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={cfg.enabled}
                          onCheckedChange={(val) =>
                            patchRow(meta.key, { enabled: val })
                          }
                          disabled={isSaving}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-mohave text-[13px] text-[#E5E5E5]">
                            {meta.label}
                            {isSaving && (
                              <span className="ml-2 inline-block w-3 h-3 border border-[#597794] border-t-transparent rounded-full animate-spin align-middle" />
                            )}
                          </p>
                          <p className="font-kosugi text-[10px] text-[#6B6B6B] truncate">
                            {meta.audience}
                          </p>
                        </div>
                      </div>

                      {/* Day inputs — only shown when enabled */}
                      {cfg.enabled && (
                        <div className="flex items-center gap-3 mt-2 ml-[56px]">
                          <DayInput
                            label="Min"
                            value={cfg.min_days}
                            disabled={isSaving}
                            onCommit={(v) =>
                              patchRow(meta.key, { min_days: v })
                            }
                          />
                          <DayInput
                            label="Max"
                            value={cfg.max_days}
                            disabled={isSaving}
                            onCommit={(v) =>
                              patchRow(meta.key, { max_days: v })
                            }
                          />
                          <span className="font-kosugi text-[10px] text-[#4A4A4A]">
                            days
                          </span>
                        </div>
                      )}

                      {/* Error */}
                      {saveError && (
                        <p className="mt-1 ml-[56px] font-kosugi text-[10px] text-[#93321A]">
                          {saveError}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day Input ────────────────────────────────────────────────────────────────

function DayInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));

  // Sync when external value changes (after save)
  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  function handleBlur() {
    const parsed = parseInt(local, 10);
    if (isNaN(parsed) || parsed < 0) {
      setLocal(String(value)); // revert
      return;
    }
    if (parsed !== value) {
      onCommit(parsed);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-kosugi text-[10px] text-[#6B6B6B]">{label}</span>
      <input
        type="number"
        min={0}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        disabled={disabled}
        className="w-[52px] bg-transparent border border-white/[0.08] rounded px-2 py-1 font-kosugi text-[11px] text-[#E5E5E5] text-center focus:outline-none focus:border-[#597794] disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}
