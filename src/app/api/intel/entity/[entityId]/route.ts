/**
 * OPS Intel - Entity Drill-Down Endpoint
 *
 * GET /api/intel/entity/[entityId]?type=<type>&companyId=<uuid>
 *
 * Returns full detail for a single entity in the Intel Galaxy.
 * Supports both Phase C AI entities (person, company, service, material)
 * and live OPS records (project, invoice, estimate, voice_profile).
 *
 * Requires authentication: Firebase/Supabase JWT + company ownership check.
 * All queries use the service-role client and filter by company_id.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import type { IntelFact, IntelKnowledgeEdge, IntelEntityDetail } from "@/types/intel";

export const maxDuration = 30;

// ─── UUID Validation ──────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

// ─── Phase C Entity Types ─────────────────────────────────────────────────────

const PHASE_C_TYPES = new Set(["person", "company", "service", "material"]);

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  // ── Auth: verify JWT + company ownership ────────────────────────────────
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId } = await params;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "";
  const companyId = searchParams.get("companyId") ?? "";

  if (!entityId) {
    return NextResponse.json({ error: "entityId is required" }, { status: 400 });
  }

  if (!companyId || !isUUID(companyId)) {
    return NextResponse.json(
      { error: "companyId query parameter is required and must be a valid UUID" },
      { status: 400 }
    );
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user || (user.company_id as string) !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getServiceRoleClient();

  // ── Phase C entity (person / company / service / material) ───────────────
  if (PHASE_C_TYPES.has(type)) {
    if (!isUUID(entityId)) {
      return NextResponse.json(
        { error: "entityId must be a valid UUID for Phase C entities" },
        { status: 400 }
      );
    }

    const [
      { data: entity },
      { data: facts },
      { data: edges },
    ] = await Promise.all([
      supabase
        .from("graph_entities")
        .select("*")
        .eq("id", entityId)
        .eq("company_id", companyId)
        .single(),

      supabase
        .from("agent_memories")
        .select("id, category, content, confidence, valid_from, valid_to, created_at")
        .eq("entity_id", entityId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("agent_knowledge_graph")
        .select("id, source_entity_id, target_entity_id, predicate, link_type, confidence, properties, created_at")
        .eq("company_id", companyId)
        .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`),
    ]);

    const mappedFacts: IntelFact[] = (facts ?? []).map((f) => ({
      id: f.id as string,
      category: (f.category as string) ?? "general",
      content: (f.content as string) ?? "",
      confidence: (f.confidence as number) ?? 0,
      validFrom: (f.valid_from as string) ?? null,
      validTo: (f.valid_to as string) ?? null,
      createdAt: f.created_at as string,
    }));

    const mappedEdges: IntelKnowledgeEdge[] = (edges ?? []).map((e) => ({
      id: e.id as string,
      sourceEntityId: e.source_entity_id as string,
      targetEntityId: e.target_entity_id as string,
      predicate: (e.predicate as string) ?? "",
      linkType: (e.link_type as string) ?? null,
      confidence: (e.confidence as number) ?? 0,
      properties: (e.properties as Record<string, unknown>) ?? {},
      createdAt: e.created_at as string,
    }));

    const response: IntelEntityDetail = {
      entity: entity ? (entity as Record<string, unknown>) : null,
      facts: mappedFacts,
      edges: mappedEdges,
      details: {},
    };

    return NextResponse.json(response);
  }

  // ── Project ───────────────────────────────────────────────────────────────
  if (type === "project") {
    if (!isUUID(entityId)) {
      return NextResponse.json(
        { error: "entityId must be a valid UUID for project entities" },
        { status: 400 }
      );
    }

    const [
      { data: project },
      { data: tasks },
      { data: invoices },
      { data: estimates },
    ] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("id", entityId)
        .eq("company_id", companyId)
        .single(),

      supabase
        .from("project_tasks")
        .select("id, title, status, due_date, assigned_to, created_at")
        .eq("project_id", entityId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),

      supabase
        .from("invoices")
        .select("id, invoice_number, subject, total, status, issue_date, due_date, amount_paid")
        .eq("project_id", entityId)
        .eq("company_id", companyId),

      supabase
        .from("estimates")
        .select("id, estimate_number, title, total, status, sent_at")
        .eq("project_id", entityId)
        .eq("company_id", companyId),
    ]);

    const response: IntelEntityDetail = {
      entity: project ? (project as Record<string, unknown>) : null,
      facts: [],
      edges: [],
      details: {
        tasks: tasks ?? [],
        invoices: invoices ?? [],
        estimates: estimates ?? [],
        taskCount: (tasks ?? []).length,
        invoiceCount: (invoices ?? []).length,
        estimateCount: (estimates ?? []).length,
      },
    };

    return NextResponse.json(response);
  }

  // ── Invoice ───────────────────────────────────────────────────────────────
  if (type === "invoice") {
    if (!isUUID(entityId)) {
      return NextResponse.json(
        { error: "entityId must be a valid UUID for invoice entities" },
        { status: 400 }
      );
    }

    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", entityId)
      .eq("company_id", companyId)
      .single();

    const response: IntelEntityDetail = {
      entity: invoice ? (invoice as Record<string, unknown>) : null,
      facts: [],
      edges: [],
      details: {},
    };

    return NextResponse.json(response);
  }

  // ── Estimate ──────────────────────────────────────────────────────────────
  if (type === "estimate") {
    if (!isUUID(entityId)) {
      return NextResponse.json(
        { error: "entityId must be a valid UUID for estimate entities" },
        { status: 400 }
      );
    }

    const { data: estimate } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", entityId)
      .eq("company_id", companyId)
      .single();

    const response: IntelEntityDetail = {
      entity: estimate ? (estimate as Record<string, unknown>) : null,
      facts: [],
      edges: [],
      details: {},
    };

    return NextResponse.json(response);
  }

  // ── Voice Profile ─────────────────────────────────────────────────────────
  if (type === "voice_profile") {
    // entityId here is the writing profile UUID (id column)
    const queryById = isUUID(entityId);

    const query = supabase
      .from("agent_writing_profiles")
      .select("*")
      .eq("company_id", companyId);

    const { data: profile } = queryById
      ? await query.eq("id", entityId).single()
      : await query.eq("profile_type", entityId).single();

    const response: IntelEntityDetail = {
      entity: profile ? (profile as Record<string, unknown>) : null,
      facts: [],
      edges: [],
      details: {},
    };

    return NextResponse.json(response);
  }

  // ── Unknown type ──────────────────────────────────────────────────────────
  return NextResponse.json(
    { error: `Unknown entity type: ${type}` },
    { status: 400 }
  );
}
