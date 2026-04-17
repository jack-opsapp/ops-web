"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Database,
  Mail,
  PenTool,
  CheckCircle,
  Loader2,
  ChevronRight,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

// ─── Animation ──────────────────────────────────────────────────────────────────

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

// ─── Types ──────────────────────────────────────────────────────────────────────

interface KnowledgeStats {
  totalFacts: number;
  totalEntities: number;
  totalEdges: number;
  profileConfidence: number;
  emailsAnalyzed: number;
}

type ReadinessLevel = "ready" | "learning" | "not_yet";

interface ReadinessState {
  writingProfile: ReadinessLevel;
  businessKnowledge: ReadinessLevel;
  emailDrafting: ReadinessLevel;
}

// ─── Component ──────────────────────────────────────────────────────────────────

interface AiSetupDashboardProps {
  onRescanEmails: () => void;
  onRemine: () => void;
  onReinterview: () => void;
}

export function AiSetupDashboard({
  onRescanEmails,
  onRemine,
  onReinterview,
}: AiSetupDashboardProps) {
  const { t } = useDictionary("ai-setup");
  const { company, currentUser } = useAuthStore();
  const router = useRouter();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? "";

  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [readiness, setReadiness] = useState<ReadinessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasEmailConnection, setHasEmailConnection] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Fetch knowledge stats
  useEffect(() => {
    if (!companyId || !userId) return;

    async function fetchStats() {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;

        // Parallel queries for stats
        const [factsRes, entitiesRes, edgesRes, profileRes, connectionsRes] =
          await Promise.all([
            supabase
              .from("agent_memories")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyId),
            supabase
              .from("graph_entities")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyId),
            supabase
              .from("agent_knowledge_graph")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyId),
            supabase
              .from("agent_writing_profiles")
              .select("emails_analyzed")
              .eq("company_id", companyId)
              .eq("user_id", userId)
              .single(),
            supabase
              .from("email_connections")
              .select("id")
              .eq("company_id", companyId)
              .limit(1),
          ]);

        const emailsAnalyzed =
          (profileRes.data?.emails_analyzed as number) ?? 0;

        // Confidence calculation matches WritingProfileService.getConfidence()
        let profileConfidence: number;
        if (emailsAnalyzed < 25) profileConfidence = emailsAnalyzed / 125;
        else if (emailsAnalyzed < 100)
          profileConfidence = 0.2 + (emailsAnalyzed - 25) * 0.004;
        else if (emailsAnalyzed < 250)
          profileConfidence = 0.5 + (emailsAnalyzed - 100) * 0.00167;
        else
          profileConfidence = Math.min(
            1.0,
            0.75 + (emailsAnalyzed - 250) * 0.001
          );

        const knowledgeStats: KnowledgeStats = {
          totalFacts: factsRes.count ?? 0,
          totalEntities: entitiesRes.count ?? 0,
          totalEdges: edgesRes.count ?? 0,
          profileConfidence,
          emailsAnalyzed,
        };

        setStats(knowledgeStats);
        setHasEmailConnection((connectionsRes.data?.length ?? 0) > 0);

        // Determine readiness
        setReadiness({
          writingProfile:
            profileConfidence > 0.5
              ? "ready"
              : profileConfidence > 0
                ? "learning"
                : "not_yet",
          businessKnowledge:
            knowledgeStats.totalFacts > 50
              ? "ready"
              : knowledgeStats.totalFacts > 0
                ? "learning"
                : "not_yet",
          emailDrafting:
            profileConfidence > 0.5 ? "ready" : "not_yet",
        });
      } catch (err) {
        console.error("[ai-dashboard] Failed to fetch stats:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [companyId, userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[20px] h-[20px] text-text-mute animate-spin" />
      </div>
    );
  }

  if (!stats || !readiness) return null;

  const readinessColor: Record<ReadinessLevel, string> = {
    ready: "#9DB582",
    learning: "#C4A868",
    not_yet: "#8E8E93",
  };

  const readinessLabel: Record<ReadinessLevel, string> = {
    ready: t("dashboard.readiness.ready"),
    learning: t("dashboard.readiness.learning"),
    not_yet: t("dashboard.readiness.notYet"),
  };

  // ─── Determine next steps ────────────────────────────────────────────────

  const nextSteps: string[] = [];
  if (!hasEmailConnection) {
    nextSteps.push(t("dashboard.nextSteps.connectEmail"));
  }
  if (stats.emailsAnalyzed < 25) {
    nextSteps.push(t("dashboard.nextSteps.scanEmails"));
  }
  if (stats.totalFacts < 10) {
    nextSteps.push(t("dashboard.nextSteps.mineData"));
  }
  if (
    readiness.writingProfile === "ready" &&
    readiness.businessKnowledge === "ready"
  ) {
    if (stats.emailsAnalyzed < 100) {
      nextSteps.push(t("dashboard.nextSteps.sendMore"));
    } else {
      nextSteps.push(t("dashboard.nextSteps.allDone"));
    }
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="flex items-center gap-1.5">
        <Brain className="w-[16px] h-[16px] text-[#6F94B0]" />
        <span className="font-cakemono text-body font-light uppercase tracking-wide text-text">
          {t("dashboard.title")}
        </span>
      </div>

      {/* Knowledge Stats */}
      <div className="space-y-1.5">
        <span className="font-mono text-[11px] text-text-3 uppercase tracking-[0.08em]">
          {t("dashboard.stats.title")}
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            {
              label: t("dashboard.stats.facts"),
              value: stats.totalFacts,
              icon: Database,
            },
            {
              label: t("dashboard.stats.entities"),
              value: stats.totalEntities,
              icon: Brain,
            },
            {
              label: t("dashboard.stats.edges"),
              value: stats.totalEdges,
              icon: ArrowRight,
            },
            {
              label: t("dashboard.stats.profileConfidence"),
              value: `${Math.round(stats.profileConfidence * 100)}%`,
              icon: PenTool,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="px-2 py-1.5 rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)]"
            >
              <div className="flex items-center gap-1 mb-[2px]">
                <stat.icon className="w-[10px] h-[10px] text-text-mute" />
                <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                  {stat.label}
                </span>
              </div>
              <span className="font-mohave text-[18px] font-semibold text-text">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Readiness Indicators */}
      <div className="space-y-1.5">
        <span className="font-mono text-[11px] text-text-3 uppercase tracking-[0.08em]">
          {t("dashboard.readiness.title")}
        </span>
        <div className="space-y-[6px]">
          {(
            [
              {
                key: "writingProfile" as const,
                label: t("dashboard.readiness.writingProfile"),
                icon: PenTool,
              },
              {
                key: "businessKnowledge" as const,
                label: t("dashboard.readiness.businessKnowledge"),
                icon: Database,
              },
              {
                key: "emailDrafting" as const,
                label: t("dashboard.readiness.emailDrafting"),
                icon: Mail,
              },
            ] as const
          ).map((item) => {
            const level = readiness[item.key];
            const color = readinessColor[level];

            return (
              <div
                key={item.key}
                className="flex items-center justify-between px-2 py-1.5 rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"
              >
                <div className="flex items-center gap-1.5">
                  <item.icon className="w-[14px] h-[14px] text-text-mute" />
                  <span className="font-mohave text-body-sm text-text">
                    {item.label}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div
                    className="w-[6px] h-[6px] rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className="font-mono text-micro uppercase tracking-wider"
                    style={{ color }}
                  >
                    {readinessLabel[level]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-1.5">
        <span className="font-mono text-[11px] text-text-3 uppercase tracking-[0.08em]">
          {t("dashboard.actions.title")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {readiness.emailDrafting === "ready" && (
            <button
              onClick={() => router.push("/inbox?compose=true&ai=true")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-ops-accent hover:bg-[#4a6680] text-white font-mohave text-[13px] transition-colors"
            >
              <Mail className="w-[13px] h-[13px]" />
              {t("dashboard.actions.tryDraft")}
            </button>
          )}
          <button
            onClick={onRescanEmails}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] text-text-2 font-mohave text-[13px] transition-colors"
          >
            <RotateCcw className="w-[12px] h-[12px]" />
            {t("dashboard.actions.rescan")}
          </button>
          <button
            onClick={onRemine}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] text-text-2 font-mohave text-[13px] transition-colors"
          >
            <Database className="w-[12px] h-[12px]" />
            {t("dashboard.actions.remine")}
          </button>
          <button
            onClick={onReinterview}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] text-text-2 font-mohave text-[13px] transition-colors"
          >
            <Brain className="w-[12px] h-[12px]" />
            {t("dashboard.actions.reinterview")}
          </button>
        </div>
      </div>

      {/* Next Steps */}
      {nextSteps.length > 0 && (
        <div className="space-y-1.5">
          <span className="font-mono text-[11px] text-text-3 uppercase tracking-[0.08em]">
            {t("dashboard.nextSteps.title")}
          </span>
          <div className="space-y-[4px]">
            {nextSteps.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 px-2 py-1 rounded border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)]"
              >
                <ChevronRight className="w-[12px] h-[12px] text-[#6F94B0] mt-[2px] shrink-0" />
                <span className="font-mohave text-[13px] text-text-2">
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
