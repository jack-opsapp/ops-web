/**
 * Conversion outbox → Google Data Manager.
 *
 * SERVER ONLY. Database triggers enqueue one row per (company, kind) into
 * `ads_conversion_events`; this module drains the queue:
 *
 *   select ready rows → resolve each company's click ids + hashed owner email
 *   → one ingest request per kind (≤ 2,000 events) → persist per event.
 *
 * States: queued → sent (with Google's requestId) | skipped (no identifier at
 * all, no conversion action recorded yet, or an identifier Google rejects) |
 * failed (after MAX_ATTEMPTS, with the last error). Failures back off
 * 15 min · 2^attempts. When Google rejects a request with per-event field
 * violations (a stale or fabricated gclid answers "Resource not found"), the
 * violating events are re-sent once with the click id dropped — hashed email
 * only — and skipped as invalid_identifier when they have no email; the other
 * events in that request are re-sent untouched, so one bad click id never
 * poisons a batch. A `failed`
 * transition raises one persistent ADS CONVERSIONS FAILING notification; the
 * next fully clean run resolves it. Nothing here is ever deleted — requeue by
 * flipping `state` back to `queued` (see docs/ads/runbook.md).
 *
 * The pure parts (`buildIngestRequests`, `processOutbox` with an injected
 * repository) are unit-tested without a database; the Supabase repository is
 * tested against a chain-recording fake.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServingCustomerIds } from "@/lib/analytics/google-ads-client";
import { getOptionalPmfOperatorIdentity } from "@/lib/pmf/recipients";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { ConversionEventKind } from "./conversion-actions";
import {
  DataManagerApiError,
  ingestEvents,
  type DataManagerEvent,
  type IngestEventsRequest,
  type IngestEventsResponse,
} from "./data-manager-client";
import { hashEmail } from "./identifier-hashing";

export const MAX_EVENTS_PER_REQUEST = 2000;
export const MAX_ATTEMPTS = 5;
/** Rows younger than this are left alone so a company's owner row can land first. */
export const READY_GRACE_MINUTES = 10;
export const RETRY_BASE_MINUTES = 15;
export const EVENT_TIME_ZONE = "America/Vancouver";
export const FAILURE_ALERT_TYPE = "ads_conversion_alert";
export const FAILURE_ALERT_DEDUPE_KEY = "ads-conversions:failed";

export type OutboxState = "queued" | "sent" | "failed" | "skipped";

export interface OutboxEvent {
  id: string;
  company_id: string;
  kind: ConversionEventKind;
  occurred_at: string;
  value: number | null;
  currency: string;
  transaction_id: string;
  state: OutboxState;
  attempts: number;
  created_at: string;
}

export interface CompanyIdentifiers {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  emailSha256?: string | null;
}

export interface ConversionActionRow {
  kind: ConversionEventKind;
  google_id: string;
  resource_name: string;
  name: string;
}

export interface IngestAccounts {
  operatingAccountId: string;
  loginAccountId?: string;
}

export type SkipReason = "no_identifier" | "no_conversion_action" | "invalid_identifier";

export interface OutboxRepository {
  selectReady(now: Date, limit: number): Promise<OutboxEvent[]>;
  resolveIdentifiers(companyIds: string[]): Promise<Map<string, CompanyIdentifiers>>;
  loadActions(): Promise<Partial<Record<ConversionEventKind, ConversionActionRow>>>;
  markSent(ids: string[], requestId: string | null, sentAt: Date): Promise<void>;
  markFailure(
    id: string,
    next: { attempts: number; nextAttemptAt: Date; lastError: string; failed: boolean }
  ): Promise<void>;
  markSkipped(id: string, reason: SkipReason): Promise<void>;
  countFailed(): Promise<number>;
  raiseFailureAlert(failedCount: number): Promise<void>;
  resolveFailureAlert(): Promise<void>;
}

export interface ProcessOutboxDeps {
  repo: OutboxRepository;
  ingest: (
    request: IngestEventsRequest,
    options: { validateOnly: boolean }
  ) => Promise<IngestEventsResponse>;
  accounts: () => Promise<IngestAccounts>;
}

