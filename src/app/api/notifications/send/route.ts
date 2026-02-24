/**
 * POST /api/notifications/send
 *
 * Sends push notifications to specified users via OneSignal REST API.
 * The OneSignal REST API key is stored server-side (never exposed to clients).
 *
 * Auth: Firebase ID token in Authorization header
 * Body: { recipientUserIds: string[], title: string, body: string, data?: object }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";

const ONESIGNAL_APP_ID = "0fc0a8e0-9727-49b6-9e37-5d6d919d741f";
const ONESIGNAL_API_ENDPOINT = "https://onesignal.com/api/v1/notifications";

interface SendNotificationBody {
  recipientUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify Firebase auth
    const firebaseUser = await verifyAdminAuth(req);
    if (!firebaseUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { recipientUserIds, title, body, data } =
      (await req.json()) as SendNotificationBody;

    if (!recipientUserIds?.length || !title || !body) {
      return NextResponse.json(
        { error: "Missing required fields: recipientUserIds, title, body" },
        { status: 400 }
      );
    }

    const restApiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!restApiKey) {
      console.error("[api/notifications/send] ONESIGNAL_REST_API_KEY not configured");
      return NextResponse.json(
        { error: "Notification service not configured" },
        { status: 500 }
      );
    }

    // Build OneSignal payload
    const payload: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: body },
      include_aliases: { external_id: recipientUserIds },
      target_channel: "push",
    };

    if (data) {
      payload.data = data;
    }

    // Send via OneSignal REST API
    const osResponse = await fetch(ONESIGNAL_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const osResult = await osResponse.json();

    if (!osResponse.ok) {
      console.error("[api/notifications/send] OneSignal error:", osResult);
      return NextResponse.json(
        { error: "Failed to send notification", details: osResult },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      recipients: recipientUserIds.length,
      onesignalId: osResult.id,
    });
  } catch (error) {
    console.error("[api/notifications/send] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
