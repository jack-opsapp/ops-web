"use client";

import { useState, useMemo, useCallback } from "react";
import { useDictionary } from "@/i18n/client";
import type {
  DuplicateEntityType,
} from "@/lib/api/services/duplicate-detection-service";
import type { DuplicateCluster, EnrichedEntity } from "@/lib/hooks/use-duplicate-reviews";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DuplicateClusterCardProps {
  cluster: DuplicateCluster;
  entityType: DuplicateEntityType;
  onMerge: (
    reviewIds: string[],
    winnerId: string,
    fieldOverrides: Record<string, unknown>
  ) => void;
  onDismiss: (reviewIds: string[]) => void;
  isMerging: boolean;
}

/** Fields that are user-visible and resolvable per entity type */
const DISPLAY_FIELDS: Record<DuplicateEntityType, string[]> = {
  client: ["name", "email", "phone_number", "address", "notes"],
  opportunity: [
    "title",
    "contact_name",
    "contact_email",
    "contact_phone",
    "address",
    "description",
    "estimated_value",
  ],
  project: ["title", "address", "notes", "description"],
  task: ["custom_title", "task_notes"],
};

/** The primary label field for each entity type (shown in the radio list) */
const LABEL_FIELD: Record<DuplicateEntityType, string> = {
  client: "name",
  opportunity: "title",
  project: "title",
  task: "custom_title",
};

