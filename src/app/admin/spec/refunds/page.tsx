import {
  getPendingRefundRequests,
  getProcessedRefundRequests,
} from "@/lib/admin/spec-queries";
import { getSpecTestMode } from "@/lib/admin/spec-test-mode";

import { SpecSubPageHeader } from "../_components/spec-sub-page-header";
import { RefundRowCard } from "./_components/refund-row-card";
import { ProcessedRefundRow } from "./_components/processed-refund-row";

export const dynamic = "force-dynamic";

export default async function SpecRefundsPage() {
  const testMode = await getSpecTestMode();
  const [pending, processed] = await Promise.all([
    getPendingRefundRequests(testMode),
    getProcessedRefundRequests(testMode, 25),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <SpecSubPageHeader
        title="REFUNDS"
        testMode={testMode}
        backHref="/admin/spec"
        rightMeta={`${pending.length} PENDING · ${processed.length} RECENT`}
      />

      <section
        aria-label="Pending refund requests"
        className="border-b border-white/[0.08] px-8 py-6"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            PENDING REQUESTS
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            {pending.length} TO REVIEW
            <span className="text-[#3A3A3A]">]</span>
          </span>
        </div>

        {pending.length === 0 ? (
          <EmptyState text="No refund requests in the queue." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {pending.map((refund) => (
              <RefundRowCard key={refund.id} refund={refund} />
            ))}
          </div>
        )}
      </section>

      <section
        aria-label="Recently processed refunds"
        className="border-b border-white/[0.08] px-8 py-6"
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            RECENTLY PROCESSED
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            LAST {processed.length}
            <span className="text-[#3A3A3A]">]</span>
          </span>
        </div>

        {processed.length === 0 ? (
          <EmptyState text="No processed or denied refunds yet." />
        ) : (
          <div className="rounded-[10px] border border-white/[0.09] bg-[#121214]/[0.58] backdrop-blur-[28px]">
            {processed.map((refund) => (
              <ProcessedRefundRow key={refund.id} refund={refund} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-white/[0.08] px-6 py-8">
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-[#6A6A6A]">
        <span className="text-[#3A3A3A]">{"//"}</span> {text}
      </p>
    </div>
  );
}
