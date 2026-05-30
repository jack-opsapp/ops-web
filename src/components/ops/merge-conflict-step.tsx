"use client";

import { useCallback, useMemo, useState } from "react";
import { Circle, CircleDot } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  buildConfirmedOverrides,
  countConflicts,
  countResolved,
  allConflictsResolved,
} from "@/lib/utils/merge-conflict-overrides";
import type {
  ConflictSelections,
  ConfirmedOverrides,
  DuplicateCluster,
  MergeConflictsResult,
} from "@/lib/hooks/use-duplicate-reviews";

// ─── Value formatting ─────────────────────────────────────────────────────

/** Fields rendered in JetBrains Mono (numeric / tabular) rather than Mohave. */
const NUMERIC_FIELDS = new Set(["estimated_value", "value", "latitude", "longitude"]);

function formatConflictValue(field: string, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (field === "estimated_value" || field === "value") {
    const num = Number(raw);
    if (!Number.isNaN(num)) return `$${num.toLocaleString()}`;
  }
  return String(raw);
}

// ─── Cluster entity title lookup ──────────────────────────────────────────

const TITLE_FIELDS = ["title", "name", "contact_name", "custom_title"] as const;

function entityTitle(
  entities: DuplicateCluster["entities"],
  id: string,
  fallback: string
): string {
  const entity = entities.find((e) => e.id === id);
  if (!entity) return fallback;
  for (const f of TITLE_FIELDS) {
    const v = entity.data[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return fallback;
}

/** Substitute `{token}` placeholders in a dictionary string (t() does not). */
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    k in params ? String(params[k]) : `{${k}}`
  );
}

// ─── Value Card (one side of a conflict) ──────────────────────────────────

