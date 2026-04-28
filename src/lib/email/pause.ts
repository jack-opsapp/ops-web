/**
 * Email Killswitch — Pause Service
 *
 * Single API surface for pause / resume across three scopes:
 *
 *   global                — hard stop, all email
 *   bucket:<name>         — pause one sender bucket (DISPATCH / GATE / FIELD_NOTES / PORTAL)
 *   campaign:<uuid>       — pause an individual campaign
 *
 * Reads NEVER throw — gatedSend reads on every call and a transient DB
 * failure must not crash a send. Writes throw on error so the admin route
 * surfaces the failure to the operator.
 */
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAdminEmails } from "@/lib/admin/admin-queries";

export type BucketName = "dispatch" | "gate" | "field_notes" | "portal";

export type PauseScope =
  | "global"
  | `bucket:${BucketName}`
  | `campaign:${string}`;

export interface PauseState {
  scope: PauseScope;
  isPaused: boolean;
  pauseReason: string | null;
  pausedUntil: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
}

const READ_FAIL_LOG_PREFIX = "[email-pause] read failure";

/**
 * Resolve which sender bucket an email kind routes to. Used by the
 * chokepoint to decide which `bucket:<name>` pause to consult.
 *
 * Keep in lockstep with src/lib/email/senders.ts. The default bucket is
 * DISPATCH so any unmapped kind still gets some pause coverage.
 */
export function resolveEmailBucket(kind: string): BucketName {
  switch (kind) {
    case "password_reset":
    case "email_verification":
    case "email_change_confirmation":
      return "gate";
    case "field_notes_newsletter":
    case "blog_newsletter":
      return "field_notes";
    case "portal_estimate_ready":
    case "portal_invoice_ready":
    case "portal_magic_link":
    case "portal_questions_reminder":
      return "portal";
    default:
      return "dispatch";
  }
}

function rowToState(r: {
  scope: string;
  is_paused: boolean;
  pause_reason: string | null;
  paused_until: string | null;
  paused_at: string | null;
  paused_by: string | null;
}): PauseState {
  return {
    scope: r.scope as PauseScope,
    isPaused: r.is_paused,
    pauseReason: r.pause_reason,
    pausedUntil: r.paused_until,
    pausedAt: r.paused_at,
    pausedBy: r.paused_by,
  };
}

/** Read every active pause row. Used by the banner. NEVER throws. */
export async function getActivePauses(): Promise<PauseState[]> {
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("email_pause_state")
      .select("scope, is_paused, pause_reason, paused_until, paused_at, paused_by")
      .eq("is_paused", true)
      .order("paused_at", { ascending: false });
    if (error) {
      console.error(READ_FAIL_LOG_PREFIX, error);
      return [];
    }
    return (data ?? []).map(rowToState);
  } catch (err) {
    console.error(READ_FAIL_LOG_PREFIX, err);
    return [];
  }
}

/** Read a single scope's pause state. NEVER throws. */
export async function getPauseState(scope: PauseScope): Promise<PauseState | null> {
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("email_pause_state")
      .select("scope, is_paused, pause_reason, paused_until, paused_at, paused_by")
      .eq("scope", scope)
      .maybeSingle();
    if (error) {
      console.error(READ_FAIL_LOG_PREFIX, error);
      return null;
    }
    if (!data) return null;
    return rowToState(data);
  } catch (err) {
    console.error(READ_FAIL_LOG_PREFIX, err);
    return null;
  }
}

/**
 * Resolve the FIRST active pause scope that applies to a given send.
 * Order: global → bucket → campaign. Returns null if no active pause.
 *
 * Used by gatedSend before the suppression check.
 *
 * NEVER throws — read failures fail open (no pause). Trade-off: if Supabase
 * is unreachable we'd rather send than block. Audit log records any send
 * during a misconfigured-state window.
 */
export async function getActivePauseScope(opts: {
  kind: string;
  campaignId?: string | null;
}): Promise<PauseState | null> {
  const bucket = resolveEmailBucket(opts.kind);
  const scopesToCheck: PauseScope[] = ["global", `bucket:${bucket}`];
  if (opts.campaignId) {
    scopesToCheck.push(`campaign:${opts.campaignId}` as PauseScope);
  }

  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("email_pause_state")
      .select("scope, is_paused, pause_reason, paused_until, paused_at, paused_by")
      .in("scope", scopesToCheck)
      .eq("is_paused", true);
    if (error) {
      console.error(READ_FAIL_LOG_PREFIX, error);
      return null;
    }
    if (!data || data.length === 0) return null;

    const now = Date.now();
    // Pick by resolution order: first matching scope in [global, bucket, campaign].
    // Skip rows whose paused_until is in the past — auto-resume cron will write
    // the audit row eventually but the send should not be blocked in the meantime.
    for (const s of scopesToCheck) {
      const row = data.find((r) => r.scope === s);
      if (!row) continue;
      if (row.paused_until && new Date(row.paused_until).getTime() < now) {
        continue;
      }
      return rowToState(row);
    }
    return null;
  } catch (err) {
    console.error(READ_FAIL_LOG_PREFIX, err);
    return null;
  }
}

export async function isPaused(opts: { kind: string; campaignId?: string | null }): Promise<boolean> {
  return (await getActivePauseScope(opts)) !== null;
}

interface PauseInput {
  scope: PauseScope;
  reason: string;
  pausedUntil?: string | null;
  actorUserId: string;
  actorEmail: string;
}

