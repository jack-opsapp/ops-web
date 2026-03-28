"use client";

import { useState } from "react";

interface SubTabsProps {
  tabs: string[];
  defaultTab?: string;
  children: (activeTab: string) => React.ReactNode;
}

export function SubTabs({ tabs, defaultTab, children }: SubTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]);

  return (
    <div>
      <div className="flex gap-0 border-b border-white/[0.08] mb-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "px-5 py-2.5 font-mohave text-[13px] uppercase tracking-wider transition-colors relative",
              activeTab === tab
                ? "text-[#E5E5E5]"
                : "text-[#6B6B6B] hover:text-[#A0A0A0]",
            ].join(" ")}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#597794]" />
            )}
          </button>
        ))}
      </div>
      {children(activeTab)}
    </div>
  );
}
