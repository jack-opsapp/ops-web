import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildEmailThreadListAuthorizationFilter,
  type AllowedEmailInboxListAccess,
} from "@/lib/email/email-opportunity-access";
import type { EmailRouteActor } from "@/lib/email/email-route-auth";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadAutonomyLevel,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";

export interface PhaseCWeekSummary {
  auto: number;
  draft: number;
  surfaced: number;
  autonomyMap: Record<EmailThreadCategory, EmailThreadAutonomyLevel>;
}

export interface GetPhaseCWeekSummaryInput {
  actor: EmailRouteActor;
  access: AllowedEmailInboxListAccess;
  supabase: SupabaseClient;
  now?: Date;
}

function emptyAutonomyMap(): Record<
  EmailThreadCategory,
  EmailThreadAutonomyLevel
> {
  const map = {} as Record<EmailThreadCategory, EmailThreadAutonomyLevel>;
  for (const category of EMAIL_THREAD_CATEGORIES) map[category] = "off";
  return map;
}

function errorMessage(error: { message?: string } | null): string {
  return error?.message || "Phase C weekly summary query failed";
}

/**
 * Aggregate Phase C activity only after applying the same inbox/pipeline
 * intersection as the Inbox itself. Assigned users receive their own durable
 * draft/send outcomes plus the union of assigned lead threads and unlinked
 * personal-mailbox threads. Elevated inbox visibility never turns this
 * personal calibration surface into another user's performance profile.
 */
export async function getPhaseCWeekSummary(
  input: GetPhaseCWeekSummaryInput
): Promise<PhaseCWeekSummary> {
  const sevenDaysAgo = new Date(
    (input.now ?? new Date()).getTime() - 7 * 86_400_000
  ).toISOString();
  const companyWide =
    input.access.inboxScope === "all" && input.access.pipelineScope === "all";

  const autoQuery = input.supabase
    .from("pending_auto_sends")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.actor.companyId)
    .eq("status", "sent")
    .eq("actor_user_id", input.actor.userId)
    .gte("sent_at", sevenDaysAgo);
  const draftQuery = input.supabase
    .from("ai_draft_history")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.actor.companyId)
    .in("status", ["drafted", "auto_drafted"])
    .eq("user_id", input.actor.userId)
    .gte("created_at", sevenDaysAgo);

  const authorizationFilter = buildEmailThreadListAuthorizationFilter(
    input.access
  );
  let surfacedQuery = input.supabase
    .from("email_threads")
    .select("connection_id, primary_category, labels")
    .eq("company_id", input.actor.companyId)
    .gte("first_message_at", sevenDaysAgo);
  if (!authorizationFilter.empty) {
    if (authorizationFilter.connectionIds) {
      surfacedQuery = surfacedQuery.in(
        "connection_id",
        authorizationFilter.connectionIds
      );
    }
    if (authorizationFilter.unlinkedOnly) {
      surfacedQuery = surfacedQuery.is("opportunity_id", null);
    }
    if (authorizationFilter.or) {
      surfacedQuery = surfacedQuery.or(authorizationFilter.or);
    }
  }

  const [autoResult, draftResult, surfacedResult] = await Promise.all([
    autoQuery,
    draftQuery,
    authorizationFilter.empty
      ? Promise.resolve({ data: [], error: null })
      : surfacedQuery,
  ]);
  if (autoResult.error) throw new Error(errorMessage(autoResult.error));
  if (draftResult.error) throw new Error(errorMessage(draftResult.error));
  if (surfacedResult.error) throw new Error(errorMessage(surfacedResult.error));

  const surfacedRows = (surfacedResult.data ?? []) as Array<{
    connection_id: string;
    primary_category: string;
    labels: string[] | null;
  }>;
  const surfaced = surfacedRows.filter(
    (row) =>
      row.primary_category === "CUSTOMER" ||
      row.primary_category === "PLATFORM_BID" ||
      (Array.isArray(row.labels) && row.labels.includes("URGENT"))
  ).length;

  const visibleConnectionIds = Array.from(
    new Set([
      ...input.access.ownPersonalConnectionIds,
      ...surfacedRows.map((row) => row.connection_id),
    ])
  );
  let connectionRows: Array<{
    id: string;
    type: string;
    user_id: string | null;
    auto_send_settings: Record<string, unknown> | null;
  }> = [];
  if (companyWide || visibleConnectionIds.length > 0) {
    let connectionQuery = input.supabase
      .from("email_connections")
      .select("id, type, user_id, auto_send_settings")
      .eq("company_id", input.actor.companyId)
      .or(
        `type.eq.company,and(type.eq.individual,user_id.eq.${input.actor.userId})`
      );
    if (!companyWide) {
      connectionQuery = connectionQuery.in("id", visibleConnectionIds);
    }
    const connectionResult = await connectionQuery;
    if (connectionResult.error) {
      throw new Error(errorMessage(connectionResult.error));
    }
    const visible = new Set(visibleConnectionIds);
    connectionRows = (
      (connectionResult.data ?? []) as typeof connectionRows
    ).filter(
      (row) =>
        (companyWide || visible.has(row.id)) &&
        (row.type === "company" ||
          (row.type === "individual" && row.user_id === input.actor.userId))
    );
  }

  const autonomyMap = emptyAutonomyMap();
  for (const row of connectionRows) {
    const settings = row.auto_send_settings ?? {};
    const stored =
      (settings.category_autonomy as Record<string, string> | undefined) ?? {};
    for (const category of EMAIL_THREAD_CATEGORIES) {
      const value = stored[`primary:${category}`] as
        | EmailThreadAutonomyLevel
        | undefined;
      if (value && value !== "off" && autonomyMap[category] === "off") {
        autonomyMap[category] = value;
      }
    }
  }

  return {
    auto: autoResult.count ?? 0,
    draft: draftResult.count ?? 0,
    surfaced,
    autonomyMap,
  };
}
