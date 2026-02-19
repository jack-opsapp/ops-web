"use client";

import { useState, useEffect } from "react";
import {
  Mail,
  Copy,
  ExternalLink,
  Inbox,
  MessageCircle,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useGmailConnections,
  useDeleteGmailConnection,
  useUpdateGmailConnection,
  useTriggerGmailSync,
} from "@/lib/hooks";
import { toast } from "sonner";

function formatTimeAgo(date: Date | null): string {
  if (!date) return "Never";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function IntegrationsTab() {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections = [], isLoading: connectionsLoading } = useGmailConnections();
  const deleteConnection = useDeleteGmailConnection();
  const updateConnection = useUpdateGmailConnection();
  const triggerSync = useTriggerGmailSync();

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "integrations" && params.get("status") === "connected") {
      toast.success("Gmail connected successfully");
      window.history.replaceState({}, "", "/settings?tab=integrations");
    }
  }, []);

  const forwardingAddress = companyId
    ? `leads-${companyId.slice(0, 8)}@inbound.opsapp.co`
    : "";

  const companyConnections = connections.filter((c) => c.type === "company");
  const individualConnections = connections.filter((c) => c.type === "individual");
  const hasAnyConnection = connections.length > 0;

  function handleConnectGmail(type: "company" | "individual") {
    const params = new URLSearchParams({
      companyId,
      type,
      ...(type === "individual" && currentUser?.id ? { userId: currentUser.id } : {}),
    });
    window.location.href = `/api/integrations/gmail?${params}`;
  }

  function handleCopyForwardingAddress() {
    navigator.clipboard.writeText(forwardingAddress).then(() => {
      setCopied(true);
      toast.success("Forwarding address copied");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDisconnect(id: string) {
    deleteConnection.mutate(id, {
      onSuccess: () => toast.success("Gmail disconnected"),
      onError: (err) => toast.error("Failed to disconnect", { description: err.message }),
    });
  }

  function handleToggleSync(id: string, currentEnabled: boolean) {
    updateConnection.mutate(
      { id, data: { id, syncEnabled: !currentEnabled } },
      {
        onSuccess: () => toast.success(`Sync ${currentEnabled ? "paused" : "enabled"}`),
        onError: (err) => toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  function handleSync() {
    triggerSync.mutate(undefined, {
      onSuccess: () => toast.success("Gmail sync triggered"),
      onError: (err) => toast.error("Sync failed", { description: err.message }),
    });
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      {/* Company Gmail */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Company Gmail</CardTitle>
            {companyConnections.length > 0 && (
              <span className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-kosugi text-[10px] uppercase tracking-wider bg-[rgba(107,143,113,0.15)] text-[#6B8F71]">
                <Check className="w-[12px] h-[12px]" />
                Connected
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Connect your company Gmail to automatically import leads and log email activity on deal timelines.
          </p>

          {connectionsLoading ? (
            <div className="flex items-center gap-[6px] py-1">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mohave text-body-sm text-text-disabled">Loading...</span>
            </div>
          ) : companyConnections.length > 0 ? (
            <div className="space-y-1">
              {companyConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between px-1.5 py-1 bg-[rgba(107,143,113,0.08)] border border-[rgba(107,143,113,0.2)] rounded"
                >
                  <div className="flex items-center gap-[6px] min-w-0">
                    <Mail className="w-[16px] h-[16px] text-[#6B8F71] shrink-0" />
                    <div className="min-w-0">
                      <span className="font-mono text-data-sm text-[#6B8F71] block truncate">
                        {conn.email}
                      </span>
                      <span className="font-kosugi text-[10px] text-text-disabled">
                        Last synced: {formatTimeAgo(conn.lastSyncedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-[4px] shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleSync(conn.id, conn.syncEnabled)}
                      title={conn.syncEnabled ? "Pause sync" : "Enable sync"}
                    >
                      {conn.syncEnabled ? (
                        <ToggleRight className="w-[16px] h-[16px] text-[#6B8F71]" />
                      ) : (
                        <ToggleLeft className="w-[16px] h-[16px] text-text-disabled" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(conn.id)}
                      className="text-text-disabled hover:text-ops-error"
                    >
                      <Trash2 className="w-[14px] h-[14px]" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Button onClick={() => handleConnectGmail("company")} className="gap-[6px]">
              <ExternalLink className="w-[14px] h-[14px]" />
              Connect Company Gmail
            </Button>
          )}

          {hasAnyConnection && (
            <div className="pt-[4px]">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSync}
                loading={triggerSync.isPending}
                className="gap-[6px]"
              >
                <RefreshCw className={cn("w-[14px] h-[14px]", triggerSync.isPending && "animate-spin")} />
                Sync Now
              </Button>
            </div>
          )}

          <p className="font-kosugi text-[11px] text-text-disabled">
            Requires a Google Workspace or Gmail account. Only reads incoming emails.
          </p>
        </CardContent>
      </Card>

      {/* Personal Gmail */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>My Gmail</CardTitle>
            {individualConnections.length > 0 && (
              <span className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-kosugi text-[10px] uppercase tracking-wider bg-[rgba(107,143,113,0.15)] text-[#6B8F71]">
                <Check className="w-[12px] h-[12px]" />
                Connected
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Connect your personal Gmail to log client emails you send and receive from your own account.
          </p>

          {individualConnections.length > 0 ? (
            <div className="space-y-1">
              {individualConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between px-1.5 py-1 bg-[rgba(107,143,113,0.08)] border border-[rgba(107,143,113,0.2)] rounded"
                >
                  <div className="flex items-center gap-[6px] min-w-0">
                    <Mail className="w-[16px] h-[16px] text-[#6B8F71] shrink-0" />
                    <div className="min-w-0">
                      <span className="font-mono text-data-sm text-[#6B8F71] block truncate">
                        {conn.email}
                      </span>
                      <span className="font-kosugi text-[10px] text-text-disabled">
                        Last synced: {formatTimeAgo(conn.lastSyncedAt)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDisconnect(conn.id)}
                    className="text-text-disabled hover:text-ops-error shrink-0"
                  >
                    <Trash2 className="w-[14px] h-[14px]" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => handleConnectGmail("individual")}
              className="gap-[6px]"
            >
              <ExternalLink className="w-[14px] h-[14px]" />
              Connect My Gmail
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Email Forwarding */}
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

      {/* Follow-up Monitoring */}
      <Card>
        <CardHeader>
          <CardTitle>Follow-up Monitoring</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1.5 py-[4px]">
            <MessageCircle className="w-[24px] h-[24px] text-ops-accent shrink-0" />
            <div>
              <p className="font-mohave text-body text-text-primary">Active</p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                Automatically tracks quoted deals and creates follow-up reminders. Configure timing in Preferences.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
