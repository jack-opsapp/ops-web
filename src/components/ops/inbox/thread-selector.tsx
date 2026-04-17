"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EmailThread {
  threadId: string;
  subject: string;
  latestTimestamp: Date;
}

interface ThreadSelectorProps {
  threads: EmailThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * Thread selector toolbar — appears when EMAIL filter is active and there
 * are 2+ threads. Shows subject tabs inline; collapses to a dropdown
 * when tabs would overflow the available width.
 */
export function ThreadSelector({
  threads,
  selectedThreadId,
  onSelect,
}: ThreadSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // ─── Overflow detection ────────────────────────────────────────────────

  const checkOverflow = useCallback(() => {
    const container = containerRef.current;
    const tabs = tabsRef.current;
    if (!container || !tabs) return;

    // If tabs scrollWidth exceeds container width, collapse
    const shouldCollapse = tabs.scrollWidth > container.clientWidth + 4;
    setCollapsed(shouldCollapse);
  }, []);

  useEffect(() => {
    checkOverflow();
    const ro = new ResizeObserver(checkOverflow);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [checkOverflow, threads.length]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  // Don't render for 0-1 threads
  if (threads.length <= 1) return null;

  const selectedThread = threads.find((t) => t.threadId === selectedThreadId);

  // ─── Truncate subject ──────────────────────────────────────────────────

  function truncateSubject(subject: string, maxLen: number): string {
    if (!subject) return "No subject";
    // Strip common prefixes
    const cleaned = subject.replace(/^(?:Re:\s*|Fwd:\s*)+/i, "").trim();
    if (!cleaned) return subject.slice(0, maxLen);
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "…" : cleaned;
  }

  // ─── Collapsed: dropdown mode ──────────────────────────────────────────

  if (collapsed) {
    return (
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-[5px] rounded-[5px] max-w-[220px]",
            "glass-surface text-text-2",
            "hover:bg-[rgba(255,255,255,0.04)] hover:text-text transition-colors cursor-pointer"
          )}
        >
          <span className="font-mohave text-caption-sm truncate">
            {selectedThread ? truncateSubject(selectedThread.subject, 28) : "Select thread"}
          </span>
          <ChevronDown
            className={cn(
              "w-3 h-3 text-text-mute shrink-0 transition-transform duration-150",
              dropdownOpen && "rotate-180"
            )}
          />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 z-[1000] min-w-[240px] max-w-[320px] py-1 glass-dense">
            {threads.map((thread) => {
              const isActive = thread.threadId === selectedThreadId;
              return (
                <button
                  key={thread.threadId}
                  onClick={() => {
                    onSelect(thread.threadId);
                    setDropdownOpen(false);
                  }}
                  className={cn(
                    "relative w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-150 cursor-pointer rounded-[6px]",
                    isActive
                      ? "bg-[rgba(255,255,255,0.04)] text-text"
                      : "text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.04)]"
                  )}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 top-[8px] bottom-[8px] w-[2px] bg-text-2 rounded-[1px]"
                    />
                  )}
                  {isActive && <Check className="w-3 h-3 shrink-0 text-text" />}
                  <span className={cn("font-mohave text-caption-sm truncate", !isActive && "ml-5")}>
                    {truncateSubject(thread.subject, 40)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Expanded: tab mode ────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="overflow-hidden">
      <div
        ref={tabsRef}
        className="inline-flex items-center gap-[8px] px-[6px] py-[2px] glass-surface whitespace-nowrap"
      >
        {threads.map((thread, i) => {
          const isActive = thread.threadId === selectedThreadId;
          return (
            <div key={thread.threadId} className="flex items-center gap-[8px]">
              {i > 0 && <div className="w-[1px] h-[18px] bg-border-subtle" />}
              <button
                onClick={() => onSelect(thread.threadId)}
                className={cn(
                  "relative px-[8px] py-[5px] rounded-[5px] transition-colors duration-150 cursor-pointer",
                  isActive
                    ? "text-text bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.18)]"
                    : "text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.04)] border border-transparent"
                )}
              >
                <span className="font-mohave text-caption-sm">
                  {truncateSubject(thread.subject, 32)}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
