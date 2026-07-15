"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Sparkles,
  Eye,
  FileText,
  Zap,
  Send,
  Settings2,
  ArrowRight,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { EmailCategoryAutonomy } from "./email-category-autonomy";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AutonomyData {
  level: number;
  emailsAnalyzed: number;
  confidence: number;
  approvalRate: number;
  totalDrafts: number;
  autoDraftEnabled: boolean;
  autoSendEnabled: boolean;
  categoryAutonomy: Record<string, string>;
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
  { key: "autoSend", icon: Send, target: null },
  { key: "perCategory", icon: Settings2, target: null },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function AutonomyStatusPanel({ connectionId }: AutonomyStatusPanelProps) {
  const { t } = useDictionary("autonomy");
  const { currentUser, company } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AutonomyData | null>(null);
  const [autoSendFeatureEnabled, setAutoSendFeatureEnabled] = useState(false);

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  // ─── Fetch autonomy status ────────────────────────────────────────────
  useEffect(() => {
    if (!company?.id || !currentUser?.id || !connectionId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/integrations/email/auto-send/settings?companyId=${company.id}&connectionId=${connectionId}`
        );
        if (!res.ok) return;

        const settingsData = await res.json();
        setAutoSendFeatureEnabled(settingsData.featureEnabled ?? false);

        // Parse autonomy-relevant data from settings response
        const settings = settingsData.settings || {};
        const autoDraftEnabled = settings.auto_draft_enabled === true;
        const autoSendEnabled = settings.enabled === true;
        const categoryAutonomy = settings.category_autonomy || {};

        // Fetch draft stats for approval rate
        const statsRes = await fetch(
          `/api/integrations/email/draft-stats?companyId=${company.id}&userId=${currentUser.id}`
        );
        let approvalRate = 0;
        let totalDrafts = 0;
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          approvalRate = statsData.approvalRate ?? 0;
          totalDrafts = statsData.totalSent ?? 0;
        }

        // Compute level client-side (mirrors server logic)
        const emailsAnalyzed = settings.emails_analyzed ?? 0;
        const confidence = settings.confidence ?? 0;
        const categoryConfigured = Object.values(categoryAutonomy).some(
          (v: unknown) => v !== "draft_on_request"
        );

        let level = 0;
        if (categoryConfigured && autoSendEnabled) level = 5;
        else if (autoSendEnabled && approvalRate >= 0.95 && totalDrafts >= 20) level = 4;
        else if (autoDraftEnabled && confidence > 0.75 && emailsAnalyzed >= 250) level = 3;
        else if (emailsAnalyzed >= 100 && confidence > 0.5) level = 2;
        else if (emailsAnalyzed >= 25 && confidence > 0.2) level = 1;

        setData({
          level,
          emailsAnalyzed,
          confidence,
          approvalRate,
          totalDrafts,
          autoDraftEnabled,
          autoSendEnabled,
          categoryAutonomy,
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
      const response = await fetch(
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
        <Loader2 className={cn("w-[14px] h-[14px] text-text-mute", !prefersReducedMotion && "animate-spin")} />
        <span className="font-mohave text-body-sm text-text-mute">
          {t("loading")}
        </span>
      </div>
    );
  }

  if (!data) return null;

  const currentLevelConfig = LEVELS[data.level] || LEVELS[0];
  const nextLevelConfig = data.level < 5 ? LEVELS[data.level + 1] : null;
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
  } else if (data.level === 3) {
    progressPercent = Math.min(100, data.approvalRate * 100);
    progressLabel = t("status.confidence").replace(
      "{{value}}",
      (data.approvalRate * 100).toFixed(0)
    );
  } else {
    progressPercent = 100;
  }

  return (
    <div className="space-y-3">
      {/* ─── Autonomy Level Status ─────────────────────────────────────── */}
      <div className="px-3 py-2.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <CurrentIcon className="w-[14px] h-[14px] text-[#6F94B0]" />
          <span className="font-cakemono text-body-sm text-text-2 font-light uppercase tracking-wide">
            {t("status.title")}
          </span>
        </div>

        {/* Level indicator */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center gap-1.5">
            {LEVELS.map((lvl, i) => (
              <div
                key={lvl.key}
                className={cn(
                  "w-[6px] h-[6px] rounded-full transition-colors",
                  i <= data.level
                    ? "bg-text-2"
                    : "bg-[rgba(255,255,255,0.08)]"
                )}
              />
            ))}
          </div>
          <span className="font-mohave text-body-sm text-text font-semibold">
            {t(`status.level.${currentLevelConfig.key}`)}
          </span>
        </div>

        {/* Description */}
        <p className="font-mohave text-caption-sm text-text-mute mb-2">
          [{t(`status.level.${currentLevelConfig.key}.description`)}]
        </p>

        {/* Progress bar */}
        {data.level < 4 && (
          <div className="mb-2">
            <div className="h-[3px] bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", !prefersReducedMotion && "transition-all duration-500")}
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: "#6F94B0",
                }}
              />
            </div>
            <span className="font-mohave text-[11px] text-text-mute mt-0.5 block">
              {progressLabel}
            </span>
          </div>
        )}

        {/* What's next */}
        {nextLevelConfig && (
          <div className="pt-2 border-t border-[rgba(255,255,255,0.04)]">
            <span className="font-mono text-micro text-text-mute uppercase tracking-wider block mb-0.5">
              {t("status.whatsNext")}
            </span>
            <div className="flex items-start gap-1.5">
              <ArrowRight className="w-[10px] h-[10px] text-text-mute mt-0.5 shrink-0" />
              <span className="font-mohave text-caption-sm text-text-mute">
                {t(`status.whatsNext.${currentLevelConfig.key}`)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Auto-Draft Toggle ─────────────────────────────────────────── */}
      <div className="px-3 py-2.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Zap className="w-[14px] h-[14px] text-[#6F94B0]" />
            <span className="font-cakemono text-body-sm text-text-2 font-light uppercase tracking-wide">
              {t("autoDraft.title")}
            </span>
          </div>

          {/* Toggle — 56dp tap area */}
          <button
            onClick={handleAutoDraftToggle}
            disabled={saving || data.confidence <= 0.75}
            className={cn(
              "relative flex items-center justify-center w-[56px] h-[56px] -m-[19px]",
              (saving || data.confidence <= 0.75) && "opacity-50 cursor-not-allowed"
            )}
          >
            <div
              className={cn(
                "relative w-[36px] h-[18px] rounded-full transition-colors",
                data.autoDraftEnabled
                  ? "bg-text-2"
                  : "bg-[rgba(255,255,255,0.1)]"
              )}
            >
              <div
                className={cn(
                  "absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform",
                  data.autoDraftEnabled
                    ? "translate-x-[20px]"
                    : "translate-x-[2px]"
                )}
              />
            </div>
          </button>
        </div>

        <p className="font-mohave text-caption-sm text-text-mute">
          [{t("autoDraft.description")}]
        </p>

        {data.confidence <= 0.75 && (
          <p className="font-mono text-micro text-text-mute mt-1">
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
