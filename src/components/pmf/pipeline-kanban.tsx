"use client";

/**
 * OPS Admin — PMF Tier A Pipeline Kanban
 *
 * Six-column drag-and-drop board for prospects in the Tier A pipeline.
 * Replaces the Task 17 stub. Each column wraps its sortable list in a
 * useDroppable zone so empty columns are valid drop targets.
 *
 * Drop targets: the destination stage is read from over.data.current
 * (populated by useSortable on cards and useDroppable on columns).
 * Reading data-* HTML attributes from `over` does NOT work in dnd-kit
 * — only the `data` param on the hooks is plumbed through.
 *
 * State updates are optimistic: the local row stage is mutated
 * immediately, the PATCH fires, and on failure the previous stage is
 * restored and an inline error message is shown next to the section
 * header.
 */
import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { PmfCard } from "@/components/pmf/ui/card";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import { ProspectCard } from "./prospect-card";
import type { Deal, DealStage, Prospect } from "@/lib/pmf/types";

const COLUMNS: { key: DealStage; label: string }[] = [
  { key: "contacted", label: "CONTACTED" },
  { key: "qualified", label: "QUALIFIED" },
  { key: "proposal", label: "PROPOSAL" },
  { key: "negotiation", label: "NEGOTIATION" },
  { key: "signed", label: "SIGNED" },
  { key: "delivered", label: "DELIVERED" },
];

interface Row {
  prospect: Prospect;
  deal: Deal;
}

// The /api/admin/pmf/prospects endpoint returns prospects with a
// nested pmf_deals array (Supabase `select(*, pmf_deals!inner(...))`).
// Flatten one row per (prospect, deal) for the Kanban.
interface NestedProspect extends Omit<Prospect, never> {
  pmf_deals: Deal[];
}

async function fetchTierA(): Promise<Row[]> {
  const res = await fetch("/api/admin/pmf/prospects?deal_type=tier_a");
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as { data: NestedProspect[] };
  return (json.data ?? []).flatMap((p) =>
    (p.pmf_deals ?? []).map((d) => ({
      prospect: p,
      deal: d,
    })),
  );
}

interface ColumnDropZoneProps {
  stage: DealStage;
  children: React.ReactNode;
}

function ColumnDropZone({ stage, children }: ColumnDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage}`,
    data: { type: "column" as const, column: stage },
  });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[400px] rounded-[5px] transition-colors ${
        isOver ? "bg-[rgba(255,255,255,0.04)]" : ""
      }`}
    >
      {children}
    </div>
  );
}

export function PipelineKanban() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTierA()
      .then((r) => {
        setRows(r);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;

    const overData = over.data.current as
      | { type: "column" | "card"; column: DealStage }
      | undefined;
    const destStage = overData?.column;
    if (!destStage) return;

    const activeDeal = rows.find((r) => r.deal.id === active.id)?.deal;
    if (!activeDeal || activeDeal.stage === destStage) return;

    const previousStage = activeDeal.stage;
    const nowIso = new Date().toISOString();

    // Optimistic update — mirror the trigger that updates
    // stage_entered_at on the server so the UI shows "0 seconds" in the
    // new column without a refetch.
    setRows((rs) =>
      rs.map((r) =>
        r.deal.id === activeDeal.id
          ? { ...r, deal: { ...r.deal, stage: destStage, stage_entered_at: nowIso } }
          : r,
      ),
    );

    try {
      const res = await fetch(`/api/admin/pmf/deals/${activeDeal.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: destStage }),
      });
      if (!res.ok) {
        throw new Error(`stage PATCH failed: ${res.status}`);
      }
      // Clear any previously surfaced error on a successful update.
      setError(null);
    } catch (err) {
      console.error("[pmf-pipeline] stage update failed, rolling back:", err);
      setRows((rs) =>
        rs.map((r) =>
          r.deal.id === activeDeal.id
            ? { ...r, deal: { ...r.deal, stage: previousStage } }
            : r,
        ),
      );
      setError("Stage update failed — reverted");
    }
  };

  return (
    <PmfCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <SlashHeader variant="section">TIER A PIPELINE</SlashHeader>
        {error && (
          <span className="font-mono text-[11px] text-[color:var(--rose)]">
            // {error}
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-[400px] animate-pulse mt-4" />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={onDragEnd}
        >
          <div className="grid grid-cols-6 gap-3 mt-4">
            {COLUMNS.map((col) => {
              const items = rows.filter((r) => r.deal.stage === col.key);
              return (
                <div key={col.key}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-cakemono font-light uppercase text-[14px]">
                      {col.label}
                    </span>
                    <span className="font-mono text-[11px] text-[color:var(--text-3)]">
                      [{items.length}]
                    </span>
                  </div>
                  <ColumnDropZone stage={col.key}>
                    <SortableContext
                      items={items.map((i) => i.deal.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="space-y-2">
                        {items.length === 0 && (
                          <div className="font-mono text-[11px] text-[color:var(--text-mute)]">
                            —
                          </div>
                        )}
                        {items.map((r) => (
                          <ProspectCard
                            key={r.deal.id}
                            prospect={r.prospect}
                            deal={r.deal}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </ColumnDropZone>
                </div>
              );
            })}
          </div>
        </DndContext>
      )}
    </PmfCard>
  );
}
