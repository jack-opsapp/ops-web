/**
 * OPS Web - Draft Schedule Context Service
 *
 * Reads the SERVER-VERIFIED schedule facts a scheduling reply is allowed to
 * state: this lead's own bookings, plus the days the company calendar is
 * already busy. The rendering lives in the pure
 * `conversation-state/schedule-context.ts`; this file is the I/O half.
 *
 * Two entry points, one contract:
 *   - `probeScheduleFactsAvailable` — the cheap deterministic probe the router
 *     consults BEFORE deciding whether a scheduling question may be drafted.
 *   - `loadDraftScheduleContext` — the full read, at draft time.
 *
 * AVAILABILITY SEMANTICS (both entry points): a schedule that reads clean but
 * holds ZERO bookings is still `available` — "nothing is on the calendar" is a
 * verified fact a reply may rely on. Only a FAILED read is unavailable, and an
 * unavailable schedule always degrades to today's behavior: hold for a human.
 * Nothing here throws.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  CompanyBusyDay,
  ScheduleContextFacts,
  ScheduleTaskFact,
  ScheduleVisitFact,
} from "./conversation-state/schedule-context";

const LOG_PREFIX = "[draft-schedule-context]";

/** Fallback when the company has no timezone recorded. */
const DEFAULT_TIMEZONE = "America/Vancouver";

/** Customer bookings are read across this window around today. */
const CUSTOMER_WINDOW_PAST_DAYS = 1;
const CUSTOMER_WINDOW_FUTURE_DAYS = 60;
const CUSTOMER_ROW_LIMIT = 10;

/** The company-calendar busy-day roll-up covers the next two weeks. */
const BUSY_WINDOW_DAYS = 14;
const BUSY_ROW_LIMIT = 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LoadDraftScheduleContextInput {
  companyId: string;
  opportunityId: string;
  /** Test/worker seam; production callers use the ambient service client. */
  supabase?: SupabaseClient;
}

export interface DraftScheduleContextResult {
  available: boolean;
  facts: ScheduleContextFacts | null;
}

interface LinkedProjects {
  ok: boolean;
  projectIds: string[];
}

function dayOffsetIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** `YYYY-MM-DD` for a `date` column comparison, offset from today in UTC. */
function dayOffsetDate(days: number): string {
  return dayOffsetIso(days).slice(0, 10);
}

/** The calendar day an instant falls on, in the company timezone. */
function dayInTimezone(value: string, timezone: string): string | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return value.slice(0, 10) || null;
  }
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every project id this lead is linked through. The linkage is legacy-shaped in
 * both directions (`opportunities.project_id`/`project_ref` are uuid;
 * `projects.opportunity_id` is TEXT while `projects.opportunity_ref` is uuid),
 * so all four edges are followed and the result deduped.
 */
