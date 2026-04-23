/**
 * OneSignal REST API wrapper for server-side push notification sends.
 * Server-side only. Failures are logged and swallowed — callers rely on
 * the web rail notification as the source of truth.
 */

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";

export interface SendOneSignalPushParams {
  playerIds: string[];
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export async function sendOneSignalPush(
  params: SendOneSignalPushParams
): Promise<void> {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    console.warn(
      "[onesignal] Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY — skipping push"
    );
    return;
  }

  if (params.playerIds.length === 0) {
    return;
  }

  try {
    const res = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_player_ids: params.playerIds,
        headings: { en: params.title },
        contents: { en: params.body },
        data: params.data,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[onesignal] push failed: ${res.status} ${errorText}`);
    }
  } catch (err) {
    console.error("[onesignal] push error:", err);
  }
}
