"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { AnalyzedLead } from "@/lib/types/email-import";

const INITIAL_VISIBLE = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
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
  /** Enable E key toggle — only when this thread is inside the focused carousel card */
  keyboardEnabled?: boolean;
}

export function EmailThreadView({
  lead,
  defaultExpanded = false,
  keyboardEnabled = false,
}: EmailThreadViewProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);
  const prefersReduced = useReducedMotion();

  // E key toggles thread when inside focused card
  useEffect(() => {
    if (!keyboardEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setIsExpanded((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardEnabled]);

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

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 font-mohave text-[11px] text-[#555] hover:text-[#999] transition-colors"
      >
        <ChevronDown
          size={11}
          className="transition-transform duration-200"
          style={{ transform: isExpanded ? "rotate(0)" : "rotate(-90deg)" }}
        />
        {isExpanded ? "Hide thread" : "Show thread"}
        <span className="text-[#444]">({sorted.length})</span>
        {keyboardEnabled && (
          <span className="text-[#333] ml-1">[E]</span>
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{
              opacity: 1,
              transition: { duration: dur, ease: EASE_SMOOTH },
            }}
            exit={{
              opacity: 0,
              transition: { duration: prefersReduced ? 0 : 0.15, ease: EASE_SMOOTH },
            }}
            className="mt-2 space-y-3"
          >
            {visible.map((excerpt, i) => (
              <div key={i} className="flex gap-2">
                <span
                  className="font-mohave text-[11px] flex-shrink-0 mt-0.5 select-none"
                  style={{
                    color:
                      excerpt.direction === "inbound" ? "#597794" : "#555",
                  }}
                >
                  {excerpt.direction === "inbound" ? "←" : "→"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mohave text-[11px] text-[#999]">
                      {excerpt.fromName}
                    </span>
                    <span className="font-mohave text-[10px] text-[#444]">
                      {formatRelativeDate(excerpt.date)}
                    </span>
                  </div>
                  <p className="font-mohave text-[11px] text-[#777] leading-[1.5] whitespace-pre-wrap break-words">
                    {excerpt.body}
                  </p>
                </div>
              </div>
            ))}

            {!showAll && hiddenCount > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="font-mohave text-[10px] text-[#597794] hover:text-[#6A88A5] transition-colors ml-4"
              >
                Show older messages ({hiddenCount} more)
              </button>
            )}

            <a
              href={gmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mohave text-[10px] text-[#597794] hover:text-[#6A88A5] transition-colors ml-4"
            >
              View full thread in Gmail
              <ExternalLink size={9} />
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
