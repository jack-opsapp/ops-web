/**
 * OPS Web - Inbox Velocity Endpoint
 *
 * GET /api/inbox/velocity?scope=own|company
 *
 * Returns the last 14 days of classification activity for the caller's
 * scope. Used by the empty-status-view's velocity section.
 *
 * Auth: Firebase/Supabase JWT. Permissions mirror /api/inbox/threads:
 *   - inbox.view          : required
 *   - inbox.view_company  : additionally required for scope=company
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import {
  padVelocityDays,
  computeWeekDelta,
  type VelocityDayRow,
} from "@/lib/api/services/inbox-velocity-helpers";
import type { InboxScope } from "@/lib/types/email-thread";

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
}

export async function GET(request: NextRequest) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = user.id as string;
  const companyId = user.company_id as string;

  if (!companyId) {
    return NextResponse.json(
      { error: "No company associated with user" },
      { status: 400 }
    );
  }

  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get("scope"));

  if (scope === "company") {
    const canViewCompany = await checkPermissionById(userId, "inbox.view_company");
    if (!canViewCompany) {
      return NextResponse.json(
        { error: "Forbidden (company scope)" },
        { status: 403 }
      );
    }
  }

  const supabase = getServiceRoleClient();

  // Resolve this user's connection ids for scope=own (same pattern as
  // /api/inbox/threads). scope=company looks across all connections.
  let ownConnectionIds: string[] = [];
  if (scope === "own") {
    const { data: connRows } = await supabase
      .from("email_connections")
      .select("id")
      .eq("company_id", companyId)
      .or(`user_id.eq.${userId},user_id.is.null`);
    ownConnectionIds = (connRows ?? []).map((r) => r.id as string);
  }

  try {
    const fourteenDaysAgoIso = new Date(
      Date.now() - 14 * 86_400_000
    ).toISOString();

    let query = supabase
      .from("email_threads")
      .select("category_classified_at, connection_id")
      .eq("company_id", companyId)
      .gte("category_classified_at", fourteenDaysAgoIso)
      .not("category_classified_at", "is", null);

    if (scope === "own") {
      if (ownConnectionIds.length === 0) {
        return NextResponse.json({
          daily: new Array(14).fill(0),
          weekTotal: 0,
          priorWeekTotal: 0,
          weekDelta: 0,
        });
      }
      query = query.in("connection_id", ownConnectionIds);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Bucket client-side by UTC day.
    const byDay = new Map<string, number>();
    for (const row of rows ?? []) {
      const iso = row.category_classified_at as string | null;
      if (!iso) continue;
      const d = new Date(iso);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const dayRows: VelocityDayRow[] = Array.from(byDay.entries()).map(
      ([key, count]) => ({ day: new Date(`${key}T00:00:00Z`), count })
    );

    const daily = padVelocityDays(dayRows, 14, new Date());
    const delta = computeWeekDelta(daily);

    return NextResponse.json({
      daily,
      weekTotal: delta.weekTotal,
      priorWeekTotal: delta.priorWeekTotal,
      weekDelta: delta.weekDelta,
    });
  } catch (err) {
    console.error("[/api/inbox/velocity] failed:", err);
    return NextResponse.json(
      { error: `Failed to load velocity: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
