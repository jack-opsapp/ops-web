import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

/**
 * Staff handling of a public booking request (PUBLIC API P2-4, design §8).
 *
 * A `request`-mode submission creates the lead and a pending request only —
 * nothing reaches any calendar until a staff member accepts (I14). Accepting
 * is what books the visit; declining books nothing and sends nothing, leaving
 * the lead in the pipeline to be worked like any other.
 *
 * Contract this module binds to (P2-1 migration owns the bodies):
 *
 *   read_booking_request_for_opportunity_as_system(
 *     p_company_id uuid, p_opportunity_id uuid, p_actor_user_id uuid)
 *     → setof (request_id uuid, slot_start_at timestamptz, duration_minutes int,
 *              contact_name text, answers jsonb, requested_at timestamptz)
 *     -- at most one row: the lead's live `submitted` intent. Empty when the
 *        actor's pipeline scope does not cover the lead. Ships with this task
 *        (`…_public_booking_request_read.sql`); the other two land with P2-1.
 *
 *   confirm_booking_request_as_system(
 *     p_intent_id uuid, p_staff_user_id uuid, p_scheduled_at timestamptz)
 *     → setof (intent_id uuid, site_visit_id uuid, scheduled_at timestamptz)
 *     -- NULL p_scheduled_at keeps the requested time.
 *
 *   decline_booking_request_as_system(
 *     p_intent_id uuid, p_staff_user_id uuid, p_reason text)
 *     → setof (intent_id uuid, opportunity_id uuid)
 *
 * The intent carries no readable email — only a keyed digest and broker-owned
 * ciphertext (I1) — so no staff surface can show one, masked or otherwise.
 * The person reaches the lead through the client the confirm resolved.
 *
 * Refusals: `42501` when the operator has no authority on the lead, `P0002`
 * for a request the store no longer knows, `55000` for one that is no longer
 * pending, and `22023` for a bad argument or a slot the live policy now
 * refuses (I12).
 */

export const BOOKING_REQUEST_UNAVAILABLE = "booking_request_unavailable" as const;

/** Recorded on the intent when staff turn a request down from the lead —
 *  the same vocabulary the RPC uses when no reason is supplied. */
export const STAFF_DECLINE_REASON = "declined_by_staff" as const;

export const READ_REQUEST_RPC = "read_booking_request_for_opportunity_as_system" as const;
export const ACCEPT_REQUEST_RPC = "confirm_booking_request_as_system" as const;
export const DECLINE_REQUEST_RPC = "decline_booking_request_as_system" as const;

/** One of the website's own questions, as staff read it. */
export interface BookingRequestAnswer {
  readonly label: string;
  readonly value: string;
}

export interface PendingBookingRequest {
  readonly requestId: string;
  readonly slotStartAt: string;
  readonly durationMinutes: number;
  readonly contactName: string;
  readonly requestedAt: string;
  readonly answers: readonly BookingRequestAnswer[];
}

export interface BookingRequestActor {
  readonly userId: string;
  readonly companyId: string;
  readonly opportunityId: string;
  readonly supabase: SupabaseClient;
}

