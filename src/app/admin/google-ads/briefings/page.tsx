import Link from "next/link";
import { listBriefings } from "@/lib/admin/briefing-queries";
import { AdminPageHeader } from "../../_components/admin-page-header";

export default async function BriefingsArchivePage() {
  const briefings = await listBriefings(20);

  return (
    <div>
      <AdminPageHeader title="Briefing Archive" caption="past intelligence briefings" />
      <div className="p-8">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Period</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Summary</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Status</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Trigger</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]"></th>
            </tr>
          </thead>
          <tbody>
            {briefings.map((b) => (
              <tr key={b.id} className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100">
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5]">
                  {b.period_start} — {b.period_end}
                </td>
                <td className="py-3 pr-3 font-mohave text-[13px] text-[#A0A0A0] max-w-[300px] truncate">
                  {b.summary ?? "\u2014"}
                </td>
                <td className="py-3 pr-3">
                  <span className={`font-mohave text-[11px] uppercase px-2 py-0.5 rounded ${
                    b.status === "complete" ? "bg-[#9DB582]/20 text-[#9DB582]" :
                    b.status === "generating" ? "bg-ops-accent/20 text-[#597794]" :
                    "bg-[#93321A]/20 text-[#93321A]"
                  }`}>{b.status}</span>
                </td>
                <td className="py-3 pr-3 font-mono text-[11px] text-[#6B6B6B]">{b.triggered_by}</td>
                <td className="py-3">
                  {b.status === "complete" && (
                    <Link
                      href={`/admin/google-ads/briefings/${b.id}`}
                      className="font-mono text-[11px] text-[#597794] hover:text-[#E5E5E5] transition-colors duration-100"
                    >
                      View →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {briefings.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center font-mohave text-[14px] text-[#6B6B6B]">
                  No briefings yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
