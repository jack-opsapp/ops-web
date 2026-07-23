"use client";

/**
 * KillswitchesTab — operator's one-click email shut-off.
 * Three sections:
 *   1. GLOBAL — hard stop, all email.
 *   2. SENDER BUCKETS — DISPATCH / GATE / FIELD_NOTES / PORTAL toggles.
 *   3. CAMPAIGNS — note pointing operators to the Scheduled Sends tab
 *      for per-campaign pauses (which write campaign:<uuid> rows).
 *
 * Switch design: outlined steel-blue when paused, gray when off. The pill
 * uses `radius: 12` (just shy of the panel radius) so it reads as a control
 * rather than a content surface.
 */
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { PauseConfirmationModal } from "./pause-confirmation-modal";

type BucketScope =
  | "bucket:dispatch"
  | "bucket:gate"
  | "bucket:field_notes"
  | "bucket:portal";

type AdminPauseScope = "global" | BucketScope;

interface ActivePauseRow {
  scope: string;
  isPaused: boolean;
  pauseReason: string | null;
  pausedUntil: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
}

interface PausesResponse {
  ok: boolean;
  active: ActivePauseRow[];
}

const BUCKETS: BucketScope[] = [
  "bucket:dispatch",
  "bucket:gate",
  "bucket:field_notes",
  "bucket:portal",
];

function bucketLabel(scope: AdminPauseScope): string {
  if (scope === "global") return "GLOBAL — ALL EMAIL";
  return scope.split(":")[1].toUpperCase();
}

interface PauseSwitchProps {
  scope: AdminPauseScope;
  state: ActivePauseRow | null;
  onPause: () => void;
  onResume: () => void;
  busy: boolean;
}

function PauseSwitch({ scope, state, onPause, onResume, busy }: PauseSwitchProps) {
  const isOn = !!state?.isPaused;
  return (
    <div
      className="flex items-center justify-between border border-white/[0.09] px-5 py-4 gap-4"
      style={{ borderRadius: 10 }}
    >
      <div className="min-w-0">
        <div className="font-cakemono font-light text-[16px] uppercase tracking-[0.04em] text-[#EDEDED]">
          {bucketLabel(scope)}
        </div>
        {state?.pauseReason && (
          <div className="mt-1 font-mono text-[11px] text-[#8A8A8A] truncate">
            [{state.pauseReason}]
          </div>
        )}
        {state?.pausedUntil && (
          <div className="mt-1 font-mono text-[11px] text-[#6A6A6A]">
            [auto-resume {new Date(state.pausedUntil).toLocaleString()}]
          </div>
        )}
      </div>
      <Switch
        checked={isOn}
        disabled={busy}
        onCheckedChange={(next) => (next ? onPause() : onResume())}
        aria-label={`${bucketLabel(scope)} pause toggle`}
        className="shrink-0"
      />
    </div>
  );
}

export function KillswitchesTab() {
  const qc = useQueryClient();
  const { data: pauses = [] } = useQuery<ActivePauseRow[]>({
    queryKey: ["email-active-pauses"],
    queryFn: async () => {
      const r = await fetch("/api/admin/email/pauses", { cache: "no-store" });
      if (!r.ok) return [];
      const j = (await r.json()) as PausesResponse;
      return j.active ?? [];
    },
    refetchInterval: 5_000,
  });

  const stateByScope = new Map<string, ActivePauseRow>(
    pauses.map((p) => [p.scope, p])
  );

  const [pendingPause, setPendingPause] = React.useState<AdminPauseScope | null>(
    null
  );

  const pauseMut = useMutation({
    mutationFn: async (input: {
      scope: AdminPauseScope;
      reason: string;
      paused_until: string | null;
    }) => {
      const r = await fetch("/api/admin/email/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `pause failed (${r.status})`);
      }
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-active-pauses"] }),
  });

  const resumeMut = useMutation({
    mutationFn: async (scope: AdminPauseScope) => {
      const r = await fetch("/api/admin/email/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `resume failed (${r.status})`);
      }
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-active-pauses"] }),
  });

  const onPause = (scope: AdminPauseScope) => setPendingPause(scope);
  const onResume = (scope: AdminPauseScope) => resumeMut.mutate(scope);
  const busyScope = (scope: AdminPauseScope) =>
    (pauseMut.isPending && pendingPause === scope) ||
    (resumeMut.isPending && resumeMut.variables === scope);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-cakemono font-light text-[20px] uppercase tracking-[0.04em] text-[#EDEDED]">
          {"// GLOBAL"}
        </h2>
        <p className="mt-1 font-mohave text-[13px] text-[#B5B5B5]">
          Hard stop. Every email send returns paused_skipped while this is on.
        </p>
        <div className="mt-4">
          <PauseSwitch
            scope="global"
            state={stateByScope.get("global") ?? null}
            onPause={() => onPause("global")}
            onResume={() => onResume("global")}
            busy={busyScope("global")}
          />
        </div>
      </section>

      <section>
        <h2 className="font-cakemono font-light text-[20px] uppercase tracking-[0.04em] text-[#EDEDED]">
          {"// SENDER BUCKETS"}
        </h2>
        <p className="mt-1 font-mohave text-[13px] text-[#B5B5B5]">
          Pause one bucket without affecting others. Use when DNS misalignment is
          bucket-specific.
        </p>
        <div className="mt-4 space-y-3">
          {BUCKETS.map((b) => (
            <PauseSwitch
              key={b}
              scope={b}
              state={stateByScope.get(b) ?? null}
              onPause={() => onPause(b)}
              onResume={() => onResume(b)}
              busy={busyScope(b)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-cakemono font-light text-[20px] uppercase tracking-[0.04em] text-[#EDEDED]">
          {"// CAMPAIGNS"}
        </h2>
        <p className="mt-1 font-mohave text-[13px] text-[#B5B5B5]">
          Pause individual campaigns from the Scheduled Sends tab. Pending jobs
          stay queued and resume automatically when lifted.
        </p>
      </section>

      <PauseConfirmationModal
        open={pendingPause !== null}
        onClose={() => setPendingPause(null)}
        onConfirm={async (reason, paused_until) => {
          if (!pendingPause) return;
          await pauseMut.mutateAsync({ scope: pendingPause, reason, paused_until });
        }}
        scopeLabel={pendingPause ? bucketLabel(pendingPause) : ""}
      />
    </div>
  );
}