export type BookingRequestAuthorization =
  | { readonly ok: true; readonly actor: BookingRequestActor }
  | { readonly ok: false; readonly response: NextResponse };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function deny(status: 401 | 403 | 404 | 500, error: string): BookingRequestAuthorization {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

export function bookingRequestUnavailable(): NextResponse {
  return NextResponse.json({ error: BOOKING_REQUEST_UNAVAILABLE }, { status: 503 });
}

/**
 * Resolve and authorize the staff caller for one lead. A lead id that is not a
 * uuid cannot name a row, so it is reported exactly like a lead from another
 * company: not found.
 */
export async function authorizeBookingRequest(
  request: NextRequest,
  opportunityId: string
): Promise<BookingRequestAuthorization> {
  const auth = await verifyAdminAuth(request);
  if (!auth) return deny(401, "Unauthorized");

  // The lookup only returns the columns it is asked for; `is_active` must be
  // requested explicitly or the gate below can never pass.
  const user = await findUserByAuth(auth.uid, auth.email, "id, company_id, is_active");
  const userId = typeof user?.id === "string" ? user.id : "";
  const companyId = typeof user?.company_id === "string" ? user.company_id : "";
  if (!userId || !companyId || user?.is_active !== true) return deny(403, "Forbidden");

  // Holding the permission at all is the route's gate; whether this operator's
  // scope reaches this particular lead is the RPC's call, mirroring
  // `private.user_can_edit_opportunity`.
  const allowed = await checkPermissionById(userId, "pipeline.edit");
  if (!allowed) return deny(403, "Forbidden");

  if (!isUuid(opportunityId)) return deny(404, "Not found");

  const supabase = getServiceRoleClient();
  const { data: leadRow, error: leadError } = await supabase
    .from("opportunities")
    .select("id")
    .eq("id", opportunityId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (leadError) return deny(500, "Lead lookup failed");
  if (!leadRow) return deny(404, "Not found");

  return { ok: true, actor: { userId, companyId, opportunityId, supabase } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ANSWER_LABEL_KEYS = ["question", "label", "key", "name", "prompt"];
const ANSWER_VALUE_KEYS = ["answer", "value", "response", "text"];
const MAX_ANSWERS = 100;

/** A stored scalar as the words staff read. `null` means "nothing said". */
function answerText(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim().length > 0 ? raw : null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return null;
}

function firstPresent(entry: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (key in entry) {
      const text = answerText(entry[key]);
      if (text !== null) return text;
    }
  }
  return null;
}

/**
 * One stored entry as the rows staff read. The store guarantees only "a flat
 * object of scalars" (`private.booking_answers_valid`), so three shapes are
 * honoured: an explicit question/answer pair, a single `{question: answer}`
 * property, and anything else flattened field by field. A value that is not a
 * scalar, or an entry with nothing said, contributes no row.
 */
function answersFromEntry(entry: unknown): BookingRequestAnswer[] {
  if (!isRecord(entry)) return [];

  const label = firstPresent(entry, ANSWER_LABEL_KEYS);
  const value = firstPresent(entry, ANSWER_VALUE_KEYS);
  if (label !== null && value !== null) return [{ label, value }];
  // A label with nothing said is a question the customer skipped.
  if (label !== null && ANSWER_VALUE_KEYS.some((key) => key in entry)) return [];

  const rows: BookingRequestAnswer[] = [];
  for (const [key, raw] of Object.entries(entry)) {
    const text = answerText(raw);
    if (text !== null) rows.push({ label: key, value: text });
  }
  return rows;
}

/**
 * The website's own questions as label/value rows, in the order they were
 * asked. Stored as an array of flat objects; an object payload is read as one
 * such entry so a shape drift never blanks the staff surface.
 */
function parseAnswers(value: unknown): BookingRequestAnswer[] {
  const entries = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  const answers: BookingRequestAnswer[] = [];
  for (const entry of entries) {
    for (const row of answersFromEntry(entry)) {
      if (answers.length >= MAX_ANSWERS) return answers;
      answers.push(row);
    }
  }
  return answers;
}

class BookingRequestStoreError extends Error {
  readonly code: string | null;

  constructor(code: string | null) {
    super(`booking request rpc failed${code ? ` (${code})` : ""}`);
    this.name = "BookingRequestStoreError";
    this.code = code;
  }
}

function storeError(error: unknown): BookingRequestStoreError {
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : null;
  return new BookingRequestStoreError(code);
}

/** The lead's live request, or null. Throws on a store failure. */
export async function readPendingBookingRequest(
  actor: BookingRequestActor
): Promise<PendingBookingRequest | null> {
  const { data, error } = await actor.supabase.rpc(READ_REQUEST_RPC, {
    p_company_id: actor.companyId,
    p_opportunity_id: actor.opportunityId,
    p_actor_user_id: actor.userId,
  });
  if (error) throw storeError(error);
  if (!Array.isArray(data) || data.length === 0) return null;

  const row = data[0];
  if (!isRecord(row) || !isUuid(row.request_id)) throw storeError(null);
  if (typeof row.slot_start_at !== "string") throw storeError(null);

  return {
    requestId: row.request_id,
    slotStartAt: row.slot_start_at,
    durationMinutes:
      typeof row.duration_minutes === "number" ? row.duration_minutes : 60,
    contactName: typeof row.contact_name === "string" ? row.contact_name : "",
    requestedAt: typeof row.requested_at === "string" ? row.requested_at : row.slot_start_at,
    answers: parseAnswers(row.answers),
  };
}

/** Books the visit for real. Throws on refusal or store failure. */
export async function acceptBookingRequest(
  actor: BookingRequestActor,
  input: { requestId: string; scheduledAt: string | null }
): Promise<{ scheduledAt: string }> {
  const { data, error } = await actor.supabase.rpc(ACCEPT_REQUEST_RPC, {
    p_intent_id: input.requestId,
    p_staff_user_id: actor.userId,
    p_scheduled_at: input.scheduledAt,
  });
  if (error) throw storeError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row) || typeof row.scheduled_at !== "string") throw storeError(null);
  return { scheduledAt: row.scheduled_at };
}

/** Turns the request down. Books nothing. Throws on refusal or store failure. */
export async function declineBookingRequest(
  actor: BookingRequestActor,
  input: { requestId: string }
): Promise<void> {
  const { error } = await actor.supabase.rpc(DECLINE_REQUEST_RPC, {
    p_intent_id: input.requestId,
    p_staff_user_id: actor.userId,
    p_reason: STAFF_DECLINE_REASON,
  });
  if (error) throw storeError(error);
}

/**
 * Maps a failed accept / decline to a response. `42501` is the RPC's own
 * authority refusal — answered with the same generic 403 as the route's gate.
 * `P0002` is a request the store no longer knows. `55000` is one that is no
 * longer pending — someone else already decided it while this screen was
 * open — and `22023` covers a bad argument or a slot the live policy now
 * refuses (I12); both are conflicts the operator resolves by re-reading.
 * Anything else is a store failure and fails closed.
 */
export function bookingRequestFailure(error: unknown): NextResponse {
  const code = error instanceof BookingRequestStoreError ? error.code : null;
  switch (code) {
    case "42501":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "P0002":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "55000":
    case "22023":
      return NextResponse.json({ error: "Conflict" }, { status: 409 });
    default:
      return bookingRequestUnavailable();
  }
}

export type DecisionBody =
  | { readonly ok: true; readonly requestId: string; readonly scheduledAt: string | null }
  | { readonly ok: false; readonly response: NextResponse };

function badRequest(error: string): DecisionBody {
  return { ok: false, response: NextResponse.json({ error }, { status: 400 }) };
}

/** `{ requestId, scheduledAt? }` — the id is required, the moved time optional. */
export function parseDecisionBody(body: unknown, allowMove: boolean): DecisionBody {
  if (!isRecord(body) || !isUuid(body.requestId)) return badRequest("request_invalid");
  if (!allowMove) return { ok: true, requestId: body.requestId, scheduledAt: null };

  const moved = body.scheduledAt;
  if (moved === null || moved === undefined) {
    return { ok: true, requestId: body.requestId, scheduledAt: null };
  }
  if (typeof moved !== "string" || Number.isNaN(Date.parse(moved))) {
    return badRequest("scheduled_at_invalid");
  }
  return { ok: true, requestId: body.requestId, scheduledAt: moved };
}

/**
 * True when the id names the request this lead is actually waiting on.
 * Binding the id to the lead in the same URL keeps one route from deciding
 * another lead's request.
 */
export async function leadIsWaitingOn(
  actor: BookingRequestActor,
  requestId: string
): Promise<boolean> {
  const pending = await readPendingBookingRequest(actor);
  return pending !== null && pending.requestId === requestId;
}
