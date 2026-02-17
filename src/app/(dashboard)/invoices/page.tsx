"use client";

import { Receipt } from "lucide-react";

export default function InvoicesPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3">
      <div className="w-[64px] h-[64px] rounded-2xl bg-ops-accent-muted flex items-center justify-center">
        <Receipt className="w-[32px] h-[32px] text-ops-accent" />
      </div>
      <div className="text-left max-w-[400px]">
        <h2 className="font-mohave text-heading text-text-primary uppercase tracking-wider">
          Invoices
        </h2>
        <p className="font-mohave text-body text-text-secondary mt-1">
          Create, send, and track invoices for your projects. Automatic payment reminders and PDF generation.
        </p>
        <div className="mt-3 flex flex-wrap justify-start gap-1">
          {["Invoice Creation", "PDF Export", "Payment Tracking", "Email Delivery", "Overdue Reminders"].map((feature) => (
            <span
              key={feature}
              className="font-kosugi text-[11px] text-text-tertiary bg-background-card border border-border rounded px-1.5 py-[4px]"
            >
              {feature}
            </span>
          ))}
        </div>
        <p className="font-kosugi text-caption-sm text-text-disabled mt-3">
          This module requires backend invoice data model integration.
        </p>
      </div>
    </div>
  );
}