export interface ProcessOutboxResult {
  validateOnly: boolean;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  requestIds: string[];
  warnings: unknown[];
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * RFC 3339 with an explicit offset, in the account's reporting time zone, so
 * Google files the conversion on the same calendar day the account reports.
 */
export function formatEventTimestamp(iso: string, timeZone: string = EVENT_TIME_ZONE): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const zone = get("timeZoneName");
  const offset = zone === "GMT" || zone === "UTC" ? "+00:00" : zone.replace(/^(GMT|UTC)/, "");
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

/** now + 15 min · 2^attempts, where `attempts` is the count before this failure. */
export function nextAttemptAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + RETRY_BASE_MINUTES * 60_000 * Math.pow(2, attempts));
}

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toDataManagerEvent(event: OutboxEvent, ids: CompanyIdentifiers): DataManagerEvent | null {
  const adIdentifiers: NonNullable<DataManagerEvent["adIdentifiers"]> = {};
  if (present(ids.gclid)) adIdentifiers.gclid = ids.gclid;
  if (present(ids.gbraid)) adIdentifiers.gbraid = ids.gbraid;
  if (present(ids.wbraid)) adIdentifiers.wbraid = ids.wbraid;
  const hasClickId = Object.keys(adIdentifiers).length > 0;
  const hasEmail = present(ids.emailSha256);
  if (!hasClickId && !hasEmail) return null;

  const out: DataManagerEvent = {
    transactionId: event.transaction_id,
    eventTimestamp: formatEventTimestamp(event.occurred_at),
    eventSource: "WEB",
  };
  if (hasClickId) out.adIdentifiers = adIdentifiers;
  if (hasEmail) out.userData = { userIdentifiers: [{ emailAddress: ids.emailSha256 as string }] };
  out.consent = { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" };
  if (event.kind === "paid" && typeof event.value === "number" && Number.isFinite(event.value)) {
    out.conversionValue = event.value;
    out.currency = event.currency;
  }
  return out;
}

export interface BuiltIngestRequest {
  kind: ConversionEventKind;
  eventIds: string[];
  request: IngestEventsRequest;
}

/**
 * One request per kind (each kind is its own conversion action, hence its own
 * destination), chunked to Google's 2,000-event ceiling, in input order.
 */
export function buildIngestRequests(
  events: OutboxEvent[],
  identifiers: Map<string, CompanyIdentifiers>,
  actions: Partial<Record<ConversionEventKind, ConversionActionRow>>,
  accounts: IngestAccounts
): { requests: BuiltIngestRequest[]; skipped: Array<{ id: string; reason: SkipReason }> } {
  const skipped: Array<{ id: string; reason: SkipReason }> = [];
  const byKind = new Map<ConversionEventKind, Array<{ id: string; event: DataManagerEvent }>>();

  for (const event of events) {
    const action = actions[event.kind];
    if (!action) {
      skipped.push({ id: event.id, reason: "no_conversion_action" });
      continue;
    }
    const built = toDataManagerEvent(event, identifiers.get(event.company_id) ?? {});
    if (!built) {
      skipped.push({ id: event.id, reason: "no_identifier" });
      continue;
    }
    const bucket = byKind.get(event.kind) ?? [];
    bucket.push({ id: event.id, event: built });
    byKind.set(event.kind, bucket);
  }

  const requests: BuiltIngestRequest[] = [];
  for (const [kind, entries] of byKind) {
    const action = actions[kind] as ConversionActionRow;
    for (let start = 0; start < entries.length; start += MAX_EVENTS_PER_REQUEST) {
      const chunk = entries.slice(start, start + MAX_EVENTS_PER_REQUEST);
      requests.push({
        kind,
        eventIds: chunk.map((e) => e.id),
        request: {
          destinations: [
            {
              operatingAccount: { accountType: "GOOGLE_ADS", accountId: accounts.operatingAccountId },
              ...(accounts.loginAccountId
                ? { loginAccount: { accountType: "GOOGLE_ADS" as const, accountId: accounts.loginAccountId } }
                : {}),
              productDestinationId: action.google_id,
            },
          ],
          events: chunk.map((e) => e.event),
          encoding: "HEX",
        },
      });
    }
  }

  return { requests, skipped };
}

// ─── State machine ───────────────────────────────────────────────────────────

export async function processOutbox(
  opts: { validateOnly: boolean; now?: Date; limit?: number },
  deps: ProcessOutboxDeps
): Promise<ProcessOutboxResult> {
  const now = opts.now ?? new Date();
  const validateOnly = opts.validateOnly;
  const result: ProcessOutboxResult = {
    validateOnly,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    requestIds: [],
    warnings: [],
  };

  const events = await deps.repo.selectReady(now, opts.limit ?? MAX_EVENTS_PER_REQUEST);
  if (events.length === 0) return result;

  const companyIds = [...new Set(events.map((e) => e.company_id))];
  const [identifiers, actions, accounts] = await Promise.all([
    deps.repo.resolveIdentifiers(companyIds),
    deps.repo.loadActions(),
    deps.accounts(),
  ]);

  const { requests, skipped } = buildIngestRequests(events, identifiers, actions, accounts);
  const byId = new Map(events.map((e) => [e.id, e]));

  for (const skip of skipped) {
    result.skipped += 1;
    if (!validateOnly) await deps.repo.markSkipped(skip.id, skip.reason);
  }

  let failedThisRun = 0;

  const recordSent = async (eventIds: string[], response: IngestEventsResponse) => {
    if (response.requestId) result.requestIds.push(response.requestId);
    if (response.fieldWarnings.length > 0) result.warnings.push(...response.fieldWarnings);
    result.sent += eventIds.length;
    if (!validateOnly) await deps.repo.markSent(eventIds, response.requestId ?? null, now);
  };

  const recordFailure = async (eventIds: string[], message: string) => {
    for (const id of eventIds) {
      const event = byId.get(id);
      if (!event) continue;
      const attempts = event.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      if (failed) {
        result.failed += 1;
        failedThisRun += 1;
      } else {
        result.retried += 1;
      }
      if (!validateOnly) {
        await deps.repo.markFailure(id, {
          attempts,
          nextAttemptAt: nextAttemptAt(event.attempts, now),
          lastError: message,
          failed,
        });
      }
    }
  };

  const recordSkipped = async (eventId: string, reason: SkipReason) => {
    result.skipped += 1;
    if (!validateOnly) await deps.repo.markSkipped(eventId, reason);
  };

  const send = async (built: BuiltIngestRequest): Promise<void> => {
    try {
      const response = await deps.ingest(built.request, { validateOnly });
      await recordSent(built.eventIds, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[ads-conversions] ingest failed for ${built.kind} (${built.eventIds.length} events): ${message}`
      );
      await recordFailure(built.eventIds, message);
    }
  };

  for (const built of requests) {
    try {
      const response = await deps.ingest(built.request, { validateOnly });
      await recordSent(built.eventIds, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const violated = error instanceof DataManagerApiError && error.status === 400
        ? [...new Set(error.fieldViolations.map((v) => v.eventIndex).filter((i): i is number => i !== null))]
        : [];
      if (violated.length === 0) {
        console.error(
          `[ads-conversions] ingest failed for ${built.kind} (${built.eventIds.length} events): ${message}`
        );
        await recordFailure(built.eventIds, message);
        continue;
      }

      // Google named the events it rejects. Re-send the rest untouched, and
      // the rejected ones without their click ids (hashed email only) — a
      // fabricated or expired gclid cannot be fixed, but the email can still
      // match a signed-in click. No email left → skipped, not retried forever.
      console.warn(
        `[ads-conversions] ${built.kind}: Google rejected ${violated.length} of ${built.eventIds.length} events (${
          error instanceof DataManagerApiError ? error.requestId ?? "no request id" : "no request id"
        }); re-sending the rest`
      );
      const rejected = new Set(violated);
      const keptIds: string[] = [];
      const keptEvents: DataManagerEvent[] = [];
      const emailOnlyIds: string[] = [];
      const emailOnlyEvents: DataManagerEvent[] = [];
      built.request.events.forEach((event, index) => {
        const id = built.eventIds[index];
        if (!rejected.has(index)) {
          keptIds.push(id);
          keptEvents.push(event);
          return;
        }
        if (event.adIdentifiers && event.userData) {
          const { adIdentifiers: _dropped, ...withoutClick } = event;
          void _dropped;
          emailOnlyIds.push(id);
          emailOnlyEvents.push(withoutClick);
        }
      });
      for (const index of rejected) {
        const id = built.eventIds[index];
        if (id && !emailOnlyIds.includes(id)) await recordSkipped(id, "invalid_identifier");
      }
      if (keptIds.length > 0) {
        await send({ kind: built.kind, eventIds: keptIds, request: { ...built.request, events: keptEvents } });
      }
      if (emailOnlyIds.length > 0) {
        try {
          const response = await deps.ingest({ ...built.request, events: emailOnlyEvents }, { validateOnly });
          await recordSent(emailOnlyIds, response);
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          console.error(`[ads-conversions] ${built.kind}: email-only re-send failed: ${retryMessage}`);
          for (const id of emailOnlyIds) await recordSkipped(id, "invalid_identifier");
        }
      }
    }
  }

  if (!validateOnly) {
    if (failedThisRun > 0) {
      await deps.repo.raiseFailureAlert(failedThisRun);
    } else if (result.sent > 0 || result.retried > 0 || result.skipped > 0) {
      const remaining = await deps.repo.countFailed();
      if (remaining === 0) await deps.repo.resolveFailureAlert();
    }
  }

  return result;
}

// ─── Supabase repository ─────────────────────────────────────────────────────

const READY_SELECT =
  "id, company_id, kind, occurred_at, value, currency, transaction_id, state, attempts, created_at";

interface UserRow {
  company_id: string | null;
  email: string | null;
  is_company_admin: boolean | null;
  created_at: string | null;
}

interface AttributionRow {
  company_id: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
}

function fail(operation: string, error: { message: string } | null): void {
  if (error) throw new Error(`ads conversion outbox ${operation} failed: ${error.message}`);
}

export function createSupabaseOutboxRepository(db: SupabaseClient): OutboxRepository {
  return {
    async selectReady(now, limit) {
      const readyBefore = new Date(now.getTime() - READY_GRACE_MINUTES * 60_000).toISOString();
      const { data, error } = await db
        .from("ads_conversion_events")
        .select(READY_SELECT)
        .eq("state", "queued")
        .lte("next_attempt_at", now.toISOString())
        .lte("created_at", readyBefore)
        .order("created_at", { ascending: true })
        .limit(limit);
      fail("select", error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        company_id: String(row.company_id),
        kind: row.kind as ConversionEventKind,
        occurred_at: String(row.occurred_at),
        value: row.value == null ? null : Number(row.value),
        currency: String(row.currency ?? "CAD"),
        transaction_id: String(row.transaction_id),
        state: (row.state as OutboxState) ?? "queued",
        attempts: Number(row.attempts ?? 0),
        created_at: String(row.created_at),
      }));
    },

    async resolveIdentifiers(companyIds) {
      const out = new Map<string, CompanyIdentifiers>();
      for (const id of companyIds) out.set(id, {});
      if (companyIds.length === 0) return out;

      const [{ data: users, error: usersError }, { data: attributions, error: attributionsError }] =
        await Promise.all([
          db
            .from("users")
            .select("company_id, email, is_company_admin, created_at")
            .in("company_id", companyIds)
            .is("deleted_at", null),
          db
            .from("trial_attributions")
            .select("company_id, gclid, gbraid, wbraid")
            .in("company_id", companyIds),
        ]);
      fail("users read", usersError);
      fail("trial_attributions read", attributionsError);

      for (const row of (attributions ?? []) as AttributionRow[]) {
        const entry = out.get(row.company_id) ?? {};
        entry.gclid = row.gclid ?? null;
        entry.gbraid = row.gbraid ?? null;
        entry.wbraid = row.wbraid ?? null;
        out.set(row.company_id, entry);
      }

      // Owner email: company admins first, then the oldest account, first
      // one that normalises to a real address wins.
      const byCompany = new Map<string, UserRow[]>();
      for (const row of (users ?? []) as UserRow[]) {
        if (!row.company_id) continue;
        const list = byCompany.get(row.company_id) ?? [];
        list.push(row);
        byCompany.set(row.company_id, list);
      }
      for (const [companyId, rows] of byCompany) {
        rows.sort((a, b) => {
          const admin = Number(b.is_company_admin === true) - Number(a.is_company_admin === true);
          if (admin !== 0) return admin;
          return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
        });
        for (const row of rows) {
          const hashed = hashEmail(row.email);
          if (!hashed) continue;
          const entry = out.get(companyId) ?? {};
          entry.emailSha256 = hashed;
          out.set(companyId, entry);
          break;
        }
      }
      return out;
    },

    async loadActions() {
      const { data, error } = await db
        .from("ads_conversion_actions")
        .select("kind, google_id, resource_name, name");
      fail("conversion actions read", error);
      const out: Partial<Record<ConversionEventKind, ConversionActionRow>> = {};
      for (const row of (data ?? []) as ConversionActionRow[]) {
        out[row.kind] = {
          kind: row.kind,
          google_id: String(row.google_id),
          resource_name: String(row.resource_name),
          name: String(row.name),
        };
      }
      return out;
    },

    async markSent(ids, requestId, sentAt) {
      if (ids.length === 0) return;
      const { error } = await db
        .from("ads_conversion_events")
        .update({
          state: "sent",
          sent_at: sentAt.toISOString(),
          google_request_id: requestId,
          last_error: null,
        })
        .in("id", ids);
      fail("mark sent", error);
    },

    async markFailure(id, next) {
      const { error } = await db
        .from("ads_conversion_events")
        .update({
          state: next.failed ? "failed" : "queued",
          attempts: next.attempts,
          next_attempt_at: next.nextAttemptAt.toISOString(),
          last_error: next.lastError.slice(0, 2000),
        })
        .eq("id", id);
      fail("mark failure", error);
    },

    async markSkipped(id, reason) {
      const { error } = await db
        .from("ads_conversion_events")
        .update({ state: "skipped", last_error: reason })
        .eq("id", id);
      fail("mark skipped", error);
    },

    async countFailed() {
      const { count, error } = await db
        .from("ads_conversion_events")
        .select("id", { count: "exact", head: true })
        .eq("state", "failed");
      fail("count failed", error);
      return count ?? 0;
    },

    async raiseFailureAlert(failedCount) {
      const identity = getOptionalPmfOperatorIdentity();
      if (!identity) {
        console.warn("[ads-conversions] operator identity unset; skipping failure alert");
        return;
      }
      const { data: open, error: readError } = await db
        .from("notifications")
        .select("id")
        .eq("user_id", identity.operatorUserId)
        .eq("company_id", identity.operatorCompanyId)
        .eq("type", FAILURE_ALERT_TYPE)
        .eq("dedupe_key", FAILURE_ALERT_DEDUPE_KEY)
        .eq("is_read", false)
        .is("resolved_at", null)
        .limit(1);
      if (readError) {
        console.error("[ads-conversions] alert read failed:", readError.message);
        return;
      }
      if (Array.isArray(open) && open.length > 0) return;

      const noun = failedCount === 1 ? "event" : "events";
      const { error } = await db.from("notifications").insert({
        user_id: identity.operatorUserId,
        company_id: identity.operatorCompanyId,
        type: FAILURE_ALERT_TYPE,
        title: "ADS CONVERSIONS FAILING",
        body: `${failedCount} conversion ${noun} could not reach Google after ${MAX_ATTEMPTS} attempts. Fix the cause, then requeue from the runbook.`,
        is_read: false,
        persistent: true,
        action_url: "/admin/google-ads",
        action_label: "VIEW ADS",
        dedupe_key: FAILURE_ALERT_DEDUPE_KEY,
      });
      // 23505 = another run raised it first; the open-alert index dedupes for us.
      if (error && !String((error as { code?: string }).code ?? "").startsWith("23505")) {
        console.error("[ads-conversions] alert insert failed:", error.message);
      }
    },

    async resolveFailureAlert() {
      const { error } = await db
        .from("notifications")
        .update({
          resolved_at: new Date().toISOString(),
          resolution_reason: "outbox_drained",
        })
        .eq("type", FAILURE_ALERT_TYPE)
        .eq("dedupe_key", FAILURE_ALERT_DEDUPE_KEY)
        .is("resolved_at", null);
      if (error) console.error("[ads-conversions] alert resolve failed:", error.message);
    },
  };
}

// ─── Production entry point ──────────────────────────────────────────────────

async function resolveAccounts(): Promise<IngestAccounts> {
  const { servingId, loginId } = await getServingCustomerIds();
  return { operatingAccountId: servingId, loginAccountId: loginId };
}

/** Drain the outbox with the production repository, transport, and accounts. */
export async function runConversionOutbox(opts: {
  validateOnly: boolean;
  limit?: number;
}): Promise<ProcessOutboxResult> {
  return processOutbox(
    { validateOnly: opts.validateOnly, limit: opts.limit },
    {
      repo: createSupabaseOutboxRepository(getAdminSupabase()),
      ingest: (request, options) => ingestEvents(request, options),
      accounts: resolveAccounts,
    }
  );
}
