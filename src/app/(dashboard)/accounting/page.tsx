"use client";

import { Calculator } from "lucide-react";

export default function AccountingPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3">
      <div className="w-[64px] h-[64px] rounded-2xl bg-ops-amber-muted flex items-center justify-center">
        <Calculator className="w-[32px] h-[32px] text-ops-amber" />
      </div>
      <div className="text-left max-w-[400px]">
        <h2 className="font-mohave text-heading text-text-primary uppercase tracking-wider">
          Accounting
        </h2>
        <p className="font-mohave text-body text-text-secondary mt-1">
          Full financial overview with profit & loss, expense tracking, and tax reporting for your business.
        </p>
        <div className="mt-3 flex flex-wrap justify-start gap-1">
          {["Profit & Loss", "Expense Tracking", "Tax Reports", "Budget Planning", "QuickBooks Sync"].map((feature) => (
            <span
              key={feature}
              className="font-kosugi text-[11px] text-text-tertiary bg-background-card border border-border rounded px-1.5 py-[4px]"
            >
              {feature}
            </span>
          ))}
        </div>
        <p className="font-kosugi text-caption-sm text-text-disabled mt-3">
          This module requires financial data model and third-party integrations.
        </p>
      </div>
    </div>
  );
}
