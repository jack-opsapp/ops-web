/**
 * GET /api/agent/team-availability
 *
 * Returns per-member availability for a date range.
 * Used by the approval queue task card to show team context.
 * Restricted to admin/owner roles.
 *
 * Query params:
 *   - startDate (ISO string, required)
 *   - endDate (ISO string, required)
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../_lib/auth";
import { AssignmentService } from "@/lib/api/services/assignment-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export async function GET(request: NextRequest) {
  setSupabaseOverride(getServiceRoleClient());

  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    // Fix 10: role check — only admin/owner can view company-wide team availability
    if (!["admin", "owner"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const startDateStr = url.searchParams.get("startDate");
    const endDateStr = url.searchParams.get("endDate");

    if (!startDateStr || !endDateStr) {
      return NextResponse.json(
        { error: "startDate and endDate query params are required" },
        { status: 400 }
      );
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use ISO 8601." },
        { status: 400 }
      );
    }

    // Fix 29: endDate must be after startDate
    if (endDate < startDate) {
      return NextResponse.json(
        { error: "endDate must be after startDate" },
        { status: 400 }
      );
    }

    // Fix 30: max 90-day range
    if (endDate.getTime() - startDate.getTime() > MAX_RANGE_MS) {
      return NextResponse.json(
        { error: "Maximum range is 90 days" },
        { status: 400 }
      );
    }

    const availability = await AssignmentService.getTeamAvailability(
      auth.companyId,
      startDate,
      endDate
    );

    return NextResponse.json({ availability });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/team-availability GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