async function loadLinkedProjectIds(
  supabase: SupabaseClient,
  companyId: string,
  opportunityId: string
): Promise<LinkedProjects> {
  const projectIds = new Set<string>();

  const { data: oppRow, error: oppError } = await supabase
    .from("opportunities")
    .select("project_id, project_ref")
    .eq("id", opportunityId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (oppError) {
    console.error(`${LOG_PREFIX} opportunity load failed:`, oppError.message);
    return { ok: false, projectIds: [] };
  }
  const opp = (oppRow ?? null) as {
    project_id: string | null;
    project_ref: string | null;
  } | null;
  for (const value of [opp?.project_id, opp?.project_ref]) {
    if (typeof value === "string" && UUID_RE.test(value.trim())) {
      projectIds.add(value.trim());
    }
  }

  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .or(
      `opportunity_ref.eq.${opportunityId},opportunity_id.eq.${opportunityId}`
    );
  if (projectError) {
    console.error(`${LOG_PREFIX} project load failed:`, projectError.message);
    return { ok: false, projectIds: [] };
  }
  for (const row of (projectRows ?? []) as Array<{ id: string | null }>) {
    if (typeof row.id === "string" && row.id.trim()) projectIds.add(row.id);
  }

  return { ok: true, projectIds: [...projectIds] };
}

async function loadCompanyTimezone(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ ok: boolean; timezone: string }> {
  const { data, error } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle();
  if (error) {
    console.error(`${LOG_PREFIX} company timezone load failed:`, error.message);
    return { ok: false, timezone: DEFAULT_TIMEZONE };
  }
  const raw = (data as { timezone?: string | null } | null)?.timezone ?? "";
  const timezone = raw.trim();
  return {
    ok: true,
    timezone:
      timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE,
  };
}

/**
 * Read the verified schedule facts for one lead.
 *
 * Never throws: any failed read degrades to `{ available: false, facts: null }`
 * and the caller holds the thread for a human rather than guessing.
 */
export async function loadDraftScheduleContext(
  input: LoadDraftScheduleContextInput
): Promise<DraftScheduleContextResult> {
  const { companyId, opportunityId } = input;
  if (!UUID_RE.test(opportunityId.trim()) || !companyId.trim()) {
    return { available: false, facts: null };
  }

  try {
    const supabase = input.supabase ?? requireSupabase();

    const timezoneRead = await loadCompanyTimezone(supabase, companyId);
    if (!timezoneRead.ok) return { available: false, facts: null };
    const timezone = timezoneRead.timezone;

    const linked = await loadLinkedProjectIds(
      supabase,
      companyId,
      opportunityId
    );
    if (!linked.ok) return { available: false, facts: null };

    // ── This customer's bookings ────────────────────────────────────────
    const customerTasks: ScheduleTaskFact[] = [];
    if (linked.projectIds.length > 0) {
      const { data, error } = await supabase
        .from("project_tasks")
        .select(
          "custom_title, start_date, end_date, start_time, all_day, schedule_confirmed_at"
        )
        .eq("company_id", companyId)
        .in("project_id", linked.projectIds)
        .eq("status", "active")
        .is("deleted_at", null)
        .gte("start_date", dayOffsetDate(-CUSTOMER_WINDOW_PAST_DAYS))
        .lte("start_date", dayOffsetDate(CUSTOMER_WINDOW_FUTURE_DAYS))
        .order("start_date", { ascending: true })
        .limit(CUSTOMER_ROW_LIMIT);
      if (error) {
        console.error(`${LOG_PREFIX} customer task load failed:`, error.message);
        return { available: false, facts: null };
      }
      for (const row of (data ?? []) as Array<{
        custom_title: string | null;
        start_date: string | null;
        end_date: string | null;
        start_time: string | null;
        all_day: boolean | null;
        schedule_confirmed_at: string | null;
      }>) {
        if (!row.start_date) continue;
        customerTasks.push({
          title: row.custom_title?.trim() || "Scheduled work",
          startDate: row.start_date,
          endDate: row.end_date,
          startTime: row.start_time,
          allDay: row.all_day === true,
          confirmed: row.schedule_confirmed_at !== null,
        });
      }
    }

    // `site_visits` links to a lead either directly or through the project
    // (project_id is TEXT there). Two reads + a dedupe beats one brittle
    // `or(...)` string with an interpolated id list.
    const visitSelect =
      "id, appointment_title, scheduled_at, duration_minutes, status";
    const visitFrom = dayOffsetIso(-CUSTOMER_WINDOW_PAST_DAYS);
    const visitTo = dayOffsetIso(CUSTOMER_WINDOW_FUTURE_DAYS);
    interface VisitRow {
      id: string;
      appointment_title: string | null;
      scheduled_at: string | null;
      duration_minutes: number | null;
      status: string | null;
    }
    const visitRows = new Map<string, VisitRow>();

    const { data: directVisits, error: directVisitError } = await supabase
      .from("site_visits")
      .select(visitSelect)
      .eq("company_id", companyId)
      .eq("opportunity_id", opportunityId)
      .in("status", ["scheduled", "in_progress"])
      .is("deleted_at", null)
      .gte("scheduled_at", visitFrom)
      .lte("scheduled_at", visitTo)
      .order("scheduled_at", { ascending: true })
      .limit(CUSTOMER_ROW_LIMIT);
    if (directVisitError) {
      console.error(
        `${LOG_PREFIX} customer site-visit load failed:`,
        directVisitError.message
      );
      return { available: false, facts: null };
    }
    for (const row of (directVisits ?? []) as VisitRow[]) {
      visitRows.set(row.id, row);
    }

    if (linked.projectIds.length > 0) {
      const { data: projectVisits, error: projectVisitError } = await supabase
        .from("site_visits")
        .select(visitSelect)
        .eq("company_id", companyId)
        .in("project_id", linked.projectIds)
        .in("status", ["scheduled", "in_progress"])
        .is("deleted_at", null)
        .gte("scheduled_at", visitFrom)
        .lte("scheduled_at", visitTo)
        .order("scheduled_at", { ascending: true })
        .limit(CUSTOMER_ROW_LIMIT);
      if (projectVisitError) {
        console.error(
          `${LOG_PREFIX} project site-visit load failed:`,
          projectVisitError.message
        );
        return { available: false, facts: null };
      }
      for (const row of (projectVisits ?? []) as VisitRow[]) {
        visitRows.set(row.id, row);
      }
    }

    const customerVisits: ScheduleVisitFact[] = [...visitRows.values()]
      .filter(
        (row): row is VisitRow & { scheduled_at: string } =>
          typeof row.scheduled_at === "string" && row.scheduled_at.length > 0
      )
      .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at))
      .slice(0, CUSTOMER_ROW_LIMIT)
      .map((row) => ({
        title: row.appointment_title?.trim() || "Site visit",
        scheduledAt: row.scheduled_at,
        durationMinutes:
          typeof row.duration_minutes === "number" ? row.duration_minutes : null,
        status: row.status === "in_progress" ? "in_progress" : "scheduled",
      }));

    // ── Company calendar: which days already carry bookings ─────────────
    const busyFromDate = dayOffsetDate(0);
    const busyToDate = dayOffsetDate(BUSY_WINDOW_DAYS);
    const bookedCounts = new Map<string, number>();
    const bump = (day: string | null) => {
      if (!day || day < busyFromDate || day > busyToDate) return;
      bookedCounts.set(day, (bookedCounts.get(day) ?? 0) + 1);
    };

    const { data: busyTasks, error: busyTaskError } = await supabase
      .from("project_tasks")
      .select("start_date")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .gte("start_date", busyFromDate)
      .lte("start_date", busyToDate)
      .limit(BUSY_ROW_LIMIT);
    if (busyTaskError) {
      console.error(
        `${LOG_PREFIX} company task roll-up failed:`,
        busyTaskError.message
      );
      return { available: false, facts: null };
    }
    for (const row of (busyTasks ?? []) as Array<{
      start_date: string | null;
    }>) {
      // A `date` column carries no instant — its own value IS the calendar day.
      bump(row.start_date ? row.start_date.slice(0, 10) : null);
    }

    const { data: busyVisits, error: busyVisitError } = await supabase
      .from("site_visits")
      .select("scheduled_at")
      .eq("company_id", companyId)
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .gte("scheduled_at", dayOffsetIso(-1))
      .lte("scheduled_at", dayOffsetIso(BUSY_WINDOW_DAYS + 1))
      .limit(BUSY_ROW_LIMIT);
    if (busyVisitError) {
      console.error(
        `${LOG_PREFIX} company site-visit roll-up failed:`,
        busyVisitError.message
      );
      return { available: false, facts: null };
    }
    for (const row of (busyVisits ?? []) as Array<{
      scheduled_at: string | null;
    }>) {
      bump(row.scheduled_at ? dayInTimezone(row.scheduled_at, timezone) : null);
    }

    const companyBusyDays: CompanyBusyDay[] = [...bookedCounts.entries()]
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, bookedCount]) => ({ date, bookedCount }));

    return {
      available: true,
      facts: {
        timezone,
        generatedAt: new Date().toISOString(),
        customerTasks,
        customerVisits,
        companyBusyDays,
      },
    };
  } catch (error) {
    console.error(
      `${LOG_PREFIX} schedule context load threw:`,
      error instanceof Error ? error.message : error
    );
    return { available: false, facts: null };
  }
}

