/**
 * GET /api/integrations/email/draft-stats-by-category
 *
 * Returns actor-mailbox readiness for each exact primary category.
 * Authenticated: requires Firebase auth + company_id validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { resolvePhaseCCategorySettingsAccess } from "@/lib/email/phase-c-category-settings-access";
import { PhaseCCategoryAutonomy } from "@/lib/api/services/phase-c-category-autonomy-service";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";

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

    const access = await resolvePhaseCCategorySettingsAccess({
      request,
      claimedCompanyId: companyId,
      connectionId,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error: access.status === 401 ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }

    const entries = await Promise.all(
      EMAIL_THREAD_CATEGORIES.map(async (category) => [
        category,
        await PhaseCCategoryAutonomy.isGraduated(
          companyId,
          connectionId,
          access.actor.userId,
          category
        ),
      ])
    );
    const categoryReadiness = Object.fromEntries(entries) as Record<
      EmailThreadCategory,
      { ready: boolean; sampleSize: number; approvalRate: number }
    >;

    return NextResponse.json({ categoryReadiness });
  } catch (err) {
    console.error("[draft-stats-by-category] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
