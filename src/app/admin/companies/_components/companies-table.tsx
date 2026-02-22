"use client";

import { useState, useMemo } from "react";
import { PlanBadge } from "../../_components/plan-badge";
import { StatusBadge } from "../../_components/status-badge";
import { useCompanySheet } from "../../_components/company-sheet-provider";
import { deriveSubscriptionStatus, deriveSubscriptionPlan } from "@/lib/admin/types";

type Company = {
  id: string;
  name: string;
  subscription_plan: string | null;
  subscription_status: string | null;
  trial_end_date: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  userCount: number;
  projectCount: number;
  pipelineCount: number;
  lastActive: string | null;
};

const STATUS_FILTERS = ["ALL", "TRIAL", "ACTIVE", "GRACE", "EXPIRED", "NONE", "INACTIVE"] as const;

function isInactive(lastActive: string | null): boolean {
  if (!lastActive) return true;
  return Date.now() - new Date(lastActive).getTime() > 30 * 86_400_000;
}

function timeAgo(date: string | null): string {
  if (!date) return "never";
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function CompaniesTable({ companies }: { companies: Company[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const { openCompany } = useCompanySheet();

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());

      if (statusFilter === "ALL") return matchesSearch;
      if (statusFilter === "INACTIVE") {
        return matchesSearch && isInactive(c.lastActive);
      }
      const derived = deriveSubscriptionStatus(c);
      const matchesStatus = derived.toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [companies, search, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Search + Filter Row */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="[search companies]"
            className="w-full h-10 bg-transparent border border-white/[0.08] rounded-lg px-4 font-kosugi text-[14px] text-[#E5E5E5] placeholder-[#6B6B6B] focus:outline-none focus:border-[#597794] transition-colors"
          />
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={[
                "px-3 py-1.5 rounded-full font-mohave text-[12px] uppercase border transition-colors",
                statusFilter === f
                  ? "text-[#E5E5E5] border-white/[0.12] bg-white/[0.05]"
                  : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
              ].join(" ")}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-8 px-6 py-3 border-b border-white/[0.08]">
          {["COMPANY", "PLAN", "STATUS", "USERS", "PROJECTS", "PIPELINE", "LAST ACTIVE", "JOINED"].map((h) => (
            <span key={h} className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B]">
              {h}
            </span>
          ))}
        </div>

        {/* Rows */}
        {filtered.map((c) => {
          const inactive = isInactive(c.lastActive);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => openCompany(c.id)}
              className={[
                "grid grid-cols-8 px-6 items-center h-14 border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors w-full text-left cursor-pointer",
                inactive ? "opacity-60" : "",
              ].join(" ")}
            >
              <span className="font-mohave text-[14px] text-[#E5E5E5] truncate pr-4">
                {c.name}
              </span>
              <span><PlanBadge plan={deriveSubscriptionPlan(c)} /></span>
              <span><StatusBadge status={deriveSubscriptionStatus(c)} /></span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.userCount}</span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.projectCount}</span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.pipelineCount}</span>
              <span className={`font-kosugi text-[12px] ${inactive ? "text-[#C4A868]" : "text-[#6B6B6B]"}`}>
                [{timeAgo(c.lastActive)}]
              </span>
              <span className="font-kosugi text-[12px] text-[#6B6B6B]">
                [{new Date(c.created_at).toLocaleDateString()}]
              </span>
            </button>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No results</p>
          </div>
        )}
      </div>
    </div>
  );
}
