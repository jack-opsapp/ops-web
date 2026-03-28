"use client";

import { PlanBadge } from "./plan-badge";
import { useCompanySheet } from "./company-sheet-provider";

interface Signup {
  id: string;
  name: string;
  subscription_plan: string | null;
  created_at: string;
}

export function RecentSignups({ companies }: { companies: Signup[] }) {
  const { openCompany } = useCompanySheet();

  return (
    <div className="space-y-0">
      {companies.map((company) => (
        <button
          key={company.id}
          type="button"
          onClick={() => openCompany(company.id)}
          className="flex items-center justify-between h-14 border-b border-white/[0.05] last:border-0 w-full text-left hover:bg-white/[0.02] transition-colors cursor-pointer px-1 rounded"
        >
          <span className="font-mohave text-[14px] text-[#E5E5E5] hover:text-[#597794] transition-colors">
            {company.name}
          </span>
          <div className="flex items-center gap-3">
            <PlanBadge plan={company.subscription_plan ?? "trial"} />
            <span className="font-kosugi text-[12px] text-[#6B6B6B]">
              [{new Date(company.created_at).toLocaleDateString()}]
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
