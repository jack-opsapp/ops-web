"use client";

/**
 * OPS Web - Email Review Panel
 *
 * Slide-over panel with 3 tabs for reviewing email-to-client matches:
 *   - Needs Review: domain/phone matches with Confirm/Wrong actions
 *   - Unmatched: no match found — Create Lead / Ignore / Block Domain
 *   - Matched: confirmed exact matches (read-only verification)
 *
 * Fetches from /api/integrations/gmail/review-items
 * Mutations: confirm-match, reject-match, ignore, block-domain
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Mail,
  CheckCircle2,
  XCircle,
  UserPlus,
  EyeOff,
  ShieldBan,
  Loader2,
  Inbox,
  Link2,
  AlertTriangle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { useGmailConnections } from "@/lib/hooks/use-gmail-connections";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReviewItem {
  id: string;
  subject: string;
  content: string | null;
  fromEmail: string | null;
  matchConfidence: "exact" | "domain" | "phone" | "thread" | "unmatched" | null;
  suggestedClientId: string | null;
  suggestedClientName: string | null;
  clientId: string | null;
  clientName: string | null;
  emailThreadId: string | null;
  createdAt: string;
}

type TabKey = "needs-review" | "unmatched" | "matched";

interface TabDef {
  key: TabKey;
  label: string;
  count: number;
}

export interface EmailReviewPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called when "Create Lead" is clicked — parent opens CreateOpportunityModal */
  onCreateLead?: (prefill: {
    title: string;
    sourceEmail?: string;
    notes?: string;
  }) => void;
}

// ─── Data Hook ─────────────────────────────────────────────────────────────────

