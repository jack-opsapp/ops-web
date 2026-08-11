/**
 * GET /api/cron/site-visit-prompts — server-owned booking prompts.
 *
 * Every 5 minutes, full-day (appointments are time-critical; this cron does
 * NOT use the overnight email window): select booked visits inside the prompt
 * window, run the pure engine per assignee, insert rail notifications, and
 * push via OneSignal external ids for freshly created rows only.
 *
 * Idempotency lives entirely in `notifications.dedupe_key` under the partial
 * unique index `notifications_site_visit_prompt_dedupe_uidx` (scoped
 * `dedupe_key LIKE 'site_visit:%'`). PostgREST cannot express that partial
 * arbiter in ON CONFLICT, and the key must suppress re-fires even after the
 * row is read — so the route inserts plainly and treats a 23505 as
 * "already prompted", which is exactly the semantics the index provides.
 *
 * Quiet hours are intentionally NOT consulted: the operator chose this
 * appointment time themselves (spec 2026-08-10 §4.5). Channel preferences
 * gate the push only — the rail row is the durable audit surface.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import {
  deterministicIdempotencyKey,
  sendOneSignalPush,
} from "@/lib/notifications/onesignal";
import {
  dueSiteVisitPrompts,
  type DueSiteVisitPrompt,
  type PromptCandidateVisit,
} from "@/lib/site-visits/prompt-engine";

export const maxDuration = 60;

const MAX_VISITS_PER_RUN = 200;
/** Covers the 15-minute START grace plus cron latency. */
const LOOKBACK_MINUTES = 20;
/** Max heads-up lead is 24 h (`reminder_lead_minutes`/preference CHECK ≤ 1440). */
const LOOKAHEAD_HOURS = 24;

const UNIQUE_VIOLATION = "23505";

interface CandidateVisitRow {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  scheduled_at: string;
  status: string;
  booked_at: string | null;
  deleted_at: string | null;
  reminder_lead_minutes: number | null;
  assignee_ids: string[] | null;
}

interface OpportunityRow {
  id: string;
  title: string;
  address: string | null;
}

interface PreferenceRow {
  user_id: string;
  company_id: string;
  push_enabled: boolean | null;
  channel_preferences: Record<string, unknown> | null;
  site_visit_reminder_lead_minutes: number | null;
}

interface PromptCopy {
  title: string;
  body: string;
  actionLabel: string;
  deepLinkType: "site_visit_heads_up" | "site_visit_start";
}

function promptCopy(
  prompt: DueSiteVisitPrompt,
  lead: OpportunityRow,
  scheduledAtMs: number,
  nowMs: number
): PromptCopy {
  const address = lead.address?.trim() ?? "";
  if (prompt.kind === "heads_up") {
    const remainingMinutes = Math.max(
      1,
      Math.round((scheduledAtMs - nowMs) / 60_000)
    );
    return {
      title: `Site visit in ${remainingMinutes} min — ${lead.title}`,
      body: address || "No address on the lead.",
      actionLabel: "OPEN LEAD",
      deepLinkType: "site_visit_heads_up",
    };
  }
  return {
    title: `Site visit — ${address || lead.title}`,
    body: "Start now?",
    actionLabel: "START VISIT",
    deepLinkType: "site_visit_start",
  };
}

