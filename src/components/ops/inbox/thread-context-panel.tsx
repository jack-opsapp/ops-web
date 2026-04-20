"use client";

/**
 * ThreadContextPanel (Inbox v2) — the right-side context pane on the rebuilt
 * inbox. Unlike the legacy ContextPanel which keys off a client, this panel
 * keys off a thread. It shows:
 *
 *   - Header (close button)
 *   - Thread summary (participants, first seen, message count)
 *   - Phase C insights:
 *       · Sender frequency ("this domain emails you N×/month")
 *       · Similar-thread classifications ("10 similar threads were VENDOR")
 *       · Phase C memories related to the sender
 *   - Linked records (client, opportunity) with deep-links
 *
 * All sections gracefully render empty states. Panel animates in from
 * the right with EASE_SMOOTH. Reduced-motion fallback: opacity only.
 */

import { useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  X,
  Sparkles,
  Users,
  FolderKanban,
  ExternalLink,
  TrendingUp,
  History,
  Brain,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { InboxThreadRow } from "@/lib/hooks/use-inbox-threads";
import type { EmailThreadCategory } from "@/lib/types/email-thread";
import { CategoryChip, categoryLabel } from "./category-chip";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ThreadContextData {
  senderThreadCount: number;
  senderLastSeen: Date | null;
  similarClassifications: Array<{
    category: EmailThreadCategory;
    count: number;
  }>;
  memories: Array<{
    id: string;
    content: string;
    createdAt: Date;
  }>;
  clientName: string | null;
  opportunityName: string | null;
  opportunityStage: string | null;
}

// ─── Data fetch ──────────────────────────────────────────────────────────────

async function fetchThreadContext(
  companyId: string,
  thread: InboxThreadRow
): Promise<ThreadContextData> {
  const supabase = requireSupabase();
  const senderEmail = thread.latestSenderEmail?.toLowerCase() ?? null;
  const senderDomain = senderEmail?.split("@")[1] ?? null;

  // 1. Sender thread count + last seen — scoped by the exact sender email first,
  // falling back to the full domain when the exact email hasn't been seen much.
  const senderCountPromise = senderEmail
    ? supabase
        .from("email_threads")
        .select("id, last_message_at", { count: "exact" })
        .eq("company_id", companyId)
        .eq("latest_sender_email", senderEmail)
        .order("last_message_at", { ascending: false })
        .limit(1)
    : Promise.resolve({ data: [], count: 0 } as unknown as {
        data: Array<{ last_message_at: string }>;
        count: number;
      });

  // 2. Similar classifications from the corrections table + existing threads.
  // Anything in this company whose sender_domain matches tells us how the user
  // has triaged this sender in the past.
  const similarPromise = senderDomain
    ? supabase
        .from("email_thread_category_corrections")
        .select("to_category")
        .eq("company_id", companyId)
        .eq("sender_domain", senderDomain)
        .limit(200)
    : Promise.resolve({ data: [] } as { data: Array<{ to_category: string }> });

  // 3. Phase C memories keyed to this sender/domain.
  const memoriesPromise = senderDomain
    ? supabase
        .from("agent_memories")
        .select("id, content, created_at")
        .eq("company_id", companyId)
        .or(
          `content.ilike.%${senderDomain}%${senderEmail ? `,content.ilike.%${senderEmail}%` : ""}`
        )
        .order("created_at", { ascending: false })
        .limit(5)
    : Promise.resolve({ data: [] } as {
        data: Array<{ id: string; content: string; created_at: string }>;
      });

  // 4. Linked records.
  const clientPromise = thread.clientId
    ? supabase
        .from("clients")
        .select("name")
        .eq("id", thread.clientId)
        .maybeSingle()
    : Promise.resolve({ data: null } as { data: { name: string } | null });

  const opportunityPromise = thread.opportunityId
    ? supabase
        .from("opportunities")
        .select("display_name, stage")
        .eq("id", thread.opportunityId)
        .maybeSingle()
    : Promise.resolve({ data: null } as {
        data: { display_name: string; stage: string } | null;
      });

  const [senderCount, similar, memories, client, opportunity] = await Promise.all([
    senderCountPromise,
    similarPromise,
    memoriesPromise,
    clientPromise,
    opportunityPromise,
  ]);

  // Tally similar classifications.
  const tally = new Map<EmailThreadCategory, number>();
  for (const row of (similar.data ?? []) as Array<{ to_category: string }>) {
    const cat = row.to_category as EmailThreadCategory;
    tally.set(cat, (tally.get(cat) ?? 0) + 1);
  }
  const similarClassifications = Array.from(tally.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    senderThreadCount:
      "count" in senderCount && typeof senderCount.count === "number"
        ? senderCount.count
        : 0,
    senderLastSeen:
      senderCount.data && senderCount.data[0]?.last_message_at
        ? new Date(senderCount.data[0].last_message_at as string)
        : null,
    similarClassifications,
    memories: (memories.data ?? []).map((m) => ({
      id: m.id as string,
      content: m.content as string,
      createdAt: new Date(m.created_at as string),
    })),
    clientName: client.data?.name ?? null,
    opportunityName: opportunity.data?.display_name ?? null,
    opportunityStage: opportunity.data?.stage ?? null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
  count,
}: {
  icon: React.ComponentType<React.ComponentProps<typeof Users>>;
  label: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-[11px] h-[11px] text-text-mute" strokeWidth={1.75} />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
        {label}
      </span>
      {count !== undefined && (
        <span className="font-mono text-[10px] text-text-mute/70">{count}</span>
      )}
    </div>
  );
}

function computeRate(count: number, firstSeen: Date | null): string {
  if (!firstSeen || count === 0) return "0× / month";
  const months = Math.max(1, (Date.now() - firstSeen.getTime()) / (30 * 86_400_000));
  const rate = count / months;
  if (rate >= 1) return `${rate.toFixed(1)}× / month`;
  return `${(rate * 4.33).toFixed(1)}× / week`;
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export interface ThreadContextPanelProps {
  open: boolean;
  onClose: () => void;
  thread: InboxThreadRow | null;
}

export function ThreadContextPanel({
  open,
  onClose,
  thread,
}: ThreadContextPanelProps) {
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const companyId = useAuthStore((s) => s.company?.id);

  const { data: ctx, isLoading } = useQuery({
    queryKey: ["inbox-v2", "context", thread?.id ?? ""],
    queryFn: () => fetchThreadContext(companyId!, thread!),
    enabled: open && !!companyId && !!thread,
  });

  const senderRate = useMemo(() => {
    if (!ctx) return "—";
    return computeRate(ctx.senderThreadCount, ctx.senderLastSeen);
  }, [ctx]);

  const variants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.12 } },
      }
    : {
        hidden: { width: 0, opacity: 0 },
        visible: {
          width: 320,
          opacity: 1,
          transition: { duration: 0.22, ease: EASE_SMOOTH },
        },
        exit: {
          width: 0,
          opacity: 0,
          transition: { duration: 0.18, ease: EASE_SMOOTH },
        },
      };

  return (
    <AnimatePresence>
      {open && thread && (
        <motion.aside
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
          aria-label="Thread context"
          className="shrink-0 border-l border-border-subtle overflow-hidden"
        >
          <div className="w-[320px] h-full flex flex-col overflow-y-auto scrollbar-hide">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border-subtle">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
                // Context
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close context panel"
                className="text-text-mute hover:text-text-2 transition-colors"
              >
                <X className="w-[14px] h-[14px]" />
              </button>
            </div>

            {/* Body */}
            <div className="p-3 space-y-4">
              {/* Sender snapshot */}
              <div>
                <SectionHeader icon={Users} label="Sender" />
                <p className="font-mohave text-[13px] text-text truncate">
                  {thread.latestSenderName || thread.latestSenderEmail || "Unknown"}
                </p>
                {thread.latestSenderEmail && thread.latestSenderName && (
                  <p className="font-mono text-[11px] text-text-3 mt-0.5 truncate">
                    {thread.latestSenderEmail}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <CategoryChip category={thread.primaryCategory} size="sm" />
                  {thread.categoryManuallySet && (
                    <span className="font-mono text-[10px] text-text-mute uppercase tracking-[0.14em]">
                      Manual
                    </span>
                  )}
                </div>
              </div>

              {/* Phase C insights */}
              <div>
                <SectionHeader icon={Sparkles} label="Phase C insights" />

                {isLoading && (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-[14px] w-[80%] rounded bg-[rgba(255,255,255,0.04)]" />
                    <div className="h-[14px] w-[60%] rounded bg-[rgba(255,255,255,0.03)]" />
                  </div>
                )}

                {!isLoading && ctx && (
                  <div className="space-y-2.5">
                    {/* Sender frequency */}
                    <div className="flex items-start gap-2">
                      <TrendingUp
                        className="w-[11px] h-[11px] text-text-mute shrink-0 mt-[3px]"
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute">
                          Frequency
                        </p>
                        <p className="font-mohave text-[12.5px] text-text-2 mt-0.5">
                          {ctx.senderThreadCount > 0 ? (
                            <>
                              {ctx.senderThreadCount} thread
                              {ctx.senderThreadCount === 1 ? "" : "s"} —{" "}
                              <span className="text-text-3">{senderRate}</span>
                            </>
                          ) : (
                            <span className="text-text-3 italic">
                              First time hearing from this sender.
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Similar classifications */}
                    <div className="flex items-start gap-2">
                      <History
                        className="w-[11px] h-[11px] text-text-mute shrink-0 mt-[3px]"
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute">
                          Past corrections from this domain
                        </p>
                        {ctx.similarClassifications.length === 0 ? (
                          <p className="font-mohave text-[12px] text-text-3 mt-0.5 italic">
                            No prior corrections.
                          </p>
                        ) : (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {ctx.similarClassifications.map((s) => (
                              <span
                                key={s.category}
                                className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded-[3px] border border-border-subtle bg-[rgba(255,255,255,0.03)]"
                              >
                                <span className="font-cakemono font-light uppercase text-[10px] tracking-[0.14em] text-text-2">
                                  {categoryLabel(s.category)}
                                </span>
                                <span className="font-mono text-[10px] text-text-mute tabular-nums">
                                  {s.count}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Memories */}
                    <div className="flex items-start gap-2">
                      <Brain
                        className="w-[11px] h-[11px] text-text-mute shrink-0 mt-[3px]"
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute">
                          What Phase C knows
                        </p>
                        {ctx.memories.length === 0 ? (
                          <p className="font-mohave text-[12px] text-text-3 mt-0.5 italic">
                            Nothing learned yet.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {ctx.memories.map((m) => (
                              <li
                                key={m.id}
                                className="font-mohave text-[12px] text-text-2 leading-snug line-clamp-2"
                              >
                                {m.content}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Linked client */}
              {ctx?.clientName && thread.clientId && (
                <div>
                  <SectionHeader icon={Users} label="Client" />
                  <button
                    type="button"
                    onClick={() => router.push(`/clients/${thread.clientId}`)}
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[5px] border border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-colors text-left"
                  >
                    <Users className="w-[11px] h-[11px] text-text-mute shrink-0" strokeWidth={1.75} />
                    <span className="font-mohave text-[12.5px] text-text truncate flex-1">
                      {ctx.clientName}
                    </span>
                    <ExternalLink className="w-[11px] h-[11px] text-text-mute" strokeWidth={1.75} />
                  </button>
                </div>
              )}

              {/* Linked opportunity */}
              {ctx?.opportunityName && thread.opportunityId && (
                <div>
                  <SectionHeader icon={FolderKanban} label="Opportunity" />
                  <button
                    type="button"
                    onClick={() => router.push(`/pipeline/${thread.opportunityId}`)}
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[5px] border border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] transition-colors text-left"
                  >
                    <FolderKanban
                      className="w-[11px] h-[11px] text-text-mute shrink-0"
                      strokeWidth={1.75}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-[12.5px] text-text truncate">
                        {ctx.opportunityName}
                      </p>
                      {ctx.opportunityStage && (
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute mt-0.5">
                          {ctx.opportunityStage}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="w-[11px] h-[11px] text-text-mute" strokeWidth={1.75} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
