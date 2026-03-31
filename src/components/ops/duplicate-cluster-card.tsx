"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { DuplicateEntityType } from "@/lib/api/services/duplicate-detection-service";
import type { EnrichedEntity } from "@/lib/hooks/use-duplicate-reviews";

// ─── Field Configuration ───────────────────────────────────────────────────

/** Fields the user can edit on each entity type */
const EDITABLE_FIELDS: Record<DuplicateEntityType, string[]> = {
  client: ["name", "email", "phone_number", "address", "notes"],
  opportunity: [
    "title",
    "contact_name",
    "contact_email",
    "contact_phone",
    "address",
    "description",
  ],
  project: ["title", "address", "notes", "description"],
  task: ["custom_title", "task_notes"],
};

/** The field used as the card title per entity type */
const TITLE_FIELD: Record<DuplicateEntityType, string> = {
  client: "name",
  opportunity: "title",
  project: "title",
  task: "custom_title",
};

/** Read-only fields to display per entity type (order matters) */
const READONLY_FIELDS: Record<DuplicateEntityType, { field: string; label: string; formatter?: "date" | "currency" }[]> = {
  client: [
    { field: "created_at", label: "fields.created", formatter: "date" },
  ],
  opportunity: [
    { field: "stage", label: "fields.stage" },
    { field: "estimated_value", label: "fields.estimated_value", formatter: "currency" },
    { field: "created_at", label: "fields.created", formatter: "date" },
  ],
  project: [
    { field: "status", label: "fields.status" },
    { field: "created_at", label: "fields.created", formatter: "date" },
  ],
  task: [
    { field: "status", label: "fields.status" },
    { field: "start_date", label: "fields.dates", formatter: "date" },
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(val: unknown): string | null {
  if (!val) return null;
  try {
    return format(new Date(val as string), "MMM d, yyyy");
  } catch {
    return null;
  }
}

function formatCurrency(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  if (isNaN(num)) return null;
  return `$${num.toLocaleString()}`;
}

function formatReadonlyValue(val: unknown, formatter?: "date" | "currency"): string | null {
  if (formatter === "date") return formatDate(val);
  if (formatter === "currency") return formatCurrency(val);
  if (val === null || val === undefined || val === "") return null;
  return String(val);
}

/** Get the i18n label key for a field, e.g. "name" -> "fields.name" */
function fieldLabelKey(field: string): string {
  return `fields.${field}`;
}

/** Get the effective value of a field, applying edits */
function getEffectiveValue(
  entity: EnrichedEntity,
  field: string,
  edits: Record<string, Record<string, unknown>>
): string | null {
  const entityEdits = edits[entity.id];
  if (entityEdits && field in entityEdits) {
    const edited = entityEdits[field];
    if (edited === null) return null;
    return String(edited);
  }
  const raw = entity.data[field];
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw);
}

// ─── FieldPill Component ───────────────────────────────────────────────────

function FieldPill({
  label,
  value,
  addLabel,
  onRemove,
  onEdit,
}: {
  label: string;
  value: string | null;
  addLabel: string;
  onRemove: () => void;
  onEdit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // When entering edit mode, focus the input
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-kosugi text-[9px] uppercase tracking-wider text-white/25">
          {label}
        </span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) onEdit(draft.trim());
            else onRemove();
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
          className="w-fit rounded-full border border-[#597794]/40 bg-white/[0.04] px-2.5 py-1 font-mohave text-[12px] text-white/80 outline-none"
        />
      </div>
    );
  }

  if (!value) {
    // Empty — show add pill
    return (
      <div className="flex flex-col gap-1">
        <span className="font-kosugi text-[9px] uppercase tracking-wider text-white/25">
          {label}
        </span>
        <button
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="inline-flex w-fit items-center gap-1 rounded-full border border-dashed border-white/10 px-2.5 py-1 font-mohave text-[12px] text-white/25 transition-colors duration-150 hover:border-white/20 hover:text-white/40"
        >
          <span className="text-[11px]">+</span> {addLabel}
        </button>
      </div>
    );
  }

  // Has value — show data pill
  return (
    <div className="flex flex-col gap-1">
      <span className="font-kosugi text-[9px] uppercase tracking-wider text-white/25">
        {label}
      </span>
      <div className="group inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 transition-colors duration-150 hover:border-white/15">
        <button
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="truncate text-left font-mohave text-[12px] text-white/75 transition-colors duration-150 hover:text-white"
        >
          {value}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 rounded-full p-0.5 text-white/20 opacity-0 transition-all duration-150 hover:bg-white/10 hover:text-white/60 group-hover:opacity-100"
          aria-label="Remove"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

// ─── EditableTitle Component ───────────────────────────────────────────────

function EditableTitle({
  value,
  fallback,
  onEdit,
}: {
  value: string | null;
  fallback: string;
  onEdit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim()) onEdit(draft.trim());
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        className="w-full rounded-[2px] border border-[#597794]/30 bg-white/[0.04] px-1 py-0.5 font-mohave text-[15px] font-medium text-white/90 outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(value ?? "");
        setEditing(true);
      }}
      className="text-left font-mohave text-[15px] font-medium leading-tight text-white/90 transition-colors duration-150 hover:text-white"
    >
      {value || fallback}
    </button>
  );
}

// ─── Entity Card with Field Pills ──────────────────────────────────────────

