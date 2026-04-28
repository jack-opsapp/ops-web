"use client";

/**
 * OPS Admin — PMF AdSpendForm
 *
 * Manual entry for ad spend totals by month. Posts to
 * /api/admin/pmf/ad-spend which evenly splits the monthly total across
 * the days in the month and upserts into ad_spend_log on
 * (channel, spend_date) — re-submitting the same month overwrites.
 *
 * google_ads is INTENTIONALLY OMITTED from the channel dropdown:
 * Task 14's daily cron auto-syncs that channel from the Google Ads
 * API. Manual entry is for meta_ads / apple_search_ads / other where
 * we don't (yet) have automated ingestion.
 *
 * The user enters spend in USD; we convert to cents at submit time
 * with Math.round(Number(input) * 100). This handles "100.50" → 10050
 * cleanly without float drift on common decimal inputs.
 *
 * Status messaging is tactical: "SYS :: SAVED" on success, "// ERROR"
 * on failure. The SAVE button is disabled while in flight.
 */
import { useState } from "react";
import { PmfCard } from "@/components/pmf/ui/card";
import { PmfButton } from "@/components/pmf/ui/button";
import type { AdChannel } from "@/lib/pmf/types";

const CHANNELS: { value: AdChannel; label: string }[] = [
  { value: "meta_ads", label: "META ADS" },
  { value: "apple_search_ads", label: "APPLE SEARCH ADS" },
  { value: "other", label: "OTHER" },
];

export function AdSpendForm() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/pmf/ad-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: fd.get("channel"),
        month: fd.get("month"),
        spend_cents: Math.round(Number(fd.get("spend_usd")) * 100),
      }),
    });
    setStatus(res.ok ? "saved" : "error");
  }

  return (
    <PmfCard className="max-w-[480px]">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">
            CHANNEL
          </span>
          <select name="channel" required className="pmf-input">
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">
            MONTH
          </span>
          <input name="month" type="month" required className="pmf-input" />
        </label>
        <label className="block">
          <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">
            SPEND (USD)
          </span>
          <input
            name="spend_usd"
            type="number"
            min={0}
            step="0.01"
            required
            className="pmf-input"
          />
        </label>
        <div className="flex items-center justify-between">
          <PmfButton
            type="submit"
            variant="primary"
            disabled={status === "saving"}
          >
            {status === "saving" ? "SAVING" : "SAVE"}
          </PmfButton>
          {status === "saved" && (
            <span className="font-mono text-[11px] text-[color:var(--olive)]">
              SYS :: SAVED
            </span>
          )}
          {status === "error" && (
            <span className="font-mono text-[11px] text-[color:var(--rose)]">
              {"// ERROR"}
            </span>
          )}
        </div>
      </form>
    </PmfCard>
  );
}
