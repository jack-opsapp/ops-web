import { fireMilestone } from "@/app/admin/spec/[id]/_actions/fire-milestone";
import type {
  SpecMilestoneRow,
  SpecMilestonesTab,
  SpecPaymentMilestone,
  SpecPaymentStatus,
} from "@/lib/admin/spec-types";
import { formatCents, formatDate, statusLabel } from "./format";

interface MilestonesTabProps {
  data: SpecMilestonesTab;
  projectId: string;
}

const STATUS_TONE: Record<SpecPaymentStatus | "not_yet_fired", string> = {
  not_yet_fired: "text-[#6A6A6A] border-white/[0.10]",
  pending: "text-[#6A6A6A] border-white/[0.10]",
  invoiced: "text-[#C4A868] border-[#C4A868]/40",
  paid: "text-[#9DB582] border-[#9DB582]/40",
  overdue: "text-[#B58289] border-[#B58289]/40",
  disputed: "text-[#B58289] border-[#B58289]/40",
  refunded: "text-[#B58289] border-[#B58289]/40",
  partially_refunded: "text-[#B58289] border-[#B58289]/40",
  voided: "text-[#8A8A8A] border-white/[0.10]",
  uncollectible: "text-[#B58289] border-[#B58289]/40",
};

const STRIPE_DASHBOARD_BASE =
  process.env.NEXT_PUBLIC_STRIPE_DASHBOARD_BASE ?? "https://dashboard.stripe.com";

function stripeInvoiceUrl(id: string): string {
  return `${STRIPE_DASHBOARD_BASE}/invoices/${id}`;
}

const MILESTONE_NAME: Record<SpecPaymentMilestone, string> = {
  deposit: "DEPOSIT",
  scope_signoff: "SCOPE SIGN-OFF",
  midpoint: "MIDPOINT DEMO",
  delivery: "DELIVERY",
};

export function MilestonesTab({ data, projectId }: MilestonesTabProps) {
  const totalPaid = data.rows
    .filter((r) => r.status === "paid" || r.status === "partially_refunded")
    .reduce((sum, r) => sum + r.amountCents, 0);

  return (
    <div className="space-y-6">
      <section
        aria-label="Milestone summary"
        className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            MILESTONES
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            TIER TOTAL · {formatCents(data.tierTotalCents)} · PAID {formatCents(totalPaid)}
            <span className="text-[#3A3A3A]">]</span>
          </span>
        </div>
      </section>

      <div className="overflow-x-auto rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] backdrop-blur-[28px]">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="border-b border-white/[0.08] text-left">
              <Th>MILESTONE</Th>
              <Th>STATUS</Th>
              <Th align="right">AMOUNT</Th>
              <Th>INVOICED</Th>
              <Th>DUE</Th>
              <Th>PAID</Th>
              <Th>STRIPE INVOICE</Th>
              <Th align="right">ACTION</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <MilestoneRow key={row.milestone} row={row} projectId={projectId} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        <span className="text-[#3A3A3A]">[</span>
        P1 FIRES AUTOMATICALLY VIA STRIPE WEBHOOK · P2/P3/P4 FIRE MANUALLY ONCE THE PREREQUISITE ACCEPTANCE EVENT EXISTS
        <span className="text-[#3A3A3A]">]</span>
      </p>
    </div>
  );
}

function MilestoneRow({ row, projectId }: { row: SpecMilestoneRow; projectId: string }) {
  return (
    <tr className="border-b border-white/[0.04] last:border-b-0">
      <Td>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[12px] tabular-nums text-[#EDEDED]">{row.label}</span>
          <span className="text-[12px] text-[#B5B5B5]">{MILESTONE_NAME[row.milestone]}</span>
        </span>
      </Td>
      <Td>
        <span
          className={`rounded-[4px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${STATUS_TONE[row.status]}`}
        >
          {row.status === "not_yet_fired" ? "NOT FIRED" : statusLabel(row.status)}
        </span>
      </Td>
      <Td align="right">
        <span className="font-mono text-[12px] tabular-nums text-[#EDEDED]">
          {formatCents(row.amountCents)}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-[#B5B5B5]">
          {formatDate(row.invoicedAt)}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-[#B5B5B5]">
          {formatDate(row.dueDate)}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-[#9DB582]">
          {formatDate(row.paidAt)}
        </span>
      </Td>
      <Td>
        {row.stripeInvoiceId ? (
          <a
            href={stripeInvoiceUrl(row.stripeInvoiceId)}
            target="_blank"
            rel="noreferrer"
            title={row.stripeInvoiceId}
            className="font-mono text-[11px] tabular-nums text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-[#EDEDED]"
          >
            {row.stripeInvoiceId.length > 16
              ? `${row.stripeInvoiceId.slice(0, 16)}…`
              : row.stripeInvoiceId}{" "}
            ↗
          </a>
        ) : (
          <span className="font-mono text-[11px] text-[#6A6A6A]">—</span>
        )}
      </Td>
      <Td align="right">
        <FireButton row={row} projectId={projectId} />
      </Td>
    </tr>
  );
}

function FireButton({ row, projectId }: { row: SpecMilestoneRow; projectId: string }) {
  if (row.milestone === "deposit") {
    return (
      <span
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]"
        title="P1 fires automatically via Stripe webhook on checkout.session.completed"
      >
        AUTO
      </span>
    );
  }
  if (!row.fireable) {
    return (
      <span
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]"
        title={row.fireBlockedReason ?? "Not fireable"}
      >
        {row.fireBlockedReason ? row.fireBlockedReason.toUpperCase() : "—"}
      </span>
    );
  }
  return (
    <form action={fireMilestone} className="inline-flex">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="milestone" value={row.milestone} />
      <button
        type="submit"
        className="rounded-[5px] border border-[#6F94B0] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
      >
        FIRE {row.label} INVOICE
      </button>
    </form>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A] ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <td className={`px-3 py-3 align-middle ${align === "right" ? "text-right" : ""}`}>
      {children}
    </td>
  );
}