interface InteractiveEntityCardProps {
  entity: EnrichedEntity;
  entityType: DuplicateEntityType;
  edits: Record<string, Record<string, unknown>>;
  onFieldEdit: (entityId: string, field: string, value: string | null) => void;
}

function InteractiveEntityCard({
  entity,
  entityType,
  edits,
  onFieldEdit,
}: InteractiveEntityCardProps) {
  const { t } = useDictionary("duplicates");
  const titleField = TITLE_FIELD[entityType];
  const editableFields = EDITABLE_FIELDS[entityType];
  const readonlyFields = READONLY_FIELDS[entityType];
  const addLabel = t("card.add");

  // Editable fields excluding the title (title is rendered separately)
  const pillFields = editableFields.filter((f) => f !== titleField);

  const titleValue = getEffectiveValue(entity, titleField, edits);
  const titleFallback =
    entityType === "task"
      ? ((entity.data.task_type_id as string) || "Task")
      : "Untitled";

  return (
    <div className="flex flex-col gap-2">
      {/* Editable title */}
      <EditableTitle
        value={titleValue}
        fallback={titleFallback}
        onEdit={(val) => onFieldEdit(entity.id, titleField, val)}
      />

      {/* Editable field pills */}
      {pillFields.map((field) => {
        const value = getEffectiveValue(entity, field, edits);
        const label = t(fieldLabelKey(field)) || field;
        return (
          <FieldPill
            key={field}
            label={label}
            value={value}
            addLabel={addLabel}
            onRemove={() => onFieldEdit(entity.id, field, null)}
            onEdit={(val) => onFieldEdit(entity.id, field, val)}
          />
        );
      })}

      {/* Read-only fields */}
      {readonlyFields.map((ro) => {
        // Special handling for task dates — show range
        if (entityType === "task" && ro.field === "start_date") {
          const startDate = entity.data.start_date
            ? formatDate(entity.data.start_date)
            : null;
          const endDate = entity.data.end_date
            ? formatDate(entity.data.end_date)
            : null;
          const dateRange =
            startDate && endDate
              ? `${startDate} - ${endDate}`
              : startDate;
          if (!dateRange) return null;
          return (
            <div key={ro.field} className="flex flex-col gap-0.5">
              <span className="font-kosugi text-[9px] uppercase tracking-wider text-white/25">
                {t(ro.label) || ro.field}
              </span>
              <span className="font-mohave text-[13px] leading-tight text-white/50">
                {dateRange}
              </span>
            </div>
          );
        }

        const formatted = formatReadonlyValue(entity.data[ro.field], ro.formatter);
        if (!formatted) return null;
        return (
          <div key={ro.field} className="flex flex-col gap-0.5">
            <span className="font-kosugi text-[9px] uppercase tracking-wider text-white/25">
              {t(ro.label) || ro.field}
            </span>
            <span className="font-mohave text-[13px] leading-tight text-white/50">
              {formatted}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Pick Best Entity ──────────────────────────────────────────────────────

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

// ─── Exported Cluster Card ─────────────────────────────────────────────────

interface DuplicateClusterCardProps {
  cluster: {
    entities: EnrichedEntity[];
    reviewIds: string[];
    confidence: "high" | "medium";
    signals: { type: string; detail: string }[];
  };
  entityType: DuplicateEntityType;
  onMerge: (
    reviewIds: string[],
    winnerId: string,
    fieldOverrides: Record<string, unknown>,
    entityEdits: Record<string, Record<string, unknown>>,
    entityType: DuplicateEntityType
  ) => void;
  onDismiss: (
    reviewIds: string[],
    entityEdits: Record<string, Record<string, unknown>>,
    entityType: DuplicateEntityType
  ) => void;
  isMerging: boolean;
}

export function DuplicateClusterCard({
  cluster,
  entityType,
  onMerge,
  onDismiss,
  isMerging,
}: DuplicateClusterCardProps) {
  const { t } = useDictionary("duplicates");

  // Track all field edits: entityId -> { field -> value (null = removed) }
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});

  const handleFieldEdit = useCallback(
    (entityId: string, field: string, value: string | null) => {
      setEdits((prev) => {
        const entityEdits = { ...prev[entityId] };
        entityEdits[field] = value;
        return { ...prev, [entityId]: entityEdits };
      });
    },
    []
  );

  const handleMerge = useCallback(() => {
    const winnerId = pickBestEntity(cluster.entities);
    onMerge(cluster.reviewIds, winnerId, {}, edits, entityType);
  }, [cluster.entities, cluster.reviewIds, edits, entityType, onMerge]);

  const handleDismiss = useCallback(() => {
    onDismiss(cluster.reviewIds, edits, entityType);
  }, [cluster.reviewIds, edits, entityType, onDismiss]);

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
            <InteractiveEntityCard
              entity={entity}
              entityType={entityType}
              edits={edits}
              onFieldEdit={handleFieldEdit}
            />
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
          onClick={handleDismiss}
          disabled={isMerging}
          className="rounded-[3px] border border-white/8 bg-white/5 px-4 py-2.5 font-mohave text-[14px] text-white/40 transition-colors duration-150 hover:bg-white/10 hover:text-white/60 disabled:opacity-40"
        >
          {t("card.dismiss")}
        </button>
      </div>
    </div>
  );
}
