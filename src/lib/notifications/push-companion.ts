import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import { filterPushRecipientsByQuietHours } from "@/lib/notifications/server-notification-service";

/**
 * Proof-based companion pushes for rows iOS already wrote server-side.
 *
 * Background: `OneSignalService.sendViaOpsWeb` posted to
 * `/api/notifications/send`, which has been a 404 stub since 2026-07-16 when
 * the arbitrary-recipient/arbitrary-copy push proxy was retired. Every iOS
 * companion push has silently failed since — mentions, note and photo
 * fan-outs, expense decisions, overdue invoices, time off, role assignment,
 * inventory thresholds, team joins.
 *
 * This restores them WITHOUT restoring the hole. The caller supplies no copy
 * and no targeting: it names a notification type and the users whose rows it
 * just caused a narrow SECURITY DEFINER RPC to write. The server finds those
 * durable rail rows, and pushes each row's own server-rendered title and body.
 *
 * Threat model: the worst an authenticated same-company actor can do is
 * re-push an existing rail row that is at most 15 minutes old, to that row's
 * own recipient, with that row's own copy. No copy injection, no cross-company
 * reach, and idempotent per row (the notification id is the idempotency key).
 */

/** Rows older than this are not "the push that accompanies what just happened". */
const COMPANION_WINDOW_MS = 15 * 60_000;

/** Bound on how many recipients one companion call may name. */
const MAX_RECIPIENTS = 50;

/**
 * Notification type → `channel_preferences` key. Types absent from this map get
 * the global `push_enabled` check plus quiet hours only, which is exactly how
 * the rail treats them.
 */
const CHANNEL_KEY_BY_TYPE: Record<string, string> = {
  mention: "team_mentions",
  project_note: "project_updates",
  photo_comment: "team_mentions",
  photo_uploaded: "project_updates",
  expense_approved: "expense_approved",
  expense_rejected: "expense_approved",
  expense_paid: "expense_approved",
  invoice_overdue: "invoice_sent",
};

export interface PushCompanionRequest {
  notificationType: string;
  recipientUserIds: string[];
  dedupeKey?: string;
}

export type PushCompanionParse =
  | { ok: true; value: PushCompanionRequest }
  | { ok: false; reason: string };

export interface PushCompanionResult {
  matched: number;
  pushed: number;
  suppressed: number;
}

interface CompanionRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  deep_link_type: string | null;
  project_id: string | null;
  batch_id: string | null;
  note_id: string | null;
  action_url: string | null;
  created_at: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Opportunity id carried by a rail row's action url. Handles the query forms
 * the web notification builders stamp (`?opportunityId=` / `?leadId=` / `?id=`)
 * so the push payload can hand iOS a `leadId` the same way the rail does.
 */
export function opportunityIdFromActionUrl(
  actionUrl: string | null | undefined
): string | null {
  const raw = nonEmptyString(actionUrl);
  if (!raw) return null;
  // Rail action urls are app-internal paths; a base makes them parseable.
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://ops.internal");
  } catch {
    return null;
  }
  for (const key of ["opportunityId", "leadId", "id"]) {
    const value = nonEmptyString(parsed.searchParams.get(key));
    if (value) return value;
  }
  return null;
}

/** Validate the request body. Nothing here reaches copy or targeting. */
export function parsePushCompanionRequest(input: unknown): PushCompanionParse {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "Request body must be an object" };
  }
  const body = input as Record<string, unknown>;

  const notificationType = nonEmptyString(body.notificationType);
  if (!notificationType) {
    return { ok: false, reason: "notificationType is required" };
  }

  if (!Array.isArray(body.recipientUserIds)) {
    return { ok: false, reason: "recipientUserIds must be an array" };
  }
  const recipientUserIds = [
    ...new Set(
      body.recipientUserIds
        .map((id) => nonEmptyString(id))
        .filter((id): id is string => id !== null)
    ),
  ];
  if (recipientUserIds.length === 0) {
    return { ok: false, reason: "recipientUserIds must not be empty" };
  }

  const dedupeKey = nonEmptyString(body.dedupeKey);
  return {
    ok: true,
    value: dedupeKey
      ? { notificationType, recipientUserIds, dedupeKey }
      : { notificationType, recipientUserIds },
  };
}

