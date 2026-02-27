"use client";

import { useState } from "react";

interface TriggerConfig {
  slug: string;
  label: string;
  description: string;
  schedule: string;
}

const TRIGGERS: TriggerConfig[] = [
  {
    slug: "lifecycle-emails",
    label: "Lifecycle Emails",
    description: "Sends onboarding, engagement, and retention emails to authenticated users based on activity milestones.",
    schedule: "Daily 6:37 AM PST",
  },
  {
    slug: "bubble-reauth-emails",
    label: "Bubble Re-auth",
    description: "Sends re-authentication emails to users with invalid email domains (Bubble legacy accounts).",
    schedule: "Daily 6:38 AM PST",
  },
  {
    slug: "unverified-emails",
    label: "Unverified Emails",
    description: "Sends nurture emails to users who signed up but haven't completed onboarding.",
    schedule: "Daily 6:39 AM PST",
  },
  {
    slug: "newsletter-emails",
    label: "Newsletter",
    description: "Sends the monthly product newsletter to all eligible users.",
    schedule: "2nd Friday 6:00 AM PST",
  },
  {
    slug: "verify-email-domains",
    label: "Domain Validation",
    description: "Validates email domains for all users and updates the email_domain_valid flag.",
    schedule: "Manual only",
  },
];

interface TriggerState {
  loading: boolean;
  result: { success: boolean; message: string } | null;
}

export function TriggersTab() {
  const [states, setStates] = useState<Record<string, TriggerState>>({});

  async function runTrigger(slug: string) {
    setStates((prev) => ({
      ...prev,
      [slug]: { loading: true, result: null },
    }));

    try {
      const res = await fetch("/api/admin/email/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      setStates((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          result: {
            success: res.ok,
            message: res.ok
              ? JSON.stringify(data, null, 2)
              : data.error ?? "Unknown error",
          },
        },
      }));
    } catch (err) {
      setStates((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          result: {
            success: false,
            message: err instanceof Error ? err.message : "Network error",
          },
        },
      }));
    }
  }

  return (
    <div className="space-y-4">
      {TRIGGERS.map((trigger) => {
        const state = states[trigger.slug];
        return (
          <div
            key={trigger.slug}
            className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-mohave text-[16px] text-[#E5E5E5] uppercase">
                    {trigger.label}
                  </h3>
                  <span className="font-kosugi text-[11px] text-[#6B6B6B]">
                    [{trigger.schedule}]
                  </span>
                </div>
                <p className="font-kosugi text-[13px] text-[#A0A0A0]">
                  {trigger.description}
                </p>
              </div>
              <button
                onClick={() => runTrigger(trigger.slug)}
                disabled={state?.loading}
                className="px-5 py-2 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#597794] hover:bg-white/[0.04] transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {state?.loading ? "Running..." : "Run Now"}
              </button>
            </div>

            {state?.result && (
              <div className={`mt-4 rounded-lg p-4 ${state.result.success ? "bg-[#9DB582]/10" : "bg-[#93321A]/10"}`}>
                <p className={`font-mohave text-[11px] uppercase mb-1 ${state.result.success ? "text-[#9DB582]" : "text-[#93321A]"}`}>
                  {state.result.success ? "Success" : "Error"}
                </p>
                <pre className="font-mono text-[12px] text-[#A0A0A0] whitespace-pre-wrap overflow-auto max-h-40">
                  {state.result.message}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
