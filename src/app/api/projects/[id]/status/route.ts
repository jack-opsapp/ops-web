import { after, NextRequest, NextResponse } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import { ProjectStatusLifecycleOutboxService } from "@/lib/api/services/project-status-lifecycle-outbox-service";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const STATUS_TO_DB = {
  RFQ: "rfq",
  Estimated: "estimated",
  Accepted: "accepted",
  "In Progress": "in_progress",
  Completed: "completed",
  Closed: "closed",
  Archived: "archived",
} as const;

type ProjectStatusInput = keyof typeof STATUS_TO_DB;

interface StatusMutationResult {
  changed: boolean;
  updated_at: string;
  status_version: number;
  from_status: string;
  to_status: string;
}

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function isProjectStatus(value: unknown): value is ProjectStatusInput {
  return typeof value === "string" && value in STATUS_TO_DB;
}

function isStatusMutationResult(value: unknown): value is StatusMutationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.changed === "boolean" &&
    typeof result.updated_at === "string" &&
    typeof result.status_version === "number" &&
    Number.isSafeInteger(result.status_version) &&
    result.status_version >= 0 &&
    typeof result.from_status === "string" &&
    typeof result.to_status === "string"
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  let body: { status?: unknown };
  try {
    body = (await request.json()) as { status?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!isProjectStatus(body.status)) {
    return NextResponse.json(
      { error: "Invalid project status" },
      { status: 400 }
    );
  }

  const { id: projectId } = await params;
  const actorDb = getAccessTokenClient(token);
  const serviceDb = getServiceRoleClient();

  try {
    const { data: current, error: currentError } = await actorDb
      .from("projects")
      .select("id, status, updated_at, status_version")
      .eq("id", projectId)
      .eq("company_id", auth.companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (currentError || !current) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const newStatus = STATUS_TO_DB[body.status];
    if (
      typeof current.updated_at !== "string" ||
      typeof current.status !== "string" ||
      !Number.isSafeInteger(current.status_version) ||
      current.status_version < 0
    ) {
      return NextResponse.json(
        { error: "Unable to update project status" },
        { status: 500 }
      );
    }

    // The service bridge row-locks the project and delegates edit membership
    // to the canonical actor-aware helper. This keeps project-level and task-
    // level assignment, granular revokes, and archive authority consistent.
    const { data: mutation, error: mutationError } = await serviceDb.rpc(
      "change_project_status_as_system",
      {
        p_actor_user_id: auth.id,
        p_project_id: projectId,
        p_new_status: newStatus,
        p_expected_updated_at: current.updated_at,
        p_expected_status: current.status,
        p_expected_status_version: current.status_version,
      }
    );
    if (mutationError?.code === "42501") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (mutationError?.code === "P0001") {
      return NextResponse.json(
        { error: "Project status changed before this update completed" },
        { status: 409 }
      );
    }
    if (mutationError?.code === "P0002") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (mutationError || !isStatusMutationResult(mutation)) {
      return NextResponse.json(
        { error: "Unable to update project status" },
        { status: 500 }
      );
    }
    if (!mutation.changed) {
      return NextResponse.json({ ok: true, changed: false });
    }

    // The database trigger committed the lifecycle event atomically with the
    // guarded mutation. Actor/company never come from the request body.
    try {
      after(async () => {
        try {
          await ProjectStatusLifecycleOutboxService.processBatch(serviceDb, {
            limit: 10,
            leaseSeconds: 180,
          });
        } catch (error) {
          // The database trigger committed the lifecycle event atomically with
          // the status. A scheduled worker will retry if this eager drain fails.
          console.error("[project-status] Eager outbox drain failed", error);
        }
      });
    } catch (error) {
      console.error("[project-status] Lifecycle scheduling failed", error);
    }

    return NextResponse.json({ ok: true, changed: true });
  } catch (error) {
    console.error("[project-status] Mutation failed", error);
    return NextResponse.json(
      { error: "Unable to update project status" },
      { status: 500 }
    );
  }
}