function wantsSiteVisitPush(preference: PreferenceRow | undefined): boolean {
  if (preference?.push_enabled === false) return false;
  const channelPreference = preference?.channel_preferences?.[
    "site_visit_reminder"
  ] as { push?: boolean } | undefined;
  return channelPreference?.push !== false;
}

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

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: "site-visit-prompts",
      leaseSeconds: 120,
      work: async () => {
        const now = new Date();
        const nowMs = now.getTime();
        const windowStart = new Date(
          nowMs - LOOKBACK_MINUTES * 60_000
        ).toISOString();
        const windowEnd = new Date(
          nowMs + LOOKAHEAD_HOURS * 60 * 60_000
        ).toISOString();

        const visitsResult = await supabase
          .from("site_visits")
          .select(
            "id, company_id, opportunity_id, scheduled_at, status, booked_at, deleted_at, reminder_lead_minutes, assignee_ids"
          )
          .not("booked_at", "is", null)
          .is("deleted_at", null)
          .eq("status", "scheduled")
          .gte("scheduled_at", windowStart)
          .lte("scheduled_at", windowEnd)
          .order("scheduled_at", { ascending: true })
          .limit(MAX_VISITS_PER_RUN);
        if (visitsResult.error) {
          throw new CronDatabaseOperationError(
            `Candidate visit query failed: ${visitsResult.error.message}`,
            { cause: visitsResult.error }
          );
        }

        const visits = (visitsResult.data ?? []) as CandidateVisitRow[];
        const counters = {
          ok: true,
          scanned: visits.length,
          due: 0,
          inserted: 0,
          deduped: 0,
          gated: 0,
          pushed: 0,
          errors: 0,
        };
        if (visits.length === 0) return counters;

        const opportunityIds = [
          ...new Set(
            visits
              .map((visit) => visit.opportunity_id)
              .filter((id): id is string => Boolean(id))
          ),
        ];
        const assigneeIds = [
          ...new Set(visits.flatMap((visit) => visit.assignee_ids ?? [])),
        ];

        const [opportunitiesResult, preferencesResult, activeUsersResult] =
          await Promise.all([
            supabase
              .from("opportunities")
              .select("id, title, address")
              .in("id", opportunityIds),
            supabase
              .from("notification_preferences")
              .select(
                "user_id, company_id, push_enabled, channel_preferences, site_visit_reminder_lead_minutes"
              )
              .in("user_id", assigneeIds),
            supabase
              .from("users")
              .select("id, company_id")
              .in("id", assigneeIds)
              .eq("is_active", true)
              .is("deleted_at", null),
          ]);
        if (opportunitiesResult.error) {
          throw new CronDatabaseOperationError(
            `Lead lookup failed: ${opportunitiesResult.error.message}`,
            { cause: opportunitiesResult.error }
          );
        }
        if (preferencesResult.error) {
          throw new CronDatabaseOperationError(
            `Preference lookup failed: ${preferencesResult.error.message}`,
            { cause: preferencesResult.error }
          );
        }
        if (activeUsersResult.error) {
          throw new CronDatabaseOperationError(
            `Active assignee lookup failed: ${activeUsersResult.error.message}`,
            { cause: activeUsersResult.error }
          );
        }

        const leadsById = new Map(
          ((opportunitiesResult.data ?? []) as OpportunityRow[]).map((row) => [
            row.id,
            row,
          ])
        );
        const preferencesByCompanyUser = new Map(
          ((preferencesResult.data ?? []) as PreferenceRow[]).map((row) => [
            `${row.company_id}:${row.user_id}`,
            row,
          ])
        );
        const activeCompanyUsers = new Set(
          (
            (activeUsersResult.data ?? []) as Array<{
              id: string;
              company_id: string | null;
            }>
          ).map((row) => `${row.company_id}:${row.id}`)
        );

        for (const visit of visits) {
          const lead = visit.opportunity_id
            ? leadsById.get(visit.opportunity_id)
            : undefined;
          // A booking is always lead-attached by design; without the lead
          // there is no destination, no address, and no copy — skip whole.
          if (!lead) continue;

          const activeAssignees = (visit.assignee_ids ?? []).filter((userId) =>
            activeCompanyUsers.has(`${visit.company_id}:${userId}`)
          );
          const engineVisit: PromptCandidateVisit = {
            id: visit.id,
            status: visit.status,
            bookedAt: visit.booked_at,
            deletedAt: visit.deleted_at,
            scheduledAt: visit.scheduled_at,
            reminderLeadMinutes: visit.reminder_lead_minutes,
            assigneeIds: activeAssignees,
          };
          const duePrompts = dueSiteVisitPrompts(
            engineVisit,
            activeAssignees.map((userId) => ({
              userId,
              siteVisitReminderLeadMinutes:
                preferencesByCompanyUser.get(`${visit.company_id}:${userId}`)
                  ?.site_visit_reminder_lead_minutes ?? null,
            })),
            now
          );
          counters.due += duePrompts.length;
          if (duePrompts.length === 0) continue;

          const scheduledAtMs = Date.parse(visit.scheduled_at);
          for (const prompt of duePrompts) {
            const copy = promptCopy(prompt, lead, scheduledAtMs, nowMs);
            const insertResult = await supabase.from("notifications").insert({
              user_id: prompt.userId,
              company_id: visit.company_id,
              type: "site_visit_reminder",
              title: copy.title,
              body: copy.body,
              is_read: false,
              persistent: false,
              action_url: `/pipeline?opportunityId=${lead.id}`,
              action_label: copy.actionLabel,
              deep_link_type: copy.deepLinkType,
              dedupe_key: prompt.dedupeKey,
            });

            if (insertResult.error) {
              if (insertResult.error.code === UNIQUE_VIOLATION) {
                counters.deduped += 1;
              } else {
                counters.errors += 1;
                console.error(
                  `[cron/site-visit-prompts] insert failed for ${prompt.dedupeKey}:`,
                  insertResult.error.message
                );
              }
              continue;
            }
            counters.inserted += 1;

            const preference = preferencesByCompanyUser.get(
              `${visit.company_id}:${prompt.userId}`
            );
            if (!wantsSiteVisitPush(preference)) {
              counters.gated += 1;
              continue;
            }

            const pushResult = await sendOneSignalPush({
              externalUserIds: [prompt.userId],
              title: copy.title,
              body: copy.body,
              data: {
                deep_link_type: copy.deepLinkType,
                leadId: lead.id,
                siteVisitId: visit.id,
              },
              idempotencyKey: deterministicIdempotencyKey(prompt.dedupeKey),
            });
            if (pushResult.ok) {
              counters.pushed += 1;
            } else {
              // Push is best-effort: the rail row is the durable record and
              // the helper already logged the failure with category context.
              counters.errors += 1;
            }
          }
        }

        console.warn(
          `[cron/site-visit-prompts] scanned=${counters.scanned} due=${counters.due} inserted=${counters.inserted} deduped=${counters.deduped} gated=${counters.gated} pushed=${counters.pushed} errors=${counters.errors}`
        );
        return counters;
      },
    });

    if (controlled.status === "skipped") {
      const reason =
        controlled.reason === "lease_held"
          ? "already_running"
          : controlled.reason;
      return NextResponse.json(
        {
          ok: controlled.reason === "lease_held",
          ran: false,
          reason,
        },
        { status: controlled.reason === "lease_held" ? 200 : 503 }
      );
    }
    return NextResponse.json(controlled.value);
  } catch (err) {
    console.error("[cron/site-visit-prompts] fatal:", err);
    return NextResponse.json(
      { error: `Cron failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
