import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import { isSafeInternalNotificationActionUrl } from "@/lib/notifications/notification-action-url";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export interface NotificationRouteActor {
  userId: string;
  companyId: string;
  name: string;
}

export type NotificationActorResolution =
  | { ok: true; actor: NotificationRouteActor }
  | { ok: false; status: 401 | 403 };

export interface TrustedNotificationInput {
  companyId: string;
  recipientUserIds: string[];
  type: string;
  title: string;
  body: string;
  persistent?: boolean;
  actionUrl?: string | null;
  actionLabel?: string | null;
  projectId?: string | null;
  deepLinkType?: string | null;
  dedupeKey: string;
  /** Reconcile the exact identity even after the notification is read/resolved. */
  durableDedupe?: boolean;
}

export interface NotificationPreferenceResult {
  inAppRecipientIds: string[];
  pushRecipientIds: string[];
  emailRecipientIds: string[];
}

export interface CreatedTrustedNotification {
  notificationId: string;
  recipientUserId: string;
}

interface TrustedNotificationIdentityRow {
  notification_id: string;
  created: boolean;
}

function parseTrustedNotificationIdentity(
  data: unknown
): TrustedNotificationIdentityRow | null {
  const raw = Array.isArray(data) ? data[0] : data;
  return raw &&
    typeof raw === "object" &&
    typeof (raw as Record<string, unknown>).notification_id === "string" &&
    typeof (raw as Record<string, unknown>).created === "boolean"
    ? (raw as TrustedNotificationIdentityRow)
    : null;
}

