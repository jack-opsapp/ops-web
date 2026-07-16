import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailRouteActor } from "@/lib/email/email-route-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import type {
  ArchiveLeadPreference,
  ArchiveWritebackPreference,
} from "@/lib/types/email-thread";

type EmailArchivePreferenceAccessCode = "forbidden" | "not_found";

export class EmailArchivePreferenceAccessError extends Error {
  constructor(readonly code: EmailArchivePreferenceAccessCode) {
    super(code);
    this.name = "EmailArchivePreferenceAccessError";
  }
}

interface CanonicalConnectionRow {
  id: string;
  company_id: string;
  type: "company" | "individual";
  user_id: string | null;
  status: string;
}

interface SetPreferenceInput<TPreference extends string> {
  supabase: SupabaseClient;
  actor: EmailRouteActor;
  connectionId: string;
  preference: TPreference;
}

async function setCanonicalPreference<TPreference extends string>(
  input: SetPreferenceInput<TPreference>,
  column: "archive_lead_preference" | "archive_writeback_preference"
): Promise<void> {
  const actorUserId = input.actor.userId.trim();
  const actorCompanyId = input.actor.companyId.trim();
  const connectionId = input.connectionId.trim();
  if (!actorUserId || !actorCompanyId || !connectionId) {
    throw new EmailArchivePreferenceAccessError("not_found");
  }

  if (!(await checkPermissionById(actorUserId, "inbox.archive"))) {
    throw new EmailArchivePreferenceAccessError("forbidden");
  }

  const { data, error } = await input.supabase
    .from("email_connections")
    .select("id, company_id, type, user_id, status")
    .eq("id", connectionId)
    .eq("company_id", actorCompanyId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `archive preference mailbox lookup failed: ${error.message}`
    );
  }

  const connection = data as CanonicalConnectionRow | null;
  if (!connection) {
    throw new EmailArchivePreferenceAccessError("not_found");
  }

  if (connection.type === "individual") {
    if (connection.status !== "active" || connection.user_id !== actorUserId) {
      throw new EmailArchivePreferenceAccessError("not_found");
    }
  } else if (connection.type === "company") {
    if (
      !(await checkPermissionById(
        actorUserId,
        "settings.integrations",
        "all"
      ))
    ) {
      throw new EmailArchivePreferenceAccessError("forbidden");
    }
  } else {
    throw new EmailArchivePreferenceAccessError("not_found");
  }

  let update = input.supabase
    .from("email_connections")
    .update({ [column]: input.preference })
    .eq("id", connectionId)
    .eq("company_id", actorCompanyId)
    .eq("type", connection.type)
    .eq(
      "status",
      connection.type === "individual" ? "active" : connection.status
    );
  if (connection.type === "individual") {
    update = update.eq("user_id", actorUserId);
  }

  const { data: updated, error: updateError } = await update
    .select("id")
    .maybeSingle();
  if (updateError) {
    throw new Error(`archive preference update failed: ${updateError.message}`);
  }
  if (!updated) {
    // Ownership, type, company, or active state changed after the lookup.
    throw new EmailArchivePreferenceAccessError("not_found");
  }
}

export const EmailArchivePreferenceService = {
  setLeadArchivePreference(
    input: SetPreferenceInput<ArchiveLeadPreference>
  ): Promise<void> {
    return setCanonicalPreference(input, "archive_lead_preference");
  },

  setWritebackPreference(
    input: SetPreferenceInput<ArchiveWritebackPreference>
  ): Promise<void> {
    return setCanonicalPreference(input, "archive_writeback_preference");
  },
};
