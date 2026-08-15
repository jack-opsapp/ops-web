/**
 * GET /api/cron/google-calendar-sync — drain the site-visit calendar queue.
 *
 * Every 5 minutes, full-day (booked appointments propagate outward whenever
 * they change, not just in the overnight email window): settle every due
 * `google_calendar_sync_queue` row against the Google Calendar API using the
 * company's calendar-scoped Gmail connection.
 *
 *   create/update → upsert on the connection's `primary` calendar (patch
 *                   when an event id is known, insert otherwise; a 404 on
 *                   patch recreates — OPS is the source of truth), then
 *                   write the event id back onto the visit.
 *   delete        → remove the remote event; 404/410 already-gone counts as
 *                   done, and the visit's calendar fields are cleared.
 *
 * Rows never error for predictable states: a mail-only grant settles as
 * `skipped`/`missing_calendar_scope`, a dead credential as
 * `skipped`/`grant_revoked`, a visit that stopped being a syncable booking
 * as `skipped`/`visit_not_syncable`. Transient provider failures back off
 * exponentially (5→10→20→40 min) and settle `failed` on the fifth attempt.
 *
 * Concurrency: PostgREST cannot express FOR UPDATE SKIP LOCKED; the durable
 * cron lease (`runWithCronWorkloadControl`) serializes whole runs instead,
 * so the plain select-then-update below cannot double-send.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  CronDatabaseOperationError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";
import {
  GmailTokenRefreshError,
  getValidGmailToken,
} from "@/lib/api/services/gmail-token";
import { hasCalendarScope } from "@/lib/email/calendar-scope";
import {
  GOOGLE_CALENDAR_SYNC_MAX_ATTEMPTS,
  buildSiteVisitCalendarEvent,
  deleteCalendarEvent,
  insertCalendarEvent,
  isGrantRevokedStatus,
  patchCalendarEvent,
  retryDelayMinutes,
} from "@/lib/site-visits/google-calendar";
import { getAppUrl } from "@/lib/utils/app-url";

export const maxDuration = 60;

/** Each row costs up to two provider calls plus a possible token refresh. */
const MAX_ROWS_PER_RUN = 25;
const DEFAULT_CALENDAR_ID = "primary";
const LAST_ERROR_LIMIT = 500;

interface QueueRow {
  id: string;
  company_id: string;
  connection_id: string;
  site_visit_id: string;
  operation: "create" | "update" | "delete";
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string;
  created_at: string;
}

