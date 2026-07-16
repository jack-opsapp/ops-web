import { NextRequest, NextResponse } from "next/server";

import {
  buildEmailThreadListAuthorizationFilter,
  resolveEmailInboxListAccess,
  type EmailThreadListAuthorizationFilter,
} from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface ThreadMetricRow {
  first_message_at: string;
  connection_id?: string | null;
  provider_thread_id?: string | null;
}

interface ActivityMetricRow {
  email_connection_id: string;
  email_thread_id: string;
  direction: string;
  created_at: string;
}

interface InboxLeadsMetrics {
  unreadCount: number;
  totalLastWeek: number;
  medianResponseSeconds: number | null;
  dailyCounts: number[];
}

function applyAuthorizationFilter<
  T extends {
    in(column: string, values: string[]): T;
    is(column: string, value: null): T;
    or(filter: string): T;
  },
>(query: T, filter: EmailThreadListAuthorizationFilter): T {
  let authorizedQuery = query;
  if (filter.connectionIds) {
    authorizedQuery = authorizedQuery.in("connection_id", filter.connectionIds);
  }
  if (filter.unlinkedOnly) {
    authorizedQuery = authorizedQuery.is("opportunity_id", null);
  }
  if (filter.or) {
    authorizedQuery = authorizedQuery.or(filter.or);
  }
  return authorizedQuery;
}

function emptyMetrics(): InboxLeadsMetrics {
  return {
    unreadCount: 0,
    totalLastWeek: 0,
    medianResponseSeconds: null,
    dailyCounts: new Array<number>(7).fill(0),
  };
}

export async function GET(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;

  const { actor } = actorResolution;
  const supabase = getServiceRoleClient();
  const access = await resolveEmailInboxListAccess({ actor, supabase });
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const authorizationFilter = buildEmailThreadListAuthorizationFilter(access);
  if (authorizationFilter.empty) {
    return NextResponse.json(emptyMetrics());
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  let unreadQuery = supabase
    .from("email_threads")
    .select("id, first_message_at, last_message_at, unread_count")
    .eq("company_id", actor.companyId)
    .eq("primary_category", "CUSTOMER")
    .is("archived_at", null)
    .gt("unread_count", 0);
  unreadQuery = applyAuthorizationFilter(unreadQuery, authorizationFilter);

  let weekQuery = supabase
    .from("email_threads")
    .select("id, first_message_at, connection_id, provider_thread_id")
    .eq("company_id", actor.companyId)
    .eq("primary_category", "CUSTOMER")
    .gte("first_message_at", sevenDaysAgo.toISOString());
  weekQuery = applyAuthorizationFilter(weekQuery, authorizationFilter);

  const [unreadResult, weekResult] = await Promise.all([
    unreadQuery,
    weekQuery.order("first_message_at", { ascending: true }),
  ]);
  if (unreadResult.error || weekResult.error) {
    console.error("[/api/inbox/widgets/leads] thread metrics failed", {
      unreadError: unreadResult.error,
      weekError: weekResult.error,
    });
    return NextResponse.json(
      { error: "Failed to load inbox metrics" },
      { status: 500 }
    );
  }

  const weekRows = (weekResult.data ?? []) as ThreadMetricRow[];
  const metrics = emptyMetrics();
  metrics.unreadCount = unreadResult.data?.length ?? 0;
  metrics.totalLastWeek = weekRows.length;

  const dayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  for (const row of weekRows) {
    const timestamp = new Date(row.first_message_at).getTime();
    const diffDays = Math.floor((dayStart - timestamp) / 86_400_000);
    if (diffDays >= 0 && diffDays < 7) {
      metrics.dailyCounts[6 - diffDays] += 1;
    }
  }

  const providerThreadIdsByConnection = new Map<string, Set<string>>();
  const authorizedTupleKeys = new Set<string>();
  for (const row of weekRows) {
    const connectionId = row.connection_id?.trim() ?? "";
    const providerThreadId = row.provider_thread_id?.trim() ?? "";
    if (!connectionId || !providerThreadId) continue;
    const threadIds = providerThreadIdsByConnection.get(connectionId) ?? new Set();
    threadIds.add(providerThreadId);
    providerThreadIdsByConnection.set(connectionId, threadIds);
    authorizedTupleKeys.add(JSON.stringify([connectionId, providerThreadId]));
  }
  if (providerThreadIdsByConnection.size === 0) {
    return NextResponse.json(metrics);
  }

  // Provider thread IDs are mailbox-local identities. Query once per exact
  // connection group so two mailboxes with the same opaque provider ID never
  // collapse into one response-time sequence.
  const activityResults = await Promise.all(
    [...providerThreadIdsByConnection].map(([connectionId, threadIds]) =>
      supabase
        .from("activities")
        .select(
          "email_connection_id, email_thread_id, direction, created_at"
        )
        .eq("company_id", actor.companyId)
        .eq("email_connection_id", connectionId)
        .eq("type", "email")
        .in("email_thread_id", [...threadIds])
        .order("created_at", { ascending: true })
    )
  );
  const activityError = activityResults.find((result) => result.error)?.error;
  if (activityError) {
    console.error(
      "[/api/inbox/widgets/leads] response metrics failed",
      activityError
    );
    return NextResponse.json(
      { error: "Failed to load inbox metrics" },
      { status: 500 }
    );
  }

  const firstInbound = new Map<string, number>();
  const firstOutbound = new Map<string, number>();
  const activityRows = activityResults.flatMap(
    (result) => (result.data ?? []) as ActivityMetricRow[]
  );
  for (const activity of activityRows) {
    const tupleKey = JSON.stringify([
      activity.email_connection_id,
      activity.email_thread_id,
    ]);
    if (!authorizedTupleKeys.has(tupleKey)) continue;
    const timestamp = new Date(activity.created_at).getTime();
    if (
      activity.direction === "inbound" &&
      !firstInbound.has(tupleKey)
    ) {
      firstInbound.set(tupleKey, timestamp);
    } else if (
      activity.direction === "outbound" &&
      !firstOutbound.has(tupleKey)
    ) {
      firstOutbound.set(tupleKey, timestamp);
    }
  }

  const responseTimes: number[] = [];
  for (const [threadId, inboundTimestamp] of firstInbound) {
    const outboundTimestamp = firstOutbound.get(threadId);
    if (outboundTimestamp && outboundTimestamp > inboundTimestamp) {
      responseTimes.push((outboundTimestamp - inboundTimestamp) / 1000);
    }
  }
  if (responseTimes.length > 0) {
    responseTimes.sort((left, right) => left - right);
    const midpoint = Math.floor(responseTimes.length / 2);
    metrics.medianResponseSeconds =
      responseTimes.length % 2 === 0
        ? (responseTimes[midpoint - 1] + responseTimes[midpoint]) / 2
        : responseTimes[midpoint];
  }

  return NextResponse.json(metrics);
}
