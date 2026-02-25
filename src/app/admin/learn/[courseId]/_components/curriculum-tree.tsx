"use client";

import { useState } from "react";
import type { LearnModuleDetail } from "@/lib/admin/types";

const ASSESSMENT_TYPE_COLORS: Record<string, string> = {
  quiz: "#597794",
  assignment: "#C4A868",
  test: "#9DB582",
};

export function CurriculumTree({ modules }: { modules: LearnModuleDetail[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set(modules.map((m) => m.id)));

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {modules.map((mod) => {
        const isOpen = open.has(mod.id);
        return (
          <div key={mod.id} className="border border-white/[0.08] rounded-lg overflow-hidden">
            {/* Module header */}
            <button
              onClick={() => toggle(mod.id)}
              className="w-full flex items-center justify-between px-6 h-14 bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
            >
              <div>
                <span className="font-mohave text-[14px] text-[#E5E5E5]">{mod.title}</span>
                <span className="ml-3 font-mohave text-[12px] text-[#6B6B6B]">
                  {mod.lessons.length} lessons · {mod.assessments.length} assessments
                </span>
              </div>
              <span className="font-mohave text-[14px] text-[#6B6B6B]">{isOpen ? "−" : "+"}</span>
            </button>

            {/* Items */}
            {isOpen && (
              <div>
                {mod.lessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="flex items-center justify-between px-6 h-10 border-t border-white/[0.05]"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="font-mohave text-[13px] text-[#A0A0A0] truncate">
                        {lesson.title}
                      </span>
                      {lesson.duration_minutes && (
                        <span className="font-kosugi text-[11px] text-[#6B6B6B] shrink-0">
                          {lesson.duration_minutes}m
                        </span>
                      )}
                      {lesson.content_blocks.map((cb, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded font-kosugi text-[9px] uppercase bg-white/[0.05] text-[#6B6B6B]"
                        >
                          {cb.type}
                        </span>
                      ))}
                    </div>
                    <span className="font-kosugi text-[10px] uppercase text-[#6B6B6B] shrink-0">
                      Lesson
                    </span>
                  </div>
                ))}

                {mod.assessments.map((assessment) => (
                  <div
                    key={assessment.id}
                    className="flex items-center justify-between px-6 h-10 border-t border-white/[0.05]"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="font-mohave text-[13px] text-[#A0A0A0] truncate">
                        {assessment.title}
                      </span>
                      <span
                        className="font-kosugi text-[10px] uppercase"
                        style={{ color: ASSESSMENT_TYPE_COLORS[assessment.type] ?? "#6B6B6B" }}
                      >
                        {assessment.type}
                      </span>
                      {assessment.passing_score !== null && (
                        <span className="font-kosugi text-[11px] text-[#6B6B6B]">
                          pass: {assessment.passing_score}%
                        </span>
                      )}
                      <span className="font-kosugi text-[11px] text-[#6B6B6B]">
                        {assessment.question_count}q
                      </span>
                    </div>
                    <span
                      className="font-kosugi text-[10px] uppercase shrink-0"
                      style={{ color: ASSESSMENT_TYPE_COLORS[assessment.type] ?? "#6B6B6B" }}
                    >
                      Assessment
                    </span>
                  </div>
                ))}

                {mod.lessons.length === 0 && mod.assessments.length === 0 && (
                  <div className="px-6 h-10 flex items-center border-t border-white/[0.05]">
                    <span className="font-mohave text-[13px] text-[#6B6B6B]">No content</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
