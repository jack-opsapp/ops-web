import { getLearnCourseList } from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { LearnCourseList } from "./_components/learn-course-list";

export default async function LearnPage() {
  let courses;
  try {
    courses = await getLearnCourseList();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Learn Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  const totalCourses = courses.length;
  const totalEnrolled = courses.reduce((acc, c) => acc + c.enrolled_count, 0);
  const totalCompleted = courses.reduce((acc, c) => acc + c.completed_count, 0);
  const totalLessons = courses.reduce((acc, c) => acc + c.lesson_count, 0);

  return (
    <div>
      <AdminPageHeader title="OPS Learn" caption={`${totalCourses} courses · ${totalLessons} lessons`} />

      <div className="p-8 space-y-8">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Courses" value={totalCourses} />
          <StatCard label="Total Enrolled" value={totalEnrolled} />
          <StatCard label="Total Completed" value={totalCompleted} />
          <StatCard
            label="Completion Rate"
            value={totalEnrolled > 0 ? `${Math.round((totalCompleted / totalEnrolled) * 100)}%` : "—"}
          />
        </div>

        {/* Course list */}
        <LearnCourseList courses={courses} />
      </div>
    </div>
  );
}
