"use client";

/**
 * Sprint S2: Phase C Integration Dashboard
 *
 * Read-only mission-control widget showing the full Phase C agent status
 * across every domain: email intelligence, project management, invoicing,
 * scheduling, and client communications. Also shows which autonomy
 * milestones have been reached.
 */

import { useState, useEffect, memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Mail,
  FolderKanban,
  Receipt,
  Calendar,
  MessageSquare,
  Gauge,
  CheckCircle2,
  Circle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";

interface DomainStats {
  proposed: number;
  executed: number;
  rejected: number;
}

interface PhaseCStatus {
  email: {
    draftsGenerated: number;
    draftsSent: number;
    approvalRate: number;
    unchangedRate: number;
    writingProfileConfidence: number;
    emailsAnalyzed: number;
  };
  projects: DomainStats;
  invoicing: DomainStats;
  scheduling: DomainStats;
  clientComms: DomainStats;
  milestones: {
    draftingAvailable: boolean;
    drafting: boolean;
    autoDraft: boolean;
    autoSend: boolean;
  };
}

function useDelayedFetch<T>(url: string): {
  data: T | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const { getIdToken } = await import("@/lib/firebase/auth");
        const idToken = await getIdToken();
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData(json as T);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, loading, error };
}

export const PhaseCDashboard = memo(function PhaseCDashboard() {
  const { t } = useDictionary("agent-queue");
  const { t: tComms } = useDictionary("client-comms");
  const shouldReduceMotion = useReducedMotion();

  const { data, loading } = useDelayedFetch<PhaseCStatus>(
    "/api/agent/phase-c-status"
  );

  if (loading || !data) {
    return (
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] saturate-[1.2] p-4">
        <span className="font-kosugi text-[11px] text-text-3 uppercase">
          [{t("dashboard.loading")}]
        </span>
      </div>
    );
  }

  const cardMotion = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.2, ease: EASE_SMOOTH },
      };

  return (
    <motion.div
      {...cardMotion}
      className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] saturate-[1.2] p-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-mohave text-[14px] text-text uppercase tracking-wider">
            {t("dashboard.phaseCTitle")}
          </h3>
          <p className="font-kosugi text-[11px] text-text-3 mt-0.5">
            [{t("dashboard.phaseCSubtitle")}]
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Gauge className="w-[14px] h-[14px] text-text-3" />
          <span className="font-mono text-[14px] text-text">
            {data.email.writingProfileConfidence}%
          </span>
          <span className="font-kosugi text-[11px] text-text-3 uppercase ml-1">
            [{t("dashboard.confidence")}]
          </span>
        </div>
      </div>

      {/* Domain cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <DomainCard
          icon={Mail}
          title={t("dashboard.email")}
          primary={data.email.draftsSent}
          primaryLabel={t("dashboard.draftsSent")}
          secondary={`${data.email.approvalRate}% ${t("dashboard.approvalRate")}`}
          href="/inbox"
        />
        <DomainCard
          icon={FolderKanban}
          title={t("dashboard.projects")}
          primary={data.projects.executed}
          primaryLabel={t("dashboard.executed")}
          secondary={`${data.projects.proposed} ${t("dashboard.proposed").toLowerCase()}`}
          href="/projects"
        />
        <DomainCard
          icon={Receipt}
          title={t("dashboard.invoicing")}
          primary={data.invoicing.executed}
          primaryLabel={t("dashboard.executed")}
          secondary={`${data.invoicing.proposed} ${t("dashboard.proposed").toLowerCase()}`}
          href="/pipeline"
        />
        <DomainCard
          icon={Calendar}
          title={t("dashboard.scheduling")}
          primary={data.scheduling.executed}
          primaryLabel={t("dashboard.executed")}
          secondary={`${data.scheduling.proposed} ${t("dashboard.proposed").toLowerCase()}`}
          href="/calendar"
        />
        <DomainCard
          icon={MessageSquare}
          title={t("dashboard.clientComms")}
          primary={data.clientComms.executed}
          primaryLabel={t("dashboard.executed")}
          secondary={`${data.clientComms.proposed} ${t("dashboard.proposed").toLowerCase()}`}
          href="/agent/queue"
        />
      </div>

      {/* Milestones row */}
      <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)]">
        <span className="font-kosugi text-[11px] text-text-3 uppercase block mb-2">
          [{t("dashboard.autonomyMilestones")}]
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <MilestoneChip
            reached={data.milestones.draftingAvailable}
            label={t("dashboard.milestoneDraftingAvailable")}
          />
          <MilestoneChip
            reached={data.milestones.drafting}
            label={t("dashboard.milestoneDrafting")}
          />
          <MilestoneChip
            reached={data.milestones.autoDraft}
            label={t("dashboard.milestoneAutoDraft")}
          />
          <MilestoneChip
            reached={data.milestones.autoSend}
            label={t("dashboard.milestoneAutoSend")}
          />
        </div>

        {/* Sub-details */}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-text-3">
          <SubDetail
            label={t("dashboard.emailsAnalyzed")}
            value={String(data.email.emailsAnalyzed)}
          />
          <SubDetail
            label={t("dashboard.unchangedRate")}
            value={`${data.email.unchangedRate}%`}
          />
          <SubDetail
            label={tComms("settings.rescheduleRequests")}
            value={String(data.clientComms.proposed)}
          />
          <SubDetail
            label={t("dashboard.rejections")}
            value={String(
              data.projects.rejected +
                data.invoicing.rejected +
                data.scheduling.rejected +
                data.clientComms.rejected
            )}
          />
        </div>
      </div>
    </motion.div>
  );
});

interface DomainCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  primary: number;
  primaryLabel: string;
  secondary: string;
  href: string;
}

const DomainCard = memo(function DomainCard({
  icon: Icon,
  title,
  primary,
  primaryLabel,
  secondary,
  href,
}: DomainCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-[4px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-3 hover:bg-[rgba(255,255,255,0.04)] transition-colors min-h-[96px]"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-[12px] h-[12px] text-text-3" />
        <span className="font-mohave text-[11px] text-text-3 uppercase tracking-wider">
          {title}
        </span>
      </div>
      <div className="font-mohave text-[20px] text-text leading-none">
        {primary}
      </div>
      <div className="font-kosugi text-[10px] text-text-3 mt-1">
        {primaryLabel}
      </div>
      <div className="font-kosugi text-[10px] text-text-3 mt-0.5">
        {secondary}
      </div>
    </Link>
  );
});

function MilestoneChip({
  reached,
  label,
}: {
  reached: boolean;
  label: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-[4px] border min-h-[32px]",
        reached
          ? "border-[rgba(89,119,148,0.5)] bg-[rgba(89,119,148,0.08)] text-[#597794]"
          : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-text-3"
      )}
    >
      {reached ? (
        <CheckCircle2 className="w-[12px] h-[12px]" />
      ) : (
        <Circle className="w-[12px] h-[12px]" />
      )}
      <span className="font-kosugi text-[11px] uppercase">{label}</span>
    </div>
  );
}

function SubDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-kosugi text-[10px] text-text-3 uppercase block">
        [{label}]
      </span>
      <span className="font-mono text-[12px] text-text">{value}</span>
    </div>
  );
}
