"use client";

import { useState, useEffect, useCallback } from "react";

interface TriggerConfig {
  slug: string;
  label: string;
  description: string;
  schedule: string;
  cronJobName: string | null; // null = no cron (manual only)
  hasTestEmail: boolean;
}

const TRIGGERS: TriggerConfig[] = [
  {
    slug: "lifecycle-emails",
    label: "Lifecycle Emails",
    description: "Sends onboarding, engagement, and retention emails to authenticated users based on activity milestones.",
    schedule: "Daily 6:37 AM PST",
    cronJobName: "lifecycle-emails-daily",
    hasTestEmail: true,
  },
  {
    slug: "bubble-reauth-emails",
    label: "Bubble Re-auth",
    description: "Sends re-authentication emails to Bubble legacy users who haven't linked to the new backend.",
    schedule: "Daily 6:38 AM PST",
    cronJobName: "bubble-reauth-emails-daily",
    hasTestEmail: true,
  },
  {
    slug: "unverified-emails",
    label: "Unverified Emails",
    description: "Sends nurture emails to users who signed up but haven't verified their email.",
    schedule: "Daily 6:39 AM PST",
    cronJobName: "unverified-emails-daily",
    hasTestEmail: true,
  },
  {
    slug: "newsletter-emails",
    label: "Newsletter",
    description: "Sends the monthly product newsletter to all eligible users.",
    schedule: "2nd Friday 6:00 AM PST",
    cronJobName: "newsletter-monthly",
    hasTestEmail: true,
  },
  {
    slug: "verify-email-domains",
    label: "Domain Validation",
    description: "Validates email domains for all users and updates the email_domain_valid flag.",
    schedule: "Manual only",
    cronJobName: null,
    hasTestEmail: false,
  },
];

interface TriggerState {
  loading: boolean;
  result: { success: boolean; message: string } | null;
}

interface CronJob {
  jobname: string;
  schedule: string;
  active: boolean;
}

