"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TriggerSheet } from "./trigger-sheet";

interface TriggerConfig {
  slug: string;
  label: string;
  description: string;
  schedule: string;
  cronJobName: string | null;
  hasTestEmail: boolean;
}

const TRIGGERS: TriggerConfig[] = [
  {
    slug: "lifecycle-emails",
    label: "Lifecycle Emails",
    description: "Onboarding, engagement, and retention emails for authenticated users.",
    schedule: "Daily 6:37 AM PST",
    cronJobName: "lifecycle-emails-daily",
    hasTestEmail: true,
  },
  {
    slug: "bubble-reauth-emails",
    label: "Bubble Re-auth",
    description: "Re-authentication emails for Bubble legacy users.",
    schedule: "Friday 6:38 AM PST",
    cronJobName: "bubble-reauth-emails-weekly",
    hasTestEmail: true,
  },
  {
    slug: "unverified-emails",
    label: "Unverified Emails",
    description: "Nurture emails for users who haven't verified their email.",
    schedule: "Daily 6:39 AM PST",
    cronJobName: "unverified-emails-daily",
    hasTestEmail: true,
  },
  {
    slug: "newsletter-emails",
    label: "Newsletter",
    description: "Monthly product newsletter to all eligible users.",
    schedule: "2nd Friday 6:00 AM PST",
    cronJobName: "newsletter-monthly",
    hasTestEmail: true,
  },
  {
    slug: "verify-email-domains",
    label: "Domain Validation",
    description: "Validates email domains and updates the email_domain_valid flag.",
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
  const [cronJobs, setCronJobs] = useState<Record<string, CronJob>>({});
  const [cronLoading, setCronLoading] = useState(true);
  const [toggleLoading, setToggleLoading] = useState<Record<string, boolean>>({});

  // Sheet state
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerConfig | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Run / test state (keyed by slug)
  const [runStates, setRunStates] = useState<Record<string, TriggerState>>({});
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
      // silent
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
      // silent
    } finally {
      setToggleLoading((prev) => ({ ...prev, [jobname]: false }));
    }
  }

  async function runTrigger(slug: string) {
    setRunStates((prev) => ({ ...prev, [slug]: { loading: true, result: null } }));
    try {
      const res = await fetch("/api/admin/email/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      setRunStates((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          result: {
            success: res.ok,
            message: res.ok ? JSON.stringify(data, null, 2) : data.error ?? "Unknown error",
          },
        },
      }));
    } catch (err) {
      setRunStates((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          result: { success: false, message: err instanceof Error ? err.message : "Network error" },
        },
      }));
    }
  }

  async function sendTestEmail(slug: string, email: string) {
    setTestStates((prev) => ({ ...prev, [slug]: { loading: true, result: null } }));
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
            message: res.ok ? JSON.stringify(data, null, 2) : data.error ?? "Unknown error",
          },
        },
      }));
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          result: { success: false, message: err instanceof Error ? err.message : "Network error" },
        },
      }));
    }
  }

  function openSheet(trigger: TriggerConfig) {
    setSelectedTrigger(trigger);
    setSheetOpen(true);
  }

  return (
    <>
      <div className="space-y-2">
        {TRIGGERS.map((trigger) => {
          const cronJob = trigger.cronJobName ? cronJobs[trigger.cronJobName] : null;
          const isToggling = trigger.cronJobName ? toggleLoading[trigger.cronJobName] : false;
          const isActive = cronJob?.active ?? false;

          return (
            <div
              key={trigger.slug}
              className="border border-white/[0.08] rounded-lg px-4 py-3 bg-white/[0.02]"
            >
              <div className="flex items-center gap-3">
                {/* Cron toggle — separate from clickable area */}
                {trigger.cronJobName ? (
                  <div className="flex-shrink-0">
                    <Switch
                      checked={isActive}
                      onCheckedChange={(val) => toggleCron(trigger.cronJobName!, val)}
                      disabled={cronLoading || isToggling || !cronJob}
                    />
                  </div>
                ) : (
                  <div className="w-[44px] flex-shrink-0" />
                )}

                {/* Clickable area — label + chevron opens sheet */}
                <div
                  className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => openSheet(trigger)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-mohave text-[14px] text-[#E5E5E5] uppercase">
                        {trigger.label}
                      </h3>
                      <span className="font-kosugi text-[10px] text-[#6B6B6B]">
                        [{trigger.schedule}]
                      </span>
                    </div>
                    <p className="font-kosugi text-[11px] text-[#6B6B6B] truncate">
                      {trigger.description}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#6B6B6B] flex-shrink-0" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Trigger Detail Sheet */}
      <TriggerSheet
        trigger={selectedTrigger}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        isActive={
          selectedTrigger?.cronJobName
            ? (cronJobs[selectedTrigger.cronJobName]?.active ?? false)
            : false
        }
        cronLoading={cronLoading}
        isToggling={
          selectedTrigger?.cronJobName
            ? (toggleLoading[selectedTrigger.cronJobName] ?? false)
            : false
        }
        hasCronJob={
          selectedTrigger?.cronJobName
            ? !!cronJobs[selectedTrigger.cronJobName]
            : false
        }
        onToggleCron={(val) => {
          if (selectedTrigger?.cronJobName) {
            toggleCron(selectedTrigger.cronJobName, val);
          }
        }}
        onRun={() => {
          if (selectedTrigger) runTrigger(selectedTrigger.slug);
        }}
        runLoading={selectedTrigger ? (runStates[selectedTrigger.slug]?.loading ?? false) : false}
        runResult={selectedTrigger ? (runStates[selectedTrigger.slug]?.result ?? null) : null}
        onSendTest={(email) => {
          if (selectedTrigger) sendTestEmail(selectedTrigger.slug, email);
        }}
        testLoading={selectedTrigger ? (testStates[selectedTrigger.slug]?.loading ?? false) : false}
        testResult={selectedTrigger ? (testStates[selectedTrigger.slug]?.result ?? null) : null}
      />
    </>
  );
}
