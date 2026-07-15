/**
 * POST /api/integrations/email/auto-send/cancel
 *
 * Cancel a pending auto-send email.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AutoSendService } from "@/lib/api/services/auto-send-service";

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const { id, companyId } = body;

    if (!id || !companyId) {
      return NextResponse.json(
        { error: "id and companyId are required" },
        { status: 400 }
      );
    }
    const authError = await requireEmailCompanyAccess(
      request,
      companyId,
      "inbox.send"
    );
    if (authError) return authError;

    const cancelled = await AutoSendService.cancelAutoSend(id, companyId);

    if (!cancelled) {
      return NextResponse.json(
        { error: "Auto-send not found or already processed" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auto-send-cancel]", err);
    return NextResponse.json(
      { error: "Failed to cancel auto-send" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
