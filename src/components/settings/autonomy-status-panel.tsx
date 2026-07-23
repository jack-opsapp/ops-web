"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Sparkles,
  Eye,
  FileText,
  Zap,
  ArrowRight,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { Switch } from "@/components/ui/switch";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { EmailCategoryAutonomy } from "./email-category-autonomy";
import { authedFetch } from "@/lib/utils/authed-fetch";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AutonomyData {
  level: number;
  emailsAnalyzed: number;
  confidence: number;
  autoDraftEnabled: boolean;
}

interface AutonomyStatusPanelProps {
  connectionId: string;
}

// ─── Level Config ───────────────────────────────────────────────────────────

const LEVELS = [
  { key: "observe", icon: Eye, target: 25 },
  { key: "available", icon: Sparkles, target: 100 },
  { key: "draft", icon: FileText, target: 250 },
  { key: "autoDraft", icon: Zap, target: null },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function AutonomyStatusPanel({
  connectionId,
}: AutonomyStatusPanelProps) {
  const { t } = useDictionary("autonomy");
  const { currentUser, company } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AutonomyData | null>(null);
  const [autoSendFeatureEnabled, setAutoSendFeatureEnabled] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // ─── Fetch autonomy status ────────────────────────────────────────────
  useEffect(() => {
    if (!company?.id || !currentUser?.id || !connectionId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await authedFetch(
          `/api/integrations/email/auto-send/settings?companyId=${company.id}&connectionId=${connectionId}`
        );
        if (!res.ok) return;

        const settingsData = await res.json();
        setAutoSendFeatureEnabled(settingsData.featureEnabled ?? false);

        // Parse autonomy-relevant data from settings response
        const settings = settingsData.settings || {};
        const autoDraftEnabled = settings.auto_draft_enabled === true;

        // This ladder ends at auto-draft. Autonomous sending is presented and
        // accepted only by the exact per-category readiness controls below.
        const emailsAnalyzed = settings.emails_analyzed ?? 0;
        const confidence = settings.confidence ?? 0;

        let level = 0;
        if (autoDraftEnabled && confidence > 0.75 && emailsAnalyzed >= 250)
          level = 3;
        else if (emailsAnalyzed >= 100 && confidence > 0.5) level = 2;
        else if (emailsAnalyzed >= 25 && confidence > 0.2) level = 1;

        setData({
          level,
          emailsAnalyzed,
          confidence,
          autoDraftEnabled,
        });
      } catch {
        // Non-fatal
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [company?.id, currentUser?.id, connectionId]);

  // ─── Toggle auto-draft ────────────────────────────────────────────────
  const handleAutoDraftToggle = useCallback(async () => {
    if (!company?.id || !data) return;
    setSaving(true);

    try {
      const newEnabled = !data.autoDraftEnabled;
      const response = await authedFetch(
        "/api/integrations/email/auto-send/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: company.id,
            connectionId,
            settings: { auto_draft_enabled: newEnabled },
          }),
        }
      );

      if (!response.ok) throw new Error("Save failed");

      setData((prev) =>
        prev ? { ...prev, autoDraftEnabled: newEnabled } : null
      );
      toast.success(t("autoDraft.saved"));
    } catch {
      toast.error(t("error.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [company?.id, connectionId, data, t]);

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
          {t("loading")}
        </span>
      </div>
    );
  }

  if (!data) return null;

  const currentLevelConfig = LEVELS[data.level] || LEVELS[0];
  const nextLevelConfig =
    data.level < LEVELS.length - 1 ? LEVELS[data.level + 1] : null;
  const CurrentIcon = currentLevelConfig.icon;

  // Progress toward next level
  let progressPercent = 0;
  let progressLabel = "";
  if (data.level === 0) {
    const target = 25;
    progressPercent = Math.min(100, (data.emailsAnalyzed / target) * 100);
    progressLabel = t("status.progress")
      .replace("{{current}}", String(data.emailsAnalyzed))
      .replace("{{target}}", String(target));
  } else if (data.level === 1) {
    const target = 100;
    progressPercent = Math.min(100, (data.emailsAnalyzed / target) * 100);
    progressLabel = t("status.progress")
      .replace("{{current}}", String(data.emailsAnalyzed))
      .replace("{{target}}", String(target));
  } else if (data.level === 2) {
    const target = 250;
    progressPercent = Math.min(100, (data.emailsAnalyzed / target) * 100);
    progressLabel = t("status.progress")
      .replace("{{current}}", String(data.emailsAnalyzed))
      .replace("{{target}}", String(target));
  } else {
    progressPercent = 100;
  }

  return (
    <div className="space-y-3">
      {/* ─── Autonomy Level Status ─────────────────────────────────────── */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
        {/* Header */}
        <div className="mb-2 flex items-center gap-2">
          <CurrentIcon className="h-[14px] w-[14px] text-[#6F94B0]" />
          <span className="font-cakemono text-body-sm font-light uppercase tracking-wide text-text-2">
            {t("status.title")}
          </span>
        </div>

        {/* Level indicator */}
        <div className="mb-2 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {LEVELS.map((lvl, i) => (
              <div
                key={lvl.key}
                className={cn(
                  "h-[6px] w-[6px] rounded-full transition-colors",
                  i <= data.level ? "bg-text-2" : "bg-[rgba(255,255,255,0.08)]"
                )}
              />
            ))}
          </div>
          <span className="font-mohave text-body-sm font-semibold text-text">
            {t(`status.level.${currentLevelConfig.key}`)}
          </span>
        </div>

        {/* Description */}
        <p className="mb-2 font-mohave text-caption-sm text-text-mute">
          [{t(`status.level.${currentLevelConfig.key}.description`)}]
        </p>

        {/* Progress bar */}
        {data.level < LEVELS.length - 1 && (
          <div className="mb-2">
            <div className="h-[3px] overflow-hidden rounded-full bg-[rgba(255,255,255,0.04)]">
              <div
                className={cn(
                  "h-full rounded-full",
                  !prefersReducedMotion && "transition-all duration-500"
                )}
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: "#6F94B0",
                }}
              />
            </div>
            <span className="mt-0.5 block font-mohave text-[11px] text-text-mute">
              {progressLabel}
            </span>
          </div>
        )}

        {/* What's next */}
        {nextLevelConfig && (
          <div className="border-t border-[rgba(255,255,255,0.04)] pt-2">
            <span className="mb-0.5 block font-mono text-micro uppercase tracking-wider text-text-mute">
              {t("status.whatsNext")}
            </span>
            <div className="flex items-start gap-1.5">
              <ArrowRight className="mt-0.5 h-[10px] w-[10px] shrink-0 text-text-mute" />
              <span className="font-mohave text-caption-sm text-text-mute">
                {t(`status.whatsNext.${currentLevelConfig.key}`)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Auto-Draft Toggle ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-[14px] w-[14px] text-[#6F94B0]" />
            <span className="font-cakemono text-body-sm font-light uppercase tracking-wide text-text-2">
              {t("autoDraft.title")}
            </span>
          </div>

          <Switch
            checked={data.autoDraftEnabled}
            disabled={saving || data.confidence <= 0.75}
            onCheckedChange={handleAutoDraftToggle}
            aria-label={t("autoDraft.title")}
          />
        </div>

        <p className="font-mohave text-caption-sm text-text-mute">
          [{t("autoDraft.description")}]
        </p>

        {data.confidence <= 0.75 && (
          <p className="mt-1 font-mono text-micro text-text-mute">
            [{t("autoDraft.requiresConfidence")}]
          </p>
        )}
      </div>

      {/* ─── Per-Category Autonomy ─────────────────────────────────────── */}
      {data.autoDraftEnabled && (
        <EmailCategoryAutonomy
          connectionId={connectionId}
          autoSendFeatureEnabled={autoSendFeatureEnabled}
        />
      )}
    </div>
  );
}
