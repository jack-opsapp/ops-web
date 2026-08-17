/**
 * GET/PUT /api/settings/invoice
 * Manages invoice automation settings for a company.
 * Stored in companies.invoice_settings JSONB column.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const VALID_PAYMENT_TERMS = new Set(["NET-15", "NET-30", "NET-45", "NET-60"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInvoicePatch(
  config: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (hasOwn(config, "default_payment_terms")) {
    const terms = String(config.default_payment_terms ?? "");
    patch.default_payment_terms = VALID_PAYMENT_TERMS.has(terms)
      ? terms
      : "NET-30";
  }
  if (hasOwn(config, "default_tax_rate")) {
    patch.default_tax_rate = clamp(config.default_tax_rate, 0, 100, 0);
  }
  if (hasOwn(config, "auto_suggest_on_completion")) {
    patch.auto_suggest_on_completion = boolOr(
      config.auto_suggest_on_completion,
      true
    );
  }
  if (hasOwn(config, "auto_suggest_from_estimate")) {
    patch.auto_suggest_from_estimate = boolOr(
      config.auto_suggest_from_estimate,
      true
    );
  }
  if (hasOwn(config, "high_value_threshold")) {
    patch.high_value_threshold = clamp(
      config.high_value_threshold,
      0,
      Number.MAX_SAFE_INTEGER,
      5000
    );
  }
  if (hasOwn(config, "include_cover_email")) {
    patch.include_cover_email = boolOr(config.include_cover_email, true);
  }

  if (isRecord(config.financial_intelligence)) {
    const financial = config.financial_intelligence;
    const financialPatch: Record<string, unknown> = {};
    if (hasOwn(financial, "enabled")) {
      financialPatch.enabled = boolOr(financial.enabled, true);
    }
    if (hasOwn(financial, "overdue_pct_threshold")) {
      financialPatch.overdue_pct_threshold = clamp(
        financial.overdue_pct_threshold,
        1,
        100,
        30
      );
    }
    if (hasOwn(financial, "concentration_pct_threshold")) {
      financialPatch.concentration_pct_threshold = clamp(
        financial.concentration_pct_threshold,
        1,
        100,
        40
      );
    }
    if (hasOwn(financial, "aging_days_threshold")) {
      financialPatch.aging_days_threshold = clamp(
        financial.aging_days_threshold,
        1,
        365,
        60
      );
    }
    if (hasOwn(financial, "aging_min_count")) {
      financialPatch.aging_min_count = clamp(
        financial.aging_min_count,
        1,
        50,
        3
      );
    }
    if (hasOwn(financial, "win_rate_increase_threshold")) {
      financialPatch.win_rate_increase_threshold = clamp(
        financial.win_rate_increase_threshold,
        1,
        100,
        80
      );
    }
    if (hasOwn(financial, "win_rate_decrease_threshold")) {
      financialPatch.win_rate_decrease_threshold = clamp(
        financial.win_rate_decrease_threshold,
        1,
        100,
        40
      );
    }
    if (hasOwn(financial, "min_estimates_for_analysis")) {
      financialPatch.min_estimates_for_analysis = clamp(
        financial.min_estimates_for_analysis,
        1,
        100,
        5
      );
    }
    patch.financial_intelligence = financialPatch;
  }

  return patch;
}

async function authorizeBillingSettings(req: NextRequest, companyId: string) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(
    authUser.uid,
    authUser.email,
    "id, company_id"
  );
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = await checkPermissionById(
    user.id as string,
    "settings.billing"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const authorizationError = await authorizeBillingSettings(req, companyId);
  if (authorizationError) return authorizationError;

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("companies")
    .select("invoice_settings")
    .eq("id", companyId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ config: data?.invoice_settings ?? null });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const companyId = isRecord(body) ? body.companyId : null;
  const config = isRecord(body) ? body.config : null;

  if (typeof companyId !== "string" || !isRecord(config)) {
    return NextResponse.json(
      { error: "companyId and config required" },
      { status: 400 }
    );
  }

  const authorizationError = await authorizeBillingSettings(req, companyId);
  if (authorizationError) return authorizationError;

  const patch = normalizeInvoicePatch(config);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "config contains no supported settings" },
      { status: 400 }
    );
  }
  const supabase = getServiceRoleClient();
  const { error } = await supabase.rpc("merge_company_invoice_settings", {
    p_company_id: companyId,
    p_patch: patch,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
