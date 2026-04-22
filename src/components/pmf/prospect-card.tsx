"use client";

/**
 * OPS Admin — PMF ProspectCard
 *
 * Sortable card used inside the Tier A Kanban (PipelineKanban). Wraps
 * @dnd-kit/sortable and exposes the deal id as the sortable id so the
 * parent's onDragEnd can resolve the active row from local state.
 *
 * The card carries column metadata via useSortable's `data` so the
 * cross-column drop handler can derive the destination stage from
 * either case (card-over-card or card-over-empty-column).
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Tag } from "@/components/pmf/ui/tag";
import { formatDistanceToNowStrict } from "date-fns";
import type { Prospect, Deal, ProspectSource, DealStage } from "@/lib/pmf/types";

const SOURCE_TAG_VARIANT: Record<ProspectSource, "olive" | "tan" | "default"> = {
  referral: "olive",
  organic_search: "olive",
  direct: "olive",
  paid_ad: "tan",
  warm_network: "default",
  outbound_cold: "default",
};

const SOURCE_LABEL: Record<ProspectSource, string> = {
  referral: "REFERRAL",
  organic_search: "ORGANIC",
  direct: "DIRECT",
  paid_ad: "PAID",
  warm_network: "WARM",
  outbound_cold: "COLD",
};

interface ProspectCardProps {
  prospect: Prospect;
  deal: Deal;
  onClick?: () => void;
}

export function ProspectCard({ prospect, deal, onClick }: ProspectCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: deal.id,
      data: { type: "card", column: deal.stage as DealStage },
      transition: { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const daysInStage = formatDistanceToNowStrict(new Date(deal.stage_entered_at));

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="glass-surface p-3 cursor-grab active:cursor-grabbing rounded-[5px]"
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-mohave font-medium text-[13px] text-[color:var(--text)] truncate">
          {prospect.company ?? prospect.name}
        </div>
        <Tag variant={SOURCE_TAG_VARIANT[prospect.source]}>
          {SOURCE_LABEL[prospect.source]}
        </Tag>
      </div>
      <div className="mt-1 font-mono text-[11px] text-[color:var(--text-3)]">
        {daysInStage}
      </div>
    </div>
  );
}
