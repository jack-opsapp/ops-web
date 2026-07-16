import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createTrustedNotifications,
  type NotificationRouteActor,
} from "@/lib/notifications/server-notification-service";
import { checkPermissionById } from "@/lib/supabase/check-permission";

interface SetupPromptDefinition {
  title: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
  dedupeKey: string;
}

interface SetupPromptState {
  canManageIntegrations: boolean;
  canManageTeam: boolean;
  companySize: string | null;
  emailConnectionCount: number;
  activeTeamCount: number;
}

const CONNECT_EMAIL_PROMPT = {
  title: "Connect Gmail",
  body: "Automate your pipeline by connecting your inbox.",
  actionUrl: "/settings?tab=integrations",
  actionLabel: "Set up",
} as const;

const INVITE_TEAM_PROMPT = {
  title: "Invite your team",
  body: "Get your crew on OPS so everyone stays in sync.",
  actionUrl: "/settings?tab=team&action=invite",
  actionLabel: "Invite",
} as const;

async function loadSetupPromptState(params: {
  actor: NotificationRouteActor;
  db: SupabaseClient;
}): Promise<SetupPromptState> {
  const { actor, db } = params;
  const [
    canManageIntegrations,
    canManageTeam,
    companyResult,
    connectionsResult,
    teamResult,
  ] = await Promise.all([
    checkPermissionById(actor.userId, "settings.integrations", "all"),
    checkPermissionById(actor.userId, "team.manage", "all"),
    db
      .from("companies")
      .select("company_size")
      .eq("id", actor.companyId)
      .is("deleted_at", null)
      .maybeSingle(),
    db
      .from("email_connections")
      .select("id, type, user_id, status, sync_enabled")
      .eq("company_id", actor.companyId),
    db
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("company_id", actor.companyId)
      .eq("is_active", true)
      .is("deleted_at", null),
  ]);

  if (
    companyResult.error ||
    !companyResult.data ||
    connectionsResult.error ||
    teamResult.error ||
    typeof teamResult.count !== "number"
  ) {
    throw new Error("Failed to load setup prompt state");
  }

  const connections = Array.isArray(connectionsResult.data)
    ? connectionsResult.data
    : [];
  const emailConnectionCount = connections.filter((connection) => {
    if (!connection || typeof connection !== "object") return false;
    const row = connection as {
      type?: unknown;
      user_id?: unknown;
      status?: unknown;
      sync_enabled?: unknown;
    };
    if (
      row.sync_enabled !== true ||
      (row.status !== "active" && row.status !== "setup_incomplete")
    ) {
      return false;
    }
    if (row.type === "company") return true;
    return row.type === "individual" && row.user_id === actor.userId;
  }).length;

  return {
    canManageIntegrations,
    canManageTeam,
    companySize:
      typeof companyResult.data.company_size === "string"
        ? companyResult.data.company_size
        : null,
    emailConnectionCount,
    activeTeamCount: teamResult.count,
  };
}

async function createPrompt(params: {
  actor: NotificationRouteActor;
  db: SupabaseClient;
  prompt: SetupPromptDefinition;
}): Promise<number> {
  const result = await createTrustedNotifications(
    {
      companyId: params.actor.companyId,
      recipientUserIds: [params.actor.userId],
      type: "setup_prompt",
      title: params.prompt.title,
      body: params.prompt.body,
      actionUrl: params.prompt.actionUrl,
      actionLabel: params.prompt.actionLabel,
      dedupeKey: params.prompt.dedupeKey,
    },
    params.db
  );
  if (result.errors > 0) {
    throw new Error("Failed to create setup prompt");
  }
  return result.createdRecipientIds.length;
}

async function resolvePrompt(params: {
  actor: NotificationRouteActor;
  db: SupabaseClient;
  prompt: SetupPromptDefinition;
}): Promise<void> {
  const { error } = await params.db
    .from("notifications")
    .update({
      is_read: true,
      resolved_at: new Date().toISOString(),
    })
    .eq("company_id", params.actor.companyId)
    .eq("user_id", params.actor.userId)
    .eq("type", "setup_prompt")
    .eq("dedupe_key", params.prompt.dedupeKey)
    .eq("is_read", false)
    .is("resolved_at", null);
  if (error) throw new Error("Failed to resolve setup prompt");
}

export async function syncSetupPromptNotifications(params: {
  actor: NotificationRouteActor;
  db: SupabaseClient;
}): Promise<{ created: number; resolved: number }> {
  const state = await loadSetupPromptState(params);
  const companySize = state.companySize?.trim() ?? "";
  const needsConnectEmail =
    state.canManageIntegrations && state.emailConnectionCount === 0;
  const needsInviteTeam =
    state.canManageTeam &&
    companySize !== "" &&
    companySize !== "just-me" &&
    state.activeTeamCount <= 1;

  let created = 0;
  let resolved = 0;
  const prompts: Array<{
    needed: boolean;
    prompt: SetupPromptDefinition;
  }> = [
    {
      needed: needsConnectEmail,
      prompt: {
        ...CONNECT_EMAIL_PROMPT,
        dedupeKey: `setup-prompt:connect-email:${params.actor.userId}`,
      },
    },
    {
      needed: needsInviteTeam,
      prompt: {
        ...INVITE_TEAM_PROMPT,
        dedupeKey: `setup-prompt:invite-team:${params.actor.userId}`,
      },
    },
  ];

  for (const { needed, prompt } of prompts) {
    if (needed) {
      created += await createPrompt({ ...params, prompt });
    } else {
      await resolvePrompt({ ...params, prompt });
      resolved += 1;
    }
  }

  return { created, resolved };
}
