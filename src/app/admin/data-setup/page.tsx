import { AdminPageHeader } from "../_components/admin-page-header";
import {
  getDataSetupQueue,
  computeQueueStats,
} from "@/lib/admin/data-setup-queries";
import { DataSetupQueue } from "./_components/data-setup-queue";
import { DataReviewQueue } from "./_components/data-review-queue";

export const dynamic = "force-dynamic";

export default async function DataSetupPage() {
  let rows;
  try {
    rows = await getDataSetupQueue();
  } catch (err) {
    return (
      <div className="p-8">
        <h1 className="font-mohave text-lg text-rose mb-4">
          Data Setup Queue Failed
        </h1>
        <pre className="text-[13px] text-text bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  const stats = computeQueueStats(rows);

  return (
    <div>
      <AdminPageHeader
        title="Data Setup"
        caption={`${stats.pending} pending · ${stats.scheduled} scheduled · ${stats.inProgress} in progress · ${stats.completed} completed this month`}
      />
      <div className="flex flex-col gap-6 p-8">
        <DataSetupQueue initialRows={rows} initialStats={stats} />
        <DataReviewQueue />
      </div>
    </div>
  );
}