interface ConnectionRow {
  id: string;
  company_id: string;
  status: string;
  granted_scopes: string[] | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface VisitRow {
  id: string;
  opportunity_id: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  status: string;
  booked_at: string | null;
  deleted_at: string | null;
  google_calendar_event_id: string | null;
  google_calendar_id: string | null;
}

interface LeadRow {
  id: string;
  title: string;
  address: string | null;
}

interface Counters {
  ok: boolean;
  scanned: number;
  succeeded: number;
  skipped: number;
  retried: number;
  failed: number;
  errors: number;
}

type RowOutcome =
  | { kind: "succeeded" }
  | { kind: "skipped"; reason: string }
  | { kind: "retry"; error: string };

function truncateError(message: string): string {
  return message.slice(0, LAST_ERROR_LIMIT);
}

async function providerFailure(
  label: string,
  response: Response
): Promise<RowOutcome> {
  if (isGrantRevokedStatus(response.status)) {
    return { kind: "skipped", reason: "grant_revoked" };
  }
  const body = await response.text().catch(() => "");
  return {
    kind: "retry",
    error: truncateError(`${label} failed (${response.status}): ${body}`),
  };
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
      workloadKey: "google-calendar-sync",
      leaseSeconds: 120,
      work: async () => {
        const now = new Date();

        const queueResult = await supabase
          .from("google_calendar_sync_queue")
          .select(
            "id, company_id, connection_id, site_visit_id, operation, google_calendar_id, google_calendar_event_id, status, attempts, next_attempt_at, created_at"
          )
          .eq("status", "pending")
          .lte("next_attempt_at", now.toISOString())
          .order("created_at", { ascending: true })
          .limit(MAX_ROWS_PER_RUN);
        if (queueResult.error) {
          throw new CronDatabaseOperationError(
            `Queue query failed: ${queueResult.error.message}`,
            { cause: queueResult.error }
          );
        }

        const rows = (queueResult.data ?? []) as QueueRow[];
        const counters: Counters = {
          ok: true,
          scanned: rows.length,
          succeeded: 0,
          skipped: 0,
          retried: 0,
          failed: 0,
          errors: 0,
        };
        if (rows.length === 0) return counters;

        const connectionIds = [
          ...new Set(rows.map((row) => row.connection_id)),
        ];
        const visitIds = [...new Set(rows.map((row) => row.site_visit_id))];

        const [connectionsResult, visitsResult] = await Promise.all([
          supabase
            .from("email_connections")
            .select(
              "id, company_id, status, granted_scopes, access_token, refresh_token, expires_at"
            )
            .in("id", connectionIds),
          supabase
            .from("site_visits")
            .select(
              "id, opportunity_id, scheduled_at, duration_minutes, status, booked_at, deleted_at, google_calendar_event_id, google_calendar_id"
            )
            .in("id", visitIds),
        ]);
        if (connectionsResult.error) {
          throw new CronDatabaseOperationError(
            `Connection lookup failed: ${connectionsResult.error.message}`,
            { cause: connectionsResult.error }
          );
        }
        if (visitsResult.error) {
          throw new CronDatabaseOperationError(
            `Visit lookup failed: ${visitsResult.error.message}`,
            { cause: visitsResult.error }
          );
        }

        const connectionsById = new Map(
          ((connectionsResult.data ?? []) as ConnectionRow[]).map((row) => [
            row.id,
            row,
          ])
        );
        const visitsById = new Map(
          ((visitsResult.data ?? []) as VisitRow[]).map((row) => [
            row.id,
            row,
          ])
        );

        const leadIds = [
          ...new Set(
            [...visitsById.values()]
              .map((visit) => visit.opportunity_id)
              .filter((id): id is string => Boolean(id))
          ),
        ];
        const leadsResult = await supabase
          .from("opportunities")
          .select("id, title, address")
          .in("id", leadIds.length > 0 ? leadIds : ["-"]);
        if (leadsResult.error) {
          throw new CronDatabaseOperationError(
            `Lead lookup failed: ${leadsResult.error.message}`,
            { cause: leadsResult.error }
          );
        }
        const leadsById = new Map(
          ((leadsResult.data ?? []) as LeadRow[]).map((row) => [row.id, row])
        );

        const appUrl = getAppUrl();

        for (const row of rows) {
          let outcome: RowOutcome;
          try {
            outcome = await processRow(supabase, row, {
              connection: connectionsById.get(row.connection_id),
              visit: visitsById.get(row.site_visit_id),
              leadsById,
              appUrl,
              now,
            });
          } catch (rowError) {
            outcome = {
              kind: "retry",
              error: truncateError((rowError as Error).message),
            };
          }

          const settleResult = await settleRow(supabase, row, outcome, now);
          if (!settleResult.ok) {
            counters.errors += 1;
            console.error(
              `[cron/google-calendar-sync] settle failed for ${row.id}:`,
              settleResult.message
            );
            continue;
          }
          if (outcome.kind === "succeeded") counters.succeeded += 1;
          else if (outcome.kind === "skipped") counters.skipped += 1;
          else if (row.attempts + 1 >= GOOGLE_CALENDAR_SYNC_MAX_ATTEMPTS) {
            counters.failed += 1;
          } else {
            counters.retried += 1;
          }
        }

        console.warn(
          `[cron/google-calendar-sync] scanned=${counters.scanned} succeeded=${counters.succeeded} skipped=${counters.skipped} retried=${counters.retried} failed=${counters.failed} errors=${counters.errors}`
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
    console.error("[cron/google-calendar-sync] fatal:", err);
    return NextResponse.json(
      { error: `Cron failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

interface RowContext {
  connection: ConnectionRow | undefined;
  visit: VisitRow | undefined;
  leadsById: Map<string, LeadRow>;
  appUrl: string;
  now: Date;
}

async function processRow(
  supabase: ReturnType<typeof getServiceRoleClient>,
  row: QueueRow,
  context: RowContext
): Promise<RowOutcome> {
  const { connection, visit, leadsById, appUrl, now } = context;

  if (!connection) {
    return { kind: "skipped", reason: "connection_missing" };
  }
  if (connection.status !== "active") {
    return { kind: "skipped", reason: "connection_inactive" };
  }
  if (!hasCalendarScope(connection.granted_scopes)) {
    return { kind: "skipped", reason: "missing_calendar_scope" };
  }

  if (row.operation === "delete") {
    return processDelete(supabase, row, connection, visit, now);
  }
  return processUpsert(supabase, row, connection, visit, leadsById, appUrl, now);
}

async function acquireAccessToken(
  supabase: ReturnType<typeof getServiceRoleClient>,
  connection: ConnectionRow
): Promise<{ token: string } | { outcome: RowOutcome }> {
  try {
    const token = await getValidGmailToken(connection, {
      client: supabase,
      context: "Google Calendar sync",
    });
    return { token };
  } catch (refreshError) {
    if (
      refreshError instanceof GmailTokenRefreshError &&
      refreshError.isGrantRevoked
    ) {
      return { outcome: { kind: "skipped", reason: "grant_revoked" } };
    }
    return {
      outcome: {
        kind: "retry",
        error: truncateError((refreshError as Error).message),
      },
    };
  }
}

async function processUpsert(
  supabase: ReturnType<typeof getServiceRoleClient>,
  row: QueueRow,
  connection: ConnectionRow,
  visit: VisitRow | undefined,
  leadsById: Map<string, LeadRow>,
  appUrl: string,
  now: Date
): Promise<RowOutcome> {
  // Re-read reality at drain time: a visit that was cancelled, deleted, or
  // never a booking between enqueue and drain must not land on the calendar
  // — its own delete row (if any) carries the cleanup.
  if (
    !visit ||
    visit.booked_at === null ||
    visit.deleted_at !== null ||
    visit.status === "cancelled"
  ) {
    return { kind: "skipped", reason: "visit_not_syncable" };
  }
  const lead = visit.opportunity_id
    ? leadsById.get(visit.opportunity_id)
    : undefined;
  // A booking is always lead-attached by design; without the lead there is
  // no event identity, destination, or deep link.
  if (!lead) {
    return { kind: "skipped", reason: "visit_not_syncable" };
  }

  const acquired = await acquireAccessToken(supabase, connection);
  if ("outcome" in acquired) return acquired.outcome;

  const event = buildSiteVisitCalendarEvent(
    {
      id: visit.id,
      scheduledAt: visit.scheduled_at,
      durationMinutes: visit.duration_minutes,
    },
    { id: lead.id, title: lead.title, address: lead.address },
    appUrl
  );

  const calendarId =
    visit.google_calendar_id ?? row.google_calendar_id ?? DEFAULT_CALENDAR_ID;
  const existingEventId =
    visit.google_calendar_event_id ?? row.google_calendar_event_id;
  const requestOptions = {
    accessToken: acquired.token,
    calendarId,
  };

  let response: Response;
  if (existingEventId) {
    response = await patchCalendarEvent(
      requestOptions,
      existingEventId,
      event
    );
    if (response.status === 404 || response.status === 410) {
      // The operator deleted the event in Google; OPS is the source of
      // truth for the booking, so the event comes back.
      response = await insertCalendarEvent(requestOptions, event);
    }
  } else {
    response = await insertCalendarEvent(requestOptions, event);
  }

  if (!response.ok) {
    return providerFailure(`Calendar ${row.operation}`, response);
  }

  const eventBody = (await response.json().catch(() => ({}))) as {
    id?: unknown;
  };
  const eventId =
    typeof eventBody.id === "string" && eventBody.id
      ? eventBody.id
      : existingEventId;
  if (!eventId) {
    return {
      kind: "retry",
      error: "Calendar write returned no event id",
    };
  }

  const writeback = await supabase
    .from("site_visits")
    .update({
      google_calendar_event_id: eventId,
      google_calendar_id: calendarId,
      google_calendar_synced_at: now.toISOString(),
    })
    .eq("id", visit.id);
  if (writeback.error) {
    return {
      kind: "retry",
      error: truncateError(
        `Visit writeback failed: ${writeback.error.message}`
      ),
    };
  }

  return { kind: "succeeded" };
}

async function processDelete(
  supabase: ReturnType<typeof getServiceRoleClient>,
  row: QueueRow,
  connection: ConnectionRow,
  visit: VisitRow | undefined,
  now: Date
): Promise<RowOutcome> {
  // The queue row's copy was captured at cancel time; the visit may already
  // be cleared. Either source names the remote event.
  const eventId =
    row.google_calendar_event_id ?? visit?.google_calendar_event_id ?? null;
  if (!eventId) {
    return { kind: "succeeded" };
  }
  const calendarId =
    row.google_calendar_id ?? visit?.google_calendar_id ?? DEFAULT_CALENDAR_ID;

  const acquired = await acquireAccessToken(supabase, connection);
  if ("outcome" in acquired) return acquired.outcome;

  const response = await deleteCalendarEvent(
    { accessToken: acquired.token, calendarId },
    eventId
  );
  const alreadyGone = response.status === 404 || response.status === 410;
  if (!response.ok && !alreadyGone) {
    return providerFailure("Calendar delete", response);
  }

  if (visit) {
    const writeback = await supabase
      .from("site_visits")
      .update({
        google_calendar_event_id: null,
        google_calendar_id: null,
        google_calendar_synced_at: now.toISOString(),
      })
      .eq("id", visit.id);
    if (writeback.error) {
      return {
        kind: "retry",
        error: truncateError(
          `Visit writeback failed: ${writeback.error.message}`
        ),
      };
    }
  }

  return { kind: "succeeded" };
}

async function settleRow(
  supabase: ReturnType<typeof getServiceRoleClient>,
  row: QueueRow,
  outcome: RowOutcome,
  now: Date
): Promise<{ ok: true } | { ok: false; message: string }> {
  const base = { updated_at: now.toISOString() };
  let payload: Record<string, unknown>;

  if (outcome.kind === "succeeded") {
    payload = { ...base, status: "succeeded", last_error: null };
  } else if (outcome.kind === "skipped") {
    payload = { ...base, status: "skipped", skip_reason: outcome.reason };
  } else {
    const attempts = row.attempts + 1;
    if (attempts >= GOOGLE_CALENDAR_SYNC_MAX_ATTEMPTS) {
      payload = {
        ...base,
        status: "failed",
        attempts,
        last_error: outcome.error,
      };
    } else {
      payload = {
        ...base,
        status: "pending",
        attempts,
        last_error: outcome.error,
        next_attempt_at: new Date(
          now.getTime() + retryDelayMinutes(attempts) * 60_000
        ).toISOString(),
      };
    }
  }

  const result = await supabase
    .from("google_calendar_sync_queue")
    .update(payload)
    .eq("id", row.id);
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  return { ok: true };
}