/** Summary fields shown under each entity in the selection list */
const SUMMARY_FIELDS: Record<DuplicateEntityType, string[]> = {
  client: ["email", "phone_number", "address"],
  opportunity: ["contact_email", "contact_phone", "address"],
  project: ["address", "description"],
  task: ["task_notes"],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFieldValue(entity: EnrichedEntity, field: string): string {
  const val = entity.data[field];
  if (val === null || val === undefined || val === "") return "";
  return String(val);
}

function countNonNullFields(entity: EnrichedEntity, fields: string[]): number {
  let count = 0;
  for (const f of fields) {
    const val = entity.data[f];
    if (val !== null && val !== undefined && val !== "") count++;
  }
  return count;
}

/**
 * For a given field, collect all unique non-empty values across entities.
 * Returns an array of { value, entityIds } for deduplication.
 */
function getUniqueFieldValues(
  entities: EnrichedEntity[],
  field: string
): { value: string; entityIds: string[] }[] {
  const map = new Map<string, string[]>();
  for (const e of entities) {
    const val = getFieldValue(e, field);
    if (!val) continue;
    const existing = map.get(val);
    if (existing) {
      existing.push(e.id);
    } else {
      map.set(val, [e.id]);
    }
  }
  return Array.from(map.entries()).map(([value, entityIds]) => ({
    value,
    entityIds,
  }));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DuplicateClusterCard({
  cluster,
  entityType,
  onMerge,
  onDismiss,
  isMerging,
}: DuplicateClusterCardProps) {
  const { t } = useDictionary("duplicates");
  const displayFields = DISPLAY_FIELDS[entityType];
  const labelField = LABEL_FIELD[entityType];
  const summaryFields = SUMMARY_FIELDS[entityType];

  // Default winner: entity with the most non-null fields
  const defaultWinnerId = useMemo(() => {
    let bestId = cluster.entities[0]?.id ?? "";
    let bestCount = -1;
    for (const e of cluster.entities) {
      const count = countNonNullFields(e, displayFields);
      if (count > bestCount) {
        bestCount = count;
        bestId = e.id;
      }
    }
    return bestId;
  }, [cluster.entities, displayFields]);

  const [winnerId, setWinnerId] = useState(defaultWinnerId);

  // Resolved field values: start from winner, backfill from losers
  const initialResolved = useMemo(() => {
    const winner = cluster.entities.find((e) => e.id === winnerId);
    if (!winner) return {};
    const resolved: Record<string, string> = {};
    for (const field of displayFields) {
      // Start with winner value
      const winnerVal = getFieldValue(winner, field);
      if (winnerVal) {
        resolved[field] = winnerVal;
      } else {
        // Backfill: first non-empty value from any other entity
        for (const e of cluster.entities) {
          if (e.id === winnerId) continue;
          const val = getFieldValue(e, field);
          if (val) {
            resolved[field] = val;
            break;
          }
        }
      }
      if (!resolved[field]) resolved[field] = "";
    }
    return resolved;
  }, [winnerId, cluster.entities, displayFields]);

  const [resolvedFields, setResolvedFields] =
    useState<Record<string, string>>(initialResolved);

  // Recalculate resolved fields when winner changes
  const handleWinnerChange = useCallback(
    (newWinnerId: string) => {
      setWinnerId(newWinnerId);
      const winner = cluster.entities.find((e) => e.id === newWinnerId);
      if (!winner) return;
      const newResolved: Record<string, string> = {};
      for (const field of displayFields) {
        const winnerVal = getFieldValue(winner, field);
        if (winnerVal) {
          newResolved[field] = winnerVal;
        } else {
          for (const e of cluster.entities) {
            if (e.id === newWinnerId) continue;
            const val = getFieldValue(e, field);
            if (val) {
              newResolved[field] = val;
              break;
            }
          }
        }
        if (!newResolved[field]) newResolved[field] = "";
      }
      setResolvedFields(newResolved);
    },
    [cluster.entities, displayFields]
  );

  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      setResolvedFields((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleMerge = useCallback(() => {
    // Build field overrides: only include fields that differ from the winner's original values
    const winner = cluster.entities.find((e) => e.id === winnerId);
    if (!winner) return;
    const overrides: Record<string, unknown> = {};
    for (const field of displayFields) {
      const winnerVal = getFieldValue(winner, field);
      const resolvedVal = resolvedFields[field] ?? "";
      if (resolvedVal !== winnerVal) {
        overrides[field] = resolvedVal || null;
      }
    }
    onMerge(cluster.reviewIds, winnerId, overrides);
  }, [cluster, winnerId, resolvedFields, displayFields, onMerge]);

  const handleDismiss = useCallback(() => {
    onDismiss(cluster.reviewIds);
  }, [cluster.reviewIds, onDismiss]);

  return (
    <div className="rounded-[3px] border border-white/8 bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]">
      {/* Header: confidence + signals */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/8 px-4 py-3">
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
            className="rounded-[2px] bg-white/5 px-2 py-0.5 font-kosugi text-[10px] text-white/50"
          >
            {t(`signals.${s.type}`) || s.type}
          </span>
        ))}
      </div>

      {/* Entity selection (radio list) */}
      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex flex-col gap-2">
          {cluster.entities.map((entity) => {
            const isSelected = entity.id === winnerId;
            const label =
              getFieldValue(entity, labelField) || entity.id.slice(0, 8);
            const summaryParts = summaryFields
              .map((f) => getFieldValue(entity, f))
              .filter(Boolean);
            const summaryText =
              summaryParts.length > 0
                ? summaryParts.join(" | ")
                : "";

            return (
              <button
                key={entity.id}
                type="button"
                onClick={() => handleWinnerChange(entity.id)}
                className={`flex items-start gap-3 rounded-[3px] border px-3 py-2.5 text-left transition-colors duration-150 ${
                  isSelected
                    ? "border-[#597794]/40 bg-[#597794]/8"
                    : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                {/* Radio indicator */}
                <div className="mt-0.5 flex-shrink-0">
                  <div
                    className={`h-3.5 w-3.5 rounded-full border-2 transition-colors duration-150 ${
                      isSelected
                        ? "border-[#597794] bg-[#597794]"
                        : "border-white/30 bg-transparent"
                    }`}
                  >
                    {isSelected && (
                      <div className="flex h-full w-full items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Entity info */}
                <div className="min-w-0 flex-1">
                  <span
                    className={`font-mohave text-[14px] leading-tight ${
                      isSelected ? "text-white/90" : "text-white/70"
                    }`}
                  >
                    {label}
                  </span>
                  {summaryText && (
                    <div className="mt-0.5 truncate font-mohave text-[12px] text-white/35">
                      {summaryParts.map((part, idx) => (
                        <span key={idx}>
                          {idx > 0 && (
                            <span className="mx-1.5 text-white/15">|</span>
                          )}
                          {part}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Merged Result — field conflict resolution */}
      <div className="px-4 py-3">
        <span className="mb-2.5 block font-kosugi text-[10px] uppercase tracking-wider text-white/40">
          {t("card.mergedResult")}
        </span>

        <div className="flex flex-col gap-2.5">
          {displayFields.map((field) => {
            const uniqueValues = getUniqueFieldValues(
              cluster.entities,
              field
            );
            const currentValue = resolvedFields[field] ?? "";
            const fieldLabel =
              t(`fields.${field}`) || field.replace(/_/g, " ");
            const hasConflict = uniqueValues.length > 1;

            return (
              <FieldResolver
                key={field}
                field={field}
                label={fieldLabel}
                currentValue={currentValue}
                uniqueValues={uniqueValues}
                hasConflict={hasConflict}
                onChange={handleFieldChange}
              />
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-white/8 px-4 py-3">
        <button
          type="button"
          onClick={handleMerge}
          disabled={isMerging}
          className="flex-1 rounded-[3px] bg-[#597794]/20 px-4 py-2 font-mohave text-[13px] font-medium text-[#597794] transition-colors duration-150 hover:bg-[#597794]/30 disabled:opacity-40"
        >
          {isMerging ? t("merging") : t("card.merge")}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isMerging}
          className="rounded-[3px] border border-white/8 bg-white/5 px-4 py-2 font-mohave text-[13px] text-white/40 transition-colors duration-150 hover:bg-white/10 hover:text-white/60 disabled:opacity-40"
        >
          {t("card.dismiss")}
        </button>
      </div>
    </div>
  );
}

// ─── Field Resolver ─────────────────────────────────────────────────────────

function FieldResolver({
  field,
  label,
  currentValue,
  uniqueValues,
  hasConflict,
  onChange,
}: {
  field: string;
  label: string;
  currentValue: string;
  uniqueValues: { value: string; entityIds: string[] }[];
  hasConflict: boolean;
  onChange: (field: string, value: string) => void;
}) {
  // If no values exist at all, show empty editable input
  if (uniqueValues.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-kosugi text-[10px] uppercase tracking-wider text-white/30">
          {label}
        </span>
        <input
          type="text"
          value={currentValue}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder="--"
          className="rounded-[2px] border border-white/8 bg-white/[0.03] px-2.5 py-1.5 font-mohave text-[13px] text-white/80 placeholder:text-white/20 transition-colors duration-150 focus:border-white/15 focus:outline-none"
        />
      </div>
    );
  }

  // If only one unique value (no conflict), show editable input with the value
  if (!hasConflict) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-kosugi text-[10px] uppercase tracking-wider text-white/30">
          {label}
        </span>
        <input
          type="text"
          value={currentValue}
          onChange={(e) => onChange(field, e.target.value)}
          className="rounded-[2px] border border-white/8 bg-white/[0.03] px-2.5 py-1.5 font-mohave text-[13px] text-white/80 placeholder:text-white/20 transition-colors duration-150 focus:border-white/15 focus:outline-none"
        />
      </div>
    );
  }

  // Conflict: show radio choices + editable input
  return (
    <div className="flex flex-col gap-1">
      <span className="font-kosugi text-[10px] uppercase tracking-wider text-white/30">
        {label}
      </span>

      {/* Radio choices for each unique value */}
      <div className="flex flex-col gap-1">
        {uniqueValues.map((uv, idx) => {
          const isSelected = currentValue === uv.value;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onChange(field, uv.value)}
              className={`flex items-center gap-2 rounded-[2px] px-2.5 py-1 text-left transition-colors duration-150 ${
                isSelected
                  ? "bg-[#597794]/10"
                  : "bg-transparent hover:bg-white/[0.03]"
              }`}
            >
              <div
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full border transition-colors duration-150 ${
                  isSelected
                    ? "border-[#597794] bg-[#597794]"
                    : "border-white/25 bg-transparent"
                }`}
              />
              <span
                className={`truncate font-mohave text-[13px] ${
                  isSelected ? "text-white/80" : "text-white/50"
                }`}
              >
                {uv.value}
              </span>
            </button>
          );
        })}
      </div>

      {/* Editable input for custom value */}
      <input
        type="text"
        value={currentValue}
        onChange={(e) => onChange(field, e.target.value)}
        className="mt-0.5 rounded-[2px] border border-white/8 bg-white/[0.03] px-2.5 py-1.5 font-mohave text-[13px] text-white/80 placeholder:text-white/20 transition-colors duration-150 focus:border-white/15 focus:outline-none"
      />
    </div>
  );
}
