import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailRouteActor } from "@/lib/email/email-route-auth";
import type { EmailConnection } from "@/lib/types/email-connection";

function isActiveSameCompanyConnection(
  actor: EmailRouteActor,
  connection: EmailConnection
): boolean {
  return (
    Boolean(connection.id) &&
    connection.companyId === actor.companyId &&
    connection.status === "active" &&
    (connection.type === "company" || connection.type === "individual")
  );
}

/**
 * Return only mailboxes whose signature the canonical OPS actor may manage.
 *
 * The service-only database preflight owns individual mailbox ownership,
 * integration administration, assigned/all pipeline scopes, granular revokes,
 * and the canonical pipeline-edit + inbox-send intersection. Company mailbox
 * `user_id` is deliberately never interpreted in TypeScript.
 */
export async function filterAuthorizedEmailSignatureConnections(input: {
  actor: EmailRouteActor;
  connections: EmailConnection[];
  supabase: SupabaseClient;
}): Promise<EmailConnection[]> {
  const candidates = input.connections.filter((connection) =>
    isActiveSameCompanyConnection(input.actor, connection)
  );
  const decisions = await Promise.all(
    candidates.map(async (connection) => {
      try {
        const { data, error } = await input.supabase.rpc(
          "authorize_email_signature_access_as_system",
          {
            p_actor_user_id: input.actor.userId,
            p_connection_id: connection.id,
          }
        );
        return !error && data === true ? connection : null;
      } catch {
        return null;
      }
    })
  );

  return decisions.filter(
    (connection): connection is EmailConnection => connection !== null
  );
}
