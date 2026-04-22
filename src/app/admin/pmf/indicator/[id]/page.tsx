import { notFound } from "next/navigation";
import { getPmfState } from "@/lib/admin/pmf-queries";
import { IndicatorCard } from "@/components/pmf/indicator-card";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import type { IndicatorKey } from "@/lib/pmf/types";

const VALID = new Set(["a", "b", "c", "d", "e"]);

export default async function IndicatorDrillInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = rawId.toLowerCase();
  if (!VALID.has(id)) notFound();

  const state = await getPmfState();
  const key = `indicator_${id}` as IndicatorKey;
  const ind = state.indicators[key];

  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">
        INDICATOR {id.toUpperCase()} · {ind.label}
      </SlashHeader>
      <div className="max-w-[320px]">
        <IndicatorCard state={ind} />
      </div>
      {/* TODO: full 12-week sparkline table — Session 3 polish */}
    </div>
  );
}
