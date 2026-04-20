"use client";

/**
 * PhaseCStatusStrip — thin banner at the top of the thread view that
 * surfaces what Phase C has done (or is about to do) on this thread.
 *
 * States (priority top → bottom):
 *   1. auto_drafted          — Phase C generated a reply; user should review.
 *   2. auto_sent              — Phase C already replied autonomously.
 *   3. monitoring_graduating  — Category is close to auto-send threshold.
 *   4. monitoring             — Drafting only (autonomy == auto_draft).
 *   5. auto_archiving         — Category autonomy is auto_archive.
 *   6. auto_following_up      — Category autonomy is auto_follow_up (LEADs).
 *   7. hidden                 — autonomy = off / draft_on_request.
 *
 * Click "Review" when a draft is pending to open the reply bar prefilled.
 * Click "Adjust" to open /settings/email-category-autonomy.
 */

import { useMemo } from "react";
import Link from "next/link";
import { Sparkles, CheckCircle2, Archive, Timer, Gauge } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type {
  EmailThreadAutonomyLevel,
  EmailThreadCategory,
} from "@/lib/types/email-thread";
import { categoryLabel } from "./category-chip";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PhaseCStripState =
  | "hidden"
  | "auto_drafted"
  | "auto_sent"
  | "monitoring"
  | "monitoring_graduating"
  | "auto_archiving"
  | "auto_following_up";

export interface PhaseCStripMeta {
  state: PhaseCStripState;
  category: EmailThreadCategory;
  /** For auto_sent — how long ago in ms. */
  sentAgoMs?: number;
  /** For monitoring_graduating — approval rate 0..1. */
  approvalRate?: number;
  /** For monitoring_graduating — sample size. */
  sampleSize?: number;
}

