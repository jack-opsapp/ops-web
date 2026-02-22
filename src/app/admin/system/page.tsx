import {
  getAuditLog,
  getDataQualityChecks,
  getTableStats,
} from "@/lib/admin/admin-queries";
import { getPortalStats } from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { SystemContent } from "./_components/system-content";

async function fetchSystemData() {
  const [auditLog, dataQuality, tableStats, portalStats] = await Promise.all([
    getAuditLog(50),
    getDataQualityChecks(),
    getTableStats(),
    getPortalStats(),
  ]);

  return { auditLog, dataQuality, tableStats, integrations: portalStats };
}

export default async function SystemPage() {
  let data;
  try {
    data = await fetchSystemData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">System Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="System" caption="diagnostics & monitoring" />
      <div className="p-8">
        <SystemContent
          auditLog={data.auditLog}
          dataQuality={data.dataQuality}
          tableStats={data.tableStats}
          integrations={data.integrations}
        />
      </div>
    </div>
  );
}
