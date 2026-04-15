/**
 * OPS Web - OneSignal REST API helper
 *
 * Server-side helper for sending push notifications via the OneSignal REST API.
 * Used by both /api/notifications/send (Firebase-authed client requests) and
 * cron jobs that need to fire notifications without a user session.
 *
 * Requires ONESIGNAL_REST_API_KEY env var. Never import from client code.
 */

export const ONESIGNAL_APP_ID = "0fc0a8e0-9727-49b6-9e37-5d6d919d741f";

const ONESIGNAL_API_ENDPOINT = "https://onesignal.com/api/v1/notifications";

export interface SendPushParams {
  recipientUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  imageUrl?: string;
}

export type SendPushResult =
  | { ok: true; recipients: number; onesignalId?: string }
  | { ok: false; error: unknown; status?: number };

/**
 * Send a push notification to a list of user IDs via OneSignal.
 * User IDs must match the OneSignal `external_id` aliases registered by the
 * iOS and web clients (which use the Supabase user UUID).
 *
 * Fire-and-forget-safe: this function never throws. Always inspect `ok`.
 */
export async function sendOneSignalPush(
  params: SendPushParams
): Promise<SendPushResult> {
  if (params.recipientUserIds.length === 0) {
    return { ok: true, recipients: 0 };
  }

  const restApiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!restApiKey) {
    console.error("[onesignal] ONESIGNAL_REST_API_KEY not configured");
    return { ok: false, error: "Not configured" };
  }

  const payload: Record<string, unknown> = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: params.title },
    contents: { en: params.body },
    include_aliases: { external_id: params.recipientUserIds },
    target_channel: "push",
  };

  if (params.data) {
    payload.data = params.data;
  }

  if (params.imageUrl) {
    payload.ios_attachments = { photo: params.imageUrl };
    payload.big_picture = params.imageUrl;
  }

  try {
    const response = await fetch(ONESIGNAL_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json()) as {
      id?: string;
      recipients?: number;
      errors?: unknown;
    };

    if (!response.ok) {
      console.error("[onesignal] API error:", result);
      return { ok: false, error: result, status: response.status };
    }

    console.log(
      `[onesignal] Sent to ${result.recipients ?? 0} recipients — id: ${result.id ?? "(none)"}`
    );

    return {
      ok: true,
      recipients: result.recipients ?? 0,
      onesignalId: result.id,
    };
  } catch (err) {
    console.error("[onesignal] Fetch failed:", err);
    return { ok: false, error: err };
  }
}
