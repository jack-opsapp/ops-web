/**
 * GET /api/portal/projects/[id]
 *
 * Fetches a single project for the portal.
 * Verifies that the project belongs to the client's company AND
 * is associated with this specific client (via estimates or invoices).
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

    // Preview mode: return demo project
    if (session.isPreview) {
      const { getDemoProjectDetail } = await import("@/lib/api/services/portal-demo-data");
      const demoProject = getDemoProjectDetail(id);
      if (!demoProject) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return NextResponse.json(demoProject);
    }

    const supabase = getServiceRoleClient();

    // Verify the client has estimates or invoices linked to this project
    // (prevents cross-client data leakage within the same company)
    const { data: linkedDocs } = await supabase
      .from("estimates")
      .select("id")
      .eq("client_id", session.clientId)
      .eq("company_id", session.companyId)
      .eq("project_id", id)
      .is("deleted_at", null)
      .limit(1);

    const hasEstimate = (linkedDocs ?? []).length > 0;

    if (!hasEstimate) {
      const { data: linkedInvoices } = await supabase
        .from("invoices")
        .select("id")
        .eq("client_id", session.clientId)
        .eq("company_id", session.companyId)
        .eq("project_id", id)
        .is("deleted_at", null)
        .limit(1);

      if ((linkedInvoices ?? []).length === 0) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }
    }

    const { data, error } = await supabase
      .from("projects")
      .select(
        "id, title, address, status, start_date, end_date, description"
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

    // Fetch linked estimates, invoices, tasks, and client-visible photos in parallel
    const [estimatesResult, invoicesResult, tasksResult, photosResult] = await Promise.all([
      supabase
        .from("estimates")
        .select("id, estimate_number, title, status, total, issue_date")
        .eq("client_id", session.clientId)
        .eq("company_id", session.companyId)
        .eq("project_id", id)
        .is("deleted_at", null)
        .neq("status", "draft")
        .order("issue_date", { ascending: false }),
      supabase
        .from("invoices")
        .select("id, invoice_number, subject, status, total, balance_due, due_date")
        .eq("client_id", session.clientId)
        .eq("company_id", session.companyId)
        .eq("project_id", id)
        .is("deleted_at", null)
        .neq("status", "draft")
        .order("issue_date", { ascending: false }),
      supabase
        .from("project_tasks")
        .select("id, title, status, scheduled_date, task_type_id, display_order, task_type:task_types(id, name, color)")
        .eq("project_id", id)
        .eq("company_id", session.companyId)
        .is("deleted_at", null)
        .order("display_order", { ascending: true }),
      supabase
        .from("project_photos")
        .select("id, url, thumbnail_url, source, caption, created_at")
        .eq("project_id", id)
        .eq("company_id", session.companyId)
        .eq("is_client_visible", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ]);

    const project = {
      id: data.id as string,
      title: (data.title as string) ?? "Untitled Project",
      address: (data.address as string) ?? null,
      status: (data.status as string) ?? "unknown",
      description: (data.description as string) ?? null,
      startDate: parseDate(data.start_date),
      endDate: parseDate(data.end_date),
      estimates: (estimatesResult.data ?? []).map((row) => ({
        id: row.id as string,
        estimateNumber: row.estimate_number as string,
        title: (row.title as string) ?? null,
        status: row.status as string,
        total: Number(row.total ?? 0),
        issueDate: row.issue_date as string,
      })),
      invoices: (invoicesResult.data ?? []).map((row) => ({
        id: row.id as string,
        invoiceNumber: row.invoice_number as string,
        subject: (row.subject as string) ?? null,
        status: row.status as string,
        total: Number(row.total ?? 0),
        balanceDue: Number(row.balance_due ?? 0),
        dueDate: row.due_date as string,
      })),
      tasks: (tasksResult.data ?? []).map((row) => ({
        id: row.id as string,
        title: row.title as string,
        status: row.status as string,
        scheduledDate: (row.scheduled_date as string) ?? undefined,
        displayOrder: (row.display_order as number) ?? 0,
        taskType: row.task_type ? {
          id: (row.task_type as Record<string, unknown>).id as string,
          name: (row.task_type as Record<string, unknown>).name as string,
          color: (row.task_type as Record<string, unknown>).color as string,
        } : null,
      })),
      photos: (photosResult.data ?? []).map((row) => ({
        id: row.id as string,
        url: row.url as string,
        thumbnailUrl: (row.thumbnail_url as string) ?? null,
        source: row.source as string,
        caption: (row.caption as string) ?? null,
      })),
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
