/**
 * GET/PUT /api/settings/invoice
 * Manages invoice automation settings for a company.
 * Stored in companies.invoice_settings JSONB column.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(req: NextRequest) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json(
      { error: "companyId required" },
      { status: 400 }
    );
  }

  // Verify user belongs to this company and has admin/owner role
  const supabase = getServiceRoleClient();
  const user = await findUserByAuth(authUser.uid, undefined, "id, company_id, role");
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userRole = (user.role as string) ?? "";
  if (!["admin", "owner"].includes(userRole)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("companies")
    .select("invoice_settings")
    .eq("id", companyId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    config: data?.invoice_settings ?? null,
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

  // Verify user belongs to this company and has admin/owner role
  const supabase = getServiceRoleClient();
  const user = await findUserByAuth(authUser.uid, undefined, "id, company_id, role");
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userRole = (user.role as string) ?? "";
  if (!["admin", "owner"].includes(userRole)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // Validate config shape
  const VALID_PAYMENT_TERMS = ["NET-15", "NET-30", "NET-45", "NET-60"];
  const rawTerms = String(config.default_payment_terms ?? "NET-30");

  // Validate reminder settings if provided
  let reminderSettings = undefined;
  if (config.reminder_settings && typeof config.reminder_settings === "object") {
    const rs = config.reminder_settings as Record<string, unknown>;
    const rawDays = Array.isArray(rs.reminder_days) ? rs.reminder_days : [7, 14, 30, 45];
    const validDays = rawDays.map((d: unknown) => Math.max(1, Math.min(365, Number(d) || 7)));
    // Ensure days are in ascending order
    validDays.sort((a: number, b: number) => a - b);

    reminderSettings = {
      enabled: Boolean(rs.enabled ?? true),
      reminder_days: validDays.slice(0, 4),
      max_reminders: Math.max(1, Math.min(4, Number(rs.max_reminders) || 4)),
      skip_weekends: Boolean(rs.skip_weekends ?? false),
      excluded_client_ids: Array.isArray(rs.excluded_client_ids)
        ? (rs.excluded_client_ids as string[]).filter((id) => typeof id === "string" && id.length > 0)
        : [],
      late_payment_threshold: Math.max(0, Math.min(100, Number(rs.late_payment_threshold) || 50)),
    };
  }

  // Validate financial intelligence settings if provided
  let financialIntelligence = undefined;
  if (config.financial_intelligence && typeof config.financial_intelligence === "object") {
    const fi = config.financial_intelligence as Record<string, unknown>;
    financialIntelligence = {
      enabled: Boolean(fi.enabled ?? true),
      overdue_pct_threshold: Math.max(1, Math.min(100, Number(fi.overdue_pct_threshold) || 30)),
      concentration_pct_threshold: Math.max(1, Math.min(100, Number(fi.concentration_pct_threshold) || 40)),
      aging_days_threshold: Math.max(1, Math.min(365, Number(fi.aging_days_threshold) || 60)),
      aging_min_count: Math.max(1, Math.min(50, Number(fi.aging_min_count) || 3)),
      win_rate_increase_threshold: Math.max(1, Math.min(100, Number(fi.win_rate_increase_threshold) || 80)),
      win_rate_decrease_threshold: Math.max(1, Math.min(100, Number(fi.win_rate_decrease_threshold) || 40)),
      min_estimates_for_analysis: Math.max(1, Math.min(100, Number(fi.min_estimates_for_analysis) || 5)),
    };
  }

  const validatedConfig: Record<string, unknown> = {
    default_payment_terms: VALID_PAYMENT_TERMS.includes(rawTerms) ? rawTerms : "NET-30",
    default_tax_rate: Math.max(0, Math.min(100, Number(config.default_tax_rate) || 0)),
    auto_suggest_on_completion: Boolean(config.auto_suggest_on_completion),
    auto_suggest_from_estimate: Boolean(config.auto_suggest_from_estimate),
    high_value_threshold: Math.max(0, Number(config.high_value_threshold) || 5000),
    include_cover_email: Boolean(config.include_cover_email),
    ...(reminderSettings ? { reminder_settings: reminderSettings } : {}),
    ...(financialIntelligence ? { financial_intelligence: financialIntelligence } : {}),
  };

  // Read existing settings first to merge (don't overwrite unrelated keys)
  const { data: existing } = await supabase
    .from("companies")
    .select("invoice_settings")
    .eq("id", companyId)
    .single();

  const merged = {
    ...((existing?.invoice_settings as Record<string, unknown>) ?? {}),
    ...validatedConfig,
  };

  const { error } = await supabase
    .from("companies")
    .update({ invoice_settings: merged })
    .eq("id", companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
