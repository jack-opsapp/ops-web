/**
 * OPS Web — Lead detail inline field-edit hook.
 *
 * A lean, field-level edit primitive for the lead detail window (map-backed
 * band + Overview tab). Composes on top of {@link useUpdateOpportunity}, which
 * already owns the optimistic cache patch + rollback + settle-invalidate, and
 * adds only per-field save-state tracking (`idle → saving → saved → idle`,
 * `error` on failure).
 *
 * This is intentionally NOT the pipeline-table `useOpportunityCellEdit` — that
 * hook is coupled to `PipelineTableRow` and carries a visible-undo stack for a
 * dense grid. Here each editor knows its own prior value and guards no-op
 * commits itself, so the hook stays minimal.
 *
 * Semantics: last-writer-wins (opportunities have no `updated_at`-guarded write
 * path — same documented delta as the table cell-edit hook). Rollback on error
 * is owned by `useUpdateOpportunity`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useUpdateOpportunity } from "@/lib/hooks/use-opportunities";
import type {
  OpportunityPriority,
  OpportunitySource,
  UpdateOpportunity,
} from "@/lib/types/pipeline";

/** Fields the lead detail surfaces can edit in place. */
export type EditableOpportunityField =
  | "estimatedValue"
  | "source"
  | "assignedTo"
  | "expectedCloseDate"
  | "priority"
  | "description"
  | "tags"
  | "address";

/** Address commits move the pin too, so they carry the geocoded coordinates. */
export interface AddressEditValue {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type FieldSaveState = "idle" | "saving" | "saved" | "error";

/** How long a field sits in the "saved" pulse before reverting to idle (ms). */
const SAVED_RESET_MS = 1_500;

// ─── Coercion helpers ────────────────────────────────────────────────────────

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function toNullableDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter((tag) => tag.length > 0);
}

/**
 * Pure: map an editable field + raw value to the `Partial<UpdateOpportunity>`
 * the service expects. Exported for exhaustive unit testing.
 */
export function buildOpportunityFieldUpdate(
  field: EditableOpportunityField,
  value: unknown
): Partial<UpdateOpportunity> {
  switch (field) {
    case "estimatedValue":
      return { estimatedValue: toNullableNumber(value) };
    case "source":
      return { source: (value ?? null) as OpportunitySource | null };
    case "assignedTo":
      return { assignedTo: toNullableString(value) };
    case "expectedCloseDate":
      return { expectedCloseDate: toNullableDate(value) };
    case "priority":
      return { priority: (value ?? null) as OpportunityPriority | null };
    case "description":
      return { description: toNullableString(value) };
    case "tags":
      return { tags: toTagList(value) };
    case "address": {
      const v = (value ?? {}) as Partial<AddressEditValue>;
      return {
        address: v.address ?? null,
        latitude: v.latitude ?? null,
        longitude: v.longitude ?? null,
      };
    }
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseOpportunityFieldEdit {
  /** Current save state for a field (defaults to "idle"). */
  saveState: (field: EditableOpportunityField) => FieldSaveState;
  /** Commit a field edit optimistically. Editors guard their own no-ops. */
  commit: (field: EditableOpportunityField, value: unknown) => Promise<void>;
}

export function useOpportunityFieldEdit(
  opportunityId: string
): UseOpportunityFieldEdit {
  const { mutateAsync } = useUpdateOpportunity();
  const [states, setStates] = useState<
    Map<EditableOpportunityField, FieldSaveState>
  >(() => new Map());

  // Per-field "saved → idle" timers, cleared on unmount.
  const timersRef = useRef<
    Map<EditableOpportunityField, ReturnType<typeof setTimeout>>
  >(new Map());
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const setFieldState = useCallback(
    (field: EditableOpportunityField, state: FieldSaveState) => {
      const existing = timersRef.current.get(field);
      if (existing) {
        clearTimeout(existing);
        timersRef.current.delete(field);
      }

      setStates((current) => {
        const next = new Map(current);
        if (state === "idle") next.delete(field);
        else next.set(field, state);
        return next;
      });

      if (state === "saved") {
        const timer = setTimeout(() => {
          timersRef.current.delete(field);
          setStates((current) => {
            if (current.get(field) !== "saved") return current;
            const next = new Map(current);
            next.delete(field);
            return next;
          });
        }, SAVED_RESET_MS);
        timersRef.current.set(field, timer);
      }
    },
    []
  );

  const commit = useCallback(
    async (field: EditableOpportunityField, value: unknown): Promise<void> => {
      setFieldState(field, "saving");
      try {
        await mutateAsync({
          id: opportunityId,
          data: buildOpportunityFieldUpdate(field, value),
        });
        setFieldState(field, "saved");
      } catch {
        // Rollback already happened inside useUpdateOpportunity's onError.
        setFieldState(field, "error");
      }
    },
    [mutateAsync, opportunityId, setFieldState]
  );

  const saveState = useCallback(
    (field: EditableOpportunityField): FieldSaveState =>
      states.get(field) ?? "idle",
    [states]
  );

  return { saveState, commit };
}