function useReviewItems(companyId: string) {
  return useQuery<ReviewItem[]>({
    queryKey: ["emailReviewItems", companyId],
    queryFn: async () => {
      const res = await fetch(
        `/api/integrations/gmail/review-items?companyId=${encodeURIComponent(companyId)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to fetch review items");
      }
      const json = (await res.json()) as { ok: boolean; items: ReviewItem[] };
      return json.items;
    },
    enabled: !!companyId,
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

function useConfirmMatch(companyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (activityId: string) => {
      const res = await fetch("/api/integrations/gmail/confirm-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to confirm match");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emailReviewItems", companyId] });
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", companyId] });
      toast.success("Match confirmed");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

function useRejectMatch(companyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (activityId: string) => {
      const res = await fetch("/api/integrations/gmail/reject-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to reject match");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emailReviewItems", companyId] });
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", companyId] });
      toast.success("Match rejected");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

function useIgnoreActivity(companyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (activityId: string) => {
      const res = await fetch("/api/integrations/gmail/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to ignore activity");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emailReviewItems", companyId] });
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", companyId] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

function useBlockDomain(companyId: string) {
  const queryClient = useQueryClient();

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
        body: JSON.stringify({ domain, connectionId, companyId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to block domain");
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["emailReviewItems", companyId] });
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", companyId] });
      toast.success(`Blocked @${variables.domain}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(email: string | null): string | null {
  if (!email) return null;
  const parts = email.split("@");
  return parts.length === 2 ? parts[1] : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function confidenceLabel(confidence: ReviewItem["matchConfidence"]): string {
  switch (confidence) {
    case "exact":
      return "Exact match";
    case "domain":
      return "Domain match";
    case "phone":
      return "Phone match";
    case "thread":
      return "Thread match";
    case "unmatched":
      return "No match";
    default:
      return "Unknown";
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: TabKey }) {
  const messages: Record<TabKey, { icon: typeof Inbox; text: string }> = {
    "needs-review": {
      icon: CheckCircle2,
      text: "No emails need review",
    },
    unmatched: {
      icon: Inbox,
      text: "No unmatched emails",
    },
    matched: {
      icon: Link2,
      text: "No confirmed matches yet",
    },
  };

  const { icon: Icon, text } = messages[tab];

  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <Icon className="h-8 w-8 text-[#333]" />
      <p className="font-kosugi text-sm text-[#555]">{text}</p>
    </div>
  );
}

/** Card for the "Needs Review" tab — shows suggested match + Confirm / Wrong */
function NeedsReviewCard({
  item,
  onConfirm,
  onReject,
  isConfirming,
  isRejecting,
}: {
  item: ReviewItem;
  onConfirm: () => void;
  onReject: () => void;
  isConfirming: boolean;
  isRejecting: boolean;
}) {
  const busy = isConfirming || isRejecting;

  return (
    <div className="rounded-sm border border-[rgba(255,255,255,0.10)] bg-[#0D0D0D] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="h-7 w-7 rounded-full bg-[#597794]/15 flex items-center justify-center shrink-0 mt-0.5">
          <Mail className="h-3.5 w-3.5 text-[#597794]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mohave text-sm font-medium text-[#E5E5E5] truncate">
            {item.subject || "(no subject)"}
          </p>
          {item.fromEmail && (
            <p className="font-kosugi text-xs text-[#999] truncate mt-0.5">
              {item.fromEmail}
            </p>
          )}
        </div>
        <span className="font-kosugi text-[10px] text-[#555] uppercase tracking-wider shrink-0">
          {formatDate(item.createdAt)}
        </span>
      </div>

      {/* Snippet */}
      {item.content && (
        <p className="font-mohave text-xs text-[#999] line-clamp-2 leading-relaxed">
          {item.content}
        </p>
      )}

      {/* Match info */}
      <div className="flex items-center gap-2 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] px-3 py-2">
        <AlertTriangle className="h-3.5 w-3.5 text-[#C4A868] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-kosugi text-[10px] text-[#C4A868] uppercase tracking-wider">
            {confidenceLabel(item.matchConfidence)}
          </p>
          {item.suggestedClientName && (
            <p className="font-mohave text-sm text-[#E5E5E5] truncate mt-0.5">
              {item.suggestedClientName}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={onConfirm}
          disabled={busy}
          loading={isConfirming}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Confirm
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={onReject}
          disabled={busy}
          loading={isRejecting}
        >
          <XCircle className="h-3.5 w-3.5" />
          Wrong
        </Button>
      </div>
    </div>
  );
}

/** Card for the "Unmatched" tab — Create Lead / Ignore / Block Domain */
function UnmatchedCard({
  item,
  onCreateLead,
  onIgnore,
  onBlockDomain,
  isIgnoring,
  isBlocking,
}: {
  item: ReviewItem;
  onCreateLead: () => void;
  onIgnore: () => void;
  onBlockDomain: () => void;
  isIgnoring: boolean;
  isBlocking: boolean;
}) {
  const domain = extractDomain(item.fromEmail);
  const busy = isIgnoring || isBlocking;

  return (
    <div className="rounded-sm border border-[rgba(255,255,255,0.10)] bg-[#0D0D0D] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="h-7 w-7 rounded-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center shrink-0 mt-0.5">
          <Mail className="h-3.5 w-3.5 text-[#999]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mohave text-sm font-medium text-[#E5E5E5] truncate">
            {item.subject || "(no subject)"}
          </p>
          {item.fromEmail && (
            <p className="font-kosugi text-xs text-[#999] truncate mt-0.5">
              {item.fromEmail}
            </p>
          )}
        </div>
        <span className="font-kosugi text-[10px] text-[#555] uppercase tracking-wider shrink-0">
          {formatDate(item.createdAt)}
        </span>
      </div>

      {/* Snippet */}
      {item.content && (
        <p className="font-mohave text-xs text-[#999] line-clamp-2 leading-relaxed">
          {item.content}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={onCreateLead}
          disabled={busy}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Create Lead
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={onIgnore}
            disabled={busy}
            loading={isIgnoring}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Ignore
          </Button>
          {domain && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-[#93321A] hover:text-[#b5432a]"
              onClick={onBlockDomain}
              disabled={busy}
              loading={isBlocking}
            >
              <ShieldBan className="h-3.5 w-3.5" />
              Block @{domain}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Card for the "Matched" tab — read-only confirmed matches */
function MatchedCard({ item }: { item: ReviewItem }) {
  return (
    <div className="rounded-sm border border-[rgba(255,255,255,0.06)] bg-[#0D0D0D] p-4 space-y-3 opacity-80">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="h-7 w-7 rounded-full bg-[#9DB582]/15 flex items-center justify-center shrink-0 mt-0.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#9DB582]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mohave text-sm font-medium text-[#E5E5E5] truncate">
            {item.subject || "(no subject)"}
          </p>
          {item.fromEmail && (
            <p className="font-kosugi text-xs text-[#999] truncate mt-0.5">
              {item.fromEmail}
            </p>
          )}
        </div>
        <span className="font-kosugi text-[10px] text-[#555] uppercase tracking-wider shrink-0">
          {formatDate(item.createdAt)}
        </span>
      </div>

      {/* Matched client */}
      {item.clientName && (
        <div className="flex items-center gap-2 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] px-3 py-2">
          <Link2 className="h-3.5 w-3.5 text-[#9DB582] shrink-0" />
          <div className="min-w-0">
            <p className="font-kosugi text-[10px] text-[#9DB582] uppercase tracking-wider">
              {confidenceLabel(item.matchConfidence)}
            </p>
            <p className="font-mohave text-sm text-[#E5E5E5] truncate mt-0.5">
              {item.clientName}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function EmailReviewPanel({
  open,
  onClose,
  onCreateLead,
}: EmailReviewPanelProps) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [activeTab, setActiveTab] = useState<TabKey>("needs-review");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<
    "confirm" | "reject" | "ignore" | "block" | null
  >(null);

  const { data: allItems = [], isLoading } = useReviewItems(companyId);
  const { data: connections = [] } = useGmailConnections();

  const confirmMatch = useConfirmMatch(companyId);
  const rejectMatch = useRejectMatch(companyId);
  const ignoreActivity = useIgnoreActivity(companyId);
  const blockDomain = useBlockDomain(companyId);

  // Split items into tabs
  const needsReview = allItems.filter(
    (i) =>
      i.matchConfidence !== "unmatched" &&
      i.matchConfidence !== "exact" &&
      i.suggestedClientId
  );
  const unmatched = allItems.filter(
    (i) => i.matchConfidence === "unmatched" && !i.clientId
  );
  const matched = allItems.filter(
    (i) => i.matchConfidence === "exact" && i.clientId
  );

  const tabs: TabDef[] = [
    { key: "needs-review", label: "Needs Review", count: needsReview.length },
    { key: "unmatched", label: "Unmatched", count: unmatched.length },
    { key: "matched", label: "Matched", count: matched.length },
  ];

  const currentItems =
    activeTab === "needs-review"
      ? needsReview
      : activeTab === "unmatched"
        ? unmatched
        : matched;

  // ── Action handlers ────────────────────────────────────────────────────────

  const handleConfirm = async (activityId: string) => {
    setActioningId(activityId);
    setActionType("confirm");
    try {
      await confirmMatch.mutateAsync(activityId);
    } finally {
      setActioningId(null);
      setActionType(null);
    }
  };

  const handleReject = async (activityId: string) => {
    setActioningId(activityId);
    setActionType("reject");
    try {
      await rejectMatch.mutateAsync(activityId);
    } finally {
      setActioningId(null);
      setActionType(null);
    }
  };

  const handleIgnore = async (activityId: string) => {
    setActioningId(activityId);
    setActionType("ignore");
    try {
      await ignoreActivity.mutateAsync(activityId);
    } finally {
      setActioningId(null);
      setActionType(null);
    }
  };

  const handleBlockDomain = async (email: string | null) => {
    const domain = extractDomain(email);
    if (!domain) return;
    const connectionId = connections[0]?.id;
    if (!connectionId) {
      toast.error("No Gmail connection found");
      return;
    }
    setActionType("block");
    try {
      await blockDomain.mutateAsync({ domain, connectionId });
    } finally {
      setActionType(null);
    }
  };

  const handleCreateLead = (item: ReviewItem) => {
    onCreateLead?.({
      title: item.subject || "Email inquiry",
      sourceEmail: item.fromEmail ?? undefined,
      notes: item.content ?? undefined,
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="email-review-backdrop"
            className="fixed inset-0 z-50"
            style={{
              backgroundColor: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.aside
            key="email-review-panel"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-[rgba(255,255,255,0.10)] bg-[#0A0A0A]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {/* ── Sticky Header ─────────────────────────────────────── */}
            <div className="shrink-0 border-b border-[rgba(255,255,255,0.10)] px-5 py-4">
              <div className="flex items-center justify-between">
                <h2 className="font-mohave text-lg font-semibold text-white uppercase tracking-wide">
                  Email Review
                </h2>
                <button
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-sm text-[#555] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#999]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* ── Tabs ──────────────────────────────────────────── */}
              <div className="mt-4 flex gap-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-kosugi text-xs uppercase tracking-wider transition-colors",
                      activeTab === tab.key
                        ? "bg-[rgba(255,255,255,0.08)] text-white"
                        : "text-[#555] hover:text-[#999] hover:bg-[rgba(255,255,255,0.03)]"
                    )}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span
                        className={cn(
                          "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold",
                          activeTab === tab.key
                            ? "bg-[#597794] text-white"
                            : "bg-[rgba(255,255,255,0.08)] text-[#999]"
                        )}
                      >
                        {tab.count > 99 ? "99+" : tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Content ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-[#597794]" />
                </div>
              ) : currentItems.length === 0 ? (
                <EmptyState tab={activeTab} />
              ) : (
                <div className="space-y-3">
                  {activeTab === "needs-review" &&
                    needsReview.map((item) => (
                      <NeedsReviewCard
                        key={item.id}
                        item={item}
                        onConfirm={() => handleConfirm(item.id)}
                        onReject={() => handleReject(item.id)}
                        isConfirming={
                          actioningId === item.id && actionType === "confirm"
                        }
                        isRejecting={
                          actioningId === item.id && actionType === "reject"
                        }
                      />
                    ))}

                  {activeTab === "unmatched" &&
                    unmatched.map((item) => (
                      <UnmatchedCard
                        key={item.id}
                        item={item}
                        onCreateLead={() => handleCreateLead(item)}
                        onIgnore={() => handleIgnore(item.id)}
                        onBlockDomain={() =>
                          handleBlockDomain(item.fromEmail)
                        }
                        isIgnoring={
                          actioningId === item.id && actionType === "ignore"
                        }
                        isBlocking={actionType === "block"}
                      />
                    ))}

                  {activeTab === "matched" &&
                    matched.map((item) => (
                      <MatchedCard key={item.id} item={item} />
                    ))}
                </div>
              )}
            </div>

            {/* ── Footer summary ────────────────────────────────────── */}
            <div className="shrink-0 border-t border-[rgba(255,255,255,0.10)] px-5 py-3">
              <p className="font-kosugi text-[10px] text-[#555] uppercase tracking-wider">
                {allItems.length} total
                {needsReview.length > 0 &&
                  ` \u00b7 ${needsReview.length} need review`}
                {unmatched.length > 0 &&
                  ` \u00b7 ${unmatched.length} unmatched`}
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
