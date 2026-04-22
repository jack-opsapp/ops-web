/**
 * POST /api/cron/memory-decay
 * Vercel cron: runs daily at 3am UTC.
 *
 * Phase C memory maintenance:
 * 1. Decay — reduce decay_score for memories not accessed in 30+ days
 * 2. Prune — delete memories with decay_score < 0.1 older than 6 months
 * 3. Consolidate — merge near-duplicate memories (cosine similarity > 0.95)
 *
 * Unresolved commitment memories are protected from decay/prune when
 * their due_date is still in the future (or within the last 7 days) —
 * a commitment that hasn't landed yet is load-bearing regardless of
 * how recently anyone "accessed" the row, and deleting one silently
 * would make the COMMITMENTS rail wrong.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();

  const stats = {
    decayed: 0,
    pruned: 0,
    consolidated: 0,
    errors: [] as string[],
  };

  // Commitments whose due_date hasn't passed (with a 7-day grace window)
  // are load-bearing — don't decay or prune them. Grace window is there
  // because a commitment "overdue by 3 days" is still something the user
  // may need to see and act on, not something to silently vacuum.
  const commitmentGraceWindowIso = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  console.log("[memory-decay] Starting memory maintenance cycle");

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1: Decay — reduce decay_score for stale memories
  // Memories not accessed in 30+ days lose 5% per day of inactivity.
  // ═══════════════════════════════════════════════════════════════════════════

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: staleMemories, error: staleErr } = await supabase
      .from("agent_memories")
      .select("id, category, decay_score, last_accessed_at, created_at, due_date, resolved_at")
      .gt("decay_score", 0.1)
      .or(
        `last_accessed_at.lt.${thirtyDaysAgo.toISOString()},` +
        `and(last_accessed_at.is.null,created_at.lt.${thirtyDaysAgo.toISOString()})`
      )
      .limit(1000);

    if (staleErr) {
      stats.errors.push(`Decay fetch failed: ${staleErr.message}`);
    } else if (staleMemories && staleMemories.length > 0) {
      for (const memory of staleMemories) {
        // Skip load-bearing unresolved commitments — see file header.
        if (
          memory.category === "commitment" &&
          memory.resolved_at === null &&
          (memory.due_date === null ||
            (memory.due_date as string) >= commitmentGraceWindowIso)
        ) {
          continue;
        }

        const referenceDate = memory.last_accessed_at || memory.created_at;
        const daysSinceAccess = Math.floor(
          (Date.now() - new Date(referenceDate as string).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const daysOverThreshold = daysSinceAccess - 30;

        if (daysOverThreshold <= 0) continue;

        // Apply 0.95 decay per day of inactivity beyond 30 days
        const currentScore = (memory.decay_score as number) || 1.0;
        const newScore = currentScore * Math.pow(0.95, daysOverThreshold);

        // Only update if score actually changed meaningfully (avoid churn)
        if (Math.abs(newScore - currentScore) < 0.001) continue;

        const { error: updateErr } = await supabase
          .from("agent_memories")
          .update({ decay_score: Math.max(0, newScore) })
          .eq("id", memory.id);

        if (updateErr) {
          stats.errors.push(`Decay update failed for ${memory.id}: ${updateErr.message}`);
        } else {
          stats.decayed++;
        }
      }
    }

    console.log(`[memory-decay] Phase 1 (decay) complete: ${stats.decayed} memories decayed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[memory-decay] Phase 1 (decay) failed:", message);
    stats.errors.push(`Decay phase failed: ${message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: Prune — delete very low-score memories older than 6 months
  // ═══════════════════════════════════════════════════════════════════════════

  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { data: pruneTargets, error: pruneErr } = await supabase
      .from("agent_memories")
      .select("id, category, due_date, resolved_at")
      .lt("decay_score", 0.1)
      .lt("created_at", sixMonthsAgo.toISOString())
      .limit(500);

    if (pruneErr) {
      stats.errors.push(`Prune fetch failed: ${pruneErr.message}`);
    } else if (pruneTargets && pruneTargets.length > 0) {
      // Filter out still-actionable commitments before deletion. A 6-month-old
      // commitment with a future due_date (e.g. a seasonal warranty followup)
      // is still real work — deleting it would make the COMMITMENTS rail lie.
      const pruneIds = pruneTargets
        .filter(
          (m) =>
            !(
              m.category === "commitment" &&
              m.resolved_at === null &&
              (m.due_date === null ||
                (m.due_date as string) >= commitmentGraceWindowIso)
            )
        )
        .map((m) => m.id as string);

      if (pruneIds.length > 0) {
        const { error: deleteErr } = await supabase
          .from("agent_memories")
          .delete()
          .in("id", pruneIds);

        if (deleteErr) {
          stats.errors.push(`Prune delete failed: ${deleteErr.message}`);
        } else {
          stats.pruned = pruneIds.length;
        }
      }
    }

    console.log(`[memory-decay] Phase 2 (prune) complete: ${stats.pruned} memories pruned`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[memory-decay] Phase 2 (prune) failed:", message);
    stats.errors.push(`Prune phase failed: ${message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3: Consolidate — merge near-duplicate memories
  // Find pairs with cosine similarity > 0.95 on embeddings.
  // Keep the one with higher confidence; merge access counts.
  // ═══════════════════════════════════════════════════════════════════════════

  try {
    // Process per-company to keep the query scoped
    const { data: companies } = await supabase
      .from("agent_memories")
      .select("company_id")
      .not("embedding", "is", null)
      .limit(1000);

    const uniqueCompanyIds = [
      ...new Set((companies || []).map((c) => c.company_id as string)),
    ];

    for (const companyId of uniqueCompanyIds) {
      try {
        // Fetch memories with embeddings for this company
        const { data: memories } = await supabase
          .from("agent_memories")
          .select("id, category, content, confidence, access_count, embedding, decay_score")
          .eq("company_id", companyId)
          .not("embedding", "is", null)
          .gt("decay_score", 0.1)
          .order("confidence", { ascending: false })
          .limit(200);

        if (!memories || memories.length < 2) continue;

        const mergedIds = new Set<string>();

        for (const memory of memories) {
          if (mergedIds.has(memory.id as string)) continue;

          // Find near-duplicates using vector similarity
          const { data: duplicates } = await supabase.rpc("match_memories", {
            query_embedding: memory.embedding,
            match_company_id: companyId,
            match_threshold: 0.95,
            match_count: 5,
          });

          if (!duplicates || duplicates.length < 2) continue;

          // The first result is the memory itself. Merge the rest into it.
          const primary = memory;
          const toMerge = (duplicates as Record<string, unknown>[]).filter(
            (d) => (d.id as string) !== (primary.id as string) && !mergedIds.has(d.id as string)
          );

          for (const duplicate of toMerge) {
            const mergedAccessCount =
              ((primary.access_count as number) || 0) +
              ((duplicate.access_count as number) || 0);
            const mergedConfidence = Math.max(
              (primary.confidence as number) || 0,
              (duplicate.confidence as number) || 0
            );

            await supabase
              .from("agent_memories")
              .update({
                access_count: mergedAccessCount,
                confidence: mergedConfidence,
                last_accessed_at: new Date().toISOString(),
              })
              .eq("id", primary.id);

            await supabase
              .from("agent_memories")
              .delete()
              .eq("id", duplicate.id);

            mergedIds.add(duplicate.id as string);
            stats.consolidated++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        stats.errors.push(`Consolidation failed for company ${companyId}: ${message}`);
      }
    }

    console.log(`[memory-decay] Phase 3 (consolidate) complete: ${stats.consolidated} memories merged`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[memory-decay] Phase 3 (consolidate) failed:", message);
    stats.errors.push(`Consolidation phase failed: ${message}`);
  }

  console.log(
    `[memory-decay] Cycle complete — decayed: ${stats.decayed}, pruned: ${stats.pruned}, consolidated: ${stats.consolidated}, errors: ${stats.errors.length}`
  );

  return NextResponse.json({
    ok: stats.errors.length === 0,
    ...stats,
  });
}
