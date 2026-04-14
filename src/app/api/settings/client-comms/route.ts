/**
 * GET/PUT /api/settings/client-comms
 *
 * Manages client scheduling communication settings for a company.
 * Stored in companies.client_comms_settings JSONB column.
 *
 * S2 Amendment: Accepts the new wizard-driven schema with 5-level appointment
 * confirmation autonomy, configurable appointment reminder lead time, and
 * per-category send delays. Legacy keys are preserved for backwards compatibility.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  DEFAULT_CLIENT_COMMS_SETTINGS,
  type ClientCommsSettings,
  type AppointmentConfirmationLevel,
  type ConfirmMode,
  type RescheduleBehavior,
  type SimpleAutonomy,
  type StatusUpdateCadence,
  type PaymentReminderPreset,
  type RescheduleRequestBehavior,
  type SubcontractorTrigger,
} from "@/lib/types/approval-queue";

// ─── Validation helpers ─────────────────────────────────────────────────────

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const APPT_LEVELS = new Set<AppointmentConfirmationLevel>([
  "off",
  "manual",
  "draft_on_confirm",
  "auto_send_on_confirm",
  "full_auto",
]);

const CONFIRM_MODES = new Set<ConfirmMode>(["explicit", "automatic"]);

const RESCHED_BEHAVIORS = new Set<RescheduleBehavior>([
  "do_nothing",
  "notify",
  "draft",
  "auto_send",
]);

const SIMPLE_AUTONOMIES = new Set<SimpleAutonomy>([
  "off",
  "draft_to_queue",
  "auto_send",
]);

const CADENCES = new Set<StatusUpdateCadence>([
  "off",
  "weekly",
  "biweekly",
  "monthly",
  "on_stage_change",
]);

const PRESETS = new Set<PaymentReminderPreset>([
  "standard",
  "gentle",
  "aggressive",
  "custom",
]);

const RR_BEHAVIORS = new Set<RescheduleRequestBehavior>([
  "detect_only",
  "detect_and_draft",
]);

const SUB_TRIGGERS = new Set<SubcontractorTrigger>(["manual", "auto_suggest"]);

function pickEnum<T extends string>(
  value: unknown,
  allowed: Set<T>,
  fallback: T
): T {
  return typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : fallback;
}

function validate(config: Record<string, unknown>): ClientCommsSettings {
  const d = DEFAULT_CLIENT_COMMS_SETTINGS;

  const ac = (config.appointment_confirmation ?? {}) as Record<string, unknown>;
  const ar = (config.appointment_reminder ?? {}) as Record<string, unknown>;
  const su = (config.status_update ?? {}) as Record<string, unknown>;
  const pr = (config.payment_reminder ?? {}) as Record<string, unknown>;
  const ic = (config.invoice_cover ?? {}) as Record<string, unknown>;
  const rr = (config.reschedule_request ?? {}) as Record<string, unknown>;
  const sc = (config.subcontractor_coordination ?? {}) as Record<string, unknown>;

  // Validate custom_days to a strict [number, number, number, number] tuple.
  // Bounds match the wizard slider (1-180 days — anything beyond 6 months
  // after due is effectively collections, not reminders).
  const rawCustomDays = pr.custom_days;
  let customDays: [number, number, number, number] = [
    ...d.payment_reminder.custom_days,
  ];
  if (Array.isArray(rawCustomDays) && rawCustomDays.length === 4) {
    customDays = [
      clamp(rawCustomDays[0], 1, 180, d.payment_reminder.custom_days[0]),
      clamp(rawCustomDays[1], 1, 180, d.payment_reminder.custom_days[1]),
      clamp(rawCustomDays[2], 1, 180, d.payment_reminder.custom_days[2]),
      clamp(rawCustomDays[3], 1, 180, d.payment_reminder.custom_days[3]),
    ];
  }

  return {
    comms_wizard_completed_at:
      typeof config.comms_wizard_completed_at === "string"
        ? (config.comms_wizard_completed_at as string)
        : null,
    comms_wizard_version: clamp(
      config.comms_wizard_version,
      0,
      999,
      d.comms_wizard_version
    ),
    appointment_confirmation: {
      level: pickEnum(ac.level, APPT_LEVELS, d.appointment_confirmation.level),
      confirm_mode: pickEnum(
        ac.confirm_mode,
        CONFIRM_MODES,
        d.appointment_confirmation.confirm_mode
      ),
      auto_confirm_after_hours: clamp(
        ac.auto_confirm_after_hours,
        1,
        24,
        d.appointment_confirmation.auto_confirm_after_hours
      ),
      send_delay_minutes: clamp(
        ac.send_delay_minutes,
        0,
        60,
        d.appointment_confirmation.send_delay_minutes
      ),
      reschedule_behavior: pickEnum(
        ac.reschedule_behavior,
        RESCHED_BEHAVIORS,
        d.appointment_confirmation.reschedule_behavior
      ),
    },
    appointment_reminder: {
      enabled: boolOr(ar.enabled, d.appointment_reminder.enabled),
      lead_days: clamp(ar.lead_days, 0, 7, d.appointment_reminder.lead_days),
      send_hour_local: clamp(
        ar.send_hour_local,
        6,
        20,
        d.appointment_reminder.send_hour_local
      ),
      include_weather: boolOr(
        ar.include_weather,
        d.appointment_reminder.include_weather
      ),
      autonomy: pickEnum(
        ar.autonomy,
        SIMPLE_AUTONOMIES,
        d.appointment_reminder.autonomy
      ),
      send_delay_minutes: clamp(
        ar.send_delay_minutes,
        0,
        60,
        d.appointment_reminder.send_delay_minutes
      ),
    },
    status_update: {
      cadence: pickEnum(su.cadence, CADENCES, d.status_update.cadence),
      weekly_day: clamp(su.weekly_day, 0, 6, d.status_update.weekly_day),
      autonomy: pickEnum(
        su.autonomy,
        SIMPLE_AUTONOMIES,
        d.status_update.autonomy
      ),
      send_delay_minutes: clamp(
        su.send_delay_minutes,
        0,
        60,
        d.status_update.send_delay_minutes
      ),
    },
    payment_reminder: {
      enabled: boolOr(pr.enabled, d.payment_reminder.enabled),
      preset: pickEnum(pr.preset, PRESETS, d.payment_reminder.preset),
      custom_days: customDays,
      max_reminders: clamp(
        pr.max_reminders,
        1,
        4,
        d.payment_reminder.max_reminders
      ),
      autonomy: pickEnum(
        pr.autonomy,
        SIMPLE_AUTONOMIES,
        d.payment_reminder.autonomy
      ),
      send_delay_minutes: clamp(
        pr.send_delay_minutes,
        0,
        60,
        d.payment_reminder.send_delay_minutes
      ),
    },
    invoice_cover: {
      enabled: boolOr(ic.enabled, d.invoice_cover.enabled),
      threshold: clamp(ic.threshold, 0, 1_000_000, d.invoice_cover.threshold),
      autonomy: pickEnum(
        ic.autonomy,
        SIMPLE_AUTONOMIES,
        d.invoice_cover.autonomy
      ),
      send_delay_minutes: clamp(
        ic.send_delay_minutes,
        0,
        60,
        d.invoice_cover.send_delay_minutes
      ),
    },
    reschedule_request: {
      enabled: boolOr(rr.enabled, d.reschedule_request.enabled),
      behavior: pickEnum(
        rr.behavior,
        RR_BEHAVIORS,
        d.reschedule_request.behavior
      ),
      min_confidence: clamp(
        rr.min_confidence,
        0,
        1,
        d.reschedule_request.min_confidence
      ),
      autonomy: pickEnum(
        rr.autonomy,
        SIMPLE_AUTONOMIES,
        d.reschedule_request.autonomy
      ),
      send_delay_minutes: clamp(
        rr.send_delay_minutes,
        0,
        60,
        d.reschedule_request.send_delay_minutes
      ),
    },
    subcontractor_coordination: {
      enabled: boolOr(sc.enabled, d.subcontractor_coordination.enabled),
      trigger: pickEnum(
        sc.trigger,
        SUB_TRIGGERS,
        d.subcontractor_coordination.trigger
      ),
    },
  };
}

// ─── Merge helper — fills any missing keys from defaults ────────────────────
//
// The DB may contain old-schema rows that lack the new wizard-driven keys.
// On read, we merge into the default shape so the client always gets a
// complete object.

function mergeWithDefaults(raw: unknown): ClientCommsSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_CLIENT_COMMS_SETTINGS;
  return validate(raw as Record<string, unknown>);
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  const user = await findUserByAuth(
    authUser.uid,
    undefined,
    "id, company_id, role"
  );
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userRole = (user.role as string) ?? "";
  if (!["admin", "owner"].includes(userRole)) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("companies")
    .select("client_comms_settings")
    .eq("id", companyId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    config: mergeWithDefaults(data?.client_comms_settings),
  });
}

export async function PUT(req: NextRequest) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { companyId, config } = body;

  if (!companyId || !config) {
    return NextResponse.json(
      { error: "companyId and config required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const user = await findUserByAuth(
    authUser.uid,
    undefined,
    "id, company_id, role"
  );
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userRole = (user.role as string) ?? "";
  if (!["admin", "owner"].includes(userRole)) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  const validated = validate(config as Record<string, unknown>);

  const { error } = await supabase
    .from("companies")
    .update({ client_comms_settings: validated })
    .eq("id", companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, config: validated });
}
