import { NextRequest, NextResponse } from "next/server";

import { EmailService } from "@/lib/api/services/email-service";
import {
  EmailSignatureService,
  type EmailSignatureRecord,
} from "@/lib/api/services/email-signature-service";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { EmailSignatureSettingsResponse } from "@/lib/types/email-signature";

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

function connectionMatchesScope(
  connection: EmailConnection | null,
  scope: SignatureScope
): connection is EmailConnection {
  return Boolean(
    connection &&
    connection.companyId === scope.companyId &&
    (connection.type !== "individual" || connection.userId === scope.userId)
  );
}

function forbiddenConnectionResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

async function authorize(
  request: NextRequest,
  scope: SignatureScope
): Promise<NextResponse | null> {
  return requireEmailCompanyAccess(
    request,
    scope.companyId,
    "settings.integrations",
    scope.userId
  );
}

export async function GET(request: NextRequest) {
  const scope = {
    companyId: requiredText(request.nextUrl.searchParams.get("companyId")),
    userId: requiredText(request.nextUrl.searchParams.get("userId")),
    connectionId: requiredText(
      request.nextUrl.searchParams.get("connectionId")
    ),
  };
  if (!scope.companyId || !scope.userId || !scope.connectionId) {
    return NextResponse.json(
      { error: "companyId, userId, and connectionId are required" },
      { status: 400 }
    );
  }

  const authError = await authorize(request, scope as SignatureScope);
  if (authError) return authError;

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  try {
    const connection = await EmailService.getConnection(scope.connectionId);
    if (!connectionMatchesScope(connection, scope as SignatureScope)) {
      return forbiddenConnectionResponse();
    }
    return NextResponse.json(
      await loadResponse(scope as SignatureScope, connection, {
        refreshProviderIfMissing: true,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    setSupabaseOverride(null);
  }
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const scope = {
    companyId: requiredText(body?.companyId),
    userId: requiredText(body?.userId),
    connectionId: requiredText(body?.connectionId),
  };
  if (
    !scope.companyId ||
    !scope.userId ||
    !scope.connectionId ||
    typeof body?.opsText !== "string"
  ) {
    return NextResponse.json(
      { error: "companyId, userId, connectionId, and opsText are required" },
      { status: 400 }
    );
  }

  const typedScope = scope as SignatureScope;
  const authError = await authorize(request, typedScope);
  if (authError) return authError;

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  try {
    const connection = await EmailService.getConnection(scope.connectionId);
    if (!connectionMatchesScope(connection, typedScope)) {
      return forbiddenConnectionResponse();
    }
    if (body.opsText.trim()) {
      await EmailSignatureService.saveOps({
        companyId: scope.companyId,
        connectionId: scope.connectionId,
        scopeUserId: scope.userId,
        text: body.opsText,
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
      await loadResponse(typedScope, connection, {
        refreshProviderIfMissing: true,
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const scope = {
    companyId: requiredText(body?.companyId),
    userId: requiredText(body?.userId),
    connectionId: requiredText(body?.connectionId),
  };
  if (
    !scope.companyId ||
    !scope.userId ||
    !scope.connectionId ||
    body?.action !== "import_provider"
  ) {
    return NextResponse.json(
      { error: "Invalid signature action" },
      { status: 400 }
    );
  }

  const typedScope = scope as SignatureScope;
  const authError = await authorize(request, typedScope);
  if (authError) return authError;

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  try {
    const connection = await EmailService.getConnection(scope.connectionId);
    if (!connectionMatchesScope(connection, typedScope)) {
      return forbiddenConnectionResponse();
    }
    if (connection.provider !== "gmail") {
      return NextResponse.json(
        { error: "Provider signature import is unavailable" },
        { status: 409 }
      );
    }
    await EmailSignatureService.refreshProvider({
      companyId: scope.companyId,
      connectionId: scope.connectionId,
      scopeUserId: scope.userId,
      mailboxAddress: connection.email,
      provider: EmailService.getProvider(connection),
      actorUserId: scope.userId,
    });
    return NextResponse.json(
      await loadResponse(typedScope, connection, {
        refreshProviderIfMissing: false,
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
