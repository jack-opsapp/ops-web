"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { htmlToPlainText } from "@/lib/utils/email-parsing";
import { useDictionary } from "@/i18n/client";
import type { AnalyzedLead } from "@/lib/types/email-import";

const INITIAL_VISIBLE = 3;
const MAX_BODY_CHARS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Most bodies arrive pre-stripped by the provider, but leftover CSS from
// marketing templates (e.g. `.body .primary { ... }`) can slip through if the
// body was stripped by an older build. The regex requires a `;` inside the
// block (CSS property terminator) so inline JSON-like content such as
// `{ tomorrow: 9am, Wed: noon }` is not mistakenly stripped.
const CSS_RULE_BLOCK =
  /[^{}<>\n][^{}<>]{0,300}\{[^{}]*?[a-zA-Z-]+\s*:\s*[^{};]*?;[^{}]*?\}/g;
// After inner rules are removed, wrappers like `@media (...)` and orphan
// braces or Outlook conditional-comment ends remain. Strip those too.
const CSS_NOISE =
  /(?:^|\n)\s*(?:-->|<!--\[if[^\]]*\]>|<!--|\[if[^\]]*\]>|@(?:media|supports|keyframes|font-face|import|charset)[^\n{}]*\{?|\}|\{)/g;

/** Drop orphan CSS rule blocks that weren't wrapped in <style> tags. */
function stripOrphanCss(text: string): string {
  if (!text) return text;
  let out = text;
  // Iterate until stable — handles nested blocks (@media { .x { ... } })
  if (out.includes("{") && out.includes("}")) {
    let prev = "";
    let guard = 0;
    while (out !== prev && guard++ < 5) {
      prev = out;
      out = out.replace(CSS_RULE_BLOCK, "\n");
    }
  }
  out = out.replace(CSS_NOISE, "\n");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Truncate email body: strip HTML, clean signatures and forwarded noise, limit length. */
function cleanBody(raw: string): string {
  let text = stripOrphanCss(htmlToPlainText(raw));

  // If the email is a forward, extract the forwarded content (which is the actual lead info)
  // and discard the owner's brief reply above the fold
  const forwardBoundaries = [
    /\nBegin forwarded message:\s*\n/i,
    /\n-{2,}\s*Forwarded message\s*-{2,}\s*\n/i,
    /\n-{2,}\s*Original Message\s*-{2,}\s*\n/i,
  ];
  for (const pattern of forwardBoundaries) {
    const match = text.match(pattern);
    if (match?.index !== undefined) {
      const afterFold = text.slice(match.index + match[0].length).trim();
      // Strip the forwarded email headers (From:, Date:, To:, Subject:, Reply-To:)
      const headerStripped = afterFold.replace(
        /^(?:From:.*\n|Date:.*\n|To:.*\n|Subject:.*\n|Reply-To:.*\n|Cc:.*\n)+/i,
        ""
      ).trim();
      if (headerStripped.length > 20) {
        text = headerStripped;
        break;
      }
    }
  }

  // Remove mobile signatures and quoted reply markers
  const signaturePatterns = [
    /\nSent from my iPhone[^\n]*/i,
    /\nSent from my iPad[^\n]*/i,
    /\nGet Outlook for[^\n]*/i,
    /\nOn .{10,80} wrote:\s*\n[^\n]*/i,
  ];
  for (const pattern of signaturePatterns) {
    text = text.replace(pattern, "").trim();
  }

  if (text.length > MAX_BODY_CHARS) {
    text = text.slice(0, MAX_BODY_CHARS).trim() + "…";
  }

  return text;
}

export function formatRelativeDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  const months = Math.floor(diffDays / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface EmailThreadViewProps {
  lead: AnalyzedLead;
  /** Additional sibling leads whose threads should be shown alongside the primary */
  siblingLeads?: AnalyzedLead[];
  defaultExpanded?: boolean;
  /** Show [E] hint — only when this thread is inside the focused carousel card */
  keyboardEnabled?: boolean;
  /** Incremented by the carousel when E is pressed — each change toggles expand/collapse */
  toggleSignal?: number;
  /** Notify parent when thread expand/collapse is toggled (click or keyboard) */
  onToggle?: () => void;
}

/** A thread with its excerpts and Gmail link */
interface ThreadGroup {
  threadId: string;
  label: string;
  excerpts: NonNullable<AnalyzedLead["emailExcerpts"]>;
  gmailUrl: string;
}

export function EmailThreadView({
  lead,
  siblingLeads,
  defaultExpanded = false,
  keyboardEnabled = false,
  toggleSignal = 0,
  onToggle,
}: EmailThreadViewProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const prevSignal = useRef(toggleSignal);

  // Toggle when the parent carousel fires the E key signal
  useEffect(() => {
    if (toggleSignal !== prevSignal.current) {
      prevSignal.current = toggleSignal;
      setIsExpanded((prev) => !prev);
    }
  }, [toggleSignal]);
  const [showAll, setShowAll] = useState(false);
  const prefersReduced = useReducedMotion();
  const { t } = useDictionary("import-wizard");

  // Build thread groups: primary lead's thread + any sibling threads
  const threads: ThreadGroup[] = useMemo(() => {
    const result: ThreadGroup[] = [];
    const seenThreadIds = new Set<string>();

    // Primary lead's thread
    if (lead.emailExcerpts?.length) {
      seenThreadIds.add(lead.threadId);
      result.push({
        threadId: lead.threadId,
        label: lead.emails?.[0]?.subject || "Thread 1",
        excerpts: lead.emailExcerpts,
        gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${lead.threadId}`,
      });
    }

    // Sibling leads' threads
    if (siblingLeads) {
      for (const sibling of siblingLeads) {
        if (sibling.id === lead.id) continue;
        if (seenThreadIds.has(sibling.threadId)) continue;
        if (!sibling.emailExcerpts?.length) continue;
        seenThreadIds.add(sibling.threadId);
        result.push({
          threadId: sibling.threadId,
          label: sibling.emails?.[0]?.subject || `Thread ${result.length + 1}`,
          excerpts: sibling.emailExcerpts,
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${sibling.threadId}`,
        });
      }
    }

    return result;
  }, [lead, siblingLeads]);

  // Flatten all excerpts for the single-thread legacy path and total count
  const allExcerpts = useMemo(
    () => threads.flatMap((t) => t.excerpts).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    ),
    [threads]
  );

  if (allExcerpts.length === 0) return null;

  const hasMultipleThreads = threads.length > 1;
  const totalExcerptCount = allExcerpts.length;

  // For single thread: use flat view (original behavior)
  // For multiple threads: group by thread (2 per thread when collapsed)
  const MULTI_THREAD_PER = 2;
  const visible = showAll ? allExcerpts : allExcerpts.slice(0, INITIAL_VISIBLE);
  const visibleInMultiThread = hasMultipleThreads
    ? threads.reduce((sum, t) => sum + Math.min(t.excerpts.length, MULTI_THREAD_PER), 0)
    : INITIAL_VISIBLE;
  const hiddenCount = hasMultipleThreads
    ? totalExcerptCount - visibleInMultiThread
    : totalExcerptCount - INITIAL_VISIBLE;
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${lead.threadId}`;

  const dur = prefersReduced ? 0 : 0.2;

  // Compact inline preview (shown when collapsed) — most recent message
  const latestExcerpt = allExcerpts[0];
  const previewText = latestExcerpt ? cleanBody(latestExcerpt.body) : "";

  return (
    <div>
      {/* Toggle button + inline preview when collapsed */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); onToggle?.(); }}
        className="flex items-start gap-1.5 font-mohave text-[13px] text-[#666] hover:text-[#999] transition-colors text-left w-full"
      >
        <ChevronDown
          size={12}
          className="transition-transform duration-200 mt-0.5 flex-shrink-0"
          style={{ transform: isExpanded ? "rotate(0)" : "rotate(-90deg)" }}
        />
        <span className="flex-1 min-w-0">
          {isExpanded ? (
            <span>{t("thread.hide")} <span className="text-[#444]">({totalExcerptCount}{hasMultipleThreads ? ` · ${threads.length} threads` : ""})</span></span>
          ) : (
            <span className="text-[#777] line-clamp-2">
              {previewText || `${t("thread.show")} (${totalExcerptCount})`}
              {hasMultipleThreads && <span className="text-[#555]"> · {threads.length} threads</span>}
            </span>
          )}
        </span>
        {keyboardEnabled && (
          <span className="text-[#333] ml-1 flex-shrink-0">[E]</span>
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={prefersReduced ? false : { height: 0, opacity: 0 }}
            animate={{
              height: "auto",
              opacity: 1,
              transition: {
                height: { duration: 0.35, ease: EASE_SMOOTH },
                opacity: { duration: 0.25, ease: EASE_SMOOTH, delay: 0.08 },
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                opacity: { duration: prefersReduced ? 0 : 0.12, ease: EASE_SMOOTH },
                height: { duration: 0.25, ease: EASE_SMOOTH, delay: 0.08 },
              },
            }}
            className="mt-2 space-y-3 ml-4 overflow-hidden"
          >
            {hasMultipleThreads ? (
              /* ── Multi-thread grouped view ── */
              threads.map((thread, ti) => {
                const threadExcerpts = [...thread.excerpts].sort(
                  (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
                );
                const threadVisible = showAll ? threadExcerpts : threadExcerpts.slice(0, MULTI_THREAD_PER);
                return (
                  <div key={thread.threadId} className={ti > 0 ? "mt-2 pt-2 border-t border-white/[0.06]" : ""}>
                    {/* Thread label */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-kosugi text-micro tracking-[0.1em] uppercase text-[#555]">
                        Thread {ti + 1} · {threadExcerpts.length} emails
                      </span>
                      <a
                        href={thread.gmailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-mohave text-[11px] text-[#6F94B0] hover:text-[#6A88A5] transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Gmail
                        <ExternalLink size={9} />
                      </a>
                    </div>
                    {/* Excerpts */}
                    {threadVisible.map((excerpt, i) => (
                      <ExcerptRow key={`${thread.threadId}-${i}`} excerpt={excerpt} index={ti * 3 + i} prefersReduced={prefersReduced} />
                    ))}
                  </div>
                );
              })
            ) : (
              /* ── Single-thread flat view ── */
              <>
                {visible.map((excerpt, i) => (
                  <ExcerptRow key={i} excerpt={excerpt} index={i} prefersReduced={prefersReduced} />
                ))}
              </>
            )}

            {!showAll && hiddenCount > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="font-mohave text-[12px] text-[#6F94B0] hover:text-[#6A88A5] transition-colors"
              >
                {t("thread.showOlder")} ({hiddenCount} {t("thread.more")})
              </button>
            )}

            {!hasMultipleThreads && (
              <a
                href={gmailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mohave text-[12px] text-[#6F94B0] hover:text-[#6A88A5] transition-colors"
              >
                {t("thread.viewInGmail")}
                <ExternalLink size={10} />
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Excerpt row ──────────────────────────────────────────────────────────────

function ExcerptRow({
  excerpt,
  index,
  prefersReduced,
}: {
  excerpt: NonNullable<AnalyzedLead["emailExcerpts"]>[number];
  index: number;
  prefersReduced: boolean | null;
}) {
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH, delay: prefersReduced ? 0 : 0.1 + index * 0.04 }}
      className="flex gap-2"
    >
      <span
        className="font-mohave text-[13px] flex-shrink-0 mt-0.5 select-none"
        style={{ color: excerpt.direction === "inbound" ? "#6F94B0" : "#777" }}
      >
        {excerpt.direction === "inbound" ? "←" : "→"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mohave text-[13px] text-[#bbb]">
            {excerpt.fromName}
          </span>
          <span className="font-mohave text-[12px] text-[#666]">
            {formatRelativeDate(excerpt.date)}
          </span>
        </div>
        <p className="font-mohave text-[13px] text-[#999] leading-[1.5] whitespace-pre-wrap break-words">
          {cleanBody(excerpt.body)}
        </p>
      </div>
    </motion.div>
  );
}
