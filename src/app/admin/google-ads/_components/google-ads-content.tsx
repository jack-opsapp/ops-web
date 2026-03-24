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
import type { ChartDataPoint, DateRangeParams } from "@/lib/admin/types";

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
}

export function GoogleAdsContent({ initialData }: GoogleAdsContentProps) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Check reduced motion preference
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const variant = prefersReducedMotion ? fadeOnly : fadeUp;

  const handleRangeChange = useCallback(async (params: DateRangeParams) => {
    // Map DateRangeParams to AdsDayRange
    const diffMs = new Date(params.to).getTime() - new Date(params.from).getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const days: number = diffDays <= 7 ? 7 : diffDays <= 14 ? 14 : diffDays <= 30 ? 30 : 90;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/google-ads?days=${days}`);
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

  return (
    <div className={`p-8 space-y-8 transition-opacity duration-150 ${loading ? "opacity-60" : "opacity-100"}`}>
      {/* Date range + refresh */}
      <div className="flex items-center justify-between">
        <DateRangeControl
          defaultPreset="30d"
          presets={["7d", "14d", "30d", "90d"]}
          onChange={handleRangeChange}
        />
        <button
          onClick={handleRefresh}
          className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B] hover:text-[#A0A0A0] transition-colors px-3 py-1"
        >
          Refresh
        </button>
      </div>

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
            caption="last period"
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
