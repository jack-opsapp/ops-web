/**
 * OPS Web - Inbox Archive Lead Preference
 *
 * POST /api/inbox/lead-archive-preference
 *   body: { connectionId: string, preference: ArchiveLeadPreference }
 *
 * Sets email_connections.archive_lead_preference. Called by the UI after the
 * user picks 'archive' or 'leave' on the first opp-linked archive that had no
 * sibling threads. Subsequent same-shape archives skip the modal.
 *
 * Auth: canonical OPS actor. Requires inbox.archive plus settings.integrations
 * for company mailboxes; personal mailboxes are active-owner only.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  EmailArchivePreferenceAccessError,
  EmailArchivePreferenceService,
} from "@/lib/api/services/email-archive-preference-service";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import type { ArchiveLeadPreference } from "@/lib/types/email-thread";

const VALID_PREFERENCES: ArchiveLeadPreference[] = ["ask", "archive", "leave"];

export async function POST(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;

  const body = (await request.json()) as {
    connectionId?: string;
    preference?: ArchiveLeadPreference;
  };

  if (!body.connectionId || !body.preference) {
    return NextResponse.json(
      { error: "connectionId and preference required" },
      { status: 400 }
    );
  }

  if (!VALID_PREFERENCES.includes(body.preference)) {
    return NextResponse.json(
      { error: `preference must be one of: ${VALID_PREFERENCES.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  try {
    await runWithSupabase(supabase, () =>
      EmailArchivePreferenceService.setLeadArchivePreference({
        supabase,
        actor,
        connectionId: body.connectionId!,
        preference: body.preference!,
      })
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EmailArchivePreferenceAccessError) {
      return err.code === "not_found"
        ? NextResponse.json({ error: "Connection not found" }, { status: 404 })
        : NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[/api/inbox/lead-archive-preference] failed:", err);
    return NextResponse.json(
      { error: `Failed to set preference: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
