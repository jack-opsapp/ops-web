"use client";

import { useState, useMemo } from "react";
import { PlanBadge } from "../../_components/plan-badge";
import { StatusBadge } from "../../_components/status-badge";

type Company = {
  id: string;
  name: string;
  subscription_plan: string | null;
  subscription_status: string | null;
  trial_end_date: string | null;
  subscription_end: string | null;
  seated_employee_ids: string[] | null;
  max_seats: number | null;
};

const FILTERS = ["ALL", "EXPIRING SOON", "GRACE", "EXPIRED"] as const;

function getDaysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

export function SubscriptionsTable({ companies }: { companies: Company[] }) {
  const [filter, setFilter] = useState("ALL");

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      if (filter === "ALL") return true;
      if (filter === "EXPIRING SOON") {
        const days = getDaysUntil(c.trial_end_date);
        return days !== null && days >= 0 && days <= 14;
      }
      if (filter === "GRACE") return c.subscription_status === "grace";
      if (filter === "EXPIRED") return ["expired", "cancelled"].includes(c.subscription_status ?? "");
      return true;
    });
  }, [companies, filter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={[
              "px-3 py-1.5 rounded-full font-mohave text-[12px] uppercase border transition-colors",
              filter === f
                ? "text-[#E5E5E5] border-white/[0.12] bg-white/[0.05]"
                : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
            ].join(" ")}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="grid grid-cols-6 px-6 py-3 border-b border-white/[0.08]">
          {["COMPANY", "PLAN", "STATUS", "SEATS", "TRIAL ENDS", "SUB ENDS"].map((h) => (
            <span key={h} className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B]">
              {h}
            </span>
          ))}
        </div>

        {filtered.map((c) => {
          const daysUntilTrial = getDaysUntil(c.trial_end_date);
          const isUrgent = daysUntilTrial !== null && daysUntilTrial >= 0 && daysUntilTrial <= 7;
          const isDanger = ["expired", "cancelled"].includes(c.subscription_status ?? "");
          const seatsUsed = c.seated_employee_ids?.length ?? 0;

          return (
            <div
              key={c.id}
              className={[
                "grid grid-cols-6 px-6 items-center h-14 border-b border-white/[0.05] last:border-0",
                isDanger ? "bg-[#93321A]/10" : isUrgent ? "bg-[#C4A868]/5" : "",
              ].join(" ")}
            >
              <span className="font-mohave text-[14px] text-[#E5E5E5] truncate pr-4">
                {c.name}
              </span>
              <span><PlanBadge plan={c.subscription_plan ?? "trial"} /></span>
              <span><StatusBadge status={c.subscription_status ?? "trial"} /></span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">
                {seatsUsed} / {c.max_seats ?? "?"}
              </span>
              <span className={`font-kosugi text-[12px] ${isUrgent ? "text-[#C4A868]" : "text-[#6B6B6B]"}`}>
                {c.trial_end_date
                  ? `[${new Date(c.trial_end_date).toLocaleDateString()}]`
                  : "—"}
              </span>
              <span className="font-kosugi text-[12px] text-[#6B6B6B]">
                {c.subscription_end
                  ? `[${new Date(c.subscription_end).toLocaleDateString()}]`
                  : "—"}
              </span>
            </div>
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
