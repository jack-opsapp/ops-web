import { getOverviewSnapshot } from "@/lib/admin/spec-queries";
import { getSpecTestMode } from "@/lib/admin/spec-test-mode";
import { SpecPageHeader } from "./_components/spec-page-header";
import { TodayQueue } from "./_components/today-queue";
import { CapacityPanel } from "./_components/capacity-panel";
import { KanbanPipeline } from "./_components/kanban-pipeline";
import { RevenueSummary } from "./_components/revenue-summary";
import { PipelineVelocity } from "./_components/pipeline-velocity";

export const dynamic = "force-dynamic";

export default async function SpecOverviewPage() {
  const testMode = await getSpecTestMode();

  let snapshot;
  try {
    snapshot = await getOverviewSnapshot(testMode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      <div className="p-8">
        <SpecPageHeader testMode={testMode} snapshotRefreshedAt={null} />
        <div className="m-8 rounded-panel border border-[#B58289]/40 bg-[#B58289]/8 p-6">
          <h2 className="font-cakemono text-[15px] font-light uppercase text-[#B58289]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            SPEC OVERVIEW FETCH FAILED
          </h2>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] text-[#EDEDED]">
            {msg}
          </pre>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[#6A6A6A]">
            [check supabase service-role + private.is_spec_operator() grants]
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <SpecPageHeader
        testMode={snapshot.testMode}
        snapshotRefreshedAt={snapshot.snapshotRefreshedAt}
      />
      <TodayQueue sections={snapshot.today} />
      <CapacityPanel rows={snapshot.capacity} />
      <KanbanPipeline
        columns={snapshot.kanbanColumns}
        counters={snapshot.kanbanCounters}
      />
      <RevenueSummary data={snapshot.revenue} />
      <PipelineVelocity data={snapshot.velocity} />
    </div>
  );
}
