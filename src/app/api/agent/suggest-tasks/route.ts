/**
 * POST /api/agent/suggest-tasks
 *
 * Manual trigger: analyze a project and propose task suggestions to the approval queue.
 * Called when a user clicks "Suggest Tasks" on the project detail page.
 *
 * Body: { projectId: string }
 * Returns: { proposed: number, deduplicated: number } or { message: "..." } if no suggestions
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../_lib/auth";
import { TaskSuggestionService } from "@/lib/api/services/task-suggestion-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

export async function POST(request: NextRequest) {
  setSupabaseOverride(getServiceRoleClient());

  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    const body = await request.json();
    const { projectId } = body as { projectId: string };

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    const suggestions = await TaskSuggestionService.suggestTasksForProject(
      auth.companyId,
      projectId
    );

    if (suggestions.length === 0) {
      return NextResponse.json({ proposed: 0, deduplicated: 0, message: "No suggestions" });
    }

    const result = await TaskSuggestionService.proposeTaskCreation(
      auth.companyId,
      auth.id,
      projectId,
      suggestions
    );

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/suggest-tasks POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
