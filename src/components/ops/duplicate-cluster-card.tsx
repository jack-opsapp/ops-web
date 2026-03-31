"use client";

import { format } from "date-fns";
import { useDictionary } from "@/i18n/client";
import type { DuplicateEntityType } from "@/lib/api/services/duplicate-detection-service";
import type { EnrichedEntity } from "@/lib/hooks/use-duplicate-reviews";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EntityCardProps {
  entity: EnrichedEntity;
  entityType: DuplicateEntityType;
}

// ─── Per-entity-type card renderers ─────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-kosugi text-[9px] uppercase tracking-wider text-white/25">
        {label}
      </span>
      <span className="font-mohave text-[13px] text-white/80 leading-tight">
        {value}
      </span>
    </div>
  );
}

function EmptyField({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-kosugi text-[9px] uppercase tracking-wider text-white/25">
        {label}
      </span>
      <span className="font-mohave text-[12px] text-white/15">—</span>
    </div>
  );
}

/** Shows a field, or an empty placeholder if missing — ensures rows align across cards */
function FieldOrEmpty({ label, value }: { label: string; value: string | null | undefined }) {
  if (value) return <Field label={label} value={value} />;
  return <EmptyField label={label} />;
}

function formatDate(val: unknown): string | null {
  if (!val) return null;
  try {
    return format(new Date(val as string), "MMM d, yyyy");
  } catch {
    return null;
  }
}

function ClientCard({ entity }: EntityCardProps) {
  const d = entity.data;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mohave text-[15px] font-medium text-white/90 leading-tight">
        {(d.name as string) || "Unnamed"}
      </span>
      <FieldOrEmpty label="EMAIL" value={d.email as string | null} />
      <FieldOrEmpty label="PHONE" value={d.phone_number as string | null} />
      <FieldOrEmpty label="ADDRESS" value={d.address as string | null} />
      <FieldOrEmpty label="CREATED" value={formatDate(d.created_at)} />
    </div>
  );
}

function OpportunityCard({ entity }: EntityCardProps) {
  const d = entity.data;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mohave text-[15px] font-medium text-white/90 leading-tight">
        {(d.title as string) || "Untitled"}
      </span>
      <FieldOrEmpty label="CONTACT" value={d.contact_name as string | null} />
      <FieldOrEmpty label="EMAIL" value={d.contact_email as string | null} />
      <FieldOrEmpty label="PHONE" value={d.contact_phone as string | null} />
      <FieldOrEmpty label="STAGE" value={d.stage as string | null} />
      <FieldOrEmpty
        label="VALUE"
        value={d.estimated_value ? `$${Number(d.estimated_value).toLocaleString()}` : null}
      />
    </div>
  );
}

function ProjectCard({ entity }: EntityCardProps) {
  const d = entity.data;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mohave text-[15px] font-medium text-white/90 leading-tight">
        {(d.title as string) || "Untitled"}
      </span>
      <FieldOrEmpty label="STATUS" value={d.status as string | null} />
      <FieldOrEmpty label="ADDRESS" value={d.address as string | null} />
      <FieldOrEmpty label="CREATED" value={formatDate(d.created_at)} />
    </div>
  );
}

function TaskCard({ entity }: EntityCardProps) {
  const d = entity.data;
  const startDate = d.start_date ? format(new Date(d.start_date as string), "MMM d") : null;
  const endDate = d.end_date ? format(new Date(d.end_date as string), "MMM d") : null;
  const dateRange = startDate && endDate ? `${startDate} – ${endDate}` : startDate;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mohave text-[15px] font-medium text-white/90 leading-tight">
        {(d.custom_title as string | null) || (d.task_type_id as string) || "Task"}
      </span>
      <FieldOrEmpty label="STATUS" value={d.status as string | null} />
      <FieldOrEmpty label="DATES" value={dateRange} />
    </div>
  );
}

// ─── Entity Card Router ─────────────────────────────────────────────────────

function EntityCard({ entity, entityType }: EntityCardProps) {
  switch (entityType) {
    case "client":
      return <ClientCard entity={entity} entityType={entityType} />;
    case "opportunity":
      return <OpportunityCard entity={entity} entityType={entityType} />;
    case "project":
      return <ProjectCard entity={entity} entityType={entityType} />;
    case "task":
      return <TaskCard entity={entity} entityType={entityType} />;
  }
}

// ─── Exported Cluster Card ──────────────────────────────────────────────────

interface DuplicateClusterCardProps {
  cluster: {
    entities: EnrichedEntity[];
    reviewIds: string[];
    confidence: "high" | "medium";
    signals: { type: string; detail: string }[];
  };
  entityType: DuplicateEntityType;
  onMerge: (reviewIds: string[], winnerId: string, fieldOverrides: Record<string, unknown>) => void;
  onDismiss: (reviewIds: string[]) => void;
  isMerging: boolean;
}

/** Pick the entity with the most non-null fields as the auto-winner */
function pickBestEntity(entities: EnrichedEntity[]): string {
  let bestId = entities[0]?.id ?? "";
  let bestCount = -1;
  for (const e of entities) {
    const count = Object.values(e.data).filter(
      (v) => v !== null && v !== undefined && v !== ""
    ).length;
    if (count > bestCount) {
      bestCount = count;
      bestId = e.id;
    }
  }
  return bestId;
}

export function DuplicateClusterCard({
  cluster,
  entityType,
  onMerge,
  onDismiss,
  isMerging,
}: DuplicateClusterCardProps) {
  const { t } = useDictionary("duplicates");

  const handleMerge = () => {
    const winnerId = pickBestEntity(cluster.entities);
    onMerge(cluster.reviewIds, winnerId, {});
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Signal badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-[2px] px-2 py-0.5 font-kosugi text-[10px] uppercase tracking-wider ${
            cluster.confidence === "high"
              ? "bg-red-500/20 text-red-400"
              : "bg-amber-500/20 text-amber-400"
          }`}
        >
          {t(`card.confidence.${cluster.confidence}`)}
        </span>
        {cluster.signals.map((s, i) => (
          <span
            key={i}
            className="rounded-[2px] bg-white/5 px-2 py-0.5 font-kosugi text-[10px] text-white/40"
          >
            {t(`signals.${s.type}`) || s.type}
          </span>
        ))}
      </div>

      {/* Side-by-side entity cards — always one row, equal widths */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cluster.entities.length}, 1fr)` }}
      >
        {cluster.entities.map((entity) => (
          <div
            key={entity.id}
            className="min-w-0 rounded-[3px] border border-white/8 bg-white/[0.03] p-3"
          >
            <EntityCard entity={entity} entityType={entityType} />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleMerge}
          disabled={isMerging}
          className="flex-1 rounded-[3px] bg-[#597794]/20 px-4 py-2.5 font-mohave text-[14px] font-medium text-[#597794] transition-colors duration-150 hover:bg-[#597794]/30 disabled:opacity-40"
        >
          {isMerging ? t("merging") : t("card.merge")}
        </button>
        <button
          type="button"
          onClick={() => onDismiss(cluster.reviewIds)}
          disabled={isMerging}
          className="rounded-[3px] border border-white/8 bg-white/5 px-4 py-2.5 font-mohave text-[14px] text-white/40 transition-colors duration-150 hover:bg-white/10 hover:text-white/60 disabled:opacity-40"
        >
          {t("card.dismiss")}
        </button>
      </div>
    </div>
  );
}
