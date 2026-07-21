/**
 * OPS Web - Gmail Labels API
 *
 * GET /api/integrations/gmail/labels?connectionId=...
 * Returns the user's Gmail labels for the filter builder.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";
import { getValidGmailToken } from "@/lib/api/services/gmail-token";
import { fetchGmailRead } from "@/lib/api/services/providers/gmail-read";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import type { SupabaseClient } from "@supabase/supabase-js";

const GMAIL_LABELS_DEADLINE_MS = 45_000;

interface ConnectionRow {
  id: string;
  company_id: string;
  provider: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

async function getLabels(request: NextRequest, supabase: SupabaseClient) {
  try {
    const connectionId = request.nextUrl.searchParams.get("connectionId");
    if (!connectionId) {
      return NextResponse.json(
        { error: "connectionId is required" },
        { status: 400 }
      );
    }

    const access = await resolveEmailConnectionOperationAccess({
      request,
      connectionId,
      requireUsable: true,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }
    if (access.connections[0]?.provider !== "gmail") {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    const { data: connRow, error: connError } = await supabase
      .from("email_connections")
      .select(
        "id, company_id, provider, access_token, refresh_token, expires_at"
      )
      .eq("id", connectionId)
      .eq("company_id", access.actor.companyId)
      .eq("provider", "gmail")
      .single();

    if (connError || !connRow) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
    const locked = await runWithEmailConnectionSyncLock({
      connectionId,
      context: "gmail-labels",
      client: supabase,
      run: async () => {
        const deadlineAt = Date.now() + GMAIL_LABELS_DEADLINE_MS;
        const token = await getValidGmailToken(connRow as ConnectionRow, {
          deadlineAt,
          context: "Gmail labels",
          client: supabase,
          requirePersistence: true,
        });

        const resp = await fetchGmailRead(
          "https://gmail.googleapis.com/gmail/v1/users/me/labels",
          { headers: { Authorization: `Bearer ${token}` } },
          { deadlineAt, context: "labels.list" }
        );

        if (!resp.ok) {
          return NextResponse.json(
            { error: `Gmail API error: ${resp.status}` },
            { status: 502 }
          );
        }

        const data = await resp.json();
        const labels: GmailLabel[] = (data.labels ?? [])
          .filter(
            (label: GmailLabel) =>
              label.type === "user" ||
              [
                "INBOX",
                "SENT",
                "IMPORTANT",
                "STARRED",
                "SPAM",
                "TRASH",
              ].includes(label.id)
          )
          .map((label: GmailLabel) => ({
            id: label.id,
            name: label.name,
            type: label.type,
          }))
          .sort((a: GmailLabel, b: GmailLabel) => {
            if (a.type === "system" && b.type !== "system") return -1;
            if (a.type !== "system" && b.type === "system") return 1;
            return a.name.localeCompare(b.name);
          });

        return NextResponse.json({ ok: true, labels });
      },
    });
    if (!locked.acquired) {
      return NextResponse.json(
        { error: "Mailbox is busy. Try again in a few minutes." },
        { status: 409 }
      );
    }
    return locked.value;
  } catch (err) {
    console.error("[gmail-labels]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, () => getLabels(request, supabase));
}
