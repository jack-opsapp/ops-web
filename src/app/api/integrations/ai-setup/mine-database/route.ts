/**
 * POST /api/integrations/ai-setup/mine-database
 *
 * Sprint E2.3: Mines existing business data (estimates, clients, projects)
 * and stores high-confidence authoritative facts in agent_memories and
 * relationship edges in agent_knowledge_graph.
 *
 * These are database-sourced facts — confidence 1.0, source "database".
 * They provide the agent with ground-truth pricing and relationship data
 * that doesn't depend on email extraction.
 *
 * Gated behind phase_c feature flag.
 * Requires CRON_SECRET or Firebase-authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import { generateEmbedding } from "@/lib/api/services/memory-service";

export const maxDuration = 300;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface MiningStats {
  pricingFacts: number;
  clientRelationships: number;
  seasonalPatterns: number;
  errors: string[];
  durationMs: number;
}

type SupabaseClient = ReturnType<typeof getServiceRoleClient>;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Escape special SQL ilike characters to prevent injection via content strings */
function escapeIlike(str: string): string {
  return str.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * Batch a Supabase .in() query into chunks to avoid PostgREST URL length limits.
 */
async function batchedIn<T>(
  queryFn: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ids: string[],
  chunkSize = 80
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await queryFn(chunk);
    if (error) throw new Error(error.message);
    if (data) results.push(...data);
  }
  return results;
}

/**
 * Store a mined fact in agent_memories with confidence 1.0.
 * Deduplicates by checking for existing facts with similar content.
 * Returns true if a new fact was stored, false if deduplicated.
 * Never throws — logs and returns false on failure.
 */
