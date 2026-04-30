import { notFound } from "next/navigation";
import { getPmfState } from "@/lib/admin/pmf-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { PmfCard } from "@/components/pmf/ui/card";
import { MarkerCard } from "@/components/pmf/marker-card";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import { fmtPct } from "@/lib/pmf/formatters";
import type { MarkerKey } from "@/lib/pmf/types";

const VALID = new Set(["1", "2", "3", "4"]);

interface CohortRow {
  cohort_month: string;
  size: number;
  d30: number | null;
  d60: number | null;
  d90: number | null;
}

export default async function MarkerDrillInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!VALID.has(id)) notFound();

  const state = await getPmfState();
  const key = `marker_${id}` as MarkerKey;
  const marker = state.markers[key];

  let cohortRows: CohortRow[] = [];
  if (id === "2") {
    const sb = getAdminSupabase();
    const { data, error } = await sb.rpc("pmf_retention_cohorts");
    if (error) {
      console.error("[pmf-marker-drill-in] retention cohorts RPC failed:", error.message);
    } else {
      cohortRows = (data ?? []) as CohortRow[];
    }
  }

  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">
        MARKER {id} · {marker.label}
      </SlashHeader>
      <div className="max-w-[360px]">
        <MarkerCard state={marker} asCurrency={id === "4"} />
      </div>

      {id === "2" && (
        <PmfCard>
          <SlashHeader variant="section">COHORT RETENTION</SlashHeader>
          {cohortRows.length === 0 ? (
            <div className="mt-4 font-mono text-[11px] text-[color:var(--text-mute)]">
              {"// NO COHORTS YET"}
            </div>
          ) : (
            <table className="w-full mt-4 font-mono text-[11px]">
              <thead>
                <tr className="text-left uppercase tracking-[0.16em] text-[color:var(--text-3)] border-b border-[color:var(--line)]">
                  <th className="py-2">COHORT</th>
                  <th>SIZE</th>
                  <th>30D</th>
                  <th>60D</th>
                  <th>90D</th>
                </tr>
              </thead>
              <tbody>
                {cohortRows.map((r) => (
                  <tr key={r.cohort_month} className="border-b border-[color:var(--line)]">
                    <td className="py-2">{r.cohort_month}</td>
                    <td>{r.size}</td>
                    <td>{fmtPct(r.d30)}</td>
                    <td>{fmtPct(r.d60)}</td>
                    <td>{fmtPct(r.d90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PmfCard>
      )}
    </div>
  );
}
