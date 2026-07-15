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
  not_yet_fired: "text-text-mute border-white/[0.10]",
  pending: "text-text-mute border-white/[0.10]",
  invoiced: "text-tan border-tan/40",
  paid: "text-olive border-olive/40",
  overdue: "text-rose border-rose/40",
  disputed: "text-rose border-rose/40",
  refunded: "text-rose border-rose/40",
  partially_refunded: "text-rose border-rose/40",
  voided: "text-text-3 border-white/[0.10]",
  uncollectible: "text-rose border-rose/40",
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
        className="glass-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-text">
            <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
              {"//"}
            </span>
            MILESTONES
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
            <span className="text-text-mute">[</span>
            TIER TOTAL · {formatCents(data.tierTotalCents)} · PAID {formatCents(totalPaid)}
            <span className="text-text-mute">]</span>
          </span>
        </div>
      </section>

      <div className="overflow-x-auto glass-surface">
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

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        <span className="text-text-mute">[</span>
        P1 FIRES AUTOMATICALLY VIA STRIPE WEBHOOK · P2/P3/P4 FIRE MANUALLY ONCE THE PREREQUISITE ACCEPTANCE EVENT EXISTS
        <span className="text-text-mute">]</span>
      </p>
    </div>
  );
}

function MilestoneRow({ row, projectId }: { row: SpecMilestoneRow; projectId: string }) {
  return (
    <tr className="border-b border-white/[0.04] last:border-b-0">
      <Td>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[12px] tabular-nums text-text">{row.label}</span>
          <span className="text-[12px] text-text-2">{MILESTONE_NAME[row.milestone]}</span>
        </span>
      </Td>
      <Td>
        <span
          className={`rounded-chip border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${STATUS_TONE[row.status]}`}
        >
          {row.status === "not_yet_fired" ? "NOT FIRED" : statusLabel(row.status)}
        </span>
      </Td>
      <Td align="right">
        <span className="font-mono text-[12px] tabular-nums text-text">
          {formatCents(row.amountCents)}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-text-2">
          {formatDate(row.invoicedAt)}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-text-2">
          {formatDate(row.dueDate)}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-olive">
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
            className="font-mono text-[11px] tabular-nums text-text-2 transition-colors duration-150 ease-smooth hover:text-text"
          >
            {row.stripeInvoiceId.length > 16
              ? `${row.stripeInvoiceId.slice(0, 16)}…`
              : row.stripeInvoiceId}{" "}
            ↗
          </a>
        ) : (
          <span className="font-mono text-[11px] text-text-mute">—</span>
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
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute"
        title="P1 fires automatically via Stripe webhook on checkout.session.completed"
      >
        AUTO
      </span>
    );
  }
  if (!row.fireable) {
    return (
      <span
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute"
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
        className="rounded border border-ops-accent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-black"
      >
        FIRE {row.label} INVOICE
      </button>
    </form>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute ${
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
