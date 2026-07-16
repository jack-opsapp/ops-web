/**
 * GET + PUT /api/integrations/email/auto-send/settings
 *
 * Manage auto-send settings for an email connection.
 * Feature-gated by ai_auto_send admin flag.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AutoSendService } from "@/lib/api/services/auto-send-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";
import { validateAutoSendSettingsTransition } from "@/lib/email/email-auto-send-settings-guard";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const connectionId = searchParams.get("connectionId");

    if (!companyId || !connectionId) {
      return NextResponse.json(
        { error: "companyId and connectionId are required" },
        { status: 400 }
      );
    }
    const access = await resolveEmailConnectionOperationAccess({
      request,
      claimedCompanyId: companyId,
      connectionId,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }

    // Check feature gate
    const featureEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "ai_auto_send"
    );

    // E5: Always return raw JSONB for autonomy panel, even if auto-send is disabled.
    // Auto-draft and autonomy features are independent of the auto-send feature flag.
    const { data: rawConn, error: connectionError } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (connectionError) {
      throw new Error(
        `Failed to validate email connection: ${connectionError.message}`
      );
    }
    if (!rawConn) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawSettings =
      (rawConn?.auto_send_settings as Record<string, unknown>) || {};

    if (!featureEnabled) {
      return NextResponse.json({
        featureEnabled: false,
        settings: {
          auto_draft_enabled: rawSettings.auto_draft_enabled ?? false,
          category_autonomy: rawSettings.category_autonomy ?? {},
          milestones: rawSettings.milestones ?? {},
        },
      });
    }

    const { settings } = await AutoSendService.isEnabled(
      companyId,
      connectionId
    );

    return NextResponse.json({
      featureEnabled: true,
      settings: {
        ...settings,
        auto_draft_enabled: rawSettings.auto_draft_enabled ?? false,
        category_autonomy: rawSettings.category_autonomy ?? {},
        milestones: rawSettings.milestones ?? {},
      },
    });
  } catch (err) {
    console.error("[auto-send-settings]", err);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

export async function PUT(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const { companyId, connectionId, settings } = body;

    if (!companyId || !connectionId || !settings) {
      return NextResponse.json(
        { error: "companyId, connectionId, and settings are required" },
        { status: 400 }
      );
    }
    if (
      typeof settings !== "object" ||
      settings === null ||
      Array.isArray(settings)
    ) {
      return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
    }

    const access = await resolveEmailConnectionOperationAccess({
      request,
      claimedCompanyId: companyId,
      connectionId,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }

    const { data: ownedConnection, error: connectionError } = await supabase
      .from("email_connections")
      .select("id, auto_send_settings")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (connectionError) {
      throw new Error(
        `Failed to validate email connection: ${connectionError.message}`
      );
    }
    if (!ownedConnection) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check feature gate — allow writes if EITHER ai_auto_send OR phase_c is enabled.
    // E5: Auto-draft and per-category autonomy are phase_c features, not auto-send.
    const [autoSendEnabled, phaseCEnabled] = await Promise.all([
      AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "ai_auto_send"),
      AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c"),
    ]);

    if (!autoSendEnabled && !phaseCEnabled) {
      return NextResponse.json(
        { error: "AI features are not enabled for this company" },
        { status: 403 }
      );
    }

    const currentSettings =
      (ownedConnection.auto_send_settings as Record<string, unknown> | null) ??
      {};
    const graduation = await validateAutoSendSettingsTransition({
      companyId,
      actorUserId: access.actor.userId,
      currentSettings,
      requestedSettings: settings as Record<string, unknown>,
    });
    if (!graduation.allowed) {
      return NextResponse.json(
        {
          error:
            "Keep reviewing drafts. Auto-send unlocks at 20 drafts and 95% sent unchanged.",
          reason: graduation.reason,
          categoryKey: graduation.categoryKey,
          sampleSize: graduation.sampleSize,
          approvalRate: graduation.approvalRate,
          requiredSampleSize: 20,
          requiredApprovalRate: 0.95,
        },
        { status: 409 }
      );
    }

    await AutoSendService.updateSettings(companyId, connectionId, settings);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auto-send-settings]", err);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