function ValueCard({
  optionLabel,
  value,
  field,
  provenance,
  selected,
  onSelect,
}: {
  optionLabel: string;
  value: unknown;
  field: string;
  provenance: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const isNumeric = NUMERIC_FIELDS.has(field);
  const display = formatConflictValue(field, value);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col gap-1 rounded-[5px] border px-3 py-2 text-left transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
        selected
          ? "border-white/40 bg-white/[0.08]"
          : "border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.05]"
      }`}
    >
      <span className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-wider text-white/40">
        {selected ? (
          <CircleDot className="h-[16px] w-[16px] shrink-0 text-white/70" aria-hidden />
        ) : (
          <Circle className="h-[16px] w-[16px] shrink-0 text-white/25" aria-hidden />
        )}
        {optionLabel}
      </span>
      <span
        className={`truncate ${
          isNumeric ? "font-mono" : "font-mohave"
        } text-[13px] text-white/85`}
        title={display}
      >
        {display}
      </span>
      <span className="truncate font-mono text-micro text-white/30">{provenance}</span>
    </button>
  );
}

// ─── Conflict Row (one field, two value cards) ────────────────────────────

function ConflictRow({
  field,
  fieldLabel,
  winnerValue,
  loserValue,
  loserTitle,
  selection,
  onSelect,
  disabled,
}: {
  field: string;
  fieldLabel: string;
  winnerValue: unknown;
  loserValue: unknown;
  loserTitle: string;
  selection: "winner" | "loser" | undefined;
  onSelect: (choice: "winner" | "loser") => void;
  disabled: boolean;
}) {
  const { t } = useDictionary("duplicates");
  return (
    <div className="flex flex-col gap-2 border-t border-white/8 py-4 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-micro uppercase tracking-wider text-white/40">
          {`// ${fieldLabel}`}
        </span>
        <span className="rounded-[4px] border border-[rgba(181,130,137,0.30)] bg-[rgba(181,130,137,0.12)] px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#B58289]">
          {t("conflict.tag")}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={fieldLabel}
        className={`grid grid-cols-2 gap-3 ${disabled ? "pointer-events-none opacity-40" : ""}`}
      >
        <ValueCard
          optionLabel={t("conflict.keepWinner")}
          value={winnerValue}
          field={field}
          provenance={t("conflict.fromWinner")}
          selected={selection === "winner"}
          onSelect={() => onSelect("winner")}
        />
        <ValueCard
          optionLabel={t("conflict.useAbsorbed")}
          value={loserValue}
          field={field}
          provenance={fill(t("conflict.fromAbsorbed"), { name: loserTitle })}
          selected={selection === "loser"}
          onSelect={() => onSelect("loser")}
        />
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────

function ScanningState({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4 py-6">
      <span className="font-mono text-[13px] text-white/40">{label}</span>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[72px] animate-pulse rounded-[5px] bg-white/[0.06] motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}

// ─── Merge Conflict Step ───────────────────────────────────────────────────

export interface MergeConflictStepProps {
  cluster: DuplicateCluster;
  winnerId: string;
  conflicts: MergeConflictsResult | undefined;
  isLoadingConflicts: boolean;
  conflictsError: Error | null;
  isMerging: boolean;
  mergeError: Error | null;
  /** Submit the operator-confirmed overrides to the merge route. */
  onConfirm: (payload: {
    confirmedOverrides: ConfirmedOverrides;
    resolvedCount: number;
  }) => void;
  onBack: () => void;
}

export function MergeConflictStep({
  cluster,
  winnerId,
  conflicts,
  isLoadingConflicts,
  conflictsError,
  isMerging,
  mergeError,
  onConfirm,
  onBack,
}: MergeConflictStepProps) {
  const { t } = useDictionary("duplicates");
  const [selections, setSelections] = useState<ConflictSelections>({});

  const perLoser = useMemo(() => conflicts?.perLoser ?? [], [conflicts]);
  const total = useMemo(() => countConflicts(perLoser), [perLoser]);
  const resolved = allConflictsResolved(perLoser, selections);

  const winnerTitle = entityTitle(cluster.entities, winnerId, t("conflict.winnerTag"));

  const handleSelect = useCallback(
    (loserId: string, field: string, choice: "winner" | "loser") => {
      if (isMerging) return;
      setSelections((prev) => ({
        ...prev,
        [loserId]: { ...prev[loserId], [field]: choice },
      }));
    },
    [isMerging]
  );

  const handleConfirm = useCallback(() => {
    if (!resolved || isMerging) return;
    onConfirm({
      confirmedOverrides: buildConfirmedOverrides(perLoser, selections),
      resolvedCount: countResolved(perLoser, selections),
    });
  }, [resolved, isMerging, onConfirm, perLoser, selections]);

  const countLabel = fill(t("conflict.count"), { count: total });

  return (
    <div className="flex flex-col gap-4">
      {/* Step indicator */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-micro uppercase tracking-wider text-white/40">
            {t("conflict.step")}
          </span>
          <span className="font-mono text-micro uppercase tracking-wider text-white/30">
            [{countLabel}]
          </span>
        </div>
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full w-full bg-text-2" />
        </div>
      </div>

      {/* Winner banner */}
      <div className="flex items-center justify-between gap-3 rounded-panel border border-white/8 bg-white/[0.03] p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-micro uppercase tracking-wider text-white/30">
            {t("conflict.keeping")}
          </span>
          <span className="truncate font-mohave text-[14px] text-white/90">
            {winnerTitle}
          </span>
        </div>
        <span className="shrink-0 rounded-[4px] border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
          {t("conflict.winnerTag")}
        </span>
      </div>

      {/* Body */}
      {isLoadingConflicts ? (
        <ScanningState label={t("conflict.scanning")} />
      ) : conflictsError ? (
        <div className="rounded-[5px] border border-[rgba(181,130,137,0.30)] bg-[rgba(181,130,137,0.08)] p-3">
          <span className="font-mono text-micro text-[#B58289]">
            {t("conflict.error")} · {conflictsError.message}
          </span>
        </div>
      ) : (
        <div className="flex flex-col">
          {perLoser.map((entry) => {
            const loserTitle = entityTitle(
              cluster.entities,
              entry.loserId,
              t("conflict.winnerTag")
            );
            return entry.reconciliation.conflicts.map((conflict) => (
              <ConflictRow
                key={`${entry.loserId}:${conflict.field}`}
                field={conflict.field}
                fieldLabel={t(`fields.${conflict.field}`, conflict.field)}
                winnerValue={conflict.winnerValue}
                loserValue={conflict.loserValue}
                loserTitle={loserTitle}
                selection={selections[entry.loserId]?.[conflict.field]}
                onSelect={(choice) => handleSelect(entry.loserId, conflict.field, choice)}
                disabled={isMerging}
              />
            ));
          })}
        </div>
      )}

      {/* Footer */}
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-white/8 bg-transparent pt-3">
        {mergeError && (
          <span className="font-mono text-micro text-[#B58289]">
            {t("conflict.error")} · {mergeError.message}
          </span>
        )}
        <span className="font-mono text-micro text-[#B58289]/70">
          {fill(t("conflict.reversible"), { winner: winnerTitle })}
        </span>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-micro text-white/30">
            {!resolved ? t("conflict.gateHint") : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={isMerging}
              className="rounded-[5px] border border-white/8 bg-white/5 px-4 font-cakemono text-[14px] font-light uppercase leading-[36px] text-white/40 transition-colors duration-150 hover:text-white/60 disabled:opacity-40"
            >
              {t("conflict.back")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!resolved || isMerging}
              className="rounded-[5px] border border-ops-accent px-4 font-cakemono text-[14px] font-light uppercase leading-[36px] text-ops-accent transition-colors duration-150 hover:bg-ops-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ops-accent"
            >
              {isMerging ? t("merging") : t("conflict.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
