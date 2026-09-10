/**
 * Google Ads engine — the admin review surface (design spec §5.3, §6).
 *
 * Pure handlers behind `withAdmin`: list proposals, approve (then apply
 * synchronously within a budget) or reject with a reason, read and change the
 * guardrail settings (auto is refused for the kinds that stay human in v1),
 * and the readouts the console renders: tests, the change ledger, the funnel
 * and engine health.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ApplyOutcome, ApplyProposalRecord } from "./apply";
import type { FunnelRow } from "./brief";
import { HUMAN_ONLY_KINDS, STRUCTURAL_KINDS } from "./guardrails";
import {
  PROPOSAL_KINDS,
  type ChangeRecord,
  type EngineSettings,
  type EntitySnapshot,
  type ProposalKind,
  type ProposalState,
  type TestRecord,
} from "./types";

export interface AdminProposalRow {
  id: string;
  run_id: string;
  kind: ProposalKind;
  target: string;
  submission_index: number;
  state: ProposalState;
  mode_at_submit: "propose" | "auto";
  payload: Record<string, unknown>;
  evidence: unknown[];
  rationale: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  applied_by: string | null;
  applied_resource_names: string[] | null;
  label: string | null;
  error: string | null;
  google_validation: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
  updated_at: string;
}

export interface EngineSettingsRow extends EngineSettings {
  stall_notified_on: string | null;
  updated_at: string;
}

export interface EngineSettingsPatch {
  modes?: Partial<Record<ProposalKind, "propose" | "auto" | "off">>;
  monthly_cap?: number;
  daily_cap?: number;
  max_budget_change_pct?: number;
  budget_cooldown_days?: number;
  max_structural_per_run?: number;
  target_cost_per_trial?: number;
  stall_hours?: number;
}

export interface AdminRunRow {
  id: string;
  state: string;
  worker: string;
  duties: string[];
  outcome: string | null;
  summary: string | null;
  proposals_accepted: number;
  proposals_rejected: number;
  brief_version: string | null;
  created_at: string;
  released_at: string | null;
}

export type AdminChangeRow = ChangeRecord & {
  proposal: { kind: ProposalKind; rationale: string; reviewed_by: string | null; applied_by: string | null; label: string | null } | null;
};

export interface EngineAdminRepository {
  listProposals(states: ProposalState[]): Promise<AdminProposalRow[]>;
  findProposal(id: string): Promise<AdminProposalRow | null>;
  reviewProposal(id: string, decision: "approve" | "reject", reviewer: string, notes: string | null): Promise<string | null>;
  readSettingsRow(): Promise<EngineSettingsRow>;
  updateSettings(patch: EngineSettingsPatch): Promise<EngineSettingsRow>;
  listTests(): Promise<TestRecord[]>;
  listChanges(sinceIso: string): Promise<AdminChangeRow[]>;
  funnelByKeyword(): Promise<FunnelRow[]>;
  lastRuns(limit: number): Promise<AdminRunRow[]>;
  countByState(): Promise<Record<ProposalState, number>>;
  readSnapshot(): Promise<EntitySnapshot>;
}

export interface EngineAdminDependencies {
  repository: EngineAdminRepository;
  now: () => Date;
  /** Applies one proposal; null when Google cannot be reached (the worker applies later). */
  apply: ((proposal: ApplyProposalRecord) => Promise<ApplyOutcome>) | null;
  applyTimeoutMs?: number;
  googleAvailable: boolean;
  rehearsal: boolean;
}

export const DEFAULT_APPLY_TIMEOUT_MS = 25_000;
/** The routine's schedule: 15:00 UTC daily (08:00 Vancouver). */
export const ROUTINE_HOUR_UTC = 15;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

