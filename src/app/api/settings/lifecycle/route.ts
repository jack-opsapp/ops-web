/**
 * GET/PUT /api/settings/lifecycle
 * Manages lead lifecycle automation settings for a company.
 * Source of truth: public.lead_lifecycle_settings.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  DEFAULT_FOLLOW_UP_TEMPLATE_BODY,
  DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
} from "@/lib/email/opportunity-lifecycle-evaluator";

interface LeadLifecycleSettingsConfig {
  follow_up_after_days: number;
  second_follow_up_archive_after_days: number;
  no_correspondence_archive_days: number;
  inbound_unreplied_lost_days: number;
  follow_up_template_subject: string;
  follow_up_template_body: string;
  auto_archive_enabled: boolean;
  auto_lost_enabled: boolean;
}

const DEFAULT_CONFIG: LeadLifecycleSettingsConfig = {
  follow_up_after_days: 7,
  second_follow_up_archive_after_days: 7,
  no_correspondence_archive_days: 14,
  inbound_unreplied_lost_days: 30,
  follow_up_template_subject: DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
  follow_up_template_body: DEFAULT_FOLLOW_UP_TEMPLATE_BODY,
  auto_archive_enabled: true,
  auto_lost_enabled: true,
};

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function nonEmptyText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function normalizeConfig(input: unknown): LeadLifecycleSettingsConfig {
  const source =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return {
    follow_up_after_days: positiveInteger(
      source.follow_up_after_days,
      DEFAULT_CONFIG.follow_up_after_days
    ),
    second_follow_up_archive_after_days: positiveInteger(
      source.second_follow_up_archive_after_days,
      DEFAULT_CONFIG.second_follow_up_archive_after_days
    ),
    no_correspondence_archive_days: positiveInteger(
      source.no_correspondence_archive_days,
      DEFAULT_CONFIG.no_correspondence_archive_days
    ),
    inbound_unreplied_lost_days: positiveInteger(
      source.inbound_unreplied_lost_days,
      DEFAULT_CONFIG.inbound_unreplied_lost_days
    ),
    follow_up_template_subject: nonEmptyText(
      source.follow_up_template_subject,
      DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT
    ),
    follow_up_template_body: nonEmptyText(
      source.follow_up_template_body,
      DEFAULT_FOLLOW_UP_TEMPLATE_BODY
    ),
    auto_archive_enabled:
      typeof source.auto_archive_enabled === "boolean"
        ? source.auto_archive_enabled
        : DEFAULT_CONFIG.auto_archive_enabled,
    auto_lost_enabled:
      typeof source.auto_lost_enabled === "boolean"
        ? source.auto_lost_enabled
        : DEFAULT_CONFIG.auto_lost_enabled,
  };
}

/**
 * Authorize lead lifecycle settings access via the granular permission system.
 * Lead lifecycle settings are company-wide configuration, gated by the
 * `settings.company` permission (the same key that protects every other
 * company-settings surface — company details, task types, data export/delete).
 * Never filter by role: scope is resolved through public.has_permission so
 * custom roles with `settings.company` are honored.
 */
async function requireCompanySettingsAccess(
  req: NextRequest,
  companyId: string
) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    };
  }

  const user = await findUserByAuth(
    authUser.uid,
    authUser.email,
    "id, company_id"
  );
  if (!user || user.company_id !== companyId) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      user: null,
    };
  }

  const allowed = await checkPermissionById(
    user.id as string,
    "settings.company"
  );
  if (!allowed) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      user: null,
    };
  }

  return { response: null, user };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json(
      { error: "companyId required" },
      { status: 400 }
    );
  }

  const auth = await requireCompanySettingsAccess(req, companyId);
  if (auth.response) return auth.response;

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("lead_lifecycle_settings")
    .select(
      "follow_up_after_days, second_follow_up_archive_after_days, no_correspondence_archive_days, inbound_unreplied_lost_days, follow_up_template_subject, follow_up_template_body, auto_archive_enabled, auto_lost_enabled"
    )
    .eq("company_id", companyId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    config: normalizeConfig(data ?? DEFAULT_CONFIG),
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const companyId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).companyId
      : null;
  const config =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).config
      : null;

  if (typeof companyId !== "string" || !config) {
    return NextResponse.json(
      { error: "companyId and config required" },
      { status: 400 }
    );
  }

  const auth = await requireCompanySettingsAccess(req, companyId);
  if (auth.response) return auth.response;

  const validConfig = normalizeConfig(config);
  const now = new Date().toISOString();
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("lead_lifecycle_settings")
    .upsert(
      {
        company_id: companyId,
        ...validConfig,
        updated_at: now,
      },
      { onConflict: "company_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, config: validConfig });
}
