/**
 * OPS Web — Duplicate Detection Service
 *
 * Core service for the daily duplicate scan cron job.
 * Scans clients, opportunities, projects, and tasks within a company
 * for potential duplicates using algorithmic matching (no AI).
 *
 * Also handles smart merge (backfill missing fields, reassign relationships,
 * soft-delete loser) and permanent dismiss.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import {
  normalizeCompanyName,
  normalizePhone,
  normalizeAddress,
  normalizeTitle,
} from "@/lib/utils/name-normalization";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DuplicateEntityType = "client" | "opportunity" | "project" | "task";
export type DuplicateConfidence = "high" | "medium";
export type DuplicateStatus = "pending" | "merged" | "dismissed";

export interface DuplicateSignal {
  type: string;
  detail: string;
}

export interface DuplicateReview {
  id: string;
  companyId: string;
  entityType: DuplicateEntityType;
  entityAId: string;
  entityBId: string;
  confidence: DuplicateConfidence;
  signals: DuplicateSignal[];
  status: DuplicateStatus;
  winnerId: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

interface DetectedPair {
  entityAId: string;
  entityBId: string;
  confidence: DuplicateConfidence;
  signals: DuplicateSignal[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ensure a < b for the ordered pair constraint */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function mapReviewFromDb(row: Record<string, unknown>): DuplicateReview {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    entityType: row.entity_type as DuplicateEntityType,
    entityAId: row.entity_a_id as string,
    entityBId: row.entity_b_id as string,
    confidence: row.confidence as DuplicateConfidence,
    signals: (row.signals as DuplicateSignal[]) ?? [],
    status: row.status as DuplicateStatus,
    winnerId: (row.winner_id as string) ?? null,
    resolvedBy: (row.resolved_by as string) ?? null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}

/** Backfill null fields on winner from loser. Returns the fields that were backfilled. */
function backfillFields(
  winner: Record<string, unknown>,
  loser: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of fields) {
    if (
      (winner[field] === null || winner[field] === undefined || winner[field] === "") &&
      loser[field] !== null &&
      loser[field] !== undefined &&
      loser[field] !== ""
    ) {
      updates[field] = loser[field];
    }
  }
  return updates;
}

/** A blank value is null/undefined/empty-after-trim. Mirrors the SQL re-validation. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

export interface FieldConflict {
  field: string;
  winnerValue: unknown;
  loserValue: unknown;
}

/**
 * Detect per-field conflicts for a single winner/loser pair: fields where BOTH
 * sides are non-blank and differ (Q2). These are NOT auto-resolved — the
 * service surfaces them so a future UI can ask the operator to choose, and only
 * an operator-confirmed choice (passed as `p_confirmed_overrides`) is applied
 * by the RPC. Fill-blank (winner blank, loser non-blank) is auto and is NOT a
 * conflict. The RPC re-validates and applies fill-blank server-side; this is
 * the read-side mirror used to populate the merge UI.
 */
function detectFieldConflicts(
  winner: Record<string, unknown>,
  loser: Record<string, unknown>,
  fields: string[]
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  for (const field of fields) {
    const w = winner[field];
    const l = loser[field];
    if (isBlank(w) || isBlank(l)) continue; // fill-blank or nothing — not a conflict
    const wStr = String(w).trim();
    const lStr = String(l).trim();
    if (wStr !== lStr) {
      conflicts.push({ field, winnerValue: w, loserValue: l });
    }
  }
  return conflicts;
}

// ─── Client Scanning ─────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  address: string | null;
}

