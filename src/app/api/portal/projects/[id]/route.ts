/**
 * GET /api/portal/projects/[id]
 *
 * Fetches a single project for the portal.
 * Verifies that the project belongs to the client's company.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDate } from "@/lib/supabase/helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const { id } = await params;

    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("projects")
      .select(
        "id, title, address, status, start_date, end_date, project_images, description"
      )
      .eq("id", id)
      .eq("company_id", session.companyId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch project: ${error.message}`);
    }

    if (!data) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const project = {
      id: data.id as string,
      title: (data.title as string) ?? "Untitled Project",
      address: (data.address as string) ?? null,
      status: (data.status as string) ?? "unknown",
      description: (data.description as string) ?? null,
      startDate: parseDate(data.start_date),
      endDate: parseDate(data.end_date),
      projectImages: (data.project_images as string[]) ?? [],
    };

    return NextResponse.json(project);
  } catch (error) {
    console.error("[portal/projects/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch project" },
      { status: 500 }
    );
  }
}
