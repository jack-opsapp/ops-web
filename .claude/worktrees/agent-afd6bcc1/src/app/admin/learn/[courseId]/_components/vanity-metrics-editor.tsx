"use client";

import { useState } from "react";
import type { LearnVanityMetrics } from "@/lib/admin/types";

interface Props {
  courseId: string;
  initial: LearnVanityMetrics;
}

export function VanityMetricsEditor({ courseId, initial }: Props) {
  const [metrics, setMetrics] = useState<LearnVanityMetrics>(initial);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/admin/learn/vanity-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, metrics }),
      });

      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: "success", message: "Saved" });
      } else {
        setFeedback({ type: "error", message: data.error ?? "Save failed" });
      }
    } catch {
      setFeedback({ type: "error", message: "Network error" });
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  }

  return (
    <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Display Enrollments */}
        <div>
          <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Display Enrollments
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={metrics.display_enrollments}
            onChange={(e) => setMetrics({ ...metrics, display_enrollments: parseInt(e.target.value) || 0 })}
            className="w-full bg-white/[0.03] border border-white/[0.08] px-4 py-3 rounded-lg font-mohave text-[14px] text-[#E5E5E5] focus:outline-none focus:border-[#597794] transition-colors"
          />
        </div>

        {/* Display Rating */}
        <div>
          <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Display Rating
          </label>
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={metrics.display_rating}
            onChange={(e) => setMetrics({ ...metrics, display_rating: parseFloat(e.target.value) || 0 })}
            className="w-full bg-white/[0.03] border border-white/[0.08] px-4 py-3 rounded-lg font-mohave text-[14px] text-[#E5E5E5] focus:outline-none focus:border-[#597794] transition-colors"
          />
        </div>

        {/* Display Review Count */}
        <div>
          <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Display Review Count
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={metrics.display_review_count}
            onChange={(e) => setMetrics({ ...metrics, display_review_count: parseInt(e.target.value) || 0 })}
            className="w-full bg-white/[0.03] border border-white/[0.08] px-4 py-3 rounded-lg font-mohave text-[14px] text-[#E5E5E5] focus:outline-none focus:border-[#597794] transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg font-mohave text-[13px] uppercase tracking-wider text-white transition-opacity cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: "#597794" }}
        >
          {saving ? "Saving..." : "Save"}
        </button>

        {feedback && (
          <span
            className="font-mohave text-[13px]"
            style={{ color: feedback.type === "success" ? "#9DB582" : "#93321A" }}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}