function scanClients(clients: ClientRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];

  // Build indexes
  const emailIndex = new Map<string, ClientRow[]>();
  const phoneIndex = new Map<string, ClientRow[]>();
  const nameIndex = new Map<string, ClientRow[]>();

  for (const c of clients) {
    if (c.email) {
      const lower = c.email.toLowerCase();
      emailIndex.set(lower, [...(emailIndex.get(lower) ?? []), c]);
    }
    if (c.phone_number) {
      const norm = normalizePhone(c.phone_number);
      if (norm.length >= 7) {
        phoneIndex.set(norm, [...(phoneIndex.get(norm) ?? []), c]);
      }
    }
    const normName = normalizeCompanyName(c.name);
    if (normName.length >= 2) {
      nameIndex.set(normName, [...(nameIndex.get(normName) ?? []), c]);
    }
  }

  const seen = new Set<string>();

  function addPair(
    a: ClientRow,
    b: ClientRow,
    confidence: DuplicateConfidence,
    signals: DuplicateSignal[]
  ) {
    const [idA, idB] = orderedPair(a.id, b.id);
    const key = `${idA}:${idB}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ entityAId: idA, entityBId: idB, confidence, signals });
  }

  // High confidence: same email
  for (const [email, group] of emailIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], "high", [
          { type: "same_email", detail: email },
        ]);
      }
    }
  }

  // High confidence: same phone
  for (const [phone, group] of phoneIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], "high", [
          { type: "same_phone", detail: phone },
        ]);
      }
    }
  }

  // Medium/High: fuzzy name match (only if not already caught)
  for (const [normName, group] of nameIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [idA, idB] = orderedPair(group[i].id, group[j].id);
        if (seen.has(`${idA}:${idB}`)) continue;

        const signals: DuplicateSignal[] = [
          { type: "fuzzy_name", detail: normName },
        ];
        let confidence: DuplicateConfidence = "medium";

        // Check if they share a non-public email domain → upgrade to high
        if (group[i].email && group[j].email) {
          const domainA = group[i].email!.toLowerCase().split("@")[1];
          const domainB = group[j].email!.toLowerCase().split("@")[1];
          if (
            domainA &&
            domainA === domainB &&
            !PUBLIC_EMAIL_DOMAINS.has(domainA)
          ) {
            signals.push({ type: "same_domain", detail: domainA });
            confidence = "high";
          }
        }

        // Check address match → upgrade to high
        if (group[i].address && group[j].address) {
          const addrA = normalizeAddress(group[i].address!);
          const addrB = normalizeAddress(group[j].address!);
          if (addrA.length > 0 && addrA === addrB) {
            signals.push({ type: "same_address", detail: addrA });
            confidence = "high";
          }
        }

        addPair(group[i], group[j], confidence, signals);
      }
    }
  }

  return pairs;
}

// ─── Opportunity Scanning ────────────────────────────────────────────────────

interface OpportunityRow {
  id: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  title: string;
  address: string | null;
}

const ACTIVE_OPP_STAGES = [
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
];

function scanOpportunities(opps: OpportunityRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];
  const seen = new Set<string>();

  function addPair(
    a: OpportunityRow,
    b: OpportunityRow,
    confidence: DuplicateConfidence,
    signals: DuplicateSignal[]
  ) {
    const [idA, idB] = orderedPair(a.id, b.id);
    const key = `${idA}:${idB}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ entityAId: idA, entityBId: idB, confidence, signals });
  }

  // Index by email
  const emailIndex = new Map<string, OpportunityRow[]>();
  for (const o of opps) {
    if (o.contact_email) {
      const lower = o.contact_email.toLowerCase();
      emailIndex.set(lower, [...(emailIndex.get(lower) ?? []), o]);
    }
  }

  // High: same contactEmail
  for (const [email, group] of emailIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], "high", [
          { type: "same_email", detail: email },
        ]);
      }
    }
  }

  // Medium: fuzzy name + (same title OR same address)
  const nameIndex = new Map<string, OpportunityRow[]>();
  for (const o of opps) {
    if (o.contact_name) {
      const norm = normalizeCompanyName(o.contact_name);
      if (norm.length >= 2) {
        nameIndex.set(norm, [...(nameIndex.get(norm) ?? []), o]);
      }
    }
  }

  for (const [normName, group] of nameIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [idA, idB] = orderedPair(group[i].id, group[j].id);
        if (seen.has(`${idA}:${idB}`)) continue;

        const signals: DuplicateSignal[] = [
          { type: "fuzzy_name", detail: normName },
        ];

        const titleA = normalizeTitle(group[i].title);
        const titleB = normalizeTitle(group[j].title);
        if (titleA.length > 0 && titleA === titleB) {
          signals.push({ type: "same_title", detail: titleA });
        }

        if (group[i].address && group[j].address) {
          const addrA = normalizeAddress(group[i].address!);
          const addrB = normalizeAddress(group[j].address!);
          if (addrA.length > 0 && addrA === addrB) {
            signals.push({ type: "same_address", detail: addrA });
          }
        }

        // Need at least 2 signals for name-based matches
        if (signals.length >= 2) {
          addPair(group[i], group[j], "medium", signals);
        }
      }
    }
  }

  return pairs;
}

// ─── Project Scanning ────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  title: string;
  client_id: string | null;
  address: string | null;
}

const ACTIVE_PROJECT_STATUSES = [
  "rfq",
  "estimated",
  "accepted",
  "in_progress",
];

