"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { PlanBadge } from "../../_components/plan-badge";
import { StatusBadge } from "../../_components/status-badge";

type Company = {
  id: string;
  name: string;
  subscription_plan: string | null;
  subscription_status: string | null;
  created_at: string;
  userCount: number;
  projectCount: number;
};

const STATUS_FILTERS = ["ALL", "TRIAL", "ACTIVE", "GRACE", "EXPIRED"] as const;

export function CompaniesTable({ companies }: { companies: Company[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus =
        statusFilter === "ALL" ||
        c.subscription_status?.toLowerCase() === statusFilter.toLowerCase();
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
        <div className="grid grid-cols-6 px-6 py-3 border-b border-white/[0.08]">
          {["COMPANY", "PLAN", "STATUS", "USERS", "PROJECTS", "JOINED"].map((h) => (
            <span key={h} className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B]">
              {h}
            </span>
          ))}
        </div>

        {/* Rows */}
        {filtered.map((c) => (
          <Link
            key={c.id}
            href={`/admin/companies/${c.id}`}
            className="grid grid-cols-6 px-6 items-center h-14 border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
          >
            <span className="font-mohave text-[14px] text-[#E5E5E5] truncate pr-4">
              {c.name}
            </span>
            <span><PlanBadge plan={c.subscription_plan ?? "trial"} /></span>
            <span><StatusBadge status={c.subscription_status ?? "trial"} /></span>
            <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.userCount}</span>
            <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.projectCount}</span>
            <span className="font-kosugi text-[12px] text-[#6B6B6B]">
              [{new Date(c.created_at).toLocaleDateString()}]
            </span>
          </Link>
        ))}

        {filtered.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No results</p>
          </div>
        )}
      </div>
    </div>
  );
}