/**
 * The deterministic pre-routing probe: CAN this lead's schedule be read?
 *
 * Cheap by construction — the linkage read plus two head-only counts. Returns
 * `true` when every read succeeds (zero bookings included), and `null` when any
 * read fails or the lead has no resolvable linkage, so routing degrades to
 * today's hold instead of drafting against an unknown calendar.
 */
export async function probeScheduleFactsAvailable(
  companyId: string,
  opportunityId: string,
  client?: SupabaseClient
): Promise<boolean | null> {
  if (!UUID_RE.test(opportunityId.trim()) || !companyId.trim()) return null;
  try {
    const supabase = client ?? requireSupabase();

    const linked = await loadLinkedProjectIds(
      supabase,
      companyId,
      opportunityId
    );
    if (!linked.ok) return null;

    const { error: taskError } = await supabase
      .from("project_tasks")
      .select("id", { head: true, count: "exact" })
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .gte("start_date", dayOffsetDate(-CUSTOMER_WINDOW_PAST_DAYS))
      .lte("start_date", dayOffsetDate(CUSTOMER_WINDOW_FUTURE_DAYS));
    if (taskError) {
      console.error(`${LOG_PREFIX} task probe failed:`, taskError.message);
      return null;
    }

    const { error: visitError } = await supabase
      .from("site_visits")
      .select("id", { head: true, count: "exact" })
      .eq("company_id", companyId)
      .in("status", ["scheduled", "in_progress"])
      .is("deleted_at", null)
      .gte("scheduled_at", dayOffsetIso(-CUSTOMER_WINDOW_PAST_DAYS))
      .lte("scheduled_at", dayOffsetIso(CUSTOMER_WINDOW_FUTURE_DAYS));
    if (visitError) {
      console.error(`${LOG_PREFIX} site-visit probe failed:`, visitError.message);
      return null;
    }

    // Zero rows is a VERIFIED empty schedule, not an unavailable one.
    return true;
  } catch (error) {
    console.error(
      `${LOG_PREFIX} schedule probe threw:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
