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
import { sendOneSignalPush } from "@/lib/integrations/onesignal";

interface SendNotificationBody {
  recipientUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  imageUrl?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const firebaseUser = await verifyAdminAuth(req);
    if (!firebaseUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { recipientUserIds, title, body, data, imageUrl } =
      (await req.json()) as SendNotificationBody;

    if (!recipientUserIds?.length || !title || !body) {
      return NextResponse.json(
        { error: "Missing required fields: recipientUserIds, title, body" },
        { status: 400 }
      );
    }

    const result = await sendOneSignalPush({
      recipientUserIds,
      title,
      body,
      data,
      imageUrl,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Failed to send notification", details: result.error },
        { status: result.status ?? 502 }
      );
    }

    return NextResponse.json({
      success: true,
      recipients: result.recipients,
      onesignalId: result.onesignalId,
    });
  } catch (error) {
    console.error("[api/notifications/send] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
