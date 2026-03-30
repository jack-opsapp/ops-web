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

const MERGE_FIELDS: Record<DuplicateEntityType, string[]> = {
  client: [
    "email",
    "phone_number",
    "address",
    "latitude",
    "longitude",
    "profile_image_url",
    "notes",
  ],
  opportunity: [
    "contact_email",
    "contact_phone",
    "description",
    "estimated_value",
    "address",
  ],
  project: ["address", "latitude", "longitude", "notes", "description"],
  task: ["task_notes", "custom_title"],
};

const ENTITY_TABLES: Record<DuplicateEntityType, string> = {
  client: "clients",
  opportunity: "opportunities",
  project: "projects",
  task: "project_tasks",
};

const RELATIONSHIP_MAP: Record<
  DuplicateEntityType,
  { table: string; fkColumn: string }[]
> = {
  client: [
    { table: "projects", fkColumn: "client_id" },
    { table: "sub_clients", fkColumn: "client_id" },
    { table: "opportunities", fkColumn: "client_id" },
    { table: "estimates", fkColumn: "client_id" },
    { table: "invoices", fkColumn: "client_id" },
  ],
  opportunity: [
    { table: "activities", fkColumn: "opportunity_id" },
    { table: "follow_ups", fkColumn: "opportunity_id" },
    { table: "stage_transitions", fkColumn: "opportunity_id" },
    { table: "estimates", fkColumn: "opportunity_id" },
    { table: "opportunity_email_threads", fkColumn: "opportunity_id" },
  ],
  project: [
    { table: "project_tasks", fkColumn: "project_id" },
    { table: "estimates", fkColumn: "project_id" },
    { table: "invoices", fkColumn: "project_id" },
    { table: "project_notes", fkColumn: "project_id" },
    { table: "site_visits", fkColumn: "project_id" },
  ],
  task: [], // Tasks are leaf entities — no child relationships
};

async function mergeEntities(
  reviewId: string,
  winnerId: string,
  resolvedBy: string
): Promise<void> {
  const supabase = requireSupabase();

  // 1. Fetch the review record
  const { data: review, error: fetchErr } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .eq("id", reviewId)
    .single();

  if (fetchErr || !review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  const entityType = review.entity_type as DuplicateEntityType;
  const loserId =
    winnerId === review.entity_a_id
      ? review.entity_b_id
      : review.entity_a_id;
  const table = ENTITY_TABLES[entityType];

  // 2. Fetch both entities
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

  // 3. Backfill missing fields on winner
  const updates = backfillFields(
    winnerRow as Record<string, unknown>,
    loserRow as Record<string, unknown>,
    MERGE_FIELDS[entityType]
  );
  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await supabase
      .from(table)
      .update(updates)
      .eq("id", winnerId);
    if (updateErr) {
      console.error(
        `[DuplicateDetection] Failed to backfill fields:`,
        updateErr.message
      );
    }
  }

  // 4. Reassign relationships
  for (const rel of RELATIONSHIP_MAP[entityType]) {
    const { error: relErr } = await supabase
      .from(rel.table)
      .update({ [rel.fkColumn]: winnerId })
      .eq(rel.fkColumn, loserId);
    if (relErr) {
      console.error(
        `[DuplicateDetection] Failed to reassign ${rel.table}.${rel.fkColumn}:`,
        relErr.message
      );
    }
  }

  // 5. Soft-delete loser
  const { error: deleteErr } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", loserId);
  if (deleteErr) {
    console.error(
      `[DuplicateDetection] Failed to soft-delete loser:`,
      deleteErr.message
    );
  }

  // 6. Update review record
  const { error: reviewErr } = await supabase
    .from("duplicate_reviews")
    .update({
      status: "merged",
      winner_id: winnerId,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  if (reviewErr) {
    console.error(
      `[DuplicateDetection] Failed to update review:`,
      reviewErr.message
    );
  }

  // 7. Cascade: replace loser in other pending reviews
  const { data: affectedReviews } = await supabase
    .from("duplicate_reviews")
    .select("id, entity_a_id, entity_b_id")
    .eq("company_id", review.company_id)
    .eq("entity_type", entityType)
    .eq("status", "pending")
    .neq("id", reviewId)
    .or(`entity_a_id.eq.${loserId},entity_b_id.eq.${loserId}`);

  for (const affected of affectedReviews ?? []) {
    const otherSide =
      affected.entity_a_id === loserId
        ? affected.entity_b_id
        : affected.entity_a_id;

    if (otherSide === winnerId) {
      // Would become self-reference — delete
      await supabase
        .from("duplicate_reviews")
        .delete()
        .eq("id", affected.id);
    } else {
      // Replace loser with winner, maintaining ordered pair
      const [newA, newB] = orderedPair(winnerId, otherSide);
      await supabase
        .from("duplicate_reviews")
        .update({ entity_a_id: newA, entity_b_id: newB })
        .eq("id", affected.id);
    }
  }
}

// ─── Dismiss ─────────────────────────────────────────────────────────────────

async function dismissPair(
  reviewId: string,
  resolvedBy: string
): Promise<void> {
  const supabase = requireSupabase();
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

// ─── Exports ─────────────────────────────────────────────────────────────────

export const DuplicateDetectionService = {
  scanCompany,
  getPendingReviews,
  mergeEntities,
  dismissPair,

  // Exposed for unit testing
  _scanClients: scanClients,
  _scanOpportunities: scanOpportunities,
  _scanProjects: scanProjects,
  _scanTasks: scanTasks,
  _datesOverlap: datesOverlap,
  _backfillFields: backfillFields,
};
