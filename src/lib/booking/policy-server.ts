import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

import {
  BOOKING_POLICY_DEFAULTS,
  bookingPolicyFromRow,
  bookingPolicyToRow,
  isBookingMode,
  validateBookingPolicy,
  type BookingPolicy,
  type BookingWindow,
} from "./policy";

/**
 * Server spine for the staff booking-policy routes (PUBLIC API P2-4).
 *
 * Firebase staff auth → active `users` row → `settings.company` (a granular
 * permission, never a role name). The company is taken from the session and
 * never from the request, so the routes carry no tenant input to validate.
 *
 * `public.site_visit_booking_policies` lives in the public schema precisely so
 * staff read and write it through the normal settings surface (design §4.1);
 * these routes reach it with the service-role client behind their own gate,
 * exactly as the rest of the `/api/settings/*` family does.
 */

export const BOOKING_SETTINGS_UNAVAILABLE = "booking_settings_unavailable" as const;

export const POLICY_TABLE = "site_visit_booking_policies" as const;

export interface BookingSettingsActor {
  readonly userId: string;
  readonly companyId: string;
  readonly supabase: SupabaseClient;
}

export type BookingSettingsAuthorization =
  | { readonly ok: true; readonly actor: BookingSettingsActor }
  | { readonly ok: false; readonly response: NextResponse };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function bookingSettingsUnavailable(): NextResponse {
  return NextResponse.json({ error: BOOKING_SETTINGS_UNAVAILABLE }, { status: 503 });
}

export async function authorizeBookingSettings(
  request: NextRequest
): Promise<BookingSettingsAuthorization> {
  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // The lookup only returns the columns it is asked for; `is_active` must be
  // requested explicitly or the gate below can never pass.
  const user = await findUserByAuth(auth.uid, auth.email, "id, company_id, is_active");
  const userId = typeof user?.id === "string" ? user.id : "";
  const companyId = typeof user?.company_id === "string" ? user.company_id : "";
  if (!userId || !companyId || user?.is_active !== true) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const allowed = await checkPermissionById(userId, "settings.company");
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true, actor: { userId, companyId, supabase: getServiceRoleClient() } };
}

export interface CompanyBookingContext {
  readonly timezone: string;
  /**
   * The company's public hosted address (`/c/<handle>`). Without it there is
   * no website wired to OPS, so there is nothing for a booking policy to
   * govern and the whole section stays hidden (design §8).
   */
  readonly publicIntegration: boolean;
}

/** Throws on a store failure so the caller can answer 503 uniformly. */
export async function readCompanyBookingContext(
  actor: BookingSettingsActor
): Promise<CompanyBookingContext> {
  const { data, error } = await actor.supabase
    .from("companies")
    .select("timezone, public_handle")
    .eq("id", actor.companyId)
    .maybeSingle();
  if (error) throw new Error("company_read_failed");

  const row = (data ?? {}) as Record<string, unknown>;
  const handle = row.public_handle;
  return {
    timezone:
      typeof row.timezone === "string" && row.timezone.trim().length > 0
        ? row.timezone
        : BOOKING_POLICY_DEFAULTS.timezone,
    publicIntegration: typeof handle === "string" && handle.trim().length > 0,
  };
}

/** Throws on a store failure so the caller can answer 503 uniformly. */
export async function readBookingPolicy(
  actor: BookingSettingsActor,
  companyTimezone: string
): Promise<BookingPolicy> {
  const { data, error } = await actor.supabase
    .from(POLICY_TABLE)
    .select("*")
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (error) throw new Error("policy_read_failed");
  return bookingPolicyFromRow((data ?? null) as Record<string, unknown> | null, companyTimezone);
}

/** Throws on a store failure so the caller can answer 503 uniformly. */
export async function writeBookingPolicy(
  actor: BookingSettingsActor,
  policy: BookingPolicy,
  companyTimezone: string
): Promise<BookingPolicy> {
  const { data, error } = await actor.supabase
    .from(POLICY_TABLE)
    .upsert({ company_id: actor.companyId, ...bookingPolicyToRow(policy) })
    .select()
    .maybeSingle();
  // PostgREST reports a rejected column or a missing table in `error` while
  // still resolving — the destructure is the only place a silent write is
  // caught (see PGRST204).
  if (error) throw new Error("policy_write_failed");
  return bookingPolicyFromRow((data ?? null) as Record<string, unknown> | null, companyTimezone);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function windowFromRequest(value: unknown): BookingWindow | null {
  if (!isRecord(value)) return null;
  const { weekday, start, end } = value;
  if (typeof weekday !== "number" || typeof start !== "string" || typeof end !== "string") {
    return null;
  }
  return { weekday, start, end };
}

export type ParsedPolicy =
  | { readonly ok: true; readonly policy: BookingPolicy }
  | { readonly ok: false; readonly problem: string };

/**
 * The request body as a policy, or the first reason it is not one. Shape
 * failures are reported as `policy_invalid`; a well-shaped policy the table
 * would refuse is reported by its own rule name, so the screen can say which
 * rule it broke.
 */
export function parsePolicyRequest(body: unknown, companyTimezone: string): ParsedPolicy {
  if (!isRecord(body) || !isRecord(body.policy)) return { ok: false, problem: "policy_invalid" };
  const input = body.policy;

  if (!isBookingMode(input.mode)) return { ok: false, problem: "policy_invalid" };
  if (!Array.isArray(input.windows)) return { ok: false, problem: "policy_invalid" };

  const windows: BookingWindow[] = [];
  for (const entry of input.windows) {
    const parsed = windowFromRequest(entry);
    if (!parsed) return { ok: false, problem: "window_invalid" };
    windows.push(parsed);
  }

  const numbers = ["minNoticeHours", "horizonDays", "visitDurationMinutes"] as const;
  for (const key of numbers) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key] as number)) {
      return { ok: false, problem: "policy_invalid" };
    }
  }

  const cap = input.maxBookingsPerDay;
  if (cap !== null && cap !== undefined && typeof cap !== "number") {
    return { ok: false, problem: "policy_invalid" };
  }

  const owner = input.defaultOwnerId;
  if (owner !== null && owner !== undefined && !isUuid(owner)) {
    return { ok: false, problem: "owner_invalid" };
  }

  // The policy owns its timezone once written, and this screen never edits it
  // (the company clock lives in Company → Details) — so the server takes it
  // from the company rather than from the browser.
  const policy: BookingPolicy = {
    mode: input.mode,
    windows,
    timezone: companyTimezone,
    minNoticeHours: input.minNoticeHours as number,
    horizonDays: input.horizonDays as number,
    visitDurationMinutes: input.visitDurationMinutes as number,
    maxBookingsPerDay: typeof cap === "number" ? cap : null,
    defaultOwnerId: typeof owner === "string" ? owner : null,
  };

  const problems = validateBookingPolicy(policy);
  if (problems.length > 0) return { ok: false, problem: problems[0] };
  return { ok: true, policy };
}