async function storeFact(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  category: string,
  content: string,
  entityId?: string | null
): Promise<boolean> {
  try {
    // Check for existing similar fact (escaped to prevent ilike injection)
    const searchFragment = escapeIlike(content.slice(0, 60));
    const { data: existing } = await supabase
      .from("agent_memories")
      .select("id")
      .eq("company_id", companyId)
      .eq("category", category)
      .eq("source", "database")
      .ilike("content", `%${searchFragment}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      // Refresh existing fact — update confidence and timestamp
      await supabase
        .from("agent_memories")
        .update({
          content,
          confidence: 1.0,
          decay_score: 1.0,
          last_accessed_at: new Date().toISOString(),
        })
        .eq("id", existing[0].id);
      return false;
    }

    // Generate embedding for vector search
    const embedding = await generateEmbedding(`${category}: ${content}`);

    await supabase.from("agent_memories").insert({
      company_id: companyId,
      user_id: userId,
      memory_type: "fact",
      category,
      content,
      confidence: 1.0,
      decay_score: 1.0,
      source: "database",
      source_id: `mine-${new Date().toISOString()}`,
      entity_id: entityId ?? null,
      ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
    });

    return true;
  } catch (err) {
    console.error(`[mine-database] storeFact failed for "${content.slice(0, 40)}...":`, err);
    return false;
  }
}

// ─── Mining Functions ──────────────────────────────────────────────────────────

/**
 * Mine estimates for service/pricing patterns.
 * Produces facts like "Standard deck construction: $45-65/sqft based on 23 estimates"
 */
async function mineEstimatePricing(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<number> {
  let factsStored = 0;

  // Fetch all non-deleted estimates
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, total, status, issue_date, client_id")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("issue_date", { ascending: false })
    .limit(500);

  if (!estimates || estimates.length === 0) return 0;

  const estimateIds = estimates.map((e) => (e as Record<string, unknown>).id as string);

  // Fetch all line items for these estimates (batched, scoped to company)
  const lineItems = await batchedIn<Record<string, unknown>>(
    (ids) =>
      supabase
        .from("line_items")
        .select("id, estimate_id, name, quantity, unit, unit_price, line_total, task_type_id, category")
        .eq("company_id", companyId)
        .in("estimate_id", ids)
        .limit(1000),
    estimateIds
  );

  if (lineItems.length === 0) return 0;

  // Fetch task type names
  const { data: taskTypes } = await supabase
    .from("task_types")
    .select("id, display")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const taskTypeMap = new Map<string, string>();
  for (const tt of (taskTypes ?? []) as Record<string, unknown>[]) {
    taskTypeMap.set(tt.id as string, tt.display as string);
  }

  // Group line items by name (normalized) to find pricing patterns
  const itemGroups = new Map<string, {
    name: string;
    prices: number[];
    quantities: number[];
    unit: string;
    taskTypeId: string | null;
  }>();

  for (const li of lineItems) {
    const name = (li.name as string || "").toLowerCase().trim();
    if (!name || name.length < 3) continue;

    const unitPrice = Number(li.unit_price ?? 0);
    if (unitPrice <= 0) continue;

    if (!itemGroups.has(name)) {
      itemGroups.set(name, {
        name: li.name as string,
        prices: [],
        quantities: [],
        unit: (li.unit as string) ?? "each",
        taskTypeId: (li.task_type_id as string) ?? null,
      });
    }

    const group = itemGroups.get(name)!;
    group.prices.push(unitPrice);
    group.quantities.push(Number(li.quantity ?? 0));
  }

  // Generate pricing facts for items with 3+ data points
  for (const [, group] of itemGroups) {
    if (group.prices.length < 3) continue;

    const sorted = [...group.prices].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = sorted.reduce((s, p) => s + p, 0) / sorted.length;
    const avgQty = group.quantities.reduce((s, q) => s + q, 0) / group.quantities.length;

    const taskTypeName = group.taskTypeId ? taskTypeMap.get(group.taskTypeId) : null;
    const servicePrefix = taskTypeName ? `${taskTypeName} — ` : "";

    const content = `${servicePrefix}${group.name}: ${formatCurrency(min)}-${formatCurrency(max)}/${group.unit} (avg ${formatCurrency(avg)}/${group.unit}, typical qty ${avgQty.toFixed(1)}) based on ${group.prices.length} line items`;

    if (await storeFact(supabase, companyId, userId, "pricing", content)) {
      factsStored++;
    }
  }

  // Generate overall estimate value facts
  const estimateTotals = (estimates as Record<string, unknown>[])
    .map((e) => Number(e.total ?? 0))
    .filter((t) => t > 0);

  if (estimateTotals.length >= 5) {
    const sorted = [...estimateTotals].sort((a, b) => a - b);
    const avg = sorted.reduce((s, t) => s + t, 0) / sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

    const content = `Average estimate value: ${formatCurrency(avg)} (median ${formatCurrency(med)}, range ${formatCurrency(min)}-${formatCurrency(max)}) based on ${estimateTotals.length} estimates`;
    if (await storeFact(supabase, companyId, userId, "pricing", content)) {
      factsStored++;
    }
  }

  // Generate per-task-type pricing summaries
  const taskTypeTotals = new Map<string, number[]>();
  for (const li of lineItems) {
    const ttId = li.task_type_id as string | null;
    if (!ttId) continue;
    if (!taskTypeTotals.has(ttId)) taskTypeTotals.set(ttId, []);
    taskTypeTotals.get(ttId)!.push(Number(li.line_total ?? 0));
  }

  for (const [ttId, totals] of taskTypeTotals) {
    if (totals.length < 3) continue;
    const name = taskTypeMap.get(ttId) ?? ttId;
    const avg = totals.reduce((s, t) => s + t, 0) / totals.length;
    const min = Math.min(...totals);
    const max = Math.max(...totals);

    const content = `${name} service: typically ${formatCurrency(min)}-${formatCurrency(max)} per item (avg ${formatCurrency(avg)}) based on ${totals.length} line items`;
    if (await storeFact(supabase, companyId, userId, "pricing", content)) {
      factsStored++;
    }
  }

  return factsStored;
}

/**
 * Mine client records for relationship patterns.
 * Stores edges in agent_knowledge_graph linking clients to service types.
 * Uses batched queries to avoid N+1 pattern.
 */
async function mineClientRelationships(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<{ edgesStored: number; factsStored: number }> {
  let edgesStored = 0;
  let factsStored = 0;

  // Fetch clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .limit(200);

  if (!clients || clients.length === 0) return { edgesStored: 0, factsStored: 0 };

  // Fetch task types for lookup
  const { data: taskTypes } = await supabase
    .from("task_types")
    .select("id, display")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const taskTypeMap = new Map<string, string>();
  for (const tt of (taskTypes ?? []) as Record<string, unknown>[]) {
    taskTypeMap.set(tt.id as string, tt.display as string);
  }

  const clientIds = (clients as Record<string, unknown>[]).map((c) => c.id as string);

  // Batch fetch: all projects for all clients at once
  const allProjects = await batchedIn<Record<string, unknown>>(
    (ids) =>
      supabase
        .from("projects")
        .select("id, title, status, client_id")
        .eq("company_id", companyId)
        .in("client_id", ids)
        .is("deleted_at", null)
        .limit(1000),
    clientIds
  );

  // Group projects by client_id
  const projectsByClient = new Map<string, Record<string, unknown>[]>();
  for (const p of allProjects) {
    const cid = p.client_id as string;
    if (!projectsByClient.has(cid)) projectsByClient.set(cid, []);
    projectsByClient.get(cid)!.push(p);
  }

  // Batch fetch: all tasks for all projects at once
  const allProjectIds = allProjects.map((p) => p.id as string);
  const allTasks = await batchedIn<Record<string, unknown>>(
    (ids) =>
      supabase
        .from("project_tasks")
        .select("project_id, task_type_id")
        .in("project_id", ids)
        .is("deleted_at", null)
        .limit(2000),
    allProjectIds
  );

  // Group tasks by project_id
  const tasksByProject = new Map<string, Record<string, unknown>[]>();
  for (const t of allTasks) {
    const pid = t.project_id as string;
    if (!tasksByProject.has(pid)) tasksByProject.set(pid, []);
    tasksByProject.get(pid)!.push(t);
  }

  // Pre-upsert all service entities (one query per unique task type)
  const serviceEntityIds = new Map<string, string>();
  const uniqueTaskTypeIds = [...new Set(allTasks.map((t) => t.task_type_id as string).filter(Boolean))];
  for (const ttId of uniqueTaskTypeIds) {
    const serviceName = taskTypeMap.get(ttId) ?? ttId;
    try {
      const { data: serviceEntity } = await supabase
        .from("graph_entities")
        .upsert(
          {
            company_id: companyId,
            entity_type: "service",
            name: serviceName,
            normalized_name: serviceName.toLowerCase(),
            properties: { task_type_id: ttId },
            confidence: 1.0,
            source: "database",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id,entity_type,normalized_name" }
        )
        .select("id")
        .single();
      if (serviceEntity) serviceEntityIds.set(ttId, serviceEntity.id as string);
    } catch {
      // Skip this service type
    }
  }

  // Process each client
  for (const clientRow of clients as Record<string, unknown>[]) {
    try {
      const clientId = clientRow.id as string;
      const clientName = clientRow.name as string;
      const projects = projectsByClient.get(clientId) ?? [];
      if (projects.length === 0) continue;

      // Count service types from pre-fetched tasks
      const serviceTypeCounts = new Map<string, number>();
      for (const project of projects) {
        const tasks = tasksByProject.get(project.id as string) ?? [];
        for (const task of tasks) {
          const ttId = task.task_type_id as string | null;
          if (!ttId) continue;
          serviceTypeCounts.set(ttId, (serviceTypeCounts.get(ttId) || 0) + 1);
        }
      }

      // Upsert client entity
      const normalizedName = (clientRow.email as string)?.toLowerCase() || clientName.toLowerCase();
      const { data: clientEntity } = await supabase
        .from("graph_entities")
        .upsert(
          {
            company_id: companyId,
            entity_type: "person",
            name: clientName,
            normalized_name: normalizedName,
            email: (clientRow.email as string) ?? null,
            properties: { source_client_id: clientId },
            confidence: 1.0,
            source: "database",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id,entity_type,normalized_name" }
        )
        .select("id")
        .single();

      if (!clientEntity) continue;

      // Create service preference edges using pre-upserted service entities
      for (const [ttId, count] of serviceTypeCounts) {
        const serviceEntityId = serviceEntityIds.get(ttId);
        if (!serviceEntityId) continue;

        const { error: edgeErr } = await supabase
          .from("agent_knowledge_graph")
          .upsert(
            {
              company_id: companyId,
              source_entity_id: clientEntity.id,
              predicate: "uses_service",
              target_entity_id: serviceEntityId,
              link_type: "database",
              properties: { task_count: count, project_count: projects.length },
              confidence: 1.0,
              valid_from: new Date().toISOString(),
            },
            { onConflict: "company_id,source_entity_id,predicate,target_entity_id" }
          );

        if (!edgeErr) edgesStored++;
      }

      // Store a client summary fact
      const activeProjects = projects.filter(
        (p) => p.status === "in_progress" || p.status === "accepted"
      ).length;

      const topServices = Array.from(serviceTypeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([ttId]) => taskTypeMap.get(ttId) ?? ttId);

      if (topServices.length > 0) {
        const content = `${clientName}: ${projects.length} projects (${activeProjects} active), primary services: ${topServices.join(", ")}`;
        if (await storeFact(supabase, companyId, userId, "client_preference", content, clientEntity.id as string)) {
          factsStored++;
        }
      }
    } catch (err) {
      console.error(`[mine-database] Client relationship mining failed for ${clientRow.name}:`, err);
    }
  }

  return { edgesStored, factsStored };
}

/**
 * Mine project history for seasonal and operational patterns.
 * Produces facts like "80% of deck projects booked March-June"
 */
async function mineSeasonalPatterns(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<number> {
  let factsStored = 0;

  // Fetch all projects with dates
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, status, start_date, end_date, client_id, created_at")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!projects || projects.length < 10) return 0;

  // Fetch tasks for all projects (batched)
  const projectIds = (projects as Record<string, unknown>[]).map((p) => p.id as string);
  const tasks = await batchedIn<Record<string, unknown>>(
    (ids) =>
      supabase
        .from("project_tasks")
        .select("project_id, task_type_id, start_date, end_date, status")
        .in("project_id", ids)
        .is("deleted_at", null)
        .limit(2000),
    projectIds
  );

  // Fetch task types
  const { data: taskTypes } = await supabase
    .from("task_types")
    .select("id, display")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const taskTypeMap = new Map<string, string>();
  for (const tt of (taskTypes ?? []) as Record<string, unknown>[]) {
    taskTypeMap.set(tt.id as string, tt.display as string);
  }

  // Analyze monthly distribution of project creation
  const monthCounts = new Array<number>(12).fill(0);
  for (const project of projects as Record<string, unknown>[]) {
    const createdAt = project.created_at as string | null;
    if (!createdAt) continue;
    const month = new Date(createdAt).getMonth();
    monthCounts[month]++;
  }

  const totalProjects = monthCounts.reduce((s, c) => s + c, 0);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Find peak booking months (top 3)
  const monthPairs = monthCounts.map((count, idx) => ({ month: idx, count }));
  monthPairs.sort((a, b) => b.count - a.count);
  const peakMonths = monthPairs.slice(0, 3).filter((m) => m.count > 0);

  if (peakMonths.length > 0 && totalProjects >= 10) {
    const peakPct = Math.round(
      (peakMonths.reduce((s, m) => s + m.count, 0) / totalProjects) * 100
    );
    const content = `${peakPct}% of projects booked in ${peakMonths.map((m) => monthNames[m.month]).join(", ")} (based on ${totalProjects} projects)`;
    if (await storeFact(supabase, companyId, userId, "seasonal_pattern", content)) {
      factsStored++;
    }
  }

  // Find slowest months
  const slowMonths = monthPairs.filter((m) => m.count > 0).slice(-3);
  if (slowMonths.length > 0 && totalProjects >= 10) {
    const slowPct = Math.round(
      (slowMonths.reduce((s, m) => s + m.count, 0) / totalProjects) * 100
    );
    const content = `Slowest months: ${slowMonths.map((m) => monthNames[m.month]).join(", ")} (${slowPct}% of projects)`;
    if (await storeFact(supabase, companyId, userId, "seasonal_pattern", content)) {
      factsStored++;
    }
  }

  // Per-service seasonal analysis
  if (tasks.length > 0) {
    const serviceMonthCounts = new Map<string, number[]>();

    for (const task of tasks) {
      const ttId = task.task_type_id as string | null;
      if (!ttId) continue;
      const startDate = task.start_date as string | null;
      if (!startDate) continue;

      const month = new Date(startDate).getMonth();
      if (!serviceMonthCounts.has(ttId)) {
        serviceMonthCounts.set(ttId, new Array(12).fill(0));
      }
      serviceMonthCounts.get(ttId)![month]++;
    }

    for (const [ttId, counts] of serviceMonthCounts) {
      const total = counts.reduce((s, c) => s + c, 0);
      if (total < 5) continue;

      const serviceName = taskTypeMap.get(ttId) ?? ttId;
      const peakIdx = counts.indexOf(Math.max(...counts));
      const peakPct = Math.round((counts[peakIdx] / total) * 100);

      if (peakPct >= 20) {
        const content = `${serviceName}: peak bookings in ${monthNames[peakIdx]} (${peakPct}% of ${total} tasks)`;
        if (await storeFact(supabase, companyId, userId, "seasonal_pattern", content)) {
          factsStored++;
        }
      }
    }
  }

  // Average project duration
  const durations: number[] = [];
  for (const project of projects as Record<string, unknown>[]) {
    const start = project.start_date as string | null;
    const end = project.end_date as string | null;
    if (!start || !end) continue;
    const days = Math.floor(
      (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days > 0 && days < 365) durations.push(days);
  }

  if (durations.length >= 5) {
    const avgDays = durations.reduce((s, d) => s + d, 0) / durations.length;
    const avgWeeks = (avgDays / 7).toFixed(1);
    const content = `Average project duration: ${avgWeeks} weeks (${Math.round(avgDays)} days) based on ${durations.length} projects`;
    if (await storeFact(supabase, companyId, userId, "process", content)) {
      factsStored++;
    }
  }

  // Project completion rate
  const completed = (projects as Record<string, unknown>[]).filter(
    (p) => p.status === "completed" || p.status === "closed"
  ).length;
  if (totalProjects >= 10) {
    const completionRate = Math.round((completed / totalProjects) * 100);
    const content = `Project completion rate: ${completionRate}% (${completed}/${totalProjects} projects)`;
    if (await storeFact(supabase, companyId, userId, "process", content)) {
      factsStored++;
    }
  }

  return factsStored;
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
  // Auth: CRON_SECRET or Firebase-authenticated user session
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let userId: string;
  let companyId: string;

  if (isCronAuth) {
    // Cron-authenticated — companyId from body, userId from body or system
    try {
      const body = await request.json();
      companyId = body.companyId;
      userId = body.userId ?? "system";
      if (!companyId) {
        return NextResponse.json({ error: "companyId required" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  } else {
    // User-authenticated — verify Firebase token and resolve user
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    userId = user.id as string;

    // companyId from body, validated against user's company
    try {
      const body = await request.json();
      companyId = body.companyId || (user.company_id as string);
      if (!companyId) {
        return NextResponse.json({ error: "companyId required" }, { status: 400 });
      }
      // Ensure user belongs to requested company
      if (user.company_id && companyId !== user.company_id) {
        return NextResponse.json({ error: "Forbidden — company mismatch" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  // Gate behind phase_c feature flag
  const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
    companyId,
    "phase_c"
  );
  if (!phaseCEnabled) {
    return NextResponse.json(
      { error: "Phase C not enabled for this company" },
      { status: 403 }
    );
  }

  const stats: MiningStats = {
    pricingFacts: 0,
    clientRelationships: 0,
    seasonalPatterns: 0,
    errors: [],
    durationMs: 0,
  };

  console.log(`[mine-database] Starting database mining for company ${companyId} (user: ${userId})`);

  // Phase 1: Mine estimate pricing patterns
  try {
    stats.pricingFacts = await mineEstimatePricing(supabase, companyId, userId);
    console.log(`[mine-database] Phase 1 complete: ${stats.pricingFacts} pricing facts`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mine-database] Phase 1 (pricing) failed:", message);
    stats.errors.push(`Pricing mining failed: ${message}`);
  }

  // Phase 2: Mine client relationships
  try {
    const result = await mineClientRelationships(supabase, companyId, userId);
    stats.clientRelationships = result.edgesStored + result.factsStored;
    console.log(`[mine-database] Phase 2 complete: ${result.edgesStored} edges, ${result.factsStored} facts`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mine-database] Phase 2 (clients) failed:", message);
    stats.errors.push(`Client mining failed: ${message}`);
  }

  // Phase 3: Mine seasonal patterns
  try {
    stats.seasonalPatterns = await mineSeasonalPatterns(supabase, companyId, userId);
    console.log(`[mine-database] Phase 3 complete: ${stats.seasonalPatterns} seasonal patterns`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mine-database] Phase 3 (seasonal) failed:", message);
    stats.errors.push(`Seasonal mining failed: ${message}`);
  }

  stats.durationMs = Date.now() - startTime;

  console.log(
    `[mine-database] Complete — pricing: ${stats.pricingFacts}, clients: ${stats.clientRelationships}, seasonal: ${stats.seasonalPatterns}, errors: ${stats.errors.length}, duration: ${stats.durationMs}ms`
  );

  return NextResponse.json({
    ok: stats.errors.length === 0,
    ...stats,
  });
  } finally {
    setSupabaseOverride(null);
  }
}
