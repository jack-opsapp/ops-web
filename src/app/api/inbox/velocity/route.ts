/**
 * OPS Web - Inbox Velocity Endpoint
 *
 * GET /api/inbox/velocity?scope=own|company
 *
 * Returns the last 14 days of classification activity for the caller's
 * scope. Used by the empty-status-view's velocity section.
 *
 * Auth and row visibility use the same inbox/pipeline scope intersection as
 * the canonical thread list. The authorization filter is applied to the root
 * email_threads query before any aggregation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import {
  buildEmailThreadListAuthorizationFilter,
  resolveEmailInboxListAccess,
  type EmailThreadListAuthorizationFilter,
} from "@/lib/email/email-opportunity-access";
import {
  padVelocityDays,
  computeWeekDelta,
  type VelocityDayRow,
} from "@/lib/api/services/inbox-velocity-helpers";
import type { InboxScope } from "@/lib/types/email-thread";

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
}

function applyAuthorizationFilter<
  T extends {
    in(column: string, values: string[]): T;
    is(column: string, value: null): T;
    or(filter: string): T;
  },
>(query: T, filter: EmailThreadListAuthorizationFilter): T {
  let authorized = query;
  if (filter.connectionIds) {
    authorized = authorized.in("connection_id", filter.connectionIds);
  }
  if (filter.unlinkedOnly) {
    authorized = authorized.is("opportunity_id", null);
  }
  if (filter.or) authorized = authorized.or(filter.or);
  return authorized;
}

function emptyVelocity() {
  return {
    daily: new Array<number>(14).fill(0),
    weekTotal: 0,
    priorWeekTotal: 0,
    weekDelta: 0,
  };
}

export async function GET(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const { userId, companyId } = actor;

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get("scope"));
  const supabase = getServiceRoleClient();
  const listAccess = await resolveEmailInboxListAccess({ actor, supabase });
  if (!listAccess.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authorizationFilter =
    buildEmailThreadListAuthorizationFilter(listAccess);
  if (authorizationFilter.empty) {
    return NextResponse.json(emptyVelocity());
  }
  const effectiveScope: InboxScope =
    listAccess.inboxScope === "assigned" ? "company" : scope;

  // Resolve this user's connection ids for scope=own (same pattern as
  // /api/inbox/threads). scope=company looks across all connections.
  let ownConnectionIds: string[] = [];
  if (effectiveScope === "own") {
    const { data: connRows } = await supabase
      .from("email_connections")
      .select("id")
      .eq("company_id", companyId)
      .or(`type.eq.company,and(type.eq.individual,user_id.eq.${userId})`);
    ownConnectionIds = (connRows ?? []).map((r) => r.id as string);
  }

  try {
    const fourteenDaysAgoIso = new Date(
      Date.now() - 14 * 86_400_000
    ).toISOString();

    let query = supabase
      .from("email_threads")
      .select("category_classified_at, connection_id, opportunity_id")
      .eq("company_id", companyId)
      .gte("category_classified_at", fourteenDaysAgoIso)
      .not("category_classified_at", "is", null);
    query = applyAuthorizationFilter(query, authorizationFilter);

    if (effectiveScope === "own") {
      if (ownConnectionIds.length === 0) {
        return NextResponse.json(emptyVelocity());
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
