import { notFound } from "next/navigation";
import { getProjectDetail, withIntakeSignedUrls } from "@/lib/admin/spec-queries";
import { ProjectDetail } from "@/components/admin/spec/project-detail/ProjectDetail";

export const dynamic = "force-dynamic";

interface PageParams {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}

const TAB_KEYS = [
  "overview",
  "timeline",
  "intake",
  "scope",
  "milestones",
  "change_orders",
  "satisfaction",
  "tickets",
  "comms",
  "entitlements",
  "notes",
] as const;

type TabKey = (typeof TAB_KEYS)[number];

function normalizeTab(raw: string | undefined): TabKey {
  if (!raw) return "overview";
  return (TAB_KEYS as readonly string[]).includes(raw) ? (raw as TabKey) : "overview";
}

export default async function SpecProjectDetailPage({ params, searchParams }: PageParams) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
  const activeTab = normalizeTab(sp.tab);

  const snapshot = await getProjectDetail(id);
  if (!snapshot) notFound();

  // For the Intake tab specifically, refresh signed URLs on every render. The
  // bucket is private; URLs live 5 minutes. Cheap when the customer hasn't
  // uploaded anything.
  const intakeWithUrls =
    activeTab === "intake"
      ? await withIntakeSignedUrls(snapshot.intake, snapshot.header.id)
      : snapshot.intake;

  return (
    <ProjectDetail
      snapshot={{ ...snapshot, intake: intakeWithUrls }}
      activeTab={activeTab}
    />
  );
}