/** Push payload derived from the durable row alone — never from the caller. */
function pushDataForRow(row: CompanionRow): Record<string, string> {
  // No `screen` key: iOS `routeByType` owns routing from `type`. This also
  // retires the broken `screen: "expenses"` payload the old client sent.
  const data: Record<string, string> = { type: row.type };
  if (row.deep_link_type) data.deep_link_type = row.deep_link_type;
  if (row.project_id) data.projectId = row.project_id;
  if (row.batch_id) data.batchId = row.batch_id;
  if (row.note_id) data.noteId = row.note_id;
  const opportunityId = opportunityIdFromActionUrl(row.action_url);
  if (opportunityId) data.leadId = opportunityId;
  return data;
}

/**
 * Find the rail rows the caller just caused, gate them on the recipient's
 * preferences and quiet hours, and push each row's own copy.
 */
export async function sendPushCompanions(params: {
  db: SupabaseClient;
  actor: { userId: string; companyId: string };
  request: PushCompanionRequest;
}): Promise<PushCompanionResult> {
  const { db, actor, request } = params;
  const sinceIso = new Date(Date.now() - COMPANION_WINDOW_MS).toISOString();

  // The actor's company scopes everything; the body's ids only hint at which
  // rows to look at. Filters stay on the filter builder so `.order` runs last.
  let query = db
    .from("notifications")
    .select(
      "id, user_id, type, title, body, deep_link_type, project_id, batch_id, note_id, action_url, created_at"
    )
    .eq("company_id", actor.companyId)
    .eq("type", request.notificationType)
    .in("user_id", request.recipientUserIds.slice(0, MAX_RECIPIENTS))
    .gte("created_at", sinceIso);
  if (request.dedupeKey) {
    query = query.eq("dedupe_key", request.dedupeKey);
  }
  const { data, error } = await query.order("created_at", {
    ascending: false,
  });
  if (error) {
    throw new Error(`Companion row lookup failed: ${error.message}`);
  }

  // Newest row per recipient; self-rows exist for receipts and must not push.
  const newestByUser = new Map<string, CompanionRow>();
  for (const raw of (data ?? []) as CompanionRow[]) {
    const userId = nonEmptyString(raw.user_id);
    if (!userId || userId === actor.userId) continue;
    if (!newestByUser.has(userId)) newestByUser.set(userId, raw);
  }
  const rows = [...newestByUser.values()];
  if (rows.length === 0) {
    return { matched: 0, pushed: 0, suppressed: 0 };
  }

  // Preference gate: global push_enabled, then the per-event channel key.
  const { data: preferenceData, error: preferenceError } = await db
    .from("notification_preferences")
    .select("user_id, push_enabled, channel_preferences")
    .in("user_id", [...newestByUser.keys()])
    .eq("company_id", actor.companyId);
  if (preferenceError) {
    throw new Error(
      `Companion preference lookup failed: ${preferenceError.message}`
    );
  }
  const preferences = new Map<string, Record<string, unknown>>(
    (preferenceData ?? []).map((row) => [
      String(row.user_id),
      row as Record<string, unknown>,
    ])
  );
  const channelKey = CHANNEL_KEY_BY_TYPE[request.notificationType];

  const wanted = rows.filter((row) => {
    const preference = preferences.get(row.user_id);
    if (preference?.push_enabled === false) return false;
    if (!channelKey) return true;
    const channels =
      preference?.channel_preferences &&
      typeof preference.channel_preferences === "object"
        ? (preference.channel_preferences as Record<string, unknown>)
        : null;
    const eventPreference = channels?.[channelKey] as
      | { push?: boolean }
      | undefined;
    return eventPreference?.push !== false;
  });

  // Quiet hours are the last gate, shared with every other push sender.
  const allowedUserIds = new Set(
    await filterPushRecipientsByQuietHours({
      companyId: actor.companyId,
      recipientUserIds: wanted.map((row) => row.user_id),
      db,
    })
  );
  const deliverable = wanted.filter((row) => allowedUserIds.has(row.user_id));

  let pushed = 0;
  for (const row of deliverable) {
    // One send per row: the copy and the idempotency key are the row's own.
    const result = await sendOneSignalPush({
      recipientUserIds: [row.user_id],
      title: row.title,
      body: row.body,
      data: pushDataForRow(row),
      idempotencyKey: row.id,
    });
    if (result.ok) {
      pushed += 1;
    } else {
      console.warn(
        `[push-companion] send failed notification=${row.id} type=${row.type}`
      );
    }
  }

  return {
    matched: rows.length,
    pushed,
    suppressed: rows.length - pushed,
  };
}
