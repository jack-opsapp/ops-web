"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DateRangeControl } from "../../_components/date-range-control";
import { StatCard } from "../../_components/stat-card";
import { CampaignTable } from "./campaign-table";
import { KeywordTable } from "./keyword-table";
import { SearchTermsTable } from "./search-terms-table";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { GoogleAdsPageData } from "@/lib/analytics/google-ads-types";
import type { ChartDataPoint, DatePreset, DateRangeParams } from "@/lib/admin/types";

// ─── Animation (per design system: EASE_SMOOTH, no spring/bounce) ─────────────

const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
};

// Reduced motion: collapse to simple fade
const fadeOnly = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2 },
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface GoogleAdsContentProps {
  initialData: GoogleAdsPageData;
  /** Range preset the server chose for first paint (state-aware default). */
  initialRangeKey?: string;
}

const RANGE_CAPTIONS: Record<string, string> = {
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  "12m": "last 12 months",
  all: "all history",
};

export function GoogleAdsContent({ initialData, initialRangeKey = "30d" }: GoogleAdsContentProps) {
  const [data, setData] = useState(initialData);
  const [rangeKey, setRangeKey] = useState<string>(initialRangeKey);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Check reduced motion preference
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const variant = prefersReducedMotion ? fadeOnly : fadeUp;

  const handleRangeChange = useCallback(async (params: DateRangeParams) => {
    // Prefer the preset chip; fall back to mapping the span for callers
    // that only provide from/to.
    let preset = params.preset as string | undefined;
    if (!preset || !(preset in RANGE_CAPTIONS)) {
      const diffMs = new Date(params.to).getTime() - new Date(params.from).getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      preset = diffDays <= 7 ? "7d" : diffDays <= 14 ? "14d" : diffDays <= 30 ? "30d" : "90d";
    }

    setRangeKey(preset);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/google-ads?preset=${preset}`);
      if (res.ok) {
        const newData: GoogleAdsPageData = await res.json();
        setData(newData);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const sparklineData: ChartDataPoint[] = data.dailySpend.map((d) => ({
    label: d.date,
    value: d.spend,
  }));

  // Find signup CPA from conversion breakdown
  const signupConversion = data.conversions.find(
    (c) => c.actionName.toLowerCase().includes("signup") || c.actionName.toLowerCase().includes("sign_up") || c.actionName.toLowerCase().includes("trial")
  );
  const installConversion = data.conversions.find(
    (c) => c.actionName.toLowerCase().includes("install")
  );

  // Orientation when the selected window has no activity but history exists.
  const windowEmpty =
    !data.summary ||
    (data.summary.totalSpend === 0 &&
      data.summary.totalClicks === 0 &&
      data.summary.totalImpressions === 0);
  const lastActivity = data.history?.lastDay ?? null;
  const allCampaignsPaused =
    data.campaigns.length > 0 && data.campaigns.every((c) => c.status === "PAUSED");

  return (
    <div className={`p-8 space-y-8 transition-opacity duration-150 ${loading ? "opacity-60" : "opacity-100"}`}>
      {/* Date range + refresh */}
      <div className="flex items-center justify-between">
        <DateRangeControl
          defaultPreset={initialRangeKey as DatePreset}
          presets={["7d", "30d", "90d", "12m", "all"]}
          onChange={handleRangeChange}
        />
        <button
          onClick={handleRefresh}
          className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B] hover:text-[#A0A0A0] transition-colors px-3 py-1"
        >
          Refresh
        </button>
      </div>

      {windowEmpty && lastActivity && (
        <p className="font-mono text-[12px] text-[#6B6B6B]">
          [{allCampaignsPaused ? "all campaigns paused" : "no ad activity this window"} — last activity {lastActivity}]
        </p>
      )}

      {/* KPI Cards — staggered entry */}
      <motion.div
        className="grid grid-cols-4 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={variant}>
          <StatCard
            label="Total Spend"
            value={data.summary ? `$${data.summary.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "\u2014"}
            caption={RANGE_CAPTIONS[rangeKey] ?? "selected range"}
            sparklineData={sparklineData}
          />
        </motion.div>
        <motion.div variants={variant}>
          <StatCard
            label="Cost per Signup"
            value={signupConversion ? `$${signupConversion.cpa.toFixed(2)}` : "\u2014"}
            caption={signupConversion ? `${signupConversion.conversions.toFixed(0)} conversions` : "no signup data"}
          />
        </motion.div>
        <motion.div variants={variant}>
          <StatCard
            label="Cost per Install"
            value={installConversion ? `$${installConversion.cpa.toFixed(2)}` : "\u2014"}
            caption={installConversion ? `${installConversion.conversions.toFixed(0)} installs` : "no install data"}
          />
        </motion.div>
        <motion.div variants={variant}>
          <StatCard
            label="Avg CTR"
            value={data.summary ? `${(data.summary.avgCtr * 100).toFixed(1)}%` : "\u2014"}
            caption={data.summary ? `${data.summary.totalClicks.toLocaleString()} clicks` : "no data"}
          />
        </motion.div>
      </motion.div>

      {/* Tables — fade in after cards */}
      <motion.div
        className="space-y-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25, delay: 0.25, ease: EASE_SMOOTH }}
      >
        <CampaignTable campaigns={data.campaigns} />
        <KeywordTable keywords={data.keywords} />
        <SearchTermsTable searchTerms={data.searchTerms} />
      </motion.div>
    </div>
  );
}
