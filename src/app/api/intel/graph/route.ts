/**
 * OPS Intel - Unified Graph Endpoint
 *
 * GET /api/intel/graph?companyId=X
 *
 * Returns the unified knowledge graph merging:
 * - Live OPS records (clients, projects, invoices, estimates) — always
 * - Phase C AI entities, edges, writing profiles — when phase_c is enabled
 *
 * No user auth required — endpoint sits behind the dashboard auth gate.
 * All queries use the service-role client and filter by company_id.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

export const maxDuration = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntelEntity {
  id: string;
  type: "person" | "company" | "project" | "invoice" | "estimate" | "voice_profile";
  name: string;
  cluster: "client" | "vendor" | "subtrade" | "internal" | "project" | "financial" | "voice";
  properties: Record<string, unknown>;
  confidence: number;
  createdAt: string;
  source: "email_import" | "ops_data";
}

export interface IntelEdge {
  sourceId: string;
  targetId: string;
  predicate: string;
  properties?: Record<string, unknown>;
}

export interface IntelVoiceProfile {
  profileType: string;
  formalityScore: number;
  toneTraits: string[];
  greetingPatterns: string[];
  closingPatterns: string[];
  vocabularyPreferences: Record<string, unknown>;
  emailsAnalyzed: number;
}

export interface IntelGraphData {
  entities: IntelEntity[];
  edges: IntelEdge[];
  voiceProfiles: IntelVoiceProfile[];
  stats: {
    entityCount: number;
    edgeCount: number;
    profileCount: number;
    lastScanAt: string | null;
  };
  phaseCEnabled: boolean;
}

// ─── UUID Validation ──────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

// ─── Cluster Resolution for Phase C Entities ─────────────────────────────────

/**
 * Determine the galaxy cluster for a Phase C graph_entity.
 * We inspect the knowledge graph edges for relationship predicates that
 * indicate client / vendor / subtrade membership. Falls back to 'internal'.
 */
