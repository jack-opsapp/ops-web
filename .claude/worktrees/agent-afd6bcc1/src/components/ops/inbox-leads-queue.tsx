"use client";

/**
 * OPS Web - Inbox Leads Queue
 *
 * Surfaces unreviewed emails from synced Gmail inboxes that don't match
 * any existing client or opportunity. Lets the user:
 *   -> Create Lead: opens CreateOpportunityModal pre-filled from the email
 *   -> Ignore: marks the activity as read and hides it
 *   -> Block Domain: blocks all future emails from that domain
 *   -> Review: opens the EmailReviewPanel for items needing review
 *
 * Emails are grouped by sender domain, sorted by count (most first).
 * Within each domain, emails are grouped by exact sender address.
 */

import { useState, useMemo } from "react";
import {
  UserPlus,
  X,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldBan,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GmailService } from "@/lib/api/services";
import { useAuthStore } from "@/lib/store/auth-store";
import { useGmailConnections } from "@/lib/hooks/use-gmail-connections";
import { EmailReviewPanel } from "@/components/ops/email-review-panel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxLead {
  activityId: string;
  messageId: string;
  threadId: string;
  subject: string;
  snippet: string;
  fromEmail: string;
  needsReview: boolean;
}

interface CreateOpportunityPrefill {
  title: string;
  sourceEmail?: string;
  notes?: string;
}

/** A group of leads from one exact sender within a domain group */
interface SenderGroup {
  email: string;
  leads: InboxLead[];
}

