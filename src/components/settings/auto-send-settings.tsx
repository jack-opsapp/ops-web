"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Sparkles, Clock, TrendingUp, Lock } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AutoSendSettingsData {
  enabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  timezone: string;
  delayMinMinutes: number;
  delayMaxMinutes: number;
}

interface DraftStats {
  totalSent: number;
  sentWithoutChanges: number;
  approvalRate: number;
  recentDrafts: number;
  commonChanges: Array<{
    type: string;
    from: string;
    to: string;
    count: number;
  }>;
}

interface AutoSendSettingsProps {
  connectionId: string;
}

// ─── Common Timezones ───────────────────────────────────────────────────────

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

function formatTimezone(tz: string): string {
  return tz.replace(/_/g, " ").replace(/\//g, " / ");
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AutoSendSettings({ connectionId }: AutoSendSettingsProps) {
  const { t } = useDictionary("ai-drafting");
  const { currentUser, company } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  const [settings, setSettings] = useState<AutoSendSettingsData | null>(null);
  const [stats, setStats] = useState<DraftStats | null>(null);

  // ─── Fetch settings + stats ───────────────────────────────────────────
  useEffect(() => {
    if (!company?.id || !currentUser?.id || !connectionId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [settingsRes, statsRes] = await Promise.all([
          authedFetch(
            `/api/integrations/email/auto-send/settings?companyId=${company.id}&connectionId=${connectionId}`
          ),
          authedFetch(
            `/api/integrations/email/draft-stats?companyId=${company.id}&connectionId=${connectionId}`
          ),
        ]);

        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setFeatureEnabled(data.featureEnabled);
          setSettings(data.settings);
        }

        if (statsRes.ok) {
          const data = await statsRes.json();
          setStats(data);
        }
      } catch {
        // Non-fatal
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [company?.id, currentUser?.id, connectionId]);

  // ─── Save settings ────────────────────────────────────────────────────
  const handleSave = useCallback(
    async (updates: Partial<AutoSendSettingsData>) => {
      if (!company?.id) return;
      setSaving(true);

      try {
        const response = await authedFetch(
          "/api/integrations/email/auto-send/settings",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: company.id,
              connectionId,
              settings: updates,
            }),
          }
        );

        if (!response.ok) throw new Error("Save failed");

        setSettings((prev) => (prev ? { ...prev, ...updates } : null));
        toast.success(t("autoSend.saved"));
      } catch {
        toast.error("Failed to save settings");
      } finally {
        setSaving(false);
      }
    },
    [company?.id, connectionId, t]
  );

  const handleDisable = useCallback(() => {
    if (settings?.enabled !== true) return;
    handleSave({ enabled: false });
  }, [settings?.enabled, handleSave]);

  // ─── Loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2
          className={cn(
            "h-[14px] w-[14px] text-text-mute",
            !prefersReducedMotion && "animate-spin"
          )}
        />
        <span className="font-mohave text-body-sm text-text-mute">
          Loading...
        </span>
      </div>
    );
  }

  // ─── Feature gated ────────────────────────────────────────────────────
  if (!featureEnabled) {
    return (
      <div className="rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
        <div className="mb-1 flex items-center gap-2">
          <Lock className="h-[14px] w-[14px] text-text-mute" />
          <span className="font-mohave text-body-sm font-medium text-text-2">
            {t("autoSend.title")}
          </span>
        </div>
        <p className="font-mohave text-caption-sm text-text-mute">
          {t("autoSend.featureGated.description")}
        </p>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────
  const effectiveSettings: AutoSendSettingsData = settings ?? {
    enabled: false,
    businessHoursStart: "08:00",
    businessHoursEnd: "18:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    delayMinMinutes: 30,
    delayMaxMinutes: 60,
  };

  return (
    <div className="space-y-3">
      {/* ─── Draft Stats ───────────────────────────────────────────────── */}
      {stats && stats.totalSent > 0 && (
        <div className="rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-[14px] w-[14px] text-[#6F94B0]" />
            <span className="font-mohave text-body-sm font-medium text-text-2">
              {t("stats.title")}
            </span>
          </div>

          {/* Approval Rate */}
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mohave text-caption-sm text-text-mute">
              {t("stats.approvalRate")}
            </span>
            <span className="font-mohave text-body-sm font-semibold text-text">
              {(stats.approvalRate * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mb-1 h-[3px] overflow-hidden rounded-full bg-[rgba(255,255,255,0.04)]">
            <div
              className={cn(
                "h-full rounded-full",
                !prefersReducedMotion && "transition-all duration-500"
              )}
              style={{
                width: `${stats.approvalRate * 100}%`,
                backgroundColor:
                  stats.approvalRate >= 0.95
                    ? "#9DB582"
                    : stats.approvalRate >= 0.7
                      ? "#C4A868"
                      : "#8E8E93",
              }}
            />
          </div>
          <span className="font-mohave text-[11px] text-text-mute">
            {t("stats.approvalRate.description")
              .replace("{{sent}}", String(stats.sentWithoutChanges))
              .replace("{{total}}", String(stats.totalSent))}
          </span>

          {/* Common Changes */}
          {stats.commonChanges.length > 0 && (
            <div className="mt-2.5 border-t border-[rgba(255,255,255,0.04)] pt-2">
              <span className="mb-1 block font-mono text-micro uppercase tracking-wider text-text-mute">
                {t("stats.commonChanges")}
              </span>
              <div className="space-y-0.5">
                {stats.commonChanges.slice(0, 3).map((change, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-[11px]"
                  >
                    <span className="w-[50px] shrink-0 font-mono text-micro uppercase tracking-wider text-text-mute">
                      {t(`stats.change.${change.type}`)}
                    </span>
                    <span className="truncate font-mohave text-text-mute line-through">
                      {change.from}
                    </span>
                    <span className="text-text-mute">&rarr;</span>
                    <span className="truncate font-mohave text-text-2">
                      {change.to}
                    </span>
                    <span className="shrink-0 font-mohave text-text-mute">
                      &times;{change.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Auto-Send Toggle + Settings ───────────────────────────────── */}
      <div className="rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-[14px] w-[14px] text-[#6F94B0]" />
            <span className="font-mohave text-body-sm font-medium text-text-2">
              {t("autoSend.title")}
            </span>
          </div>

          {effectiveSettings.enabled && (
            <button
              type="button"
              onClick={handleDisable}
              disabled={saving}
              className="min-h-11 rounded border border-border bg-surface-input px-2 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:text-text disabled:cursor-wait disabled:opacity-50"
            >
              {t("autoSend.toggle.off")}
            </button>
          )}
        </div>

        <p className="mb-3 font-mohave text-caption-sm text-text-mute">
          [{t("autoSend.description")}]
        </p>

        {effectiveSettings.enabled && (
          <div className="space-y-2.5 border-t border-[rgba(255,255,255,0.04)] pt-2">
            {/* Business Hours */}
            <div>
              <span className="mb-1 block font-mono text-micro uppercase tracking-wider text-text-mute">
                {t("autoSend.businessHours")}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="w-[28px] font-mohave text-caption-sm text-text-mute">
                    {t("autoSend.businessHours.start")}
                  </span>
                  <input
                    type="time"
                    value={effectiveSettings.businessHoursStart}
                    onChange={(e) =>
                      handleSave({ businessHoursStart: e.target.value })
                    }
                    className="focus:border-[rgba(111, 148, 176,0.4)] rounded-panel border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 font-mohave text-caption-sm text-text outline-none"
                  />
                </div>
                <span className="text-text-mute">&ndash;</span>
                <div className="flex items-center gap-1">
                  <span className="w-[20px] font-mohave text-caption-sm text-text-mute">
                    {t("autoSend.businessHours.end")}
                  </span>
                  <input
                    type="time"
                    value={effectiveSettings.businessHoursEnd}
                    onChange={(e) =>
                      handleSave({ businessHoursEnd: e.target.value })
                    }
                    className="focus:border-[rgba(111, 148, 176,0.4)] rounded-panel border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 font-mohave text-caption-sm text-text outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Timezone */}
            <div>
              <span className="mb-1 block font-mono text-micro uppercase tracking-wider text-text-mute">
                {t("autoSend.timezone")}
              </span>
              <select
                value={effectiveSettings.timezone}
                onChange={(e) => handleSave({ timezone: e.target.value })}
                className="focus:border-[rgba(111, 148, 176,0.4)] w-full appearance-none rounded-panel border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-1.5 py-1 font-mohave text-caption-sm text-text outline-none"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {formatTimezone(tz)}
                  </option>
                ))}
              </select>
            </div>

            {/* Delay Range */}
            <div>
              <span className="mb-0.5 block font-mono text-micro uppercase tracking-wider text-text-mute">
                {t("autoSend.delay")}
              </span>
              <span className="mb-1 block font-mohave text-[11px] text-text-mute">
                {t("autoSend.delay.description")}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="font-mohave text-caption-sm text-text-mute">
                    {t("autoSend.delay.min")}
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={effectiveSettings.delayMinMinutes}
                    onChange={(e) =>
                      handleSave({
                        delayMinMinutes: Math.max(
                          5,
                          parseInt(e.target.value) || 30
                        ),
                      })
                    }
                    className="focus:border-[rgba(111, 148, 176,0.4)] w-[52px] rounded-panel border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 text-center font-mohave text-caption-sm text-text outline-none"
                  />
                </div>
                <span className="text-text-mute">&ndash;</span>
                <div className="flex items-center gap-1">
                  <span className="font-mohave text-caption-sm text-text-mute">
                    {t("autoSend.delay.max")}
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={480}
                    value={effectiveSettings.delayMaxMinutes}
                    onChange={(e) =>
                      handleSave({
                        delayMaxMinutes: Math.max(
                          10,
                          parseInt(e.target.value) || 60
                        ),
                      })
                    }
                    className="focus:border-[rgba(111, 148, 176,0.4)] w-[52px] rounded-panel border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 text-center font-mohave text-caption-sm text-text outline-none"
                  />
                </div>
                <span className="font-mohave text-caption-sm text-text-mute">
                  {t("autoSend.delay.unit")}
                </span>
              </div>
            </div>

            {/* Clock indicator */}
            <div className="flex items-center gap-1.5 pt-1">
              <Clock className="h-[11px] w-[11px] text-text-mute" />
              <span className="font-mohave text-[11px] text-text-mute">
                {t("autoSend.requiresApproval")}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