function scanProjects(projects: ProjectRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];
  const seen = new Set<string>();

  function addPair(
    a: ProjectRow,
    b: ProjectRow,
    confidence: DuplicateConfidence,
    signals: DuplicateSignal[]
  ) {
    const [idA, idB] = orderedPair(a.id, b.id);
    const key = `${idA}:${idB}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ entityAId: idA, entityBId: idB, confidence, signals });
  }

  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i];
      const b = projects[j];

      const sameClient =
        a.client_id && b.client_id && a.client_id === b.client_id;
      const titleA = normalizeTitle(a.title);
      const titleB = normalizeTitle(b.title);
      const sameTitle = titleA.length > 0 && titleA === titleB;

      let addrA = "";
      let addrB = "";
      let sameAddress = false;
      if (a.address && b.address) {
        addrA = normalizeAddress(a.address);
        addrB = normalizeAddress(b.address);
        sameAddress = addrA.length > 0 && addrA === addrB;
      }

      // High: same client + fuzzy title
      if (sameClient && sameTitle) {
        addPair(a, b, "high", [
          { type: "same_client", detail: a.client_id! },
          { type: "same_title", detail: titleA },
        ]);
        continue;
      }

      // High: same client + same address
      if (sameClient && sameAddress) {
        addPair(a, b, "high", [
          { type: "same_client", detail: a.client_id! },
          { type: "same_address", detail: addrA },
        ]);
        continue;
      }

      // Medium: same address + fuzzy title (no client match)
      if (sameAddress && sameTitle) {
        addPair(a, b, "medium", [
          { type: "same_address", detail: addrA },
          { type: "same_title", detail: titleA },
        ]);
      }
    }
  }

  return pairs;
}

// ─── Task Scanning ───────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  project_id: string;
  task_type_id: string;
  custom_title: string | null;
  start_date: string | null;
  end_date: string | null;
}

function datesOverlap(
  startA: string | null,
  endA: string | null,
  startB: string | null,
  endB: string | null
): boolean {
  if (!startA || !startB) return false;
  const sA = new Date(startA).getTime();
  const eA = endA ? new Date(endA).getTime() : sA;
  const sB = new Date(startB).getTime();
  const eB = endB ? new Date(endB).getTime() : sB;
  return sA <= eB && sB <= eA;
}

function scanTasks(tasks: TaskRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];
  const seen = new Set<string>();

  // Group by project — only compare within same project
  const byProject = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    byProject.set(t.project_id, [
      ...(byProject.get(t.project_id) ?? []),
      t,
    ]);
  }

  for (const [, projectTasks] of byProject) {
    for (let i = 0; i < projectTasks.length; i++) {
      for (let j = i + 1; j < projectTasks.length; j++) {
        const a = projectTasks[i];
        const b = projectTasks[j];

        const overlap = datesOverlap(
          a.start_date,
          a.end_date,
          b.start_date,
          b.end_date
        );
        if (!overlap) continue;

        // Same taskType + overlapping dates
        if (a.task_type_id === b.task_type_id) {
          const [idA, idB] = orderedPair(a.id, b.id);
          const key = `${idA}:${idB}`;
          if (!seen.has(key)) {
            seen.add(key);
            pairs.push({
              entityAId: idA,
              entityBId: idB,
              confidence: "high",
              signals: [
                { type: "same_task_type", detail: a.task_type_id },
                {
                  type: "overlapping_dates",
                  detail: `${a.start_date} – ${a.end_date}`,
                },
              ],
            });
          }
          continue;
        }

        // Same custom title + overlapping dates
        if (a.custom_title && b.custom_title) {
          const titleA = normalizeTitle(a.custom_title);
          const titleB = normalizeTitle(b.custom_title);
          if (titleA.length > 0 && titleA === titleB) {
            const [idA, idB] = orderedPair(a.id, b.id);
            const key = `${idA}:${idB}`;
            if (!seen.has(key)) {
              seen.add(key);
              pairs.push({
                entityAId: idA,
                entityBId: idB,
                confidence: "high",
                signals: [
                  { type: "same_title", detail: titleA },
                  {
                    type: "overlapping_dates",
                    detail: `${a.start_date} – ${a.end_date}`,
                  },
                ],
              });
            }
          }
        }
      }
    }
  }

  return pairs;
}

// ─── Main Scan Orchestrator ──────────────────────────────────────────────────

async function scanCompany(companyId: string): Promise<number> {
  const supabase = requireSupabase();
  let newCount = 0;

  // Load existing dismissed/pending pairs to skip
  const { data: existingReviews } = await supabase
    .from("duplicate_reviews")
    .select("entity_type, entity_a_id, entity_b_id, status")
    .eq("company_id", companyId)
    .in("status", ["pending", "dismissed"]);

  const existingKeys = new Set(
    (existingReviews ?? []).map(
      (r) =>
        `${r.entity_type}:${r.entity_a_id}:${r.entity_b_id}`
    )
  );

  async function insertNewPairs(
    entityType: DuplicateEntityType,
    pairs: DetectedPair[]
  ): Promise<number> {
    const newPairs = pairs.filter((p) => {
      const key = `${entityType}:${p.entityAId}:${p.entityBId}`;
      return !existingKeys.has(key);
    });

    if (newPairs.length === 0) return 0;

    const rows = newPairs.map((p) => ({
      company_id: companyId,
      entity_type: entityType,
      entity_a_id: p.entityAId,
      entity_b_id: p.entityBId,
      confidence: p.confidence,
      signals: p.signals,
      status: "pending",
    }));

    const { error } = await supabase.from("duplicate_reviews").insert(rows);

    if (error) {
      console.error(
        `[DuplicateDetection] Failed to insert ${entityType} pairs:`,
        error.message
      );
      return 0;
    }
    return newPairs.length;
  }

  // ── 1. Clients ──
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, phone_number, address")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  if (clients && clients.length > 1) {
    const clientPairs = scanClients(clients as ClientRow[]);
    newCount += await insertNewPairs("client", clientPairs);
  }

  // ── 2. Opportunities ──
  const { data: opps } = await supabase
    .from("opportunities")
    .select(
      "id, contact_name, contact_email, contact_phone, title, address"
    )
    .eq("company_id", companyId)
    .in("stage", ACTIVE_OPP_STAGES)
    .is("deleted_at", null);

  if (opps && opps.length > 1) {
    const oppPairs = scanOpportunities(opps as OpportunityRow[]);
    newCount += await insertNewPairs("opportunity", oppPairs);
  }

  // ── 3. Projects ──
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, client_id, address")
    .eq("company_id", companyId)
    .in("status", ACTIVE_PROJECT_STATUSES)
    .is("deleted_at", null);

  if (projects && projects.length > 1) {
    const projectPairs = scanProjects(projects as ProjectRow[]);
    newCount += await insertNewPairs("project", projectPairs);
  }

  // ── 4. Tasks ──
  const { data: tasks } = await supabase
    .from("project_tasks")
    .select(
      "id, project_id, task_type_id, custom_title, start_date, end_date"
    )
    .eq("company_id", companyId)
    .not("status", "in", '("completed","cancelled")')
    .is("deleted_at", null);

  if (tasks && tasks.length > 1) {
    const taskPairs = scanTasks(tasks as TaskRow[]);
    newCount += await insertNewPairs("task", taskPairs);
  }

  return newCount;
}

// ─── Smart Merge ─────────────────────────────────────────────────────────────

const ENTITY_TABLES: Record<DuplicateEntityType, string> = {
  client: "clients",
  opportunity: "opportunities",
  project: "projects",
  task: "project_tasks",
};

/**
 * Map of entity type → guarded merge RPC name. Only opportunity + client have
 * transactional, complete-FK-coverage RPCs (P5). project + task merges are out
 * of P5 scope and keep the legacy in-process re-point path until separately
 * hardened (see legacyMergeProjectOrTask).
 */
const MERGE_RPC: Partial<Record<DuplicateEntityType, string>> = {
  opportunity: "execute_opportunity_merge_guarded",
  client: "execute_client_merge_guarded",
};

/** Fields the guarded merge RPC accepts in p_field_fill / p_confirmed_overrides. */
const RPC_RECONCILE_FIELDS: Record<"client" | "opportunity", string[]> = {
  client: [
    "email",
    "phone_number",
    "address",
    "latitude",
    "longitude",
    "profile_image_url",
    "notes",
  ],
  // contact_name is included (the gap map flagged it was omitted from MERGE_FIELDS).
  opportunity: [
    "contact_name",
    "contact_email",
    "contact_phone",
    "description",
    "estimated_value",
    "address",
  ],
};

const LEGACY_RELATIONSHIP_MAP: Record<
  "project" | "task",
  { table: string; fkColumn: string }[]
> = {
  project: [
    { table: "project_tasks", fkColumn: "project_id" },
    { table: "estimates", fkColumn: "project_id" },
    { table: "invoices", fkColumn: "project_id" },
    { table: "project_notes", fkColumn: "project_id" },
    { table: "site_visits", fkColumn: "project_id" },
  ],
  task: [], // Tasks are leaf entities — no child relationships
};

export interface MergeReconciliation {
  /** Fields to auto-fill on the winner from the loser (winner blank). */
  fieldFill: Record<string, unknown>;
  /** Non-blank-differing fields requiring an operator choice (Q2). */
  conflicts: FieldConflict[];
}

/**
 * Compute the fill-blank set and the conflict set for a winner/loser pair.
 * Fill-blank is the server-applied auto path (re-validated in SQL); conflicts
 * are surfaced to the UI and only applied via operator-confirmed overrides.
 */
function computeReconciliation(
  winner: Record<string, unknown>,
  loser: Record<string, unknown>,
  entityType: "client" | "opportunity"
): MergeReconciliation {
  const fields = RPC_RECONCILE_FIELDS[entityType];
  return {
    fieldFill: backfillFields(winner, loser, fields),
    conflicts: detectFieldConflicts(winner, loser, fields),
  };
}

interface GuardedMergeResult {
  applied: boolean;
  merge_id?: string;
  winner_id?: string;
  loser_id?: string;
  guard_reason?: string;
  error_code?: string;
  error_message?: string;
  manifest?: Record<string, unknown>;
  disposition_id?: string;
}

/**
 * Run one guarded merge RPC for a single loser. Each call is its own
 * transaction with its own merge_key. The RPC re-points the complete FK graph,
 * de-dupes, soft-deletes the loser, writes the disposition + audit + manifest,
 * and cascades pending reviews in-transaction. Throws on a hard RPC error so a
 * cluster loop surfaces the failure (losers already merged stay merged — each
 * was atomic).
 */
async function runGuardedMerge(params: {
  entityType: "client" | "opportunity";
  companyId: string;
  winnerId: string;
  loserId: string;
  mergeKey: string;
  reviewId: string | null;
  resolvedBy: string;
  expectedWinnerStage?: string | null;
  expectedLoserStage?: string | null;
  expectedWinnerUpdatedAt?: string | null;
  expectedLoserUpdatedAt?: string | null;
  fieldFill: Record<string, unknown>;
  confirmedOverrides: Record<string, unknown>;
  runId?: string | null;
}): Promise<GuardedMergeResult> {
  const supabase = requireSupabase();
  const rpc = MERGE_RPC[params.entityType]!;

  const args =
    params.entityType === "opportunity"
      ? {
          p_company_id: params.companyId,
          p_winner_id: params.winnerId,
          p_loser_id: params.loserId,
          p_merge_key: params.mergeKey,
          p_review_id: params.reviewId,
          p_expected_winner_stage: params.expectedWinnerStage ?? null,
          p_expected_loser_stage: params.expectedLoserStage ?? null,
          p_field_fill: params.fieldFill,
          p_confirmed_overrides: params.confirmedOverrides,
          p_resolved_by: params.resolvedBy,
          p_run_id: params.runId ?? null,
        }
      : {
          p_company_id: params.companyId,
          p_winner_id: params.winnerId,
          p_loser_id: params.loserId,
          p_merge_key: params.mergeKey,
          p_review_id: params.reviewId,
          p_expected_winner_updated_at: params.expectedWinnerUpdatedAt ?? null,
          p_expected_loser_updated_at: params.expectedLoserUpdatedAt ?? null,
          p_field_fill: params.fieldFill,
          p_confirmed_overrides: params.confirmedOverrides,
          p_resolved_by: params.resolvedBy,
          p_run_id: params.runId ?? null,
        };

  const { data, error } = await supabase.rpc(rpc, args);
  if (error) {
    throw new Error(
      `Guarded merge ${rpc} failed for loser ${params.loserId}: ${error.message}`
    );
  }
  return (data ?? {}) as GuardedMergeResult;
}

/**
 * Public conflict-detection helper used by the merge UI. For the given review
 * (or cluster), fetch the winner + each loser and return the auto fill-blank
 * map plus the conflicts that require an explicit operator choice. Does NOT
 * mutate anything. opportunity + client only.
 */
async function detectMergeConflicts(
  reviewIds: string[],
  winnerId: string
): Promise<{
  entityType: DuplicateEntityType;
  perLoser: Array<{ loserId: string; reconciliation: MergeReconciliation }>;
}> {
  const supabase = requireSupabase();
  if (reviewIds.length === 0) {
    throw new Error("No review IDs provided for conflict detection");
  }

  const { data: reviews, error } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .in("id", reviewIds);
  if (error || !reviews || reviews.length === 0) {
    throw new Error("Could not fetch reviews for conflict detection");
  }

  const entityType = reviews[0].entity_type as DuplicateEntityType;
  if (entityType !== "opportunity" && entityType !== "client") {
    return { entityType, perLoser: [] };
  }

  const table = ENTITY_TABLES[entityType];
  const loserIds = new Set<string>();
  for (const r of reviews) {
    loserIds.add(r.entity_a_id as string);
    loserIds.add(r.entity_b_id as string);
  }
  loserIds.delete(winnerId);

  const { data: winnerRow } = await supabase
    .from(table)
    .select("*")
    .eq("id", winnerId)
    .single();
  if (!winnerRow) {
    throw new Error(`Winner ${winnerId} not found for conflict detection`);
  }

  const perLoser: Array<{ loserId: string; reconciliation: MergeReconciliation }> = [];
  for (const loserId of loserIds) {
    const { data: loserRow } = await supabase
      .from(table)
      .select("*")
      .eq("id", loserId)
      .single();
    if (!loserRow) continue;
    perLoser.push({
      loserId,
      reconciliation: computeReconciliation(
        winnerRow as Record<string, unknown>,
        loserRow as Record<string, unknown>,
        entityType
      ),
    });
  }

  return { entityType, perLoser };
}

/**
 * Legacy in-process merge for project + task (out of P5 scope — kept until
 * separately hardened). Mirrors the prior re-point-then-soft-delete behavior.
 */
async function legacyMergeProjectOrTask(
  entityType: "project" | "task",
  companyId: string,
  winnerId: string,
  loserIds: string[]
): Promise<void> {
  const supabase = requireSupabase();
  const table = ENTITY_TABLES[entityType];
  for (const loserId of loserIds) {
    for (const rel of LEGACY_RELATIONSHIP_MAP[entityType]) {
      const { error: relErr } = await supabase
        .from(rel.table)
        .update({ [rel.fkColumn]: winnerId })
        .eq(rel.fkColumn, loserId);
      if (relErr) {
        console.error(
          `[DuplicateDetection] Legacy merge: failed to reassign ${rel.table}.${rel.fkColumn} for loser ${loserId}:`,
          relErr.message
        );
      }
    }
    const { error: deleteErr } = await supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", loserId);
    if (deleteErr) {
      console.error(
        `[DuplicateDetection] Legacy merge: failed to soft-delete loser ${loserId}:`,
        deleteErr.message
      );
    }
  }
  // Mark the cluster reviews resolved + cascade is handled by the caller.
}

/**
 * Merge a single duplicate review's loser into its winner.
 *
 * For opportunity + client this is now a thin wrapper over the guarded merge
 * RPC: one transaction, complete FK re-point, de-dupe, soft-delete + pointer,
 * disposition('merged'), manifest, in-transaction review cascade. Fill-blank is
 * computed here and re-validated server-side; `confirmedOverrides` carries only
 * operator-chosen overwrites of non-blank winner fields (Q2). For project/task
 * it falls back to the legacy path.
 */
async function mergeEntities(
  reviewId: string,
  winnerId: string,
  resolvedBy: string,
  confirmedOverrides?: Record<string, unknown>,
  additionalReviewIds?: string[]
): Promise<GuardedMergeResult | void> {
  if (additionalReviewIds && additionalReviewIds.length > 0) {
    return mergeCluster(
      [reviewId, ...additionalReviewIds],
      winnerId,
      resolvedBy,
      confirmedOverrides
    );
  }

  const supabase = requireSupabase();

  const { data: review, error: fetchErr } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .eq("id", reviewId)
    .single();
  if (fetchErr || !review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  const entityType = review.entity_type as DuplicateEntityType;
  const companyId = review.company_id as string;
  const loserId =
    winnerId === review.entity_a_id ? review.entity_b_id : review.entity_a_id;

  if (entityType === "project" || entityType === "task") {
    await legacyMergeProjectOrTask(entityType, companyId, winnerId, [loserId]);
    await markReviewsMerged(supabase, [reviewId], winnerId, resolvedBy);
    await cascadePendingReviews(supabase, companyId, entityType, [loserId], winnerId, [
      reviewId,
    ]);
    await resolveNotificationIfEmpty(companyId);
    return;
  }

  const table = ENTITY_TABLES[entityType];
  const { data: winnerRow } = await supabase
    .from(table)
    .select("*")
    .eq("id", winnerId)
    .single();
  const { data: loserRow } = await supabase
    .from(table)
    .select("*")
    .eq("id", loserId)
    .single();
  if (!winnerRow || !loserRow) {
    throw new Error(
      `Could not fetch entities for merge: winner=${winnerId}, loser=${loserId}`
    );
  }

  const { fieldFill } = computeReconciliation(
    winnerRow as Record<string, unknown>,
    loserRow as Record<string, unknown>,
    entityType
  );

  return runGuardedMerge({
    entityType,
    companyId,
    winnerId,
    loserId,
    mergeKey: `${reviewId}:${loserId}`,
    reviewId,
    resolvedBy,
    expectedWinnerStage:
      entityType === "opportunity"
        ? ((winnerRow as Record<string, unknown>).stage as string)
        : null,
    expectedLoserStage:
      entityType === "opportunity"
        ? ((loserRow as Record<string, unknown>).stage as string)
        : null,
    expectedWinnerUpdatedAt:
      entityType === "client"
        ? ((winnerRow as Record<string, unknown>).updated_at as string)
        : null,
    expectedLoserUpdatedAt:
      entityType === "client"
        ? ((loserRow as Record<string, unknown>).updated_at as string)
        : null,
    fieldFill,
    confirmedOverrides: confirmedOverrides ?? {},
  }).then(async (result) => {
    await resolveNotificationIfEmpty(companyId);
    return result;
  });
}

// ─── Cluster Merge ──────────────────────────────────────────────────────────

/**
 * Merge a cluster: every entity that isn't the winner is a loser. Each loser is
 * merged by its own guarded RPC call (its own merge_key + transaction). A
 * failure on loser N leaves losers 1..N-1 fully merged (each atomic) and
 * surfaces the error — no half-merged loser is reachable. project/task fall
 * back to the legacy path.
 */
async function mergeCluster(
  reviewIds: string[],
  winnerId: string,
  resolvedBy: string,
  confirmedOverridesByLoser?: Record<string, unknown> | Record<string, Record<string, unknown>>
): Promise<void> {
  const supabase = requireSupabase();
  if (reviewIds.length === 0) {
    throw new Error("No review IDs provided for cluster merge");
  }

  const { data: reviews, error: fetchErr } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .in("id", reviewIds);
  if (fetchErr || !reviews || reviews.length === 0) {
    throw new Error("Could not fetch reviews for cluster merge");
  }

  const entityType = reviews[0].entity_type as DuplicateEntityType;
  const companyId = reviews[0].company_id as string;
  const table = ENTITY_TABLES[entityType];

  const allEntityIds = new Set<string>();
  for (const r of reviews) {
    allEntityIds.add(r.entity_a_id as string);
    allEntityIds.add(r.entity_b_id as string);
  }
  allEntityIds.delete(winnerId);
  const loserIds = Array.from(allEntityIds);
  if (loserIds.length === 0) {
    throw new Error("No losers found in cluster merge — winnerId not in reviews");
  }

  if (entityType === "project" || entityType === "task") {
    await legacyMergeProjectOrTask(entityType, companyId, winnerId, loserIds);
    await markReviewsMerged(supabase, reviewIds, winnerId, resolvedBy);
    await cascadePendingReviews(
      supabase,
      companyId,
      entityType,
      loserIds,
      winnerId,
      reviewIds
    );
    await resolveNotificationIfEmpty(companyId);
    return;
  }

  // Per-loser confirmed overrides: accept either a flat map (applied to every
  // loser) or a per-loser keyed map. The keyed form is the UI-driven shape.
  function overridesFor(loserId: string): Record<string, unknown> {
    if (!confirmedOverridesByLoser) return {};
    const keyed = confirmedOverridesByLoser as Record<string, Record<string, unknown>>;
    if (keyed[loserId] && typeof keyed[loserId] === "object") {
      return keyed[loserId];
    }
    // Flat map fallback — only treat as flat if no key looks like a loser id.
    if (!loserIds.some((id) => id in confirmedOverridesByLoser)) {
      return confirmedOverridesByLoser as Record<string, unknown>;
    }
    return {};
  }

  // Fetch the winner once.
  const { data: winnerRow } = await supabase
    .from(table)
    .select("*")
    .eq("id", winnerId)
    .single();
  if (!winnerRow) {
    throw new Error(`Winner ${winnerId} not found for cluster merge`);
  }

  for (const loserId of loserIds) {
    const { data: loserRow } = await supabase
      .from(table)
      .select("*")
      .eq("id", loserId)
      .single();
    if (!loserRow) continue; // already merged away / missing — skip

    const { fieldFill } = computeReconciliation(
      winnerRow as Record<string, unknown>,
      loserRow as Record<string, unknown>,
      entityType as "client" | "opportunity"
    );

    // Re-read the winner stage/updated_at fresh each iteration is unnecessary —
    // the snapshot guard is on the loser too, and each merge is atomic. We pass
    // the loser's own snapshot; winner snapshot uses the cluster-start value.
    await runGuardedMerge({
      entityType: entityType as "client" | "opportunity",
      companyId,
      winnerId,
      loserId,
      mergeKey: `${reviewIds[0]}:${loserId}`,
      reviewId: reviews.find(
        (r) => r.entity_a_id === loserId || r.entity_b_id === loserId
      )?.id as string ?? null,
      resolvedBy,
      expectedLoserStage:
        entityType === "opportunity"
          ? ((loserRow as Record<string, unknown>).stage as string)
          : null,
      expectedLoserUpdatedAt:
        entityType === "client"
          ? ((loserRow as Record<string, unknown>).updated_at as string)
          : null,
      fieldFill,
      confirmedOverrides: overridesFor(loserId),
    });
  }

  // Mark any cluster reviews that the RPC didn't already resolve (e.g. reviews
  // not driving a specific loser merge) as merged.
  await markReviewsMerged(supabase, reviewIds, winnerId, resolvedBy);
  await resolveNotificationIfEmpty(companyId);
}

// ─── Review bookkeeping helpers (legacy project/task path + cluster cleanup) ──

async function markReviewsMerged(
  supabase: ReturnType<typeof requireSupabase>,
  reviewIds: string[],
  winnerId: string,
  resolvedBy: string
): Promise<void> {
  const { error } = await supabase
    .from("duplicate_reviews")
    .update({
      status: "merged",
      winner_id: winnerId,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .in("id", reviewIds);
  if (error) {
    console.error(
      `[DuplicateDetection] Failed to mark reviews as merged:`,
      error.message
    );
  }
}

async function cascadePendingReviews(
  supabase: ReturnType<typeof requireSupabase>,
  companyId: string,
  entityType: DuplicateEntityType,
  loserIds: string[],
  winnerId: string,
  alreadyResolvedIds: string[]
): Promise<void> {
  for (const loserId of loserIds) {
    const { data: affectedReviews } = await supabase
      .from("duplicate_reviews")
      .select("id, entity_a_id, entity_b_id")
      .eq("company_id", companyId)
      .eq("entity_type", entityType)
      .eq("status", "pending")
      .or(`entity_a_id.eq.${loserId},entity_b_id.eq.${loserId}`);

    for (const affected of affectedReviews ?? []) {
      if (alreadyResolvedIds.includes(affected.id)) continue;
      const otherSide =
        affected.entity_a_id === loserId
          ? affected.entity_b_id
          : affected.entity_a_id;

      if (otherSide === winnerId || loserIds.includes(otherSide)) {
        await supabase.from("duplicate_reviews").delete().eq("id", affected.id);
      } else {
        const [newA, newB] = orderedPair(winnerId, otherSide);
        await supabase
          .from("duplicate_reviews")
          .update({ entity_a_id: newA, entity_b_id: newB })
          .eq("id", affected.id);
      }
    }
  }
}

// ─── Dismiss ─────────────────────────────────────────────────────────────────

async function dismissPair(
  reviewId: string,
  resolvedBy: string
): Promise<void> {
  const supabase = requireSupabase();

  // Fetch company_id before updating (needed for notification resolution)
  const { data: review } = await supabase
    .from("duplicate_reviews")
    .select("company_id")
    .eq("id", reviewId)
    .single();

  const { error } = await supabase
    .from("duplicate_reviews")
    .update({
      status: "dismissed",
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId);

  if (error) {
    throw new Error(
      `Failed to dismiss review ${reviewId}: ${error.message}`
    );
  }

  // Auto-resolve notification if no pending reviews remain
  if (review?.company_id) {
    await resolveNotificationIfEmpty(review.company_id as string);
  }
}

// ─── Auto-resolve notification when all duplicates handled ───────────────────

async function resolveNotificationIfEmpty(companyId: string): Promise<void> {
  const supabase = requireSupabase();

  // Check if any pending reviews remain
  const { count } = await supabase
    .from("duplicate_reviews")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "pending");

  if (count === 0) {
    // Mark all duplicates_found notifications as read for this company
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("company_id", companyId)
      .eq("type", "duplicates_found")
      .eq("is_read", false);
  }
}

// ─── Get Pending ─────────────────────────────────────────────────────────────

async function getPendingReviews(
  companyId: string
): Promise<DuplicateReview[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapReviewFromDb);
}

// ─── Apply Entity Edits ─────────────────────────────────────────────────────

/**
 * Apply field edits to individual entities.
 * Used when the user edits/removes fields on entity cards before merging or dismissing.
 * entityEdits is a map of entityId -> { field: value } updates (null = remove field).
 */
async function applyEntityEdits(
  entityEdits: Record<string, Record<string, unknown>>,
  entityType: DuplicateEntityType
): Promise<void> {
  const supabase = requireSupabase();
  const table = ENTITY_TABLES[entityType];

  for (const [entityId, updates] of Object.entries(entityEdits)) {
    if (Object.keys(updates).length === 0) continue;
    const { error } = await supabase.from(table).update(updates).eq("id", entityId);
    if (error) {
      console.error(`[DuplicateDetection] Failed to apply edits to ${entityId}:`, error.message);
    }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const DuplicateDetectionService = {
  scanCompany,
  getPendingReviews,
  mergeEntities,
  mergeCluster,
  dismissPair,
  applyEntityEdits,
  detectMergeConflicts,

  // Exposed for unit testing
  _scanClients: scanClients,
  _scanOpportunities: scanOpportunities,
  _scanProjects: scanProjects,
  _scanTasks: scanTasks,
  _datesOverlap: datesOverlap,
  _backfillFields: backfillFields,
  _detectFieldConflicts: detectFieldConflicts,
  _computeReconciliation: computeReconciliation,
  _isBlank: isBlank,
};
