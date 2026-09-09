"use client";

/**
 * Google Ads engine — console data hooks.
 *
 * Every read is a TanStack query against the admin engine routes (the auth
 * cookie rides along); every write invalidates the reads it changes. Shapes
 * are the route responses, typed from the server modules by type only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminChangeRow, AdminProposalRow, AdminRunRow, EngineSettingsPatch, EngineSettingsRow } from "@/lib/ads/engine/admin";
import type { ApplyOutcome } from "@/lib/ads/engine/apply";
import type { FunnelRow } from "@/lib/ads/engine/brief";
import type { ProposalKind, ProposalState, TestRecord } from "@/lib/ads/engine/types";

export const ADS_ENGINE_KEYS = {
  all: ["ads-engine"] as const,
  proposals: (state: string) => ["ads-engine", "proposals", state] as const,
  settings: ["ads-engine", "settings"] as const,
  tests: ["ads-engine", "tests"] as const,
  changes: ["ads-engine", "changes"] as const,
  funnel: ["ads-engine", "funnel"] as const,
  health: ["ads-engine", "health"] as const,
};

export interface ProposalsResponse {
  proposals: AdminProposalRow[];
  counts: Record<ProposalState, number>;
}

export type ReviewOutcome = ApplyOutcome | { state: "pending"; reason: "google_unavailable" | "apply_timeout" } | { state: "rejected" };

export interface ReviewResponse {
  proposal: AdminProposalRow | null;
  outcome: ReviewOutcome;
}

export interface SettingsResponse {
  settings: EngineSettingsRow;
  human_only_kinds: ProposalKind[];
  structural_kinds: ProposalKind[];
  kinds: readonly ProposalKind[];
}

export type TestRow = TestRecord & {
  control: { headlines: string[]; status: string } | null;
  challenger: { headlines: string[]; status: string } | null;
};

export interface HealthResponse {
  last_run: AdminRunRow | null;
  recent_runs: AdminRunRow[];
  next_due_at: string;
  heartbeat_at: string | null;
  heartbeat_age_hours: number | null;
  stall: { stalled: boolean; threshold_hours: number; campaigns_live: boolean };
  campaigns_live: boolean;
  google: "available" | "unavailable";
  rehearsal: boolean;
  counts: Record<ProposalState, number>;
  modes: Record<ProposalKind, "propose" | "auto" | "off">;
  snapshot_at: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

async function sendJson<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as T & { code?: string; issues?: Array<{ field: string; message: string }> };
  if (!response.ok) {
    const detail = payload.issues?.map((issue) => issue.message).join(" ") ?? payload.code ?? `${response.status}`;
    throw new Error(detail);
  }
  return payload;
}

const BASE = "/api/admin/google-ads/engine";

export function useEngineProposals(state = "proposed") {
  return useQuery({ queryKey: ADS_ENGINE_KEYS.proposals(state), queryFn: () => getJson<ProposalsResponse>(`${BASE}/proposals?state=${encodeURIComponent(state)}`), refetchInterval: 60_000 });
}

export function useEngineSettings() {
  return useQuery({ queryKey: ADS_ENGINE_KEYS.settings, queryFn: () => getJson<SettingsResponse>(`${BASE}/settings`) });
}

export function useEngineTests() {
  return useQuery({ queryKey: ADS_ENGINE_KEYS.tests, queryFn: () => getJson<{ tests: TestRow[] }>(`${BASE}/tests`) });
}

export function useEngineChanges() {
  return useQuery({ queryKey: ADS_ENGINE_KEYS.changes, queryFn: () => getJson<{ changes: AdminChangeRow[] }>(`${BASE}/changes`) });
}

export function useEngineFunnel() {
  return useQuery({ queryKey: ADS_ENGINE_KEYS.funnel, queryFn: () => getJson<{ rows: FunnelRow[]; available: boolean }>(`${BASE}/funnel`) });
}

export function useEngineHealth() {
  return useQuery({ queryKey: ADS_ENGINE_KEYS.health, queryFn: () => getJson<HealthResponse>(`${BASE}/health`), refetchInterval: 60_000 });
}

export function useReviewProposal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, notes }: { id: string; decision: "approve" | "reject"; notes?: string }) =>
      sendJson<ReviewResponse>(`${BASE}/proposals/${id}`, "POST", notes ? { decision, notes } : { decision }),
    onSettled: () => client.invalidateQueries({ queryKey: ADS_ENGINE_KEYS.all }),
  });
}

export function useUpdateEngineSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: EngineSettingsPatch) => sendJson<{ settings: EngineSettingsRow }>(`${BASE}/settings`, "PATCH", patch),
    onSuccess: (data) => {
      client.setQueryData<SettingsResponse>(ADS_ENGINE_KEYS.settings, (previous) => (previous ? { ...previous, settings: data.settings } : previous));
      void client.invalidateQueries({ queryKey: ADS_ENGINE_KEYS.health });
    },
  });
}
