"use client";

/**
 * Is the engine alive, and what is it allowed to do on its own. Last run,
 * next due, last check-in, stall state; then per-kind modes as segment
 * controls (auto never offered for the kinds that stay human) and the caps.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentControl } from "@/components/ui/segment-control";
import { Tag } from "@/components/ui/tag";
import type { EngineSettingsPatch, EngineSettingsRow } from "@/lib/ads/engine/admin";
import type { ProposalKind, ProposalMode } from "@/lib/ads/engine/types";
import type { HealthResponse } from "@/lib/hooks/use-ads-engine";
import { BUTTONS, EMPTY, ERROR, HEALTH, KIND_NAMES, LABELS } from "./copy";
import { ago, inHours, shortDateTime } from "./format";
import { PanelLabel, PanelSkeleton, PanelStatus } from "./panel";

export interface EngineHealthProps {
  health: HealthResponse | undefined;
  settings: EngineSettingsRow | undefined;
  humanOnlyKinds: ProposalKind[];
  kinds: readonly ProposalKind[];
  isPending: boolean;
  error: Error | null;
  saving?: boolean;
  saveError?: string | null;
  onSave: (patch: EngineSettingsPatch) => void;
  onRetry?: () => void;
  now?: Date;
}

type CapKey = keyof typeof HEALTH.caps;
const CAP_KEYS = Object.keys(HEALTH.caps) as CapKey[];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] items-baseline gap-1 border-b border-border-subtle py-0.5 last:border-b-0">
      <p className="font-mono text-micro uppercase tracking-wider text-text-3">{label}</p>
      <div className="min-w-0 font-mohave text-body-sm text-text-2">{children}</div>
    </div>
  );
}

export function EngineHealth({ health, settings, humanOnlyKinds, kinds, isPending, error, saving = false, saveError, onSave, onRetry, now = new Date() }: EngineHealthProps) {
  const [caps, setCaps] = useState<Record<CapKey, string>>({} as Record<CapKey, string>);
  useEffect(() => {
    if (!settings) return;
    setCaps(Object.fromEntries(CAP_KEYS.map((key) => [key, String(settings[key])])) as Record<CapKey, string>);
  }, [settings]);

  const dirty = settings ? CAP_KEYS.filter((key) => caps[key] !== undefined && caps[key] !== String(settings[key])) : [];
  const saveCaps = () => {
    const patch: EngineSettingsPatch = {};
    for (const key of dirty) {
      const value = Number(caps[key]);
      if (Number.isFinite(value)) (patch as Record<string, number>)[key] = value;
    }
    if (Object.keys(patch).length > 0) onSave(patch);
  };

  const stateTag = health
    ? !health.campaigns_live
      ? { label: HEALTH.dark, variant: "dim" as const }
      : health.stall.stalled
        ? { label: HEALTH.stalled, variant: "rose" as const }
        : { label: HEALTH.checkedIn, variant: "olive" as const }
    : null;

  return (
    <section id="engine" aria-labelledby="engine-health-label" className="scroll-mt-4">
      <PanelLabel id="engine-health-label">{LABELS.engine}</PanelLabel>
      {isPending ? (
        <PanelSkeleton rows={4} />
      ) : error || !health || !settings ? (
        <PanelStatus tone="error" action={onRetry ? { label: BUTTONS.retry, onClick: onRetry } : undefined}>
          {ERROR.load}
        </PanelStatus>
      ) : (
        <div className="mt-1 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="glass-surface rounded-panel p-2">
            <Row label={HEALTH.state}>
              <div className="flex flex-wrap items-center gap-0.5">
                {stateTag && <Tag variant={stateTag.variant}>{stateTag.label}</Tag>}
                {health.rehearsal && <Tag variant="tan">{HEALTH.rehearsal}</Tag>}
              </div>
            </Row>
            <Row label={HEALTH.lastRun}>
              {health.last_run ? (
                <span>
                  <span className="font-mono text-micro tabular-nums text-text-3">{shortDateTime(health.last_run.created_at)}</span>
                  {" · "}
                  {health.last_run.duties.join(", ") || "—"}
                  {" · "}
                  <span className="font-mono text-micro text-text-3">{health.last_run.outcome ?? health.last_run.state}</span>
                  {health.last_run.summary && <span className="block truncate font-mono text-micro text-text-3">{health.last_run.summary.split("\n")[0]}</span>}
                </span>
              ) : (
                <span className="text-text-3">{EMPTY.runs}</span>
              )}
            </Row>
            <Row label={HEALTH.nextRun}>
              <span className="font-mono text-micro tabular-nums">{inHours(health.next_due_at, now)}</span>
              <span className="font-mono text-micro text-text-3"> · {shortDateTime(health.next_due_at)}</span>
            </Row>
            <Row label={HEALTH.checkIn}>
              <span className="font-mono text-micro tabular-nums">{ago(health.heartbeat_at, now)}</span>
            </Row>
            <Row label={HEALTH.google}>
              <span className="font-mono text-micro">{health.google === "available" ? HEALTH.googleAvailable : HEALTH.googleUnavailable}</span>
            </Row>
            <Row label={HEALTH.snapshot}>
              <span className="font-mono text-micro tabular-nums">{ago(health.snapshot_at, now)}</span>
            </Row>
          </div>

          <div className="glass-surface rounded-panel p-2">
            <p className="font-mono text-micro uppercase tracking-wider text-text-3">{LABELS.modes}</p>
            <ul className="mt-0.5">
              {kinds.map((kind) => {
                const humanOnly = humanOnlyKinds.includes(kind);
                const value = settings.modes[kind];
                const options = (humanOnly ? (["propose", "off"] as const) : (["propose", "auto", "off"] as const)).map((mode) => ({ value: mode, label: HEALTH.modeOptions[mode] }));
                return (
                  <li key={kind} className="flex items-center justify-between gap-1 border-b border-border-subtle py-0.5 last:border-b-0">
                    <div className="min-w-0">
                      <p className="font-mohave text-body-sm text-text-2">{KIND_NAMES[kind]}</p>
                      {humanOnly && <p className="font-mono text-micro text-text-mute">{HEALTH.humanOnly}</p>}
                    </div>
                    <SegmentControl<ProposalMode>
                      mode="choice"
                      ariaLabel={`${KIND_NAMES[kind]} mode`}
                      options={options}
                      value={value}
                      disabled={saving}
                      onChange={(mode) => onSave({ modes: { [kind]: mode } })}
                    />
                  </li>
                );
              })}
            </ul>

            <p className="mt-2 font-mono text-micro uppercase tracking-wider text-text-3">{LABELS.caps}</p>
            <div className="mt-0.5 grid grid-cols-2 gap-1">
              {CAP_KEYS.map((key) => (
                <Input
                  key={key}
                  label={HEALTH.caps[key]}
                  type="number"
                  inputMode="decimal"
                  className="font-mono text-data-sm tabular-nums"
                  value={caps[key] ?? ""}
                  onChange={(event) => setCaps((current) => ({ ...current, [key]: event.target.value }))}
                />
              ))}
            </div>
            <div className="mt-1 flex items-center justify-end gap-1">
              {saveError && <p className="font-mono text-micro text-rose">{saveError}</p>}
              {dirty.length > 0 && (
                <Button variant="default" size="sm" loading={saving} onClick={saveCaps}>
                  {BUTTONS.save}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
