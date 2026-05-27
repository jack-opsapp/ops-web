import { notFound } from "next/navigation";

import { getRefundRequestDetail } from "@/lib/admin/spec-queries";
import { getSpecTestMode } from "@/lib/admin/spec-test-mode";
import { formatCents, formatTier } from "../../_components/format";
import { SpecSubPageHeader } from "../../_components/spec-sub-page-header";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface BreakdownRow {
  milestone: string;
  action: string;
  stripe_resource_id?: string | null;
  amount_cents?: number;
  cash_refund_cents?: number;
  status?: string;
  executed_at?: string;
  error?: string | null;
}

export default async function ProcessedRefundDetailPage({ params }: PageProps) {
  const { id } = await params;
  const testMode = await getSpecTestMode();
  const refund = await getRefundRequestDetail(id);
  if (!refund) notFound();

  const breakdown = Array.isArray(refund.refundBreakdown)
    ? (refund.refundBreakdown as BreakdownRow[])
    : [];

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <SpecSubPageHeader
        title={`REFUND · ${refund.status.toUpperCase()}`}
        testMode={testMode}
        backHref="/admin/spec/refunds"
        rightMeta={`${formatTier(refund.projectTier)} · ${refund.customerName?.trim() || refund.customerEmail}`}
      />

      <section className="border-b border-white/[0.08] px-8 py-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-3">
          <Field label="Status" value={refund.status.toUpperCase()} />
          <Field
            label="Total cash refunded"
            value={formatCents(refund.totalRefundCents)}
          />
          <Field
            label="Processed at"
            value={refund.processedAt ?? "—"}
            mono
          />
          <Field
            label="Denied at"
            value={refund.deniedAt ?? "—"}
            mono
          />
          <Field
            label="Guarantee invocation"
            value={refund.isGuaranteeInvocation ? "YES" : "NO"}
          />
          <Field label="Goodwill" value={refund.isGoodwill ? "YES" : "NO"} />
        </dl>

        {refund.customerReasonText && (
          <div className="mt-6 border-l border-white/[0.06] pl-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
              <span className="text-[#3A3A3A]">{"//"}</span> CUSTOMER REASON
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[#B5B5B5]">
              {refund.customerReasonText}
            </p>
          </div>
        )}

        {refund.denialReasonText && (
          <div className="mt-6 border-l border-[#B58289]/40 pl-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#B58289]">
              <span className="text-[#3A3A3A]">{"//"}</span> DENIAL REASON
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[#EDEDED]">
              {refund.denialReasonText}
            </p>
          </div>
        )}
      </section>

      <section
        aria-label="Executed refund breakdown"
        className="border-b border-white/[0.08] px-8 py-6"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            EXECUTED BREAKDOWN
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            {breakdown.length} LINE{breakdown.length === 1 ? "" : "S"}
            <span className="text-[#3A3A3A]">]</span>
          </span>
        </div>

        {breakdown.length === 0 ? (
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-[#6A6A6A]">
            No breakdown recorded for this refund.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-white/[0.09] bg-[#121214]/[0.58] backdrop-blur-[28px]">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <Th>Milestone</Th>
                  <Th>Action</Th>
                  <Th>Stripe resource</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Cash refund</Th>
                  <Th>Status</Th>
                  <Th>Executed at</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row, idx) => (
                  <tr key={`${row.milestone}-${idx}`} className="border-b border-white/[0.04] last:border-b-0">
                    <Td className="font-cakemono text-[12px] uppercase">{row.milestone}</Td>
                    <Td className="font-mono text-[11px] uppercase tracking-[0.10em] text-[#B5B5B5]">
                      {row.action}
                    </Td>
                    <Td className="font-mono text-[10px] tracking-[0.04em] text-[#8A8A8A]">
                      {row.stripe_resource_id ?? "—"}
                    </Td>
                    <Td align="right" className="font-mono text-[12px] tabular-nums">
                      {row.amount_cents != null ? formatCents(row.amount_cents) : "—"}
                    </Td>
                    <Td align="right" className="font-mono text-[12px] tabular-nums">
                      {row.cash_refund_cents != null ? formatCents(row.cash_refund_cents) : "—"}
                    </Td>
                    <Td className={`font-mono text-[10px] uppercase tracking-[0.12em] ${row.status === "succeeded" ? "text-[#9DB582]" : row.status === "failed" ? "text-[#B58289]" : "text-[#8A8A8A]"}`}>
                      {row.status ?? "—"}
                    </Td>
                    <Td className="font-mono text-[10px] tracking-[0.04em] text-[#6A6A6A]">
                      {row.executed_at ?? "—"}
                    </Td>
                    <Td className="font-mono text-[10px] tracking-[0.04em] text-[#B58289]">
                      {row.error ?? ""}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        <span className="text-[#3A3A3A]">{"//"}</span> {label}
      </dt>
      <dd
        className={`mt-1 ${mono ? "font-mono tabular-nums" : "font-cakemono uppercase"} text-[13px] tracking-[0.04em] text-[#EDEDED]`}
      >
        {value}
      </dd>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-3 font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-[#6A6A6A] ${align === "right" ? "text-right" : "text-left"}`}
      scope="col"
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  align = "left",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
