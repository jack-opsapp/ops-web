"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { EmailLogRow } from "@/lib/admin/types";

interface TriggerConfig {
  slug: string;
  label: string;
  description: string;
  schedule: string;
  cronJobName: string | null;
  hasTestEmail: boolean;
}

interface TriggerSheetProps {
  trigger: TriggerConfig | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isActive: boolean;
  cronLoading: boolean;
  isToggling: boolean;
  hasCronJob: boolean;
  onToggleCron: (active: boolean) => void;
  onRun: () => void;
  runLoading: boolean;
  runResult: { success: boolean; message: string } | null;
  onSendTest: (email: string) => void;
  testLoading: boolean;
  testResult: { success: boolean; message: string } | null;
}

export function TriggerSheet({
  trigger,
  open,
  onOpenChange,
  isActive,
  cronLoading,
  isToggling,
  hasCronJob,
  onToggleCron,
  onRun,
  runLoading,
  runResult,
  onSendTest,
  testLoading,
  testResult,
}: TriggerSheetProps) {
  const [testEmail, setTestEmail] = useState("");
  const [lastEmail, setLastEmail] = useState<EmailLogRow | null>(null);
  const [lastEmailLoading, setLastEmailLoading] = useState(false);

  // Fetch last email when sheet opens
  useEffect(() => {
    if (!open || !trigger) {
      setLastEmail(null);
      return;
    }
    // Skip for verify-email-domains — it doesn't send emails
    if (trigger.slug === "verify-email-domains") return;

    setLastEmailLoading(true);
    fetch(`/api/admin/email/last-email?type=${trigger.slug}`)
      .then((res) => res.json())
      .then((data) => setLastEmail(data.entry ?? null))
      .catch(() => setLastEmail(null))
      .finally(() => setLastEmailLoading(false));
  }, [open, trigger]);

  if (!trigger) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-[480px] w-full">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-white/[0.08]">
          <div className="flex items-center justify-between">
            <SheetTitle className="font-mohave text-xl text-[#E5E5E5]">
              {trigger.label}
            </SheetTitle>
            {trigger.cronJobName && (
              <Switch
                checked={isActive}
                onCheckedChange={(val) => onToggleCron(val)}
                disabled={cronLoading || isToggling || !hasCronJob}
              />
            )}
          </div>
          <SheetDescription className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full font-mohave text-[10px] uppercase border border-[#597794]/30 text-[#597794] bg-[#597794]/10">
              {trigger.schedule}
            </span>
            {trigger.cronJobName && (
              <span className={`font-kosugi text-[10px] ${isActive ? "text-[#9DB582]" : "text-[#6B6B6B]"}`}>
                {isActive ? "Active" : "Paused"}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="px-6 py-4">
          <div className="space-y-6">
            {/* Description */}
            <p className="font-kosugi text-[12px] text-[#A0A0A0]">
              {trigger.description}
            </p>

            {/* Last Email Preview */}
            {trigger.slug !== "verify-email-domains" && (
              <div>
                <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
                  Last Email Sent
                </p>
                {lastEmailLoading ? (
                  <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]">
                    <div className="flex items-center justify-center py-4">
                      <div className="w-4 h-4 border-2 border-[#597794] border-t-transparent rounded-full animate-spin" />
                    </div>
                  </div>
                ) : lastEmail ? (
                  <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-white/[0.02]">
                    <div className="px-4 py-2.5 border-b border-white/[0.05]">
                      <p className="font-mohave text-[13px] text-[#E5E5E5]">{lastEmail.subject}</p>
                    </div>
                    <div className="px-4 py-2 flex items-center justify-between border-b border-white/[0.05]">
                      <span className="font-kosugi text-[11px] text-[#6B6B6B]">To</span>
                      <span className="font-kosugi text-[11px] text-[#A0A0A0]">{lastEmail.recipient_email}</span>
                    </div>
                    <div className="px-4 py-2 flex items-center justify-between border-b border-white/[0.05]">
                      <span className="font-kosugi text-[11px] text-[#6B6B6B]">Type</span>
                      <span className="font-kosugi text-[11px] text-[#A0A0A0]">{lastEmail.email_type}</span>
                    </div>
                    <div className="px-4 py-2 flex items-center justify-between border-b border-white/[0.05]">
                      <span className="font-kosugi text-[11px] text-[#6B6B6B]">Sent</span>
                      <span className="font-kosugi text-[11px] text-[#A0A0A0]">
                        {new Date(lastEmail.sent_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="px-4 py-2 flex items-center justify-between">
                      <span className="font-kosugi text-[11px] text-[#6B6B6B]">Status</span>
                      <span className={`font-mohave text-[11px] uppercase ${
                        lastEmail.status === "sent" || lastEmail.status === "delivered"
                          ? "text-[#9DB582]"
                          : "text-[#93321A]"
                      }`}>
                        {lastEmail.status}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]">
                    <p className="font-kosugi text-[12px] text-[#6B6B6B] text-center">
                      No emails sent yet
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div>
              <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
                Actions
              </p>

              {/* Run Now */}
              <button
                onClick={onRun}
                disabled={runLoading}
                className="w-full px-4 py-2.5 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#597794] hover:bg-white/[0.04] transition-colors disabled:opacity-40 mb-2"
              >
                {runLoading ? "Running..." : "Run Now"}
              </button>

              {/* Run result */}
              {runResult && (
                <div className={`mb-3 rounded p-2.5 ${runResult.success ? "bg-[#9DB582]/10" : "bg-[#93321A]/10"}`}>
                  <p className={`font-mohave text-[10px] uppercase mb-0.5 ${runResult.success ? "text-[#9DB582]" : "text-[#93321A]"}`}>
                    {runResult.success ? "Success" : "Error"}
                  </p>
                  <pre className="font-mono text-[11px] text-[#A0A0A0] whitespace-pre-wrap overflow-auto max-h-32">
                    {runResult.message}
                  </pre>
                </div>
              )}

              {/* Test Email */}
              {trigger.hasTestEmail && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      placeholder="test@email.com"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && testEmail.trim()) onSendTest(testEmail.trim());
                      }}
                      className="flex-1 bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 font-kosugi text-[12px] text-[#E5E5E5] placeholder-[#4A4A4A] focus:outline-none focus:border-[#597794]"
                    />
                    <button
                      onClick={() => testEmail.trim() && onSendTest(testEmail.trim())}
                      disabled={testLoading || !testEmail.trim()}
                      className="px-4 py-2 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#C4A868] hover:bg-white/[0.04] transition-colors disabled:opacity-30 whitespace-nowrap"
                    >
                      {testLoading ? "..." : "Send Test"}
                    </button>
                  </div>

                  {/* Test result */}
                  {testResult && (
                    <div className={`rounded p-2.5 ${testResult.success ? "bg-[#9DB582]/10" : "bg-[#93321A]/10"}`}>
                      <p className={`font-mohave text-[10px] uppercase mb-0.5 ${testResult.success ? "text-[#9DB582]" : "text-[#93321A]"}`}>
                        {testResult.success ? "Test Sent" : "Error"}
                      </p>
                      <pre className="font-mono text-[11px] text-[#A0A0A0] whitespace-pre-wrap overflow-auto max-h-20">
                        {testResult.message}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
