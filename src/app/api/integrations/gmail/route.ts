/**
 * OPS Web - Gmail OAuth Initiation
 *
 * GET /api/integrations/gmail?companyId=...&userId=...&type=...
 * Builds Google OAuth URL and redirects to consent screen.
 *
 * Scope: `https://mail.google.com/` — full mailbox access. Required so the
 * sync pipeline can apply labels, create drafts, send replies, and manage
 * the "OPS Pipeline" label. Narrower scopes (`gmail.readonly`) break label
 * application, send, draft, and label creation with 403 Insufficient
 * Permission. The wizard warns the user about the permission scope.
 *
 * State: one-time opaque nonce. Tenant context is stored server-side only.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_GMAIL_SCOPE,
} from "@/lib/email/calendar-scope";
import {
  createEmailOAuthState,
  resolveEmailOAuthAlertConnection,
  resolveEmailOAuthCalendarConnection,
} from "@/lib/email/email-oauth-state";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAppUrl } from "@/lib/utils/app-url";
import { sanitizeReturnTo } from "@/lib/utils/oauth-return";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const userId = searchParams.get("userId");
  const typeParam = searchParams.get("type") || "company";
  // `source` lets the callback know whether to land the user back on the
  // standard /settings page (wizard flow) or on /reconnect-inbox/success
  // (alert-email flow). Defaults to wizard so existing in-app callers
  // are unaffected.
  const source = searchParams.get("source") === "alert" ? "alert" : "wizard";
  // `include_calendar=1` is the incremental-consent lane: same mailbox flow,
  // widened to calendar.events against one bound existing connection.
  const includeCalendar = searchParams.get("include_calendar") === "1";
  const connectionId = searchParams.get("connectionId");
  const expectedEmail = searchParams.get("expectedEmail");
  // Optional app-internal path to land on after the callback (e.g.
  // /pipeline). Only safe same-app paths are persisted with the opaque state.
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId is required" },
      { status: 400 }
    );
  }

  if (typeParam !== "company" && typeParam !== "individual") {
    return NextResponse.json(
      { error: 'type must be "company" or "individual"' },
      { status: 400 }
    );
  }
  const type = typeParam;

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      {
        error: "Gmail integration not configured. GOOGLE_CLIENT_ID is missing.",
      },
      { status: 500 }
    );
  }

  // Both company and individual connections require a userId. Phase C
  // memory/writing-profile extraction attributes artifacts to a real user —
  // without one, the entire knowledge-extraction pipeline silently skips.
  // Company connections attribute to whichever admin ran the wizard, matching
  // how other shared-resource features (estimates, invoices) track createdBy
  // while still being visible to the whole company.
  if (!userId) {
    return NextResponse.json(
      { error: "userId is required — wizard must pass the current user's id" },
      { status: 400 }
    );
  }

  const authError = await requireEmailCompanyAccess(
    request,
    companyId,
    "settings.integrations",
    userId
  );
  if (authError) return authError;

  const redirectUri = `${getAppUrl()}/api/integrations/gmail/callback`;
  const supabase = getServiceRoleClient();

  let alertBinding: {
    connectionId: string;
    expectedEmail: string;
  } | null = null;
  if (source === "alert") {
    if (!connectionId || !expectedEmail) {
      return NextResponse.json(
        { error: "Alert reconnect requires a connection and mailbox" },
        { status: 400 }
      );
    }
    try {
      alertBinding = await resolveEmailOAuthAlertConnection(supabase, {
        companyId,
        provider: "gmail",
        type,
        connectionId,
        expectedEmail,
      });
    } catch (bindingError) {
      console.error(
        "[Gmail OAuth] Failed to verify alert binding:",
        bindingError
      );
      return NextResponse.json(
        { error: "Failed to verify Gmail reconnect" },
        { status: 500 }
      );
    }
    if (!alertBinding) {
      return NextResponse.json(
        { error: "This Gmail reconnect link is no longer valid" },
        { status: 400 }
      );
    }
  }

  let calendarBinding: {
    connectionId: string;
    expectedEmail: string;
  } | null = null;
  if (includeCalendar) {
    // Alert reconnect links arrive from email and must stay exactly what
    // they claim to be; the calendar upgrade is its own in-app lane.
    if (source === "alert") {
      return NextResponse.json(
        { error: "Calendar consent cannot ride an alert reconnect" },
        { status: 400 }
      );
    }
    if (!connectionId) {
      return NextResponse.json(
        { error: "Calendar consent requires an existing Gmail connection" },
        { status: 400 }
      );
    }
    try {
      calendarBinding = await resolveEmailOAuthCalendarConnection(supabase, {
        companyId,
        provider: "gmail",
        type,
        connectionId,
      });
    } catch (bindingError) {
      console.error(
        "[Gmail OAuth] Failed to verify calendar binding:",
        bindingError
      );
      return NextResponse.json(
        { error: "Failed to verify calendar upgrade" },
        { status: 500 }
      );
    }
    if (!calendarBinding) {
      return NextResponse.json(
        { error: "This mailbox is not ready for calendar sync" },
        { status: 400 }
      );
    }
  }

  let state: string;
  try {
    state = await createEmailOAuthState(
      supabase,
      calendarBinding
        ? {
            provider: "gmail",
            companyId,
            userId,
            type,
            source: "calendar",
            connectionId: calendarBinding.connectionId,
            expectedEmail: calendarBinding.expectedEmail,
            returnTo,
          }
        : source === "alert"
          ? {
              provider: "gmail",
              companyId,
              userId,
              type,
              source,
              connectionId: alertBinding!.connectionId,
              expectedEmail: alertBinding!.expectedEmail,
              returnTo,
            }
          : {
              provider: "gmail",
              companyId,
              userId,
              type,
              source,
              returnTo,
            }
    );
  } catch (error) {
    console.error("[Gmail OAuth] Failed to create one-time state:", error);
    return NextResponse.json(
      { error: "Failed to initiate Gmail OAuth" },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    // Full mailbox access. Required for: label create/apply, draft create,
    // send email, thread modify. Explicitly granted by user on consent.
    // The calendar lane additionally requests event write access so booked
    // site visits can land on the mailbox's Google Calendar.
    scope: includeCalendar
      ? `${GOOGLE_GMAIL_SCOPE} ${GOOGLE_CALENDAR_EVENTS_SCOPE}`
      : GOOGLE_GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    // Re-consents union with previously granted scopes instead of narrowing
    // the stored refresh token to only what this round requested.
    include_granted_scopes: "true",
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
