import Link from "next/link";
import type { LearnCourseOverview } from "@/lib/admin/types";

const STATUS_COLORS: Record<string, string> = {
  published: "#9DB582",
  draft: "#C4A868",
  archived: "#6B6B6B",
};

function CourseStatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#6B6B6B";
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

export function LearnCourseList({ courses }: { courses: LearnCourseOverview[] }) {
  if (courses.length === 0) {
    return (
      <p className="text-center py-12 font-mohave text-[14px] text-[#6B6B6B]">
        No courses found.
      </p>
    );
  }

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_100px_140px_140px_180px] gap-4 px-6 h-10 items-center bg-white/[0.02] border-b border-white/[0.08]">
        <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B]">Course</p>
        <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B]">Status</p>
        <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] text-right">Content</p>
        <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] text-right">Enrolled</p>
        <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] text-right">Display Metrics</p>
      </div>

      {/* Course rows */}
      {courses.map((course) => {
        const price = course.price_cents === 0
          ? "FREE"
          : `$${(course.price_cents / 100).toFixed(0)}`;

        return (
          <Link
            key={course.id}
            href={`/admin/learn/${course.id}`}
            className="grid grid-cols-[1fr_100px_140px_140px_180px] gap-4 px-6 h-14 items-center border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
          >
            {/* Course name + price */}
            <div className="flex items-center gap-3 min-w-0">
              <p className="font-mohave text-[14px] text-[#E5E5E5] truncate">{course.title}</p>
              <span className="font-mohave text-[12px] text-[#597794] shrink-0">{price}</span>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <CourseStatusDot status={course.status} />
              <span className="font-mohave text-[12px] uppercase text-[#A0A0A0]">{course.status}</span>
            </div>

            {/* Content counts */}
            <p className="font-mohave text-[13px] text-[#A0A0A0] text-right">
              {course.module_count}m · {course.lesson_count}l · {course.assessment_count}a
            </p>

            {/* Real enrollment */}
            <p className="font-mohave text-[13px] text-[#E5E5E5] text-right">
              {course.enrolled_count} <span className="text-[#6B6B6B]">/ {course.completed_count} done</span>
            </p>

            {/* Display metrics */}
            <p className="font-mohave text-[12px] text-[#597794] text-right">
              {course.display_enrollments} · {course.display_rating.toFixed(1)}★ · {course.display_review_count}r
            </p>
          </Link>
        );
      })}
    </div>
  );
}
