"use client";

/**
 * OPS Web - Inbox Leads Queue
 *
 * Surfaces unreviewed emails from synced Gmail inboxes that don't match
 * any existing client or opportunity. Lets the user:
 *   → Create Lead: opens CreateOpportunityModal pre-filled from the email
 *   → Ignore: marks the activity as read and hides it
 */

import { useState } from "react";
import { Mail, UserPlus, X, Inbox, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GmailService } from "@/lib/api/services";
import { useAuthStore } from "@/lib/store/auth-store";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxLead {
  activityId: string;
  messageId: string;
  threadId: string;
  subject: string;
  snippet: string;
  fromEmail: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useInboxLeads(companyId: string) {
  return useQuery({
    queryKey: ["inboxLeads", companyId],
    queryFn: () => GmailService.getInboxLeads(companyId),
    enabled: !!companyId,
    staleTime: 2 * 60 * 1000, // 2 min
    refetchInterval: 5 * 60 * 1000, // poll every 5 min
  });
}

function useIgnoreLead() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: (activityId: string) => GmailService.ignoreInboxLead(activityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", company?.id] });
    },
    onError: () => {
      toast.error("Failed to dismiss lead");
    },
  });
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

interface CreateOpportunityPrefill {
  title: string;
  sourceEmail?: string;
  notes?: string;
}

function LeadCard({
  lead,
  onCreateLead,
  onIgnore,
  isIgnoring,
}: {
  lead: InboxLead;
  onCreateLead: (prefill: CreateOpportunityPrefill) => void;
  onIgnore: () => void;
  isIgnoring: boolean;
}) {
  const prefill: CreateOpportunityPrefill = {
    title: lead.subject || "Email inquiry",
    sourceEmail: lead.fromEmail || undefined,
    notes: lead.snippet || undefined,
  };

  return (
    <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-full bg-[#417394]/20 flex items-center justify-center shrink-0">
            <Mail className="h-3.5 w-3.5 text-[#8BB8D4]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#E5E5E5] truncate">
              {lead.subject || "(no subject)"}
            </p>
            {lead.fromEmail && (
              <p className="text-xs text-[#555] truncate">{lead.fromEmail}</p>
            )}
          </div>
        </div>
        <button
          onClick={onIgnore}
          disabled={isIgnoring}
          className="shrink-0 text-[#444] hover:text-[#9CA3AF] transition-colors"
        >
          {isIgnoring ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Snippet */}
      {lead.snippet && (
        <p className="text-xs text-[#9CA3AF] line-clamp-2 leading-relaxed">
          {lead.snippet}
        </p>
      )}

      {/* Action */}
      <button
        onClick={() => onCreateLead(prefill)}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#417394]/20 hover:bg-[#417394]/30 text-[#8BB8D4] text-sm font-medium transition-colors"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Create Lead
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface InboxLeadsQueueProps {
  /** Called when "Create Lead" is clicked — parent opens CreateOpportunityModal */
  onCreateLead: (prefill: CreateOpportunityPrefill) => void;
  className?: string;
}

export function InboxLeadsQueue({ onCreateLead, className }: InboxLeadsQueueProps) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading, isFetching } = useInboxLeads(companyId);
  const ignoreLead = useIgnoreLead();
  const [ignoringId, setIgnoringId] = useState<string | null>(null);

  const handleIgnore = async (activityId: string) => {
    setIgnoringId(activityId);
    try {
      await ignoreLead.mutateAsync(activityId);
    } finally {
      setIgnoringId(null);
    }
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["inboxLeads", companyId] });
  };

  if (!companyId) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-[#9CA3AF]" />
          <h3 className="text-sm font-medium text-[#E5E5E5]">Inbox Leads</h3>
          {leads.length > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#417394] text-[9px] font-bold text-white">
              {leads.length > 9 ? "9+" : leads.length}
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="text-[#444] hover:text-[#9CA3AF] transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[#417394]" />
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A2A2A] py-8 flex flex-col items-center gap-2">
          <Inbox className="h-7 w-7 text-[#333]" />
          <p className="text-sm text-[#555]">No new inbox leads</p>
          <p className="text-xs text-[#444]">
            Unmatched emails from synced Gmail accounts appear here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <LeadCard
              key={lead.activityId}
              lead={lead}
              onCreateLead={onCreateLead}
              onIgnore={() => handleIgnore(lead.activityId)}
              isIgnoring={ignoringId === lead.activityId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export type { CreateOpportunityPrefill };
