"use client";

/**
 * Schedule Overview Widget
 *
 * Sprint S1.6: Compact read-only display of today's schedule health.
 * Shows crew utilization, conflicts, unassigned tasks, weather alerts,
 * and optimization status. No actions — just awareness.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Users,
  AlertTriangle,
  UserX,
  CloudRain,
  CheckCircle2,
  Sparkles,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";

interface ScheduleHealth {
  totalMembers: number;
  activeMembers: number;
  conflictCount: number;
  unassignedCount: number;
  weatherRiskCount: number;
  pendingSuggestions: number;
  enabled: boolean;
}

function pluralS(count: number): string {
  return count === 1 ? "" : "s";
}

export function ScheduleOverview() {
  const { t } = useDictionary("scheduling");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const shouldReduceMotion = useReducedMotion();

  const [health, setHealth] = useState<ScheduleHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    if (!companyId) return;
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch(
        `/api/agent/schedule-health?companyId=${companyId}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch {
      // Silently fail — widget is supplementary
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (!health || !health.enabled) {
    return (
      <div className="px-4 py-6">
        <p className="font-kosugi text-[12px] text-text-tertiary text-left">
          {t("dashboard.noData")}
        </p>
      </div>
    );
  }

  const motionProps = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.2, ease: EASE_SMOOTH },
      };

  const rows = [
    {
      icon: Users,
      label: t("dashboard.crewUtilization"),
      value: t("dashboard.crewUtilizationValue")
        .replace("{{active}}", String(health.activeMembers))
        .replace("{{total}}", String(health.totalMembers)),
      color: "text-text-secondary",
      iconColor: "text-text-tertiary",
    },
    {
      icon: AlertTriangle,
      label: t("dashboard.conflicts"),
      value:
        health.conflictCount > 0
          ? t("dashboard.conflictsDetected")
              .replace("{{count}}", String(health.conflictCount))
              .replace("{{plural}}", pluralS(health.conflictCount))
          : t("dashboard.noConflicts"),
      color: health.conflictCount > 0 ? "text-[#C4A868]" : "text-text-secondary",
      iconColor: health.conflictCount > 0 ? "text-[#C4A868]" : "text-text-tertiary",
    },
    {
      icon: UserX,
      label: t("dashboard.unassigned"),
      value:
        health.unassignedCount > 0
          ? t("dashboard.unassignedCount")
              .replace("{{count}}", String(health.unassignedCount))
              .replace("{{plural}}", pluralS(health.unassignedCount))
          : t("dashboard.allAssigned"),
      color:
        health.unassignedCount > 0 ? "text-[#C4A868]" : "text-text-secondary",
      iconColor:
        health.unassignedCount > 0 ? "text-[#C4A868]" : "text-text-tertiary",
    },
    {
      icon: CloudRain,
      label: t("dashboard.weatherAlerts"),
      value:
        health.weatherRiskCount > 0
          ? t("dashboard.weatherRisk")
              .replace("{{count}}", String(health.weatherRiskCount))
              .replace("{{plural}}", pluralS(health.weatherRiskCount))
          : t("dashboard.noWeatherRisk"),
      color:
        health.weatherRiskCount > 0
          ? "text-[#C4A868]"
          : "text-text-secondary",
      iconColor:
        health.weatherRiskCount > 0
          ? "text-[#C4A868]"
          : "text-text-tertiary",
    },
    {
      icon: health.pendingSuggestions > 0 ? Sparkles : CheckCircle2,
      label: t("dashboard.optimizationStatus"),
      value:
        health.pendingSuggestions > 0
          ? t("dashboard.improvementsSuggested")
              .replace("{{count}}", String(health.pendingSuggestions))
              .replace("{{plural}}", pluralS(health.pendingSuggestions))
          : t("dashboard.optimized"),
      // Reserve accent for the single footer CTA link — keep this row neutral
      color: "text-text-secondary",
      iconColor: "text-text-tertiary",
    },
  ];

  return (
    <motion.div {...motionProps} className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <h3 className="font-mohave text-[14px] text-text-primary uppercase tracking-wider">
          {t("dashboard.title")}
        </h3>
        <p className="font-kosugi text-[11px] text-text-tertiary mt-0.5">
          [{t("dashboard.subtitle")}]
        </p>
      </div>

      {/* Metrics */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-2">
        <div className="space-y-1">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <div
                key={row.label}
                className="flex items-center gap-3 py-2 min-h-[44px]"
              >
                <Icon className={cn("w-[14px] h-[14px] shrink-0", row.iconColor)} />
                <div className="flex-1 min-w-0">
                  <span className="font-kosugi text-[11px] text-text-tertiary block">
                    {row.label}
                  </span>
                  <span className={cn("font-mohave text-[13px] block truncate", row.color)}>
                    {row.value}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer link — 56dp touch target per design system */}
      {health.pendingSuggestions > 0 && (
        <div className="px-4 border-t border-[rgba(255,255,255,0.06)]">
          <a
            href="/agent/queue"
            className="flex items-center gap-1.5 font-kosugi text-[11px] text-[#597794] hover:text-[#7B9AB8] transition-colors min-h-[56px]"
          >
            <ExternalLink className="w-[12px] h-[12px]" />
            {t("dashboard.viewQueue")}
          </a>
        </div>
      )}
    </motion.div>
  );
}
