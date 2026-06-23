import { getPendingOwnerApprovals } from "@/lib/admin/spec-queries";
import { getSpecTestMode } from "@/lib/admin/spec-test-mode";

import { SpecSubPageHeader } from "../_components/spec-sub-page-header";
import { OwnerApprovalRow } from "./_components/owner-approval-row";

export const dynamic = "force-dynamic";

export default async function SpecOwnerApprovalsPage() {
  const testMode = await getSpecTestMode();
  const pending = await getPendingOwnerApprovals(testMode);

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <SpecSubPageHeader
        title="OWNER APPROVALS"
        testMode={testMode}
        backHref="/admin/spec"
        rightMeta={`${pending.length} PENDING`}
      />

      <section
        aria-label="Pending owner approval requests"
        className="border-b border-white/[0.08] px-8 py-6"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            BUYER WAITING ON OWNER
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            SORTED OLDEST FIRST
            <span className="text-[#3A3A3A]">]</span>
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-panel border border-dashed border-white/[0.08] px-6 py-8">
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-[#6A6A6A]">
              <span className="text-[#3A3A3A]">{"//"}</span> No pending owner-approval requests.
            </p>
          </div>
        ) : (
          <div className="rounded-panel border border-white/[0.09] bg-[#121214]/[0.58] backdrop-blur-[28px]">
            {pending.map((approval) => (
              <OwnerApprovalRow key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
