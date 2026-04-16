"use client";

import { useDictionary } from "@/i18n/client";
import { format } from "date-fns";
import type {
  DuplicateEntityType,
  DuplicateConfidence,
  DuplicateSignal,
} from "@/lib/api/services/duplicate-detection-service";

interface DuplicatePairCardProps {
  reviewId: string;
  entityType: DuplicateEntityType;
  confidence: DuplicateConfidence;
  signals: DuplicateSignal[];
  entityA: Record<string, unknown> | null;
  entityB: Record<string, unknown> | null;
  onMerge: (reviewId: string, winnerId: string) => void;
  onDismiss: (reviewId: string) => void;
  isMerging: boolean;
}

export function DuplicatePairCard({
  reviewId,
  entityType,
  confidence,
  signals,
  entityA,
  entityB,
  onMerge,
  onDismiss,
  isMerging,
}: DuplicatePairCardProps) {
  const { t } = useDictionary("duplicates");

  if (!entityA || !entityB) return null;

  const idA = entityA.id as string;
  const idB = entityB.id as string;

  return (
    <div className="rounded-[3px] border border-white/8 bg-glass glass-surface backdrop-blur-[20px] backdrop-saturate-[1.2] p-4">
      {/* Header: confidence + signals */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-[2px] px-2 py-0.5 font-kosugi text-[10px] uppercase tracking-wider ${
            confidence === "high"
              ? "bg-red-500/20 text-red-400"
              : "bg-amber-500/20 text-amber-400"
          }`}
        >
          {t(`card.confidence.${confidence}`)}
        </span>
        {signals.map((s, i) => (
          <span
            key={i}
            className="rounded-[2px] bg-white/5 px-2 py-0.5 font-kosugi text-[10px] text-white/50"
          >
            {t(`signals.${s.type}`) || s.type}
          </span>
        ))}
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 gap-3">
        <EntitySummary entityType={entityType} entity={entityA} t={t} />
        <EntitySummary entityType={entityType} entity={entityB} t={t} />
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onMerge(reviewId, idA)}
          disabled={isMerging}
          className="flex-1 rounded-[3px] border border-white/8 bg-white/5 px-3 py-2 font-mohave text-[13px] text-white/80 transition-colors duration-150 hover:bg-white/10 disabled:opacity-40"
        >
          ← {t("card.mergeLeft")}
        </button>
        <button
          onClick={() => onMerge(reviewId, idB)}
          disabled={isMerging}
          className="flex-1 rounded-[3px] border border-white/8 bg-white/5 px-3 py-2 font-mohave text-[13px] text-white/80 transition-colors duration-150 hover:bg-white/10 disabled:opacity-40"
        >
          {t("card.mergeRight")} →
        </button>
        <button
          onClick={() => onDismiss(reviewId)}
          disabled={isMerging}
          className="rounded-[3px] border border-white/8 bg-white/5 px-3 py-2 font-mohave text-[13px] text-white/40 transition-colors duration-150 hover:bg-white/10 hover:text-white/60 disabled:opacity-40"
        >
          {t("card.dismiss")}
        </button>
      </div>
    </div>
  );
}

// ─── Entity Summary (per-type field display) ─────────────────────────────────

function EntitySummary({
  entityType,
  entity,
  t,
}: {
  entityType: DuplicateEntityType;
  entity: Record<string, unknown>;
  t: (key: string) => string;
}) {
  switch (entityType) {
    case "client":
      return <ClientSummary entity={entity} t={t} />;
    case "opportunity":
      return <OpportunitySummary entity={entity} t={t} />;
    case "project":
      return <ProjectSummary entity={entity} t={t} />;
    case "task":
      return <TaskSummary entity={entity} t={t} />;
  }
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-kosugi text-[10px] uppercase tracking-wider text-white/30">
        {label}
      </span>
      <span
        className={`font-mohave text-[13px] ${value ? "text-white/80" : "text-white/20"}`}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function formatDate(val: unknown): string | null {
  if (!val) return null;
  try {
    return format(new Date(val as string), "MMM d, yyyy");
  } catch {
    return null;
  }
}

function ClientSummary({
  entity,
  t,
}: {
  entity: Record<string, unknown>;
  t: (k: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t("fields.name")} value={entity.name as string} />
      <FieldRow
        label={t("fields.email")}
        value={entity.email as string | null}
      />
      <FieldRow
        label={t("fields.phone")}
        value={entity.phone_number as string | null}
      />
      <FieldRow
        label={t("fields.address")}
        value={entity.address as string | null}
      />
      <FieldRow
        label={t("fields.created")}
        value={formatDate(entity.created_at)}
      />
    </div>
  );
}

function OpportunitySummary({
  entity,
  t,
}: {
  entity: Record<string, unknown>;
  t: (k: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t("fields.title")} value={entity.title as string} />
      <FieldRow
        label={t("fields.contact")}
        value={entity.contact_name as string | null}
      />
      <FieldRow
        label={t("fields.email")}
        value={entity.contact_email as string | null}
      />
      <FieldRow
        label={t("fields.stage")}
        value={entity.stage as string | null}
      />
      <FieldRow
        label={t("fields.value")}
        value={
          entity.estimated_value
            ? `$${Number(entity.estimated_value).toLocaleString()}`
            : null
        }
      />
    </div>
  );
}

function ProjectSummary({
  entity,
  t,
}: {
  entity: Record<string, unknown>;
  t: (k: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t("fields.title")} value={entity.title as string} />
      <FieldRow
        label={t("fields.status")}
        value={entity.status as string | null}
      />
      <FieldRow
        label={t("fields.address")}
        value={entity.address as string | null}
      />
      <FieldRow
        label={t("fields.created")}
        value={formatDate(entity.created_at)}
      />
    </div>
  );
}

function TaskSummary({
  entity,
  t,
}: {
  entity: Record<string, unknown>;
  t: (k: string) => string;
}) {
  const startDate = entity.start_date
    ? format(new Date(entity.start_date as string), "MMM d")
    : null;
  const endDate = entity.end_date
    ? format(new Date(entity.end_date as string), "MMM d")
    : null;
  const dateRange =
    startDate && endDate ? `${startDate} – ${endDate}` : startDate;

  return (
    <div className="flex flex-col gap-2">
      <FieldRow
        label={t("fields.title")}
        value={
          (entity.custom_title as string | null) ||
          (entity.task_type_id as string)
        }
      />
      <FieldRow label={t("fields.dates")} value={dateRange} />
      <FieldRow
        label={t("fields.status")}
        value={entity.status as string | null}
      />
    </div>
  );
}
