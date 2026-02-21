"use client";

import { useState } from "react";
import { UsersTab } from "./users-tab";
import { OnboardingTab } from "./onboarding-tab";
import { EngagementTab } from "./engagement-tab";
import { GrowthTab } from "./growth-tab";

const TABS = ["USERS", "ONBOARDING", "ENGAGEMENT", "GROWTH & REVENUE"] as const;
type Tab = (typeof TABS)[number];

interface AnalyticsTabsProps {
  dau: number;
  wau: number;
  mau: number;
  signupTrend: { label: string; value: number }[];
  signupsByPlatform: { dimension: string; count: number }[];
  onboardingFunnel: { step: string; eventName: string; count: number }[];
  taskCreatedByDate: { label: string; value: number }[];
  projectCreatedByDate: { label: string; value: number }[];
  topScreens: { label: string; value: number }[];
  formAbandonment: { dimension: string; count: number }[];
  teamInvitedByPlatform: { dimension: string; count: number }[];
  subscribeByPlatform: { dimension: string; count: number }[];
  beginTrialByPlatform: { dimension: string; count: number }[];
}

export function AnalyticsTabs(props: AnalyticsTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("USERS");

  return (
    <div>
      {/* Tab Bar */}
      <div className="flex gap-0 border-b border-white/[0.08] mb-8">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "px-6 py-3 font-mohave text-[13px] uppercase tracking-wider transition-colors relative",
              activeTab === tab
                ? "text-[#E5E5E5]"
                : "text-[#6B6B6B] hover:text-[#A0A0A0]",
            ].join(" ")}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#E5E5E5]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "USERS" && <UsersTab {...props} />}
      {activeTab === "ONBOARDING" && <OnboardingTab {...props} />}
      {activeTab === "ENGAGEMENT" && <EngagementTab {...props} />}
      {activeTab === "GROWTH & REVENUE" && <GrowthTab {...props} />}
    </div>
  );
}
