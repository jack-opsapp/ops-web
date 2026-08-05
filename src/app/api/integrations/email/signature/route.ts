import { NextRequest, NextResponse } from "next/server";

import { EmailConnectionService } from "@/lib/api/services/email-connection-service";
import { EmailService } from "@/lib/api/services/email-service";
import {
  EmailSignatureService,
  type EmailSignatureRecord,
} from "@/lib/api/services/email-signature-service";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import { filterAuthorizedEmailSignatureConnections } from "@/lib/email/email-signature-access";
import {
  resolveEmailRouteActor,
  type EmailRouteActor,
} from "@/lib/email/email-route-auth";
import {
  isEmailSignatureProviderMailboxBusyError,
  resolveEmailSignatureForMessage,
} from "@/lib/email/email-signature-runtime";
import {
  describeSignatureTemplate,
  renderSignatureTemplate,
} from "@/lib/email/signature-template";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { EmailConnection } from "@/lib/types/email-connection";
import type {
  EmailIdentityFields,
  EmailSignatureConnectionDescriptor,
  EmailSignatureLayout,
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

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function signatureLayout(value: unknown): EmailSignatureLayout {
  return value === "stacked" ? "stacked" : "logo-left";
}

/**
 * The operator's own particulars, for prefilling a signature they have not
 * written yet. Read from the authoritative rows rather than trusted from the
 * request — the same reason the draft prompt loads them (2026-08-02: a
 * forwarded email's signature became the sender's identity).
 */
async function loadIdentityDefaults(scope: SignatureScope): Promise<{
  companyLogoUrl: string | null;
  name: string;
  companyName: string;
  phone: string;
  website: string;
}> {
  const supabase = getServiceRoleClient();
  const [user, company] = await Promise.all([
    supabase
      .from("users")
      .select("first_name, last_name, phone")
      .eq("id", scope.userId)
      .maybeSingle(),
    supabase
      .from("companies")
      .select("name, phone, website, logo_url")
      .eq("id", scope.companyId)
      .maybeSingle(),
  ]);

  const userRow = (user.data ?? {}) as Record<string, unknown>;
  const companyRow = (company.data ?? {}) as Record<string, unknown>;

  return {
    companyLogoUrl: optionalText(companyRow.logo_url) || null,
    name: [optionalText(userRow.first_name), optionalText(userRow.last_name)]
      .filter(Boolean)
      .join(" "),
    companyName: optionalText(companyRow.name),
    // A customer calls the business, so the company line leads. The operator's
    // own number stands in when the company record has none.
    phone: optionalText(companyRow.phone) || optionalText(userRow.phone),
    website: optionalText(companyRow.website),
  };
}

function identityFields(input: {
  defaults: Awaited<ReturnType<typeof loadIdentityDefaults>>;
  saved: EmailSignatureRecord | undefined;
}): EmailIdentityFields {
  const { defaults, saved } = input;
  const described = saved
    ? describeSignatureTemplate({
        html: saved.contentHtml,
        text: saved.contentText,
        companyName: defaults.companyName,
      })
    : null;

  return {
    name: described?.name || defaults.name,
    title: described?.title ?? "",
    companyName: defaults.companyName,
    phone: described ? described.phone : defaults.phone,
    website: described ? described.website : defaults.website,
    includeLogo: described?.includeLogo ?? false,
    layout: described?.layout ?? "logo-left",
  };
}

function providerSource(
  source: EmailSignatureRecord["source"]
): "gmail" | "office_confirmed" {
  return source === "gmail_send_as" ? "gmail" : "office_confirmed";
}

function forbiddenConnectionResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function mailboxBusyResponse(): NextResponse {
  return NextResponse.json(
    { error: "Mailbox is busy. Try again in a few minutes." },
    { status: 409 }
  );
}

function signatureScope(actor: EmailRouteActor, connectionId: string) {
  return {
    companyId: actor.companyId,
    userId: actor.userId,
    connectionId,
  };
}

async function toConnectionDescriptor(
  actor: EmailRouteActor,
  connection: EmailConnection
): Promise<EmailSignatureConnectionDescriptor> {
  return {
    id: connection.id,
    mailbox: connection.email,
    provider: connection.provider,
    type: connection.type,
    // The gate's own answer, not an approximation of it — the post-connect
    // step and the settings list both need to know which mailbox is holding
    // outreach, and asking per mailbox afterwards would be a read per card.
    identityConfirmed: await EmailSignatureService.hasConfirmedIdentity({
      companyId: actor.companyId,
      connectionId: connection.id,
      userId: actor.userId,
    }),
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
  // Read the confirmation the way the outreach gate reads it — the newest OPS
  // row that actually carries the stamp, operator scope before mailbox scope.
  // Reporting the effective row's stamp instead would tell an operator their
  // outreach is held while it is in fact running on the mailbox signature.
  const confirmed =
    rows.find(
      (row) =>
        row.source === "ops" &&
        row.scopeUserId === scope.userId &&
        row.confirmedAt
    ) ??
    rows.find(
      (row) => row.source === "ops" && row.scopeUserId === null && row.confirmedAt
    );
  const defaults = await loadIdentityDefaults(scope);

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
    // Mirrors the outreach gate exactly: only an OPS-authored row in operator
    // or mailbox scope can carry the confirmation.
    confirmedAt: confirmed?.confirmedAt ?? null,
    outreachSubject: connection.outreachSubject?.trim() || null,
    companyLogoUrl: defaults.companyLogoUrl,
    fields: identityFields({ defaults, saved: ops }),
  };
}

/**
 * Renders the operator's structured fields into the one OPS template. The
 * logo is taken from the company record, never from the request, so no caller
 * can plant a remote image in an outbound signature.
 */
async function saveStructuredSignature(input: {
  scope: SignatureScope;
  fields: Record<string, unknown>;
  includeLogo: boolean;
  layout: EmailSignatureLayout;
}): Promise<{ error: string } | null> {
  const name = optionalText(input.fields.name);
  if (!name) return { error: "A name is required" };

  const defaults = await loadIdentityDefaults(input.scope);
  const rendered = renderSignatureTemplate({
    name,
    title: optionalText(input.fields.title),
    companyName:
      optionalText(input.fields.companyName) || defaults.companyName,
    phone: optionalText(input.fields.phone),
    website: optionalText(input.fields.website),
    logoUrl: input.includeLogo ? defaults.companyLogoUrl : null,
    layout: input.layout,
  });

  await EmailSignatureService.saveOps({
    companyId: input.scope.companyId,
    connectionId: input.scope.connectionId,
    scopeUserId: input.scope.userId,
    html: rendered.html,
    text: rendered.text,
    // Authoring it IS confirming it — there is no separate "I mean it" step.
    confirmedAt: new Date().toISOString(),
    actorUserId: input.scope.userId,
  });
  return null;
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
          connections: await Promise.all(
            allowed.map((connection) =>
              toConnectionDescriptor(actorResult.actor, connection)
            )
          ),
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
      if (isEmailSignatureProviderMailboxBusyError(error)) {
        return mailboxBusyResponse();
      }
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
  const fields =
    body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? (body.fields as Record<string, unknown>)
      : null;
  const hasLegacyText = typeof body?.opsText === "string";
  const hasSubject = typeof body?.outreachSubject === "string";
  if (!connectionId || (!fields && !hasLegacyText && !hasSubject)) {
    return NextResponse.json(
      { error: "connectionId and something to save are required" },
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
      const scope = signatureScope(actorResult.actor, connection.id);

      if (fields) {
        const failure = await saveStructuredSignature({
          scope,
          fields,
          includeLogo: body?.includeLogo === true,
          layout: signatureLayout(body?.layout),
        });
        if (failure) return NextResponse.json(failure, { status: 400 });
      } else if (hasLegacyText) {
        const opsText = body?.opsText as string;
        if (opsText.trim()) {
          await EmailSignatureService.saveOps({
            companyId: scope.companyId,
            connectionId: scope.connectionId,
            scopeUserId: scope.userId,
            text: opsText,
            confirmedAt: new Date().toISOString(),
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
      }

      if (hasSubject) {
        await EmailConnectionService.updateConnection(scope.connectionId, {
          outreachSubject: optionalText(body?.outreachSubject) || null,
        });
      }

      const saved = hasSubject
        ? ((await EmailService.getConnection(connectionId)) ?? connection)
        : connection;
      return NextResponse.json(
        await loadResponse(scope, saved, {
          refreshProviderIfMissing: true,
        })
      );
    } catch (error) {
      if (isEmailSignatureProviderMailboxBusyError(error)) {
        return mailboxBusyResponse();
      }
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
  const action = body?.action;
  if (
    !connectionId ||
    (action !== "import_provider" && action !== "confirm_imported")
  ) {
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
      const scope = signatureScope(actorResult.actor, connection.id);

      if (action === "confirm_imported") {
        const rows = await EmailSignatureService.listActive({
          companyId: scope.companyId,
          connectionId: scope.connectionId,
        });
        const mailboxAddress = connection.email.trim().toLowerCase();
        const imported = rows.find(
          (row) =>
            row.source !== "ops" &&
            row.providerIdentity?.trim().toLowerCase() === mailboxAddress
        );
        if (!imported) {
          return NextResponse.json(
            { error: "There is no imported signature to confirm" },
            { status: 409 }
          );
        }
        // Copy the content into operator scope rather than stamping the
        // provider row. Outreach only trusts an OPS-authored signature, so a
        // confirmed import has to become one to count.
        await EmailSignatureService.saveOps({
          companyId: scope.companyId,
          connectionId: scope.connectionId,
          scopeUserId: scope.userId,
          html: imported.contentHtml,
          text: imported.contentText,
          confirmedAt: new Date().toISOString(),
          actorUserId: scope.userId,
        });
        return NextResponse.json(
          await loadResponse(scope, connection, {
            refreshProviderIfMissing: false,
          })
        );
      }

      if (connection.provider !== "gmail") {
        return NextResponse.json(
          { error: "Provider signature import is unavailable" },
          { status: 409 }
        );
      }
      const locked = await runWithEmailConnectionSyncLock({
        connectionId: connection.id,
        context: "email-signature-provider-import",
        client: supabase,
        run: async (checkpoint) => {
          await checkpoint();
          const importResult = await EmailSignatureService.refreshProvider({
            companyId: scope.companyId,
            connectionId: scope.connectionId,
            scopeUserId: connection.type === "individual" ? scope.userId : null,
            mailboxAddress: connection.email,
            provider: EmailService.getProvider(connection),
            actorUserId: scope.userId,
            providerLockCheckpoint: checkpoint,
          });
          await checkpoint();
          return importResult;
        },
      });
      if (!locked.acquired) return mailboxBusyResponse();
      const importResult = locked.value;
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
      if (isEmailSignatureProviderMailboxBusyError(error)) {
        return mailboxBusyResponse();
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 }
      );
    }
  });
}