export interface PhaseCStatusStripProps {
  state: PhaseCStripState;
  category: EmailThreadCategory;
  autonomyLevel?: EmailThreadAutonomyLevel;
  sentAgoMs?: number;
  approvalRate?: number;
  sampleSize?: number;
  onReviewDraft?: () => void;
  onViewSent?: () => void;
  /** True if the current user has permission to configure Phase C. */
  canConfigure?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAgo(ms: number | undefined): string {
  if (!ms || ms <= 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/** Compute strip state from autonomy + runtime flags. Pure, testable. */
export function computePhaseCStripState(input: {
  autonomyLevel: EmailThreadAutonomyLevel | undefined;
  hasAutoDraft: boolean;
  hasAutoSent: boolean;
  approvalRate?: number;
  sampleSize?: number;
}): PhaseCStripState {
  const { autonomyLevel, hasAutoDraft, hasAutoSent, approvalRate, sampleSize } = input;

  if (hasAutoDraft) return "auto_drafted";
  if (hasAutoSent) return "auto_sent";

  switch (autonomyLevel) {
    case "auto_archive":
      return "auto_archiving";
    case "auto_follow_up":
      return "auto_following_up";
    case "auto_send":
      // With AUTO_SEND set but nothing drafted or sent yet, show monitoring — Phase C
      // will generate+send on the next inbound message.
      return "monitoring";
    case "auto_draft": {
      if (
        approvalRate !== undefined &&
        approvalRate >= 0.95 &&
        sampleSize !== undefined &&
        sampleSize >= 20
      ) {
        return "monitoring_graduating";
      }
      return "monitoring";
    }
    case "draft_on_request":
    case "off":
    default:
      return "hidden";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhaseCStatusStrip({
  state,
  category,
  sentAgoMs,
  approvalRate,
  sampleSize,
  onReviewDraft,
  onViewSent,
  canConfigure = false,
}: PhaseCStatusStripProps) {
  const content = useMemo(() => {
    switch (state) {
      case "auto_drafted":
        return {
          Icon: Sparkles,
          tone: "accent" as const,
          primary: "Phase C drafted a reply for you",
          secondary: "Review before it sends.",
          actionLabel: "Review draft",
          actionOnClick: onReviewDraft,
        };
      case "auto_sent":
        return {
          Icon: CheckCircle2,
          tone: "success" as const,
          primary: `Phase C replied ${formatAgo(sentAgoMs)}`,
          secondary: "Autonomous send — you can still follow up.",
          actionLabel: "View sent",
          actionOnClick: onViewSent,
        };
      case "monitoring_graduating": {
        const pct = approvalRate ? Math.round(approvalRate * 100) : 95;
        const n = sampleSize ?? 20;
        return {
          Icon: Gauge,
          tone: "attention" as const,
          primary: `Phase C is ready to auto-respond to ${categoryLabel(category)}`,
          secondary: `${pct}% approval over ${n} drafts. Confirm to graduate.`,
          actionLabel: canConfigure ? "Graduate" : "View",
          actionOnClick: undefined,
          linkTo: "/settings/email-category-autonomy",
        };
      }
      case "monitoring":
        return {
          Icon: Sparkles,
          tone: "neutral" as const,
          primary: `Phase C is monitoring ${categoryLabel(category)} threads`,
          secondary: "Drafts only — nothing sends until you approve.",
          actionLabel: canConfigure ? "Adjust" : undefined,
          actionOnClick: undefined,
          linkTo: canConfigure ? "/settings/email-category-autonomy" : undefined,
        };
      case "auto_archiving":
        return {
          Icon: Archive,
          tone: "neutral" as const,
          primary: `Auto-archiving ${categoryLabel(category)} threads`,
          secondary: "Nothing will live in your inbox long.",
          actionLabel: canConfigure ? "Adjust" : undefined,
          linkTo: canConfigure ? "/settings/email-category-autonomy" : undefined,
        };
      case "auto_following_up":
        return {
          Icon: Timer,
          tone: "neutral" as const,
          primary: "Auto follow-up on quiet leads",
          secondary: "Phase C nudges when a lead goes cold.",
          actionLabel: canConfigure ? "Adjust" : undefined,
          linkTo: canConfigure ? "/settings/email-category-autonomy" : undefined,
        };
      default:
        return null;
    }
  }, [state, category, sentAgoMs, approvalRate, sampleSize, onReviewDraft, onViewSent, canConfigure]);

  if (!content || state === "hidden") return null;

  const { Icon, tone, primary, secondary, actionLabel, actionOnClick } = content;
  const linkTo = "linkTo" in content ? (content as { linkTo?: string }).linkTo : undefined;

  const toneClasses: Record<typeof tone, string> = {
    accent: "border-[rgba(111,148,176,0.30)] bg-[rgba(111,148,176,0.06)]",
    success: "border-[rgba(157,181,130,0.26)] bg-[rgba(157,181,130,0.05)]",
    attention: "border-[rgba(196,168,104,0.28)] bg-[rgba(196,168,104,0.06)]",
    neutral: "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]",
  };
  const iconTone: Record<typeof tone, string> = {
    accent: "text-ops-accent",
    success: "text-olive",
    attention: "text-tan",
    neutral: "text-text-2",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 border-b",
        toneClasses[tone]
      )}
      role="status"
    >
      <div
        className={cn(
          "w-[22px] h-[22px] rounded-[4px] flex items-center justify-center shrink-0 bg-[rgba(255,255,255,0.04)]"
        )}
      >
        <Icon className={cn("w-[13px] h-[13px]", iconTone[tone])} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text">
          {primary}
        </p>
        <p className="font-mohave text-[12px] text-text-2 truncate">{secondary}</p>
      </div>

      {actionLabel && actionOnClick && (
        <button
          type="button"
          onClick={actionOnClick}
          className={cn(
            "shrink-0 px-2.5 py-1 rounded-[5px] border border-[rgba(255,255,255,0.14)]",
            "bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)]",
            "font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text-2 hover:text-text",
            "transition-colors duration-150"
          )}
        >
          {actionLabel}
        </button>
      )}

      {actionLabel && linkTo && !actionOnClick && (
        <Link
          href={linkTo}
          className={cn(
            "shrink-0 px-2.5 py-1 rounded-[5px] border border-[rgba(255,255,255,0.14)]",
            "bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)]",
            "font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text-2 hover:text-text",
            "transition-colors duration-150"
          )}
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