function resolvePhaseCluster(
  entityId: string,
  entityType: string,
  edgePredicates: Map<string, string[]>
): IntelEntity["cluster"] {
  const predicates = edgePredicates.get(entityId) ?? [];

  if (entityType === "person" || entityType === "company") {
    if (predicates.some((p) => p.includes("client"))) return "client";
    if (predicates.some((p) => p.includes("vendor"))) return "vendor";
    if (predicates.some((p) => p.includes("subtrade"))) return "subtrade";
    return "internal";
  }

  if (entityType === "service" || entityType === "material") return "vendor";
  if (entityType === "document") return "financial";

  return "internal";
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId") ?? "";

  if (!companyId || !isUUID(companyId)) {
    return NextResponse.json(
      { error: "companyId query parameter is required and must be a valid UUID" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  // ── Phase C gate ─────────────────────────────────────────────────────────
  const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
    companyId,
    "phase_c"
  );

  // ── Live OPS queries (always) ─────────────────────────────────────────────
  const [
    { data: clientRows },
    { data: projectRows },
    { data: invoiceRows },
    { data: estimateRows },
    { data: taskCountRows },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email, phone_number, address, created_at")
      .eq("company_id", companyId)
      .is("deleted_at", null),

    supabase
      .from("projects")
      .select("id, client_id, title, status, address, start_date, end_date, created_at")
      .eq("company_id", companyId)
      .is("deleted_at", null),

    supabase
      .from("invoices")
      .select("id, client_id, project_id, invoice_number, subject, total, status, issue_date, due_date, amount_paid, created_at")
      .eq("company_id", companyId),

    supabase
      .from("estimates")
      .select("id, client_id, project_id, estimate_number, title, total, status, sent_at, created_at")
      .eq("company_id", companyId),

    supabase
      .from("project_tasks")
      .select("project_id")
      .eq("company_id", companyId)
      .is("deleted_at", null),
  ]);

  // Build task-count-per-project map
  const taskCountMap = new Map<string, number>();
  for (const row of taskCountRows ?? []) {
    const pid = row.project_id as string;
    taskCountMap.set(pid, (taskCountMap.get(pid) ?? 0) + 1);
  }

  // ── Phase C queries (conditional) ────────────────────────────────────────
  let graphEntityRows: Record<string, unknown>[] = [];
  let knowledgeEdgeRows: Record<string, unknown>[] = [];
  let writingProfileRows: Record<string, unknown>[] = [];
  let lastScanAt: string | null = null;

  if (phaseCEnabled) {
    const [
      { data: entities },
      { data: kgEdges },
      { data: profiles },
    ] = await Promise.all([
      supabase
        .from("graph_entities")
        .select("id, entity_type, name, email, properties, confidence, source, created_at")
        .eq("company_id", companyId),

      supabase
        .from("agent_knowledge_graph")
        .select("id, source_entity_id, target_entity_id, predicate, properties, link_type, confidence, created_at")
        .eq("company_id", companyId)
        .not("source_entity_id", "is", null),

      supabase
        .from("agent_writing_profiles")
        .select("id, user_id, profile_type, formality_score, avg_sentence_length, greeting_patterns, closing_patterns, vocabulary_preferences, tone_traits, emails_analyzed, updated_at")
        .eq("company_id", companyId),
    ]);

    graphEntityRows = (entities ?? []) as Record<string, unknown>[];
    knowledgeEdgeRows = (kgEdges ?? []) as Record<string, unknown>[];
    writingProfileRows = (profiles ?? []) as Record<string, unknown>[];

    // Determine lastScanAt from the most recent entity creation
    if (graphEntityRows.length > 0) {
      const sorted = [...graphEntityRows].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      );
      lastScanAt = (sorted[0].created_at as string) ?? null;
    }
  }

  // ── Build entity list ─────────────────────────────────────────────────────

  const entities: IntelEntity[] = [];
  const edges: IntelEdge[] = [];

  // Map Phase C edge predicates by entity ID for cluster resolution
  const phaseEdgePredicates = new Map<string, string[]>();
  for (const edge of knowledgeEdgeRows) {
    const srcId = edge.source_entity_id as string;
    const tgtId = edge.target_entity_id as string;
    const pred = (edge.predicate as string) ?? "";
    if (srcId) {
      const existing = phaseEdgePredicates.get(srcId) ?? [];
      existing.push(pred);
      phaseEdgePredicates.set(srcId, existing);
    }
    if (tgtId) {
      const existing = phaseEdgePredicates.get(tgtId) ?? [];
      existing.push(pred);
      phaseEdgePredicates.set(tgtId, existing);
    }
  }

  // Clients
  for (const c of clientRows ?? []) {
    entities.push({
      id: c.id as string,
      type: "person",
      name: (c.name as string) ?? "Unknown Client",
      cluster: "client",
      properties: {
        email: c.email,
        phone: c.phone_number,
        address: c.address,
      },
      confidence: 1.0,
      createdAt: c.created_at as string,
      source: "ops_data",
    });
  }

  // Projects + edges from client → project
  for (const p of projectRows ?? []) {
    entities.push({
      id: p.id as string,
      type: "project",
      name: (p.title as string) ?? "Untitled Project",
      cluster: "project",
      properties: {
        status: p.status,
        address: p.address,
        startDate: p.start_date,
        endDate: p.end_date,
        taskCount: taskCountMap.get(p.id as string) ?? 0,
      },
      confidence: 1.0,
      createdAt: p.created_at as string,
      source: "ops_data",
    });

    if (p.client_id) {
      edges.push({
        sourceId: p.client_id as string,
        targetId: p.id as string,
        predicate: "owns_project",
      });
    }
  }

  // Invoices + edges from project → invoice
  for (const inv of invoiceRows ?? []) {
    entities.push({
      id: inv.id as string,
      type: "invoice",
      name: `Invoice ${(inv.invoice_number as string) ?? inv.id}`,
      cluster: "financial",
      properties: {
        subject: inv.subject,
        total: inv.total,
        status: inv.status,
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        amountPaid: inv.amount_paid,
        clientId: inv.client_id,
      },
      confidence: 1.0,
      createdAt: inv.created_at as string,
      source: "ops_data",
    });

    if (inv.project_id) {
      edges.push({
        sourceId: inv.project_id as string,
        targetId: inv.id as string,
        predicate: "has_invoice",
      });
    }
  }

  // Estimates + edges from project → estimate
  for (const est of estimateRows ?? []) {
    entities.push({
      id: est.id as string,
      type: "estimate",
      name: `Estimate ${(est.estimate_number as string) ?? est.id}`,
      cluster: "financial",
      properties: {
        title: est.title,
        total: est.total,
        status: est.status,
        sentAt: est.sent_at,
        clientId: est.client_id,
      },
      confidence: 1.0,
      createdAt: est.created_at as string,
      source: "ops_data",
    });

    // estimates.project_id is TEXT — still valid for edge building
    if (est.project_id) {
      edges.push({
        sourceId: est.project_id as string,
        targetId: est.id as string,
        predicate: "has_estimate",
      });
    }
  }

  // Phase C entities
  for (const ge of graphEntityRows) {
    const entityType = (ge.entity_type as string) ?? "person";
    const cluster = resolvePhaseCluster(
      ge.id as string,
      entityType,
      phaseEdgePredicates
    );

    entities.push({
      id: ge.id as string,
      type: entityType === "company" ? "company" : "person",
      name: (ge.name as string) ?? "Unknown",
      cluster,
      properties: {
        email: ge.email,
        ...((ge.properties as Record<string, unknown>) ?? {}),
        confidence: ge.confidence,
      },
      confidence: (ge.confidence as number) ?? 0.5,
      createdAt: ge.created_at as string,
      source: "email_import",
    });
  }

  // Phase C knowledge graph edges
  for (const ke of knowledgeEdgeRows) {
    edges.push({
      sourceId: ke.source_entity_id as string,
      targetId: ke.target_entity_id as string,
      predicate: (ke.predicate as string) ?? "related_to",
      properties: (ke.properties as Record<string, unknown>) ?? undefined,
    });
  }

  // ── Voice profiles ────────────────────────────────────────────────────────
  const voiceProfiles: IntelVoiceProfile[] = (writingProfileRows ?? []).map(
    (wp) => ({
      profileType: (wp.profile_type as string) ?? "unknown",
      formalityScore: (wp.formality_score as number) ?? 0,
      toneTraits: Array.isArray(wp.tone_traits) ? (wp.tone_traits as string[]) : [],
      greetingPatterns: Array.isArray(wp.greeting_patterns)
        ? (wp.greeting_patterns as string[])
        : [],
      closingPatterns: Array.isArray(wp.closing_patterns)
        ? (wp.closing_patterns as string[])
        : [],
      vocabularyPreferences:
        (wp.vocabulary_preferences as Record<string, unknown>) ?? {},
      emailsAnalyzed: (wp.emails_analyzed as number) ?? 0,
    })
  );

  // Voice profile entities (one per profile)
  for (const wp of writingProfileRows) {
    entities.push({
      id: wp.id as string,
      type: "voice_profile",
      name: `Voice — ${(wp.profile_type as string) ?? "Unknown"}`,
      cluster: "voice",
      properties: {
        userId: wp.user_id,
        profileType: wp.profile_type,
        formalityScore: wp.formality_score,
        emailsAnalyzed: wp.emails_analyzed,
        updatedAt: wp.updated_at,
      },
      confidence: 1.0,
      createdAt: (wp.updated_at as string) ?? new Date().toISOString(),
      source: "email_import",
    });
  }

  return NextResponse.json({
    entities,
    edges,
    voiceProfiles,
    stats: {
      entityCount: entities.length,
      edgeCount: edges.length,
      profileCount: voiceProfiles.length,
      lastScanAt,
    },
    phaseCEnabled,
  } satisfies IntelGraphData);
}
