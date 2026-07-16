import { NextRequest, NextResponse } from "next/server";

import { EmailService } from "@/lib/api/services/email-service";
import {
  EmailSignatureService,
  type EmailSignatureRecord,
} from "@/lib/api/services/email-signature-service";
import { filterAuthorizedEmailSignatureConnections } from "@/lib/email/email-signature-access";
import {
  resolveEmailRouteActor,
  type EmailRouteActor,
} from "@/lib/email/email-route-auth";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { EmailConnection } from "@/lib/types/email-connection";
import type {
  EmailSignatureConnectionDescriptor,
  EmailSignatureSettingsResponse,
} from "@/lib/types/email-signature";

interface SignatureScope {
  companyId: string;
  userId: string;
  connectionId: string;
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function providerSource(
  source: EmailSignatureRecord["source"]
): "gmail" | "office_confirmed" {
  return source === "gmail_send_as" ? "gmail" : "office_confirmed";
}

function forbiddenConnectionResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function signatureScope(actor: EmailRouteActor, connectionId: string) {
  return {
    companyId: actor.companyId,
    userId: actor.userId,
    connectionId,
  };
}

function toConnectionDescriptor(
  connection: EmailConnection
): EmailSignatureConnectionDescriptor {
  return {
    id: connection.id,
    mailbox: connection.email,
    provider: connection.provider,
    type: connection.type,
  };
}

async function authorizedConnections(input: {
  actor: EmailRouteActor;
  connections: EmailConnection[];
  supabase: ReturnType<typeof getServiceRoleClient>;
}) {
  return filterAuthorizedEmailSignatureConnections(input);
}

async function loadResponse(
  scope: SignatureScope,
  connection: EmailConnection,
  options: { refreshProviderIfMissing?: boolean } = {}
): Promise<EmailSignatureSettingsResponse> {
  const supabase = getServiceRoleClient();

  const effective = await resolveEmailSignatureForMessage({
    supabase,
    connection,
    userId: scope.userId,
    refreshProviderIfMissing: options.refreshProviderIfMissing,
  });
  const rows = await EmailSignatureService.listActive({
    companyId: scope.companyId,
    connectionId: scope.connectionId,
  });
  const ops =
    rows.find(
      (row) => row.source === "ops" && row.scopeUserId === scope.userId
    ) ?? rows.find((row) => row.source === "ops" && row.scopeUserId === null);
  const provider = rows.find(
    (row) =>
      row.source !== "ops" &&
      row.providerIdentity?.trim().toLowerCase() ===
        connection.email.trim().toLowerCase()
  );

  return {
    connectionId: connection.id,
    mailbox: connection.email,
    provider: connection.provider,
    effective: effective
      ? {
          source:
            effective.source === "ops"
              ? "ops"
              : providerSource(effective.source),
          html: effective.html,
          text: effective.text,
          hash: effective.hash,
        }
      : null,
    ops: ops ? { html: ops.contentHtml, text: ops.contentText } : null,
    providerSignature: provider
      ? {
          source: providerSource(provider.source),
          html: provider.contentHtml,
          text: provider.contentText,
          fetchedAt: provider.fetchedAt ?? provider.updatedAt,
        }
      : null,
    providerImportSupported: connection.provider === "gmail",
    missing: effective === null,
  };
}

export async function GET(request: NextRequest) {
  const claimedCompanyId = requiredText(
    request.nextUrl.searchParams.get("companyId")
  );
  const claimedUserId = requiredText(
    request.nextUrl.searchParams.get("userId")
  );
  const connectionId = requiredText(
    request.nextUrl.searchParams.get("connectionId")
  );
  const actorResult = await resolveEmailRouteActor(request, {
    claimedCompanyId: claimedCompanyId ?? undefined,
    claimedUserId: claimedUserId ?? undefined,
  });
  if (!actorResult.ok) return actorResult.response;

  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, async () => {
    try {
      if (!connectionId) {
        const connections = await EmailService.getConnections(
          actorResult.actor.companyId
        );
        const allowed = await authorizedConnections({
          actor: actorResult.actor,
          connections,
          supabase,
        });
        return NextResponse.json({
          connections: allowed.map(toConnectionDescriptor),
        });
      }

      const connection = await EmailService.getConnection(connectionId);
      const allowed = connection
        ? await authorizedConnections({
            actor: actorResult.actor,
            connections: [connection],
            supabase,
          })
        : [];
      if (allowed.length !== 1 || !connection) {
        return forbiddenConnectionResponse();
      }
      return NextResponse.json(
        await loadResponse(
          signatureScope(actorResult.actor, connection.id),
          connection,
          { refreshProviderIfMissing: true }
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const connectionId = requiredText(body?.connectionId);
  if (!connectionId || typeof body?.opsText !== "string") {
    return NextResponse.json(
      { error: "connectionId and opsText are required" },
      { status: 400 }
    );
  }
  const opsText = body.opsText;

  const actorResult = await resolveEmailRouteActor(request, {
    claimedCompanyId: requiredText(body?.companyId) ?? undefined,
    claimedUserId: requiredText(body?.userId) ?? undefined,
  });
  if (!actorResult.ok) return actorResult.response;

  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, async () => {
    try {
      const connection = await EmailService.getConnection(connectionId);
      const allowed = connection
        ? await authorizedConnections({
            actor: actorResult.actor,
            connections: [connection],
            supabase,
          })
        : [];
      if (allowed.length !== 1 || !connection) {
        return forbiddenConnectionResponse();
      }
      const scope = signatureScope(actorResult.actor, connection.id);
      if (opsText.trim()) {
        await EmailSignatureService.saveOps({
          companyId: scope.companyId,
          connectionId: scope.connectionId,
          scopeUserId: scope.userId,
          text: opsText,
          actorUserId: scope.userId,
        });
      } else {
        await EmailSignatureService.deactivate({
          companyId: scope.companyId,
          connectionId: scope.connectionId,
          source: "ops",
          scopeUserId: scope.userId,
          actorUserId: scope.userId,
        });
      }
      return NextResponse.json(
        await loadResponse(scope, connection, {
          refreshProviderIfMissing: true,
        })
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const connectionId = requiredText(body?.connectionId);
  if (!connectionId || body?.action !== "import_provider") {
    return NextResponse.json(
      { error: "Invalid signature action" },
      { status: 400 }
    );
  }

  const actorResult = await resolveEmailRouteActor(request, {
    claimedCompanyId: requiredText(body?.companyId) ?? undefined,
    claimedUserId: requiredText(body?.userId) ?? undefined,
  });
  if (!actorResult.ok) return actorResult.response;

  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, async () => {
    try {
      const connection = await EmailService.getConnection(connectionId);
      const allowed = connection
        ? await authorizedConnections({
            actor: actorResult.actor,
            connections: [connection],
            supabase,
          })
        : [];
      if (allowed.length !== 1 || !connection) {
        return forbiddenConnectionResponse();
      }
      if (connection.provider !== "gmail") {
        return NextResponse.json(
          { error: "Provider signature import is unavailable" },
          { status: 409 }
        );
      }
      const scope = signatureScope(actorResult.actor, connection.id);
      const importResult = await EmailSignatureService.refreshProvider({
        companyId: scope.companyId,
        connectionId: scope.connectionId,
        scopeUserId: connection.type === "individual" ? scope.userId : null,
        mailboxAddress: connection.email,
        provider: EmailService.getProvider(connection),
        actorUserId: scope.userId,
      });
      if (importResult.status === "not_configured") {
        const response = await loadResponse(scope, connection, {
          refreshProviderIfMissing: false,
        });
        return NextResponse.json({
          ...response,
          providerImportStatus: "not_configured",
        });
      }
      if (importResult.status === "unsupported") {
        return NextResponse.json(
          { error: "Gmail signature import is unavailable for this inbox" },
          { status: 409 }
        );
      }
      if (importResult.status === "stale") {
        return NextResponse.json(
          { error: "Gmail signature could not be read. Try again" },
          { status: 502 }
        );
      }
      const response = await loadResponse(scope, connection, {
        refreshProviderIfMissing: false,
      });
      return NextResponse.json({
        ...response,
        providerImportStatus: "refreshed",
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 }
      );
    }
  });
}