export function TriggersTab() {
  const [states, setStates] = useState<Record<string, TriggerState>>({});
  const [cronJobs, setCronJobs] = useState<Record<string, CronJob>>({});
  const [cronLoading, setCronLoading] = useState(true);
  const [toggleLoading, setToggleLoading] = useState<Record<string, boolean>>({});
  const [testEmails, setTestEmails] = useState<Record<string, string>>({});
  const [testStates, setTestStates] = useState<Record<string, TriggerState>>({});

  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/email/cron");
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, CronJob> = {};
      for (const job of data.jobs || []) {
        map[job.jobname] = job;
      }
      setCronJobs(map);
    } catch {
      // silent fail
    } finally {
      setCronLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCronStatus();
  }, [fetchCronStatus]);

  async function toggleCron(jobname: string, active: boolean) {
    setToggleLoading((prev) => ({ ...prev, [jobname]: true }));
    try {
      const res = await fetch("/api/admin/email/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobname, active }),
      });
      if (res.ok) {
        setCronJobs((prev) => ({
          ...prev,
          [jobname]: { ...prev[jobname], active },
        }));
      }
    } catch {
      // silent fail
    } finally {
      setToggleLoading((prev) => ({ ...prev, [jobname]: false }));
    }
  }

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

  async function sendTestEmail(slug: string) {
    const email = testEmails[slug]?.trim();
    if (!email) return;

    setTestStates((prev) => ({
      ...prev,
      [slug]: { loading: true, result: null },
    }));

    try {
      const res = await fetch("/api/admin/email/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, test_email: email }),
      });
      const data = await res.json();
      setTestStates((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          result: {
            success: res.ok && data.sent !== false,
            message: res.ok
              ? JSON.stringify(data, null, 2)
              : data.error ?? "Unknown error",
          },
        },
      }));
    } catch (err) {
      setTestStates((prev) => ({
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
        const testState = testStates[trigger.slug];
        const cronJob = trigger.cronJobName
          ? cronJobs[trigger.cronJobName]
          : null;
        const isToggling = trigger.cronJobName
          ? toggleLoading[trigger.cronJobName]
          : false;

        return (
          <div
            key={trigger.slug}
            className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]"
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-mohave text-[16px] text-[#E5E5E5] uppercase">
                    {trigger.label}
                  </h3>
                  <span className="font-kosugi text-[11px] text-[#6B6B6B]">
                    [{trigger.schedule}]
                  </span>
                  {/* Cron status badge */}
                  {trigger.cronJobName && !cronLoading && cronJob && (
                    <span
                      className={`font-mohave text-[11px] uppercase px-2 py-0.5 rounded-full border ${
                        cronJob.active
                          ? "text-[#9DB582] border-[#9DB582]/30 bg-[#9DB582]/10"
                          : "text-[#93321A] border-[#93321A]/30 bg-[#93321A]/10"
                      }`}
                    >
                      {cronJob.active ? "Active" : "Paused"}
                    </span>
                  )}
                </div>
                <p className="font-kosugi text-[13px] text-[#A0A0A0]">
                  {trigger.description}
                </p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Cron toggle */}
                {trigger.cronJobName && (
                  <button
                    onClick={() =>
                      cronJob &&
                      toggleCron(trigger.cronJobName!, !cronJob.active)
                    }
                    disabled={cronLoading || isToggling || !cronJob}
                    className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                      cronJob?.active
                        ? "bg-[#597794]"
                        : "bg-white/[0.1]"
                    }`}
                    title={cronJob?.active ? "Pause cron" : "Enable cron"}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                        cronJob?.active ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                )}

                {/* Run Now button */}
                <button
                  onClick={() => runTrigger(trigger.slug)}
                  disabled={state?.loading}
                  className="px-5 py-2 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#597794] hover:bg-white/[0.04] transition-colors disabled:opacity-50"
                >
                  {state?.loading ? "Running..." : "Run Now"}
                </button>
              </div>
            </div>

            {/* Run result */}
            {state?.result && (
              <div
                className={`mt-4 rounded-lg p-4 ${
                  state.result.success
                    ? "bg-[#9DB582]/10"
                    : "bg-[#93321A]/10"
                }`}
              >
                <p
                  className={`font-mohave text-[11px] uppercase mb-1 ${
                    state.result.success
                      ? "text-[#9DB582]"
                      : "text-[#93321A]"
                  }`}
                >
                  {state.result.success ? "Success" : "Error"}
                </p>
                <pre className="font-mono text-[12px] text-[#A0A0A0] whitespace-pre-wrap overflow-auto max-h-40">
                  {state.result.message}
                </pre>
              </div>
            )}

            {/* Test email section */}
            {trigger.hasTestEmail && (
              <div className="mt-4 pt-4 border-t border-white/[0.05]">
                <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
                  Send Test Email
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="test@example.com"
                    value={testEmails[trigger.slug] ?? ""}
                    onChange={(e) =>
                      setTestEmails((prev) => ({
                        ...prev,
                        [trigger.slug]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") sendTestEmail(trigger.slug);
                    }}
                    className="flex-1 max-w-xs bg-transparent border border-white/[0.08] rounded-lg px-3 py-1.5 font-kosugi text-[13px] text-[#E5E5E5] placeholder-[#6B6B6B] focus:outline-none focus:border-[#597794]"
                  />
                  <button
                    onClick={() => sendTestEmail(trigger.slug)}
                    disabled={
                      testState?.loading || !testEmails[trigger.slug]?.trim()
                    }
                    className="px-4 py-1.5 rounded-lg border border-white/[0.08] font-mohave text-[12px] uppercase tracking-wider text-[#C4A868] hover:bg-white/[0.04] transition-colors disabled:opacity-50"
                  >
                    {testState?.loading ? "Sending..." : "Send Test"}
                  </button>
                </div>

                {testState?.result && (
                  <div
                    className={`mt-2 rounded-lg p-3 ${
                      testState.result.success
                        ? "bg-[#9DB582]/10"
                        : "bg-[#93321A]/10"
                    }`}
                  >
                    <p
                      className={`font-mohave text-[11px] uppercase mb-1 ${
                        testState.result.success
                          ? "text-[#9DB582]"
                          : "text-[#93321A]"
                      }`}
                    >
                      {testState.result.success ? "Test Sent" : "Error"}
                    </p>
                    <pre className="font-mono text-[11px] text-[#A0A0A0] whitespace-pre-wrap overflow-auto max-h-24">
                      {testState.result.message}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
