"use client";

import { useState, useEffect } from "react";
import { Mail, Copy, ExternalLink, Inbox, MessageCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";

export function IntegrationsTab() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const [gmailConnected, setGmailConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "integrations" && params.get("status") === "connected") {
      setGmailConnected(true);
      toast.success("Gmail connected successfully");
      window.history.replaceState({}, "", "/settings?tab=integrations");
    }
  }, []);

  const forwardingAddress = companyId
    ? `leads-${companyId.slice(0, 8)}@inbound.opsapp.co`
    : "";

  function handleConnectGmail() {
    window.location.href = `/api/integrations/gmail?companyId=${companyId}`;
  }

  function handleCopyForwardingAddress() {
    navigator.clipboard.writeText(forwardingAddress).then(() => {
      setCopied(true);
      toast.success("Forwarding address copied");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Gmail Integration</CardTitle>
            {gmailConnected && (
              <span className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-kosugi text-[10px] uppercase tracking-wider bg-[rgba(107,143,113,0.15)] text-[#6B8F71]">
                <Check className="w-[12px] h-[12px]" />
                Connected
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Connect your Gmail account to automatically import leads from incoming emails.
          </p>
          {gmailConnected ? (
            <div className="flex items-center gap-1.5 px-1.5 py-1 bg-[rgba(107,143,113,0.08)] border border-[rgba(107,143,113,0.2)] rounded">
              <Mail className="w-[16px] h-[16px] text-[#6B8F71]" />
              <span className="font-mono text-data-sm text-[#6B8F71]">Gmail account connected</span>
            </div>
          ) : (
            <Button onClick={handleConnectGmail} className="gap-[6px]">
              <ExternalLink className="w-[14px] h-[14px]" />
              Connect Gmail
            </Button>
          )}
          <p className="font-kosugi text-[11px] text-text-disabled">
            Requires a Google Workspace or Gmail account. Only reads incoming emails.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Forwarding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Forward emails to your unique OPS address to automatically create leads in your pipeline.
          </p>
          <div className="flex items-center gap-1">
            <div className="flex-1 bg-background-input border border-border rounded px-1.5 py-[8px]">
              <div className="flex items-center gap-[6px]">
                <Inbox className="w-[14px] h-[14px] text-text-disabled shrink-0" />
                <span className="font-mono text-data-sm text-ops-accent truncate">
                  {forwardingAddress || "Loading..."}
                </span>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="gap-[4px] shrink-0"
              onClick={handleCopyForwardingAddress}
              disabled={!forwardingAddress}
            >
              <Copy className="w-[14px] h-[14px]" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled">
            Set this as a forwarding address in your email client to auto-create RFQ leads.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Follow-up Monitoring</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1.5 py-2">
            <MessageCircle className="w-[24px] h-[24px] text-text-disabled" />
            <div>
              <p className="font-mohave text-body text-text-secondary">Coming Soon</p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                Automatically track email threads with leads and get reminded about follow-ups.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
