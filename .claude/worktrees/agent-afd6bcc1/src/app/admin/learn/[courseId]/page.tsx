import { notFound } from "next/navigation";
import Link from "next/link";
import { getLearnCourseDetail, getLearnCourseAnalytics } from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../../_components/admin-page-header";
import { StatCard } from "../../_components/stat-card";
import { CurriculumTree } from "./_components/curriculum-tree";
import { AnalyticsSection } from "./_components/analytics-section";
import { VanityMetricsEditor } from "./_components/vanity-metrics-editor";

export default async function LearnCourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;

  let course, analytics;
  try {
    [course, analytics] = await Promise.all([
      getLearnCourseDetail(courseId),
      getLearnCourseAnalytics(courseId),
    ]);
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Course Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  if (!course) notFound();

  const price = course.price_cents === 0 ? "FREE" : `$${(course.price_cents / 100).toFixed(0)}`;

  return (
    <div>
      <AdminPageHeader title={course.title} caption={`${course.status} · ${price}`} />

      <div className="p-8 space-y-10">
        {/* Back link */}
        <Link
          href="/admin/learn"
          className="inline-flex items-center gap-1.5 font-mohave text-[13px] text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          ← All Courses
        </Link>

        {/* Enrollment KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Enrolled" value={analytics.enrollment.total} />
          <StatCard label="Active" value={analytics.enrollment.active} />
          <StatCard label="Completed" value={analytics.enrollment.completed} />
          <StatCard
            label="Completion Rate"
            value={`${analytics.enrollment.completion_rate}%`}
          />
        </div>

        {/* Section: Curriculum */}
        <section>
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Curriculum
          </p>
          <CurriculumTree modules={course.modules} />
        </section>

        {/* Section: Analytics */}
        <section>
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Analytics
          </p>
          <AnalyticsSection analytics={analytics} />
        </section>

        {/* Section: Display Metrics */}
        <section>
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Display Metrics
          </p>
          <VanityMetricsEditor
            courseId={course.id}
            initial={{
              display_enrollments: course.display_enrollments,
              display_rating: course.display_rating,
              display_review_count: course.display_review_count,
            }}
          />
        </section>
      </div>
    </div>
  );
}
