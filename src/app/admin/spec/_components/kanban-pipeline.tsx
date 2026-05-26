import Link from "next/link";
import type {
  KanbanCard,
  KanbanColumn,
  KanbanSideCounters,
  SpecHoldType,
  SpecProjectStatus,
  SpecTier,
} from "@/lib/admin/spec-types";
import { formatCentsCompact, formatHoldType, formatStatusLabel, formatTier } from "./format";

interface KanbanPipelineProps {
  columns: KanbanColumn[];
  counters: KanbanSideCounters;
}

const STATUS_COPY: Record<SpecProjectStatus, string> = {
  awaiting_owner_approval: "OWNER APPROVAL",
  awaiting_deposit: "AWAITING DEPOSIT",
  deposit_paid: "DEPOSIT PAID",
  discovery: "DISCOVERY",
  building: "BUILDING",
  on_hold: "ON HOLD",
  support: "SUPPORT",
  on_retainer: "RETAINER",
  completed: "COMPLETED",
  stalled: "STALLED",
  stalled_on_hold: "STALLED HOLD",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
};

const TIER_TONE: Record<SpecTier, string> = {
  setup: "text-[#9DB582] border-[#9DB582]/30",
  build: "text-[#C4A868] border-[#C4A868]/30",
  enterprise: "text-[#6F94B0] border-[#6F94B0]/40",
};

export function KanbanPipeline({ columns, counters }: KanbanPipelineProps) {
  return (
    <section
      aria-label="Pipeline Kanban"
      className="border-b border-white/[0.08] px-8 py-6"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          PIPELINE
        </h2>
        <SideCounters counters={counters} />
      </div>

      {/* Horizontal scroll on narrow viewports; 9 columns fit at ~1320px+ */}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[1320px] gap-3">
          {columns.map((column) => (
            <ColumnBlock key={column.status} column={column} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SideCounters({ counters }: { counters: KanbanSideCounters }) {
  const items: Array<{ label: string; value: number; tone: string }> = [
    { label: "STALLED", value: counters.stalled, tone: "text-[#8A8A8A]" },
    { label: "STALLED · HOLD", value: counters.stalledOnHold, tone: "text-[#8A8A8A]" },
    { label: "CANCELLED", value: counters.cancelled, tone: "text-[#B58289]" },
    { label: "REFUNDED", value: counters.refunded, tone: "text-[#B58289]" },
  ];
  return (
    <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[#6A6A6A]">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className="text-[#6A6A6A]">{item.label}</span>
          <span className={`tabular-nums ${item.tone}`}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}

function ColumnBlock({ column }: { column: KanbanColumn }) {
  const splitHold = column.status === "on_hold";
  let primary: KanbanCard[] = column.cards;
  let secondary: KanbanCard[] = [];
  if (splitHold) {
    primary = column.cards.filter((c) => c.holdType !== "ops_blocked");
    secondary = column.cards.filter((c) => c.holdType === "ops_blocked");
  }

  return (
    <div className="flex w-[180px] flex-shrink-0 flex-col">
      <header className="mb-2 flex items-center justify-between border-b border-white/[0.06] pb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A]">
          {STATUS_COPY[column.status]}
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-[#EDEDED]">
          {column.cards.length}
        </span>
      </header>

      <div className="space-y-2">
        {primary.length === 0 && secondary.length === 0 ? (
          <p className="font-mono text-[11px] text-[#6A6A6A]">— empty</p>
        ) : (
          primary.map((card) => <Card key={card.id} card={card} />)
        )}

        {splitHold && primary.length > 0 && secondary.length > 0 && (
          <div
            aria-hidden="true"
            className="my-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]"
          >
            <span className="h-px flex-1 bg-white/[0.06]" />
            OPS-BLOCKED
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>
        )}

        {secondary.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

function Card({ card }: { card: KanbanCard }) {
  const tone = TIER_TONE[card.tier];
  const holdLabel = formatHoldType(card.holdType as SpecHoldType | null);

  return (
    <Link
      href={`/admin/spec/${card.id}`}
      className="group block rounded-[6px] border border-white/[0.08] bg-[rgba(18,18,20,0.58)] p-2.5 backdrop-blur-[20px] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-[#6F94B0]/60 hover:bg-[rgba(111,148,176,0.06)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-[#EDEDED]">{card.customerLabel}</span>
        <span
          className={`shrink-0 rounded-[4px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.14em] ${tone}`}
        >
          {formatTier(card.tier)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-[#8A8A8A]">
        <span className="tabular-nums">{card.daysInStatus}D IN {formatStatusLabel(card.status)}</span>
        <span className="text-[#C4A868] tabular-nums">{formatCentsCompact(card.totalCommittedCents)}</span>
      </div>

      {(holdLabel || card.nextActionLabel || card.isTest) && (
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]">
          {holdLabel && (
            <span className="rounded-[4px] border border-[#B58289]/30 px-1.5 py-px text-[#B58289]">
              {holdLabel}
            </span>
          )}
          {card.isTest && (
            <span className="rounded-[4px] border border-[#C4A868]/40 px-1.5 py-px text-[#C4A868]">
              TEST
            </span>
          )}
          {card.nextActionLabel && (
            <span className="ml-auto truncate text-[#8A8A8A]">{card.nextActionLabel}</span>
          )}
        </div>
      )}
    </Link>
  );
}
