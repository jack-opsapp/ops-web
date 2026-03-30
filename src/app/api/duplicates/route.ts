/**
 * GET /api/duplicates
 * Returns pending duplicate reviews for the authenticated user's company,
 * enriched with entity data for both sides of each pair.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

const TABLE_MAP: Record<string, string> = {
  client: "clients",
  opportunity: "opportunities",
  project: "projects",
  task: "project_tasks",
};

export async function GET(req: NextRequest) {
  const auth = await verifyAdminAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(auth.uid, auth.email);
  if (!user?.company_id) {
    return NextResponse.json({ error: "No company" }, { status: 400 });
  }

  const db = getServiceRoleClient();
  setSupabaseOverride(db);

  try {
    const reviews = await DuplicateDetectionService.getPendingReviews(
      user.company_id as string
    );

    // Batch-fetch entity data for both sides
    const idsByType: Record<string, Set<string>> = {};
    for (const r of reviews) {
      if (!idsByType[r.entityType]) idsByType[r.entityType] = new Set();
      idsByType[r.entityType].add(r.entityAId);
      idsByType[r.entityType].add(r.entityBId);
    }

    const entityCache: Record<string, Record<string, unknown>> = {};
    for (const [type, ids] of Object.entries(idsByType)) {
      const table = TABLE_MAP[type];
      const { data } = await db
        .from(table)
        .select("*")
        .in("id", Array.from(ids));
      for (const row of data ?? []) {
        entityCache[row.id as string] = row;
      }
    }

    const enriched = reviews.map((r) => ({
      ...r,
      entityA: entityCache[r.entityAId] ?? null,
      entityB: entityCache[r.entityBId] ?? null,
    }));

    return NextResponse.json({ reviews: enriched });
  } finally {
    setSupabaseOverride(null);
  }
}
