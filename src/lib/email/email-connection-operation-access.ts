import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveEmailRouteActor,
  type EmailRouteActor,
} from "@/lib/email/email-route-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export interface EmailConnectionOperationRow {
  id: string;
  company_id: string;
  email?: string;
  provider: string;
  type: "company" | "individual";
  user_id: string | null;
  status: string;
  sync_enabled: boolean;
}

/**
 * Return a canonical mailbox owner only for an individual mailbox.
 *
 * Historical company connections can still carry the UUID-shaped text of the
 * user who connected them. That value is connector metadata, never ownership
 * or actor authority, and must not be propagated into requester snapshots.
 */
export function emailConnectionOwnerId(
  connection: Pick<EmailConnectionOperationRow, "type" | "user_id">
): string | null {
  if (connection.type !== "individual") return null;
  const ownerId = connection.user_id?.trim();
  return ownerId || null;
}

export type EmailConnectionOperationDenialReason =
  | "unauthorized"
  | "forbidden"
  | "connection_not_found"
  | "connection_unavailable"
  | "lookup_failed";

export type EmailConnectionOperationDecision =
  | {
      allowed: true;
      actor: EmailRouteActor;
      connections: EmailConnectionOperationRow[];
      connectionIds: string[];
    }
  | {
      allowed: false;
      reason: EmailConnectionOperationDenialReason;
      status: 401 | 403 | 500;
    };

interface AuthorizeForActorInput {
  actor: EmailRouteActor;
  supabase?: SupabaseClient;
  connectionId?: string;
  /**
   * Provider reads and background continuations must stop after a mailbox is
   * paused, disconnected, or marked for reconnect. Wizard analysis is allowed
   * while the connection is still setup_incomplete.
   */
  requireUsable?: boolean;
}

interface ResolveOperationInput extends Omit<AuthorizeForActorInput, "actor"> {
  request: NextRequest;
  claimedCompanyId?: string;
}

function isUsable(connection: EmailConnectionOperationRow): boolean {
  return (
    connection.sync_enabled === true &&
    (connection.status === "active" || connection.status === "setup_incomplete")
  );
}

/**
 * Authorize mailbox-wide service-role work for a canonical OPS user UUID.
 *
 * Individual mailboxes are never administratively inherited: only their
 * current `email_connections.user_id` owner may operate them. Company
 * mailboxes require the canonical integration-management permission at the
 * explicit `all` scope. Mailbox/login email equality is never consulted.
 */
export async function authorizeEmailConnectionOperationForActor({
  actor,
  supabase = getServiceRoleClient(),
  connectionId,
  requireUsable = false,
}: AuthorizeForActorInput): Promise<EmailConnectionOperationDecision> {
  if (!actor.userId.trim() || !actor.companyId.trim()) {
    return { allowed: false, reason: "forbidden", status: 403 };
  }

  const { data: currentActor, error: actorError } = await supabase
    .from("users")
    .select("id, company_id, is_active")
    .eq("id", actor.userId)
    .eq("company_id", actor.companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (actorError) {
    console.error("[email-connection-operation] actor lookup failed", {
      actorUserId: actor.userId,
      actorCompanyId: actor.companyId,
      error: actorError,
    });
    return { allowed: false, reason: "lookup_failed", status: 500 };
  }
  if (!currentActor || currentActor.is_active !== true) {
    return { allowed: false, reason: "forbidden", status: 403 };
  }

  let query = supabase
    .from("email_connections")
    .select(
      "id, company_id, email, provider, type, user_id, status, sync_enabled"
    )
    .eq("company_id", actor.companyId);
  if (connectionId) query = query.eq("id", connectionId);

  const { data, error } = await query;
  if (error) {
    console.error("[email-connection-operation] connection lookup failed", {
      actorUserId: actor.userId,
      actorCompanyId: actor.companyId,
      connectionId: connectionId ?? null,
      error,
    });
    return { allowed: false, reason: "lookup_failed", status: 500 };
  }

  const rows = (data ?? []) as EmailConnectionOperationRow[];
  if (connectionId && rows.length === 0) {
    return { allowed: false, reason: "connection_not_found", status: 403 };
  }

  const hasCompanyMailbox = rows.some((row) => row.type === "company");
  const canManageCompany = hasCompanyMailbox
    ? await checkPermissionById(actor.userId, "settings.integrations", "all")
    : false;

  const identityAuthorized = rows.filter((row) =>
    row.type === "individual"
      ? row.user_id?.trim() === actor.userId
      : row.type === "company" && canManageCompany
  );
  if (connectionId && identityAuthorized.length === 0) {
    return { allowed: false, reason: "forbidden", status: 403 };
  }

  const authorized = requireUsable
    ? identityAuthorized.filter(isUsable)
    : identityAuthorized;
  if (connectionId && authorized.length === 0) {
    return {
      allowed: false,
      reason: "connection_unavailable",
      status: 403,
    };
  }
  if (!connectionId && authorized.length === 0) {
    return { allowed: false, reason: "forbidden", status: 403 };
  }

  return {
    allowed: true,
    actor,
    connections: authorized,
    connectionIds: authorized.map((connection) => connection.id),
  };
}

/** Resolve the actor strictly from the verified auth subject, then authorize. */
export async function resolveEmailConnectionOperationAccess({
  request,
  claimedCompanyId,
  ...input
}: ResolveOperationInput): Promise<EmailConnectionOperationDecision> {
  const actorResolution = await resolveEmailRouteActor(request, {
    claimedCompanyId,
  });
  if (!actorResolution.ok) {
    return {
      allowed: false,
      reason:
        actorResolution.response.status === 401 ? "unauthorized" : "forbidden",
      status: actorResolution.response.status === 401 ? 401 : 403,
    };
  }
  return authorizeEmailConnectionOperationForActor({
    ...input,
    actor: actorResolution.actor,
  });
}