export async function pause(input: PauseInput): Promise<PauseState> {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new Error("Pause requires a reason (>= 3 chars)");
  }
  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("email_pause_state")
    .upsert(
      {
        scope: input.scope,
        is_paused: true,
        pause_reason: input.reason,
        paused_until: input.pausedUntil ?? null,
        paused_at: now,
        paused_by: input.actorUserId,
        resumed_at: null,
        resumed_by: null,
        updated_at: now,
      },
      { onConflict: "scope" }
    )
    .select("scope, is_paused, pause_reason, paused_until, paused_at, paused_by")
    .single();

  if (error) throw new Error(`Pause failed: ${error.message}`);

  await supabase.from("email_pause_audit_log").insert({
    scope: input.scope,
    action: "pause",
    reason: input.reason,
    paused_until: input.pausedUntil ?? null,
    actor_user_id: input.actorUserId,
    actor_email: input.actorEmail,
  });

  await fanoutPauseNotifications({
    scope: input.scope,
    reason: input.reason,
    actorEmail: input.actorEmail,
  });

  return rowToState(data);
}

interface ResumeInput {
  scope: PauseScope;
  reason?: string;
  actorUserId: string;
  actorEmail: string;
}

export async function resume(input: ResumeInput): Promise<void> {
  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("email_pause_state")
    .update({
      is_paused: false,
      resumed_at: now,
      resumed_by: input.actorUserId,
      updated_at: now,
    })
    .eq("scope", input.scope);
  if (error) throw new Error(`Resume failed: ${error.message}`);

  await supabase.from("email_pause_audit_log").insert({
    scope: input.scope,
    action: "resume",
    reason: input.reason ?? null,
    actor_user_id: input.actorUserId,
    actor_email: input.actorEmail,
  });

  await resolvePauseNotifications(input.scope);
}

/**
 * Mark a scope as auto-resumed when its `paused_until` has passed.
 * Called by the email-pause-auto-resume cron.
 */
export async function autoResume(scope: PauseScope): Promise<void> {
  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("email_pause_state")
    .update({ is_paused: false, resumed_at: now, updated_at: now })
    .eq("scope", scope)
    .eq("is_paused", true);
  if (error) throw new Error(`Auto-resume failed: ${error.message}`);

  await supabase.from("email_pause_audit_log").insert({
    scope,
    action: "auto_resume",
    reason: "paused_until elapsed",
  });

  await resolvePauseNotifications(scope);
}

export interface AuditLogRow {
  id: string;
  scope: string;
  action: "pause" | "resume" | "auto_resume";
  reason: string | null;
  paused_until: string | null;
  actor_email: string | null;
  created_at: string;
}

export async function listAuditLog(
  opts: { scope?: PauseScope; limit?: number; offset?: number } = {}
): Promise<AuditLogRow[]> {
  const supabase = getServiceRoleClient();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let q = supabase
    .from("email_pause_audit_log")
    .select("id, scope, action, reason, paused_until, actor_email, created_at")
    .order("created_at", { ascending: false });
  if (opts.scope) q = q.eq("scope", opts.scope);
  q = q.range(offset, offset + limit - 1);
  const { data, error } = await q;
  if (error) throw new Error(`Audit log read failed: ${error.message}`);
  return (data ?? []) as AuditLogRow[];
}

// ─── Rail notifications ────────────────────────────────────────────────────

const PAUSE_NOTIFICATION_TYPE = "email_pause";

/**
 * Insert a persistent rail notification for every admin when a pause is
 * applied. We resolve admin user rows by joining `admins.email` to
 * `users.email`. Admins without a matching `users` row are skipped silently
 * (notifications.user_id is NOT NULL).
 */
async function fanoutPauseNotifications(input: {
  scope: PauseScope;
  reason: string;
  actorEmail: string;
}): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const adminEmails = await getAdminEmails();
    if (adminEmails.length === 0) return;

    const { data: adminUsers, error: lookupErr } = await supabase
      .from("users")
      .select("id, company_id, email")
      .in("email", adminEmails);
    if (lookupErr) {
      console.error("[email-pause] admin user lookup failed:", lookupErr);
      return;
    }
    const recipients = (adminUsers ?? []).filter((u) => u.id && u.company_id);
    if (recipients.length === 0) return;

    const title = `Email paused: ${input.scope}`;
    const body = `Reason: ${input.reason}. Paused by ${input.actorEmail}.`;
    const rows = recipients.map((u) => ({
      user_id: u.id,
      company_id: u.company_id,
      type: PAUSE_NOTIFICATION_TYPE,
      title,
      body,
      is_read: false,
      persistent: true,
      action_url: "/admin/email?tab=killswitches",
      action_label: "MANAGE",
    }));
    const { error: insertErr } = await supabase.from("notifications").insert(rows);
    if (insertErr) {
      console.error("[email-pause] notification insert failed:", insertErr);
    }
  } catch (err) {
    // Notifications are best-effort — never throw out of a pause operation.
    console.error("[email-pause] fanout failed:", err);
  }
}

/**
 * Mark every persistent pause notification for a scope as read.
 * Called from resume() and autoResume().
 */
async function resolvePauseNotifications(scope: PauseScope): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const titleFragment = `Email paused: ${scope}`;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("type", PAUSE_NOTIFICATION_TYPE)
      .eq("title", titleFragment)
      .eq("is_read", false);
    if (error) {
      console.error("[email-pause] notification resolve failed:", error);
    }
  } catch (err) {
    console.error("[email-pause] resolve failed:", err);
  }
}