async function findDurableTrustedNotificationId(params: {
  db: SupabaseClient;
  userId: string;
  companyId: string;
  type: string;
  dedupeKey: string;
}): Promise<string | null> {
  const { data, error } = await params.db
    .from("notifications")
    .select("id")
    .eq("user_id", params.userId)
    .eq("company_id", params.companyId)
    .eq("type", params.type)
    .eq("dedupe_key", params.dedupeKey)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Durable notification lookup failed: ${error.message}`);
  }
  return typeof data?.id === "string" ? data.id : null;
}

/**
 * Resolve a cryptographically linked, active OPS user. Login email is never an
 * identity fallback for notification authority.
 */
export async function resolveNotificationRouteActor(
  request: NextRequest
): Promise<NotificationActorResolution> {
  const auth = await verifyAdminAuth(request);
  if (!auth?.uid) return { ok: false, status: 401 };

  const user = await findUserByAuth(
    auth.uid,
    undefined,
    "id, company_id, first_name, last_name, is_active"
  );
  const userId = typeof user?.id === "string" ? user.id : "";
  const companyId = typeof user?.company_id === "string" ? user.company_id : "";
  if (!userId || !companyId || user?.is_active !== true) {
    return { ok: false, status: 403 };
  }

  const firstName = typeof user.first_name === "string" ? user.first_name : "";
  const lastName = typeof user.last_name === "string" ? user.last_name : "";
  return {
    ok: true,
    actor: {
      userId,
      companyId,
      name: `${firstName} ${lastName}`.trim() || "A team member",
    },
  };
}

export async function filterActiveCompanyRecipients(params: {
  companyId: string;
  recipientUserIds: string[];
  excludeUserId?: string;
  db?: SupabaseClient;
}): Promise<string[]> {
  const uniqueIds = [...new Set(params.recipientUserIds)].filter(
    (id) => id && id !== params.excludeUserId
  );
  if (uniqueIds.length === 0) return [];

  const db = params.db ?? getServiceRoleClient();
  const { data, error } = await db
    .from("users")
    .select("id")
    .in("id", uniqueIds)
    .eq("company_id", params.companyId)
    .eq("is_active", true)
    .is("deleted_at", null);
  if (error) {
    throw new Error(
      `Active notification recipient lookup failed: ${error.message}`
    );
  }

  const allowed = new Set(
    (data ?? []).map((row) => (typeof row.id === "string" ? row.id : ""))
  );
  return uniqueIds.filter((id) => allowed.has(id));
}

/**
 * Trusted server creation seam. It still revalidates active same-company
 * recipients and internal navigation before invoking the service-only RPC.
 */
export async function createTrustedNotifications(
  input: TrustedNotificationInput,
  db: SupabaseClient = getServiceRoleClient()
): Promise<{
  attempted: number;
  errors: number;
  createdRecipientIds: string[];
  createdNotifications: CreatedTrustedNotification[];
}> {
  const notificationType = input.type.trim();
  const dedupeKey = input.dedupeKey.trim();
  if (!isSafeInternalNotificationActionUrl(input.actionUrl)) {
    throw new Error("Unsafe notification action URL");
  }
  if (!dedupeKey) {
    throw new Error("Notification dedupe key is required");
  }
  if (
    input.durableDedupe &&
    (notificationType !== "data_review_resolved" ||
      !dedupeKey.startsWith("data_review_resolution:v1:"))
  ) {
    throw new Error("Unsupported durable notification identity");
  }

  const recipients = await filterActiveCompanyRecipients({
    companyId: input.companyId,
    recipientUserIds: input.recipientUserIds,
    db,
  });
  if (recipients.length === 0) {
    return {
      attempted: 0,
      errors: 0,
      createdRecipientIds: [],
      createdNotifications: [],
    };
  }

  const reconciled = await Promise.all(
    recipients.map(async (userId) => {
      if (input.durableDedupe) {
        const notificationId = await findDurableTrustedNotificationId({
          db,
          userId,
          companyId: input.companyId,
          type: notificationType,
          dedupeKey,
        });
        if (notificationId) {
          return {
            userId,
            result: { data: null, error: null },
            row: { notification_id: notificationId, created: false },
          };
        }
      }

      const result = await db.rpc("create_notification_if_new_with_identity", {
        p_user_id: userId,
        p_company_id: input.companyId,
        p_type: notificationType,
        p_title: input.title,
        p_body: input.body,
        p_persistent: input.persistent ?? false,
        p_action_url: input.actionUrl ?? null,
        p_action_label: input.actionLabel ?? null,
        p_project_id: input.projectId ?? null,
        p_deep_link_type: input.deepLinkType ?? null,
        p_dedupe_key: dedupeKey,
      });
      const row = parseTrustedNotificationIdentity(result.data);

      // The durable partial unique index may win a race after the preflight,
      // including when the winner was immediately marked read. Re-read the
      // exact user/company/type/key without presentation-state filters.
      if (input.durableDedupe && (result.error || row === null)) {
        const notificationId = await findDurableTrustedNotificationId({
          db,
          userId,
          companyId: input.companyId,
          type: notificationType,
          dedupeKey,
        });
        if (notificationId) {
          return {
            userId,
            result: { data: null, error: null },
            row: { notification_id: notificationId, created: false },
          };
        }
      }

      return { userId, result, row };
    })
  );
  const errors = reconciled.filter(
    ({ result, row }) => result.error || row === null
  ).length;
  const createdNotifications = reconciled.flatMap(({ userId, result, row }) =>
    !result.error && row?.created
      ? [
          {
            notificationId: row.notification_id,
            recipientUserId: userId,
          },
        ]
      : []
  );
  const createdRecipientIds = createdNotifications.map(
    ({ recipientUserId }) => recipientUserId
  );
  if (errors > 0) {
    console.error(
      `[notifications] ${errors}/${recipients.length} trusted notification writes failed`
    );
  }
  return {
    attempted: recipients.length,
    errors,
    createdRecipientIds,
    createdNotifications,
  };
}

export async function resolveNotificationPreferences(params: {
  companyId: string;
  recipientUserIds: string[];
  preferenceKey: string;
  excludeUserId?: string;
  db?: SupabaseClient;
}): Promise<NotificationPreferenceResult> {
  const db = params.db ?? getServiceRoleClient();
  const recipients = await filterActiveCompanyRecipients({
    companyId: params.companyId,
    recipientUserIds: params.recipientUserIds,
    excludeUserId: params.excludeUserId,
    db,
  });
  if (recipients.length === 0) {
    return {
      inAppRecipientIds: [],
      pushRecipientIds: [],
      emailRecipientIds: [],
    };
  }

  const { data, error } = await db
    .from("notification_preferences")
    .select("user_id, push_enabled, email_enabled, channel_preferences")
    .in("user_id", recipients)
    .eq("company_id", params.companyId);
  if (error) {
    throw new Error(`Notification preference lookup failed: ${error.message}`);
  }

  const preferences = new Map<string, Record<string, unknown>>(
    (data ?? []).map((row) => [
      String(row.user_id),
      row as Record<string, unknown>,
    ])
  );
  const result: NotificationPreferenceResult = {
    inAppRecipientIds: [],
    pushRecipientIds: [],
    emailRecipientIds: [],
  };

  for (const recipientId of recipients) {
    const userPreferences = preferences.get(recipientId);
    const channelPreferences =
      userPreferences?.channel_preferences &&
      typeof userPreferences.channel_preferences === "object"
        ? (userPreferences.channel_preferences as Record<string, unknown>)
        : null;
    const eventPreference = channelPreferences?.[params.preferenceKey] as
      | { push?: boolean; email?: boolean }
      | undefined;
    const wantsPush = eventPreference?.push !== false;
    const wantsEmail = eventPreference?.email === true;

    // The rail is the durable in-app audit surface and has no separate opt-out.
    // Channel preferences govern external delivery only.
    result.inAppRecipientIds.push(recipientId);
    if (wantsPush && userPreferences?.push_enabled !== false) {
      result.pushRecipientIds.push(recipientId);
    }
    if (wantsEmail && userPreferences?.email_enabled !== false) {
      result.emailRecipientIds.push(recipientId);
    }
  }
  return result;
}

/** Server-only role-needed fan-out used directly by employee setup. */
export async function dispatchRoleNeededNotification(
  targetUserId: string,
  db: SupabaseClient = getServiceRoleClient()
): Promise<{ notified: number; pushed: number }> {
  const { data: target, error: targetError } = await db
    .from("users")
    .select("id, company_id, first_name, last_name, is_active")
    .eq("id", targetUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (
    targetError ||
    !target ||
    target.is_active !== true ||
    !target.company_id
  ) {
    return { notified: 0, pushed: 0 };
  }

  const companyId = String(target.company_id);
  const { data: permitted, error: permissionError } = await db.rpc(
    "users_with_permission",
    {
      p_company_id: companyId,
      p_permission: "team.assign_roles",
      p_required_scope: "all",
    }
  );
  if (permissionError) {
    console.error(
      "[role-needed] recipient resolution failed:",
      permissionError.message
    );
    return { notified: 0, pushed: 0 };
  }

  const recipientUserIds = await filterActiveCompanyRecipients({
    companyId,
    recipientUserIds: Array.isArray(permitted) ? permitted.map(String) : [],
    excludeUserId: targetUserId,
    db,
  });
  const firstName = String(target.first_name ?? "").trim();
  const fullName =
    `${firstName} ${String(target.last_name ?? "")}`.trim() || "A team member";
  const title = `${firstName || "A team member"} needs a role`;
  const body = `${fullName} joined without a role.`;

  const rail = await createTrustedNotifications(
    {
      companyId,
      recipientUserIds,
      type: "role_needed",
      title,
      body,
      persistent: true,
      actionUrl: "/settings?section=team",
      actionLabel: "ASSIGN ROLE",
      deepLinkType: "team",
      dedupeKey: `role-needed:${targetUserId}`,
    },
    db
  );

  const pushResult =
    rail.errors === 0 && rail.createdRecipientIds.length > 0
      ? await sendOneSignalPush({
          recipientUserIds: rail.createdRecipientIds,
          title,
          body: "Tap to assign their role.",
          data: {
            type: "role_needed",
            userId: targetUserId,
            companyId,
            deepLink: `ops://settings/team?user=${targetUserId}`,
          },
        })
      : null;

  return {
    notified: rail.createdRecipientIds.length,
    pushed: pushResult?.ok ? pushResult.recipients : 0,
  };
}