const PROPOSAL_STATES: ProposalState[] = ["proposed", "approved", "rejected", "applied", "failed", "expired"];
const uuidSchema = z.string().uuid();
const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
const modeSchema = z.enum(["propose", "auto", "off"]);
const settingsPatchSchema = z
  .object({
    modes: z.object(Object.fromEntries(PROPOSAL_KINDS.map((kind) => [kind, modeSchema.optional()]))).strict().optional(),
    monthly_cap: z.number().positive().max(100_000).optional(),
    daily_cap: z.number().positive().max(10_000).optional(),
    max_budget_change_pct: z.number().int().min(1).max(50).optional(),
    budget_cooldown_days: z.number().int().min(1).max(90).optional(),
    max_structural_per_run: z.number().int().min(0).max(20).optional(),
    target_cost_per_trial: z.number().positive().max(10_000).optional(),
    stall_hours: z.number().int().min(6).max(240).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to change." });

function issuesOf(error: z.ZodError) {
  return error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function nextRoutineDue(now: Date): Date {
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ROUTINE_HOUR_UTC, 0, 0, 0));
  if (due.getTime() <= now.getTime()) due.setUTCDate(due.getUTCDate() + 1);
  return due;
}

function toApplyRecord(row: AdminProposalRow): ApplyProposalRecord {
  return { id: row.id, run_id: row.run_id, kind: row.kind, target: row.target, state: row.state, mode_at_submit: row.mode_at_submit, payload: row.payload };
}

export function createEngineAdminHandlers(d: EngineAdminDependencies) {
  const { repository } = d;
  const timeout = d.applyTimeoutMs ?? DEFAULT_APPLY_TIMEOUT_MS;

  async function listProposals(request: NextRequest): Promise<NextResponse> {
    const raw = request.nextUrl.searchParams.get("state") ?? "proposed";
    const states = raw === "all" ? PROPOSAL_STATES : raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (states.some((s) => !PROPOSAL_STATES.includes(s as ProposalState)))
      return json({ code: "SCHEMA_INVALID", issues: [{ field: "state", message: `Unknown state in "${raw}".` }] }, 422);
    const [proposals, counts] = await Promise.all([repository.listProposals(states as ProposalState[]), repository.countByState()]);
    return json({ proposals, counts });
  }

  async function reviewProposal(request: NextRequest, id: string, reviewer: string): Promise<NextResponse> {
    if (!uuidSchema.safeParse(id).success) return json({ code: "PROPOSAL_NOT_FOUND" }, 404);
    const parsed = decisionSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ code: "SCHEMA_INVALID", issues: issuesOf(parsed.error) }, 422);
    const existing = await repository.findProposal(id);
    if (!existing) return json({ code: "PROPOSAL_NOT_FOUND" }, 404);
    const notes = parsed.data.notes?.trim() || null;
    const state = await repository.reviewProposal(id, parsed.data.decision, reviewer, notes);
    if (!state) return json({ code: "NOT_REVIEWABLE", state: existing.state }, 409);

    if (parsed.data.decision === "reject") {
      return json({ proposal: await repository.findProposal(id), outcome: { state: "rejected" } });
    }

    let outcome: ApplyOutcome | { state: "pending"; reason: "google_unavailable" | "apply_timeout" };
    if (!d.apply) {
      outcome = { state: "pending", reason: "google_unavailable" };
    } else {
      const approved = await repository.findProposal(id);
      const record = toApplyRecord(approved ?? { ...existing, state: "approved" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<{ state: "pending"; reason: "apply_timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ state: "pending", reason: "apply_timeout" }), timeout);
      });
      try {
        outcome = await Promise.race([d.apply(record), budget]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return json({ proposal: await repository.findProposal(id), outcome });
  }

  async function getSettings(): Promise<NextResponse> {
    return json({
      settings: await repository.readSettingsRow(),
      human_only_kinds: [...HUMAN_ONLY_KINDS],
      structural_kinds: [...STRUCTURAL_KINDS],
      kinds: PROPOSAL_KINDS,
    });
  }

  async function patchSettings(request: NextRequest): Promise<NextResponse> {
    const parsed = settingsPatchSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ code: "SCHEMA_INVALID", issues: issuesOf(parsed.error) }, 422);
    const patch = parsed.data as EngineSettingsPatch;
    const humanOnly = Object.entries(patch.modes ?? {}).filter(([kind, mode]) => mode === "auto" && HUMAN_ONLY_KINDS.has(kind as ProposalKind));
    if (humanOnly.length > 0)
      return json(
        {
          code: "HUMAN_ONLY_KIND",
          issues: humanOnly.map(([kind]) => ({ field: `modes.${kind}`, message: `${kind} stays reviewed by you in this version.` })),
        },
        422
      );
    return json({ settings: await repository.updateSettings(patch) });
  }

  async function listTests(): Promise<NextResponse> {
    const [tests, snapshot] = await Promise.all([repository.listTests(), repository.readSnapshot()]);
    const adById = new Map(snapshot.ads.map((ad) => [ad.id, ad]));
    return json({
      tests: tests.map((test) => ({
        ...test,
        control: adById.get(test.control_ad_id) ? { headlines: adById.get(test.control_ad_id)!.headlines.slice(0, 3).map((h) => h.text), status: adById.get(test.control_ad_id)!.status } : null,
        challenger: adById.get(test.challenger_ad_id) ? { headlines: adById.get(test.challenger_ad_id)!.headlines.slice(0, 3).map((h) => h.text), status: adById.get(test.challenger_ad_id)!.status } : null,
      })),
    });
  }

  async function listChanges(): Promise<NextResponse> {
    const since = new Date(d.now().getTime() - 90 * 86_400_000).toISOString();
    return json({ changes: await repository.listChanges(since) });
  }

  async function funnel(): Promise<NextResponse> {
    try {
      return json({ rows: await repository.funnelByKeyword(), available: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/does not exist|schema cache|could not find/i.test(message)) return json({ rows: [], available: false });
      throw error;
    }
  }

  async function health(): Promise<NextResponse> {
    const now = d.now();
    const [settingsRow, runs, counts, snapshot] = await Promise.all([
      repository.readSettingsRow(),
      repository.lastRuns(5),
      repository.countByState(),
      repository.readSnapshot(),
    ]);
    const campaignsLive = snapshot.campaigns.some((c) => c.status === "ENABLED" && c.labels.includes("engine") && c.kind !== "legacy");
    const heartbeat = settingsRow.heartbeat_at ? Date.parse(settingsRow.heartbeat_at) : Number.NaN;
    const ageHours = Number.isFinite(heartbeat) ? (now.getTime() - heartbeat) / 3_600_000 : null;
    const stalled = campaignsLive && (ageHours === null || ageHours > settingsRow.stall_hours);
    return json({
      last_run: runs[0] ?? null,
      recent_runs: runs,
      next_due_at: nextRoutineDue(now).toISOString(),
      heartbeat_at: settingsRow.heartbeat_at,
      heartbeat_age_hours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      stall: { stalled, threshold_hours: settingsRow.stall_hours, campaigns_live: campaignsLive },
      campaigns_live: campaignsLive,
      google: d.googleAvailable ? "available" : "unavailable",
      rehearsal: d.rehearsal,
      counts,
      modes: settingsRow.modes,
      snapshot_at: snapshot.snapshotAt,
    });
  }

  return { listProposals, reviewProposal, getSettings, patchSettings, listTests, listChanges, funnel, health };
}
