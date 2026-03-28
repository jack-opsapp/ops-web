"use client";

import { useSortState } from "../../../_components/sortable-table-header";
import type { LearnCourseAnalytics, LearnAssessmentStats } from "@/lib/admin/types";

export function AnalyticsSection({ analytics }: { analytics: LearnCourseAnalytics }) {
  const { enrollment, lesson_progress, assessment_stats } = analytics;
  const hasData = enrollment.total > 0;

  if (!hasData) {
    return (
      <p className="text-center py-8 font-mohave text-[14px] text-[#6B6B6B]">
        No enrollment data yet.
      </p>
    );
  }

  const maxStarted = Math.max(...lesson_progress.map((l) => l.started_count), 1);

  return (
    <div className="space-y-8">
      {/* Lesson drop-off */}
      {lesson_progress.length > 0 && (
        <div>
          <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-3">
            Lesson Drop-off
          </p>
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02] space-y-2">
            {lesson_progress.map((lp) => (
              <div key={lp.lesson_id} className="flex items-center gap-4">
                <span
                  className="w-44 shrink-0 truncate font-mohave text-[12px] text-[#A0A0A0]"
                  title={lp.lesson_title}
                >
                  {lp.lesson_title}
                </span>
                <div className="flex-1 h-5 bg-white/[0.03] rounded overflow-hidden relative">
                  {/* Started bar */}
                  <div
                    className="absolute inset-y-0 left-0 rounded"
                    style={{
                      width: `${(lp.started_count / maxStarted) * 100}%`,
                      backgroundColor: "rgba(89, 119, 148, 0.25)",
                    }}
                  />
                  {/* Completed bar */}
                  <div
                    className="absolute inset-y-0 left-0 rounded"
                    style={{
                      width: `${(lp.completed_count / maxStarted) * 100}%`,
                      backgroundColor: "#597794",
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-kosugi text-[11px] text-[#6B6B6B]">
                  {lp.completed_count}/{lp.started_count}
                </span>
              </div>
            ))}
            <div className="flex gap-4 pt-2 font-kosugi text-[10px] text-[#6B6B6B]">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2 rounded" style={{ backgroundColor: "#597794" }} /> Completed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2 rounded" style={{ backgroundColor: "rgba(89, 119, 148, 0.25)" }} /> Started
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Assessment performance table */}
      {assessment_stats.length > 0 && (
        <AssessmentTable stats={assessment_stats} />
      )}
    </div>
  );
}

function AssessmentTable({ stats }: { stats: LearnAssessmentStats[] }) {
  const sort = useSortState("submission_count");
  const sorted = sort.sorted(stats);

  return (
    <div>
      <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        Assessment Performance
      </p>
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_100px_100px_100px] gap-4 px-6 h-10 items-center bg-white/[0.02] border-b border-white/[0.08]">
          {([
            { key: "assessment_title", label: "Assessment" },
            { key: "type", label: "Type" },
            { key: "submission_count", label: "Submissions" },
            { key: "pass_rate", label: "Pass Rate" },
            { key: "avg_score", label: "Avg Score" },
          ] as const).map((col) => (
            <p
              key={col.label}
              className={`font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] inline-flex items-center gap-1 ${
                col.key ? "cursor-pointer select-none hover:text-[#A0A0A0]" : ""
              } ${col.key !== "assessment_title" && col.key !== "type" ? "justify-end" : ""}`}
              onClick={() => sort.toggle(col.key)}
            >
              {col.label}
              {sort.sort.key === col.key && (
                <span className="text-[#597794]">{sort.sort.dir === "asc" ? "↑" : "↓"}</span>
              )}
            </p>
          ))}
        </div>
        {sorted.map((a) => (
          <div
            key={a.assessment_id}
            className="grid grid-cols-[1fr_80px_100px_100px_100px] gap-4 px-6 h-10 items-center border-b border-white/[0.05] last:border-0"
          >
            <p className="font-mohave text-[13px] text-[#E5E5E5] truncate">{a.assessment_title}</p>
            <p className="font-mohave text-[12px] uppercase text-[#A0A0A0]">{a.type}</p>
            <p className="font-mohave text-[13px] text-[#E5E5E5] text-right">{a.submission_count}</p>
            <p className="font-mohave text-[13px] text-[#E5E5E5] text-right">{a.pass_rate}%</p>
            <p className="font-mohave text-[13px] text-[#E5E5E5] text-right">{a.avg_score}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
