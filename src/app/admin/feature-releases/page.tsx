"use client";

import { useState } from "react";
import { AdminPageHeader } from "../_components/admin-page-header";
import { FeatureReleasesContent } from "./_components/feature-releases-content";
import { WhatsNewContent } from "./_components/whats-new-content";

type Tab = "flags" | "whats-new";

export default function FeatureReleasesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("flags");

  return (
    <div>
      <AdminPageHeader
        title="Feature Releases"
        caption="master switches · per-user overrides · roadmap management"
      />
      <div className="px-8 pt-6">
        {/* Tab bar */}
        <div className="flex gap-0 border-b border-white/[0.08] mb-6">
          <button
            onClick={() => setActiveTab("flags")}
            className={`px-5 py-3 font-mohave text-[13px] uppercase tracking-wider transition-colors border-b-2 -mb-px ${
              activeTab === "flags"
                ? "text-[#E5E5E5] border-[#597794]"
                : "text-[#6B6B6B] border-transparent hover:text-[#A0A0A0]"
            }`}
          >
            Feature Flags
          </button>
          <button
            onClick={() => setActiveTab("whats-new")}
            className={`px-5 py-3 font-mohave text-[13px] uppercase tracking-wider transition-colors border-b-2 -mb-px ${
              activeTab === "whats-new"
                ? "text-[#E5E5E5] border-[#597794]"
                : "text-[#6B6B6B] border-transparent hover:text-[#A0A0A0]"
            }`}
          >
            What&apos;s New
          </button>
        </div>
      </div>

      <div className="px-8 pb-8">
        {activeTab === "flags" ? <FeatureReleasesContent /> : <WhatsNewContent />}
      </div>
    </div>
  );
}