/** A group of leads from one domain */
interface DomainGroup {
  domain: string;
  totalCount: number;
  senders: SenderGroup[];
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

function useBlockDomain() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      domain,
      connectionId,
    }: {
      domain: string;
      connectionId: string;
    }) => {
      const res = await fetch("/api/integrations/gmail/block-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, connectionId, companyId: company?.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Failed to block domain"
        );
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", company?.id] });
      queryClient.invalidateQueries({
        queryKey: ["emailReviewItems", company?.id],
      });
      toast.success(`Blocked @${variables.domain}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(email: string): string {
  const parts = email.split("@");
  return parts.length === 2 ? parts[1] : email;
}

/** Groups leads by domain, then by sender. Sorted by domain count descending. */
function buildDomainGroups(leads: InboxLead[]): DomainGroup[] {
  // Group by domain
  const domainMap = new Map<string, InboxLead[]>();
  for (const lead of leads) {
    const domain = extractDomain(lead.fromEmail);
    const existing = domainMap.get(domain);
    if (existing) {
      existing.push(lead);
    } else {
      domainMap.set(domain, [lead]);
    }
  }

  // Build domain groups with sender sub-groups
  const groups: DomainGroup[] = [];
  for (const [domain, domainLeads] of domainMap) {
    // Sub-group by exact sender email
    const senderMap = new Map<string, InboxLead[]>();
    for (const lead of domainLeads) {
      const existing = senderMap.get(lead.fromEmail);
      if (existing) {
        existing.push(lead);
      } else {
        senderMap.set(lead.fromEmail, [lead]);
      }
    }

    const senders: SenderGroup[] = [];
    for (const [email, senderLeads] of senderMap) {
      senders.push({ email, leads: senderLeads });
    }
    // Sort senders by count descending
    senders.sort((a, b) => b.leads.length - a.leads.length);

    groups.push({
      domain,
      totalCount: domainLeads.length,
      senders,
    });
  }

  // Sort domains by total count descending
  groups.sort((a, b) => b.totalCount - a.totalCount);

  return groups;
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

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
    <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0D0D0D] p-3 space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mohave text-sm font-medium text-[#E5E5E5] truncate">
            {lead.subject || "(no subject)"}
          </p>
        </div>
        <button
          onClick={onIgnore}
          disabled={isIgnoring}
          className="shrink-0 text-[#444] hover:text-[#9CA3AF] transition-colors"
        >
          {isIgnoring ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Snippet */}
      {lead.snippet && (
        <p className="font-kosugi text-xs text-[#999] line-clamp-2 leading-relaxed">
          {lead.snippet}
        </p>
      )}

      {/* Action */}
      <button
        onClick={() => onCreateLead(prefill)}
        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-sm bg-[#597794]/15 hover:bg-[#597794]/25 text-[#597794] text-xs font-medium transition-colors font-kosugi"
      >
        <UserPlus className="h-3 w-3" />
        Create Lead
      </button>
    </div>
  );
}

// ─── Sender Group Section ─────────────────────────────────────────────────────

function SenderGroupSection({
  senderGroup,
  onCreateLead,
  onIgnore,
  ignoringId,
}: {
  senderGroup: SenderGroup;
  onCreateLead: (prefill: CreateOpportunityPrefill) => void;
  onIgnore: (activityId: string) => void;
  ignoringId: string | null;
}) {
  const count = senderGroup.leads.length;

  return (
    <div className="space-y-1.5">
      {/* Sender count header */}
      {count > 1 && (
        <p className="font-kosugi text-[11px] text-[#999] px-1">
          {count} {count === 1 ? "email" : "emails"} from{" "}
          <span className="text-[#E5E5E5]">{senderGroup.email}</span>
        </p>
      )}
      {count === 1 && (
        <p className="font-kosugi text-[11px] text-[#999] px-1">
          <span className="text-[#E5E5E5]">{senderGroup.email}</span>
        </p>
      )}

      {/* Lead cards */}
      {senderGroup.leads.map((lead) => (
        <LeadCard
          key={lead.activityId}
          lead={lead}
          onCreateLead={onCreateLead}
          onIgnore={() => onIgnore(lead.activityId)}
          isIgnoring={ignoringId === lead.activityId}
        />
      ))}
    </div>
  );
}

// ─── Domain Group Section ─────────────────────────────────────────────────────

function DomainGroupSection({
  group,
  onCreateLead,
  onIgnore,
  onBlockDomain,
  ignoringId,
  isBlocking,
  blockingDomain,
}: {
  group: DomainGroup;
  onCreateLead: (prefill: CreateOpportunityPrefill) => void;
  onIgnore: (activityId: string) => void;
  onBlockDomain: (domain: string) => void;
  ignoringId: string | null;
  isBlocking: boolean;
  blockingDomain: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const isThisDomainBlocking = isBlocking && blockingDomain === group.domain;

  return (
    <div className="space-y-2">
      {/* Domain header */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 min-w-0 group"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-[#555] shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-[#555] shrink-0" />
          )}
          <span className="font-mohave text-xs font-semibold text-[#E5E5E5] uppercase tracking-wide truncate group-hover:text-white transition-colors">
            @{group.domain}
          </span>
          <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] px-1 font-kosugi text-[9px] font-bold text-[#999] shrink-0">
            {group.totalCount}
          </span>
        </button>

        {/* Block domain button */}
        <button
          onClick={() => onBlockDomain(group.domain)}
          disabled={isBlocking}
          className={cn(
            "flex items-center gap-1 rounded-sm px-2 py-1 font-kosugi text-[10px] transition-colors shrink-0",
            isThisDomainBlocking
              ? "text-[#555]"
              : "text-[#93321A] hover:text-[#b5432a] hover:bg-[rgba(147,50,26,0.10)]"
          )}
        >
          {isThisDomainBlocking ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ShieldBan className="h-3 w-3" />
          )}
          Block
        </button>
      </div>

      {/* Expanded content: sender groups */}
      {expanded && (
        <div className="ml-4 space-y-3 border-l border-[rgba(255,255,255,0.06)] pl-3">
          {group.senders.map((sender) => (
            <SenderGroupSection
              key={sender.email}
              senderGroup={sender}
              onCreateLead={onCreateLead}
              onIgnore={onIgnore}
              ignoringId={ignoringId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface InboxLeadsQueueProps {
  /** Called when "Create Lead" is clicked -- parent opens CreateOpportunityModal */
  onCreateLead: (prefill: CreateOpportunityPrefill) => void;
  className?: string;
}

export function InboxLeadsQueue({
  onCreateLead,
  className,
}: InboxLeadsQueueProps) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  const {
    data: leads = [],
    isLoading,
    isFetching,
  } = useInboxLeads(companyId);
  const ignoreLead = useIgnoreLead();
  const blockDomain = useBlockDomain();
  const { data: connections = [] } = useGmailConnections();

  const [ignoringId, setIgnoringId] = useState<string | null>(null);
  const [blockingDomain, setBlockingDomain] = useState<string | null>(null);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);

  // Build domain-grouped structure
  const domainGroups = useMemo(() => buildDomainGroups(leads), [leads]);

  // Check if any leads need review
  const reviewCount = useMemo(
    () => leads.filter((l) => l.needsReview).length,
    [leads]
  );

  const handleIgnore = async (activityId: string) => {
    setIgnoringId(activityId);
    try {
      await ignoreLead.mutateAsync(activityId);
    } finally {
      setIgnoringId(null);
    }
  };

  const handleBlockDomain = async (domain: string) => {
    const connectionId = connections[0]?.id;
    if (!connectionId) {
      toast.error("No Gmail connection found");
      return;
    }
    setBlockingDomain(domain);
    try {
      await blockDomain.mutateAsync({ domain, connectionId });
    } finally {
      setBlockingDomain(null);
    }
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["inboxLeads", companyId] });
  };

  if (!companyId) return null;

  return (
    <>
      <div className={cn("space-y-3", className)}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-[#999]" />
            <h3 className="font-mohave text-sm font-medium text-[#E5E5E5] uppercase tracking-wide">
              Inbox Leads
            </h3>
            {leads.length > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#597794] text-[9px] font-bold text-white">
                {leads.length > 9 ? "9+" : leads.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Review button — shown when any items need review */}
            {reviewCount > 0 && (
              <button
                onClick={() => setReviewPanelOpen(true)}
                className="flex items-center gap-1.5 rounded-sm px-2 py-1 font-kosugi text-[10px] uppercase tracking-wider text-[#C4A868] hover:bg-[rgba(196,168,104,0.10)] transition-colors"
              >
                <AlertTriangle className="h-3 w-3" />
                Review ({reviewCount})
              </button>
            )}

            <button
              onClick={handleRefresh}
              disabled={isFetching}
              className="text-[#444] hover:text-[#999] transition-colors"
              title="Refresh"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
              />
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[#597794]" />
          </div>
        ) : leads.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[rgba(255,255,255,0.10)] py-8 flex flex-col items-center gap-2">
            <Inbox className="h-7 w-7 text-[#333]" />
            <p className="font-kosugi text-sm text-[#555]">
              No new inbox leads
            </p>
            <p className="font-kosugi text-xs text-[#444]">
              Unmatched emails from synced Gmail accounts appear here
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {domainGroups.map((group) => (
              <DomainGroupSection
                key={group.domain}
                group={group}
                onCreateLead={onCreateLead}
                onIgnore={handleIgnore}
                onBlockDomain={handleBlockDomain}
                ignoringId={ignoringId}
                isBlocking={blockDomain.isPending}
                blockingDomain={blockingDomain}
              />
            ))}
          </div>
        )}
      </div>

      {/* Email Review Panel */}
      <EmailReviewPanel
        open={reviewPanelOpen}
        onClose={() => setReviewPanelOpen(false)}
        onCreateLead={onCreateLead}
      />
    </>
  );
}

export type { CreateOpportunityPrefill };
