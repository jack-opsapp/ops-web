import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  authorizeEmailConnectionOperationForActor,
  emailConnectionOwnerId,
} from "@/lib/email/email-connection-operation-access";

export type EmailAnalysisJobAccessDecision =
  | {
      allowed: true;
      actorUserId: string;
      companyId: string;
      connectionId: string;
      connectionOwnerUserId: string | null;
      connectionType: "company" | "individual";
    }
  | {
      allowed: false;
      reason:
        | "job_not_found"
        | "job_identity_mismatch"
        | "requester_snapshot_missing"
        | "connection_access_revoked"
        | "connection_owner_changed"
        | "lookup_failed";
    };

/**
 * Re-authorize a chained analysis stage from the immutable job requester.
 * Body job/company/connection identifiers are consistency claims only.
 */
export async function authorizeEmailAnalysisJobContinuation({
  supabase,
  jobId,
  claimedConnectionId,
  claimedCompanyId,
}: {
  supabase: SupabaseClient;
  jobId: string;
  claimedConnectionId?: string;
  claimedCompanyId?: string;
}): Promise<EmailAnalysisJobAccessDecision> {
  const { data, error } = await supabase
    .from("gmail_scan_jobs")
    .select(
      "id, company_id, connection_id, requested_by_user_id, connection_owner_user_id"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) return { allowed: false, reason: "lookup_failed" };
  if (!data) return { allowed: false, reason: "job_not_found" };

  const companyId = String(data.company_id ?? "");
  const connectionId = String(data.connection_id ?? "");
  const actorUserId = String(data.requested_by_user_id ?? "");
  const ownerSnapshot = data.connection_owner_user_id
    ? String(data.connection_owner_user_id)
    : null;
  if (
    (claimedCompanyId !== undefined && claimedCompanyId !== companyId) ||
    (claimedConnectionId !== undefined && claimedConnectionId !== connectionId)
  ) {
    return { allowed: false, reason: "job_identity_mismatch" };
  }
  if (!actorUserId || !companyId || !connectionId) {
    return { allowed: false, reason: "requester_snapshot_missing" };
  }

  const connectionAccess = await authorizeEmailConnectionOperationForActor({
    actor: { userId: actorUserId, companyId },
    connectionId,
    requireUsable: true,
    supabase,
  });
  if (!connectionAccess.allowed) {
    return { allowed: false, reason: "connection_access_revoked" };
  }

  const currentConnection = connectionAccess.connections[0];
  const currentOwner = currentConnection
    ? emailConnectionOwnerId(currentConnection)
    : null;
  if (currentOwner !== ownerSnapshot) {
    return { allowed: false, reason: "connection_owner_changed" };
  }

  return {
    allowed: true,
    actorUserId,
    companyId,
    connectionId,
    connectionOwnerUserId: currentOwner,
    connectionType: currentConnection.type,
  };
}
