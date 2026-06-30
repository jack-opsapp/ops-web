"use client";

import { useDictionary } from "@/i18n/client";
import type { HeldReviewView } from "./held-review";

export interface HeldReviewBannerProps {
  view: HeldReviewView;
}

/**
 * Phase 3 — the held-for-review banner mounted below the detail header when the
 * deterministic router held a thread (routing='require_human_review'). Explains
 * WHY in plain language, shows that auto-reply is paused + the confidence, and
 * reassures the operator that OPS won't send on its own. Manual reply stays fully
 * available below — the operator IS the review. Tan earth-tone (caution/hold),
 * not red — this is a considered stand-down, not an error.
 */
export function HeldReviewBanner({ view }: HeldReviewBannerProps) {
  const { t } = useDictionary("inbox");
  if (!view.held) return null;

  const reason = view.reasons[0] ?? t("held.defaultReason", "This thread needs a human before OPS replies.");

  return (
    <div
      data-testid="held-review-banner"
      role="status"
      className="shrink-0 border-b border-line bg-transparent px-3 py-2.5"
    >
      <div className="rounded-panel border border-tan/30 bg-tan/[0.06] px-3.5 py-3">
        <div
          className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-tan"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {t("held.title", "// HELD FOR REVIEW")}
        </div>

        <p className="font-mohave text-[14px] leading-snug text-text">{reason}</p>

        {view.reasons.length > 1 && (
          <ul className="mt-1.5 space-y-0.5">
            {view.reasons.slice(1).map((r, i) => (
              <li key={i} className="font-mohave text-[13px] leading-snug text-text-2">
                {r}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span
            className="rounded-chip border border-tan/25 bg-tan/[0.08] px-[6px] py-[1px] font-mono text-[11px] uppercase tracking-[0.10em] text-tan"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {t("held.paused", "[ auto-reply paused ]")}
          </span>
          {view.confidenceLabel && (
            <span
              className="rounded-chip border border-line px-[6px] py-[1px] font-mono text-[11px] uppercase tracking-[0.10em] text-text-3"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {t("held.confidence", "[ confidence {pct} ]").replace("{pct}", view.confidenceLabel)}
            </span>
          )}
        </div>

        <p className="mt-2.5 border-t border-line pt-2 font-mohave text-[13px] leading-snug text-text-2">
          {t("held.directive", "Reply once you've confirmed who this is. OPS won't send on its own until you do.")}
        </p>
      </div>
    </div>
  );
}
