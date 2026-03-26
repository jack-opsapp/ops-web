"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";
import type { AnalyzedLead } from "@/lib/types/email-import";

const INITIAL_VISIBLE = 3;
const MAX_BODY_CHARS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities. Returns plain text only. */
function stripHtml(raw: string): string {
  if (!raw || !raw.includes("<")) return raw;
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x200[cdef];/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

/** Truncate email body: strip HTML, clean signatures and forwarded noise, limit length. */
function cleanBody(raw: string): string {
  let text = stripHtml(raw);

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
    /\nSent from my iPhone.*/is,
    /\nSent from my iPad.*/is,
    /\nGet Outlook for.*/is,
    /\nOn .{10,80} wrote:\s*\n.*/is,
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
  defaultExpanded?: boolean;
  /** Show [E] hint — only when this thread is inside the focused carousel card */
  keyboardEnabled?: boolean;
  /** Incremented by the carousel when E is pressed — each change toggles expand/collapse */
  toggleSignal?: number;
  /** Notify parent when thread expand/collapse is toggled (click or keyboard) */
  onToggle?: () => void;
}

export function EmailThreadView({
  lead,
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

  // E key toggle is handled by the carousel's onKeyDown and passed via onToggleThread prop
  // (no DOM query needed — works reliably inside Radix Dialog portals)

  const excerpts = lead.emailExcerpts ?? [];

  const sorted = useMemo(
    () =>
      [...excerpts].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [excerpts]
  );

  if (sorted.length === 0) return null;

  const visible = showAll ? sorted : sorted.slice(0, INITIAL_VISIBLE);
  const hiddenCount = sorted.length - INITIAL_VISIBLE;
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${lead.threadId}`;

  const dur = prefersReduced ? 0 : 0.2;

  // Compact inline preview (shown when collapsed) — most recent message
  const latestExcerpt = sorted[0];
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
            <span>{t("thread.hide")} <span className="text-[#444]">({sorted.length})</span></span>
          ) : (
            <span className="text-[#777] line-clamp-2">
              {previewText || `${t("thread.show")} (${sorted.length})`}
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
              transition: { height: { duration: 0.3, ease: EASE_SMOOTH }, opacity: { duration: dur, ease: EASE_SMOOTH, delay: 0.05 } },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { opacity: { duration: prefersReduced ? 0 : 0.1, ease: EASE_SMOOTH }, height: { duration: 0.25, ease: EASE_SMOOTH, delay: 0.05 } },
            }}
            className="mt-2 space-y-3 ml-4 overflow-hidden"
          >
            {visible.map((excerpt, i) => (
              <div key={i} className="flex gap-2">
                <span
                  className="font-mohave text-[13px] flex-shrink-0 mt-0.5 select-none"
                  style={{
                    color:
                      excerpt.direction === "inbound" ? "#597794" : "#777",
                  }}
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
              </div>
            ))}

            {!showAll && hiddenCount > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="font-mohave text-[12px] text-[#597794] hover:text-[#6A88A5] transition-colors"
              >
                {t("thread.showOlder")} ({hiddenCount} {t("thread.more")})
              </button>
            )}

            <a
              href={gmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mohave text-[12px] text-[#597794] hover:text-[#6A88A5] transition-colors"
            >
              {t("thread.viewInGmail")}
              <ExternalLink size={10} />
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
