/**
 * OPS Email — Campaign service.
 * Service-role only. Never import from client components.
 */
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { filterSuppressed } from "@/lib/email/suppressions";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CampaignStatus =
  | "draft" | "scheduled" | "in_flight"
  | "completed" | "failed" | "cancelled" | "paused";

export interface Campaign {
  id: string;
  name: string;
  slug: string;
  templateId: string;
  audienceFilter: Record<string, unknown>;
  audienceTemplateId: string | null;
  scheduledFor: string | null;
  sendStatus: CampaignStatus;
  recipientCountEstimate: number;
  recipientCountActual: number | null;
  sentCount: number;
  deliveredCount: number;
  bouncedCount: number;
  openedCount: number;
  clickedCount: number;
  suppressedSkippedCount: number;
  failedCount: number;
  pausedAt: string | null;
  pauseReason: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface Row {
  id: string; name: string; slug: string; template_id: string;
  audience_filter: Record<string, unknown> | null;
  audience_template_id: string | null;
  scheduled_for: string | null;
  send_status: CampaignStatus;
  recipient_count_estimate: number;
  recipient_count_actual: number | null;
  sent_count: number; delivered_count: number; bounced_count: number;
  opened_count: number; clicked_count: number;
  suppressed_skipped_count: number; failed_count: number;
  paused_at: string | null; pause_reason: string | null;
  created_by_user_id: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

function rowToCampaign(r: Row): Campaign {
  return {
    id: r.id, name: r.name, slug: r.slug, templateId: r.template_id,
    audienceFilter: r.audience_filter ?? {},
    audienceTemplateId: r.audience_template_id,
    scheduledFor: r.scheduled_for, sendStatus: r.send_status,
    recipientCountEstimate: r.recipient_count_estimate,
    recipientCountActual: r.recipient_count_actual,
    sentCount: r.sent_count, deliveredCount: r.delivered_count,
    bouncedCount: r.bounced_count, openedCount: r.opened_count,
    clickedCount: r.clicked_count,
    suppressedSkippedCount: r.suppressed_skipped_count,
    failedCount: r.failed_count, pausedAt: r.paused_at,
    pauseReason: r.pause_reason, createdByUserId: r.created_by_user_id,
    createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
  };
}

export async function createCampaign(input: {
  name: string; slug: string; templateId: string;
  audienceFilter?: Record<string, unknown>;
  audienceTemplateId?: string | null;
  createdByUserId?: string | null;
  recipientCountEstimate?: number;
  client?: SupabaseClient;
}): Promise<Campaign> {
  const db = input.client ?? getServiceRoleClient();
  const { data, error } = await db
    .from("email_campaigns")
    .insert({
      name: input.name, slug: input.slug, template_id: input.templateId,
      audience_filter: input.audienceFilter ?? {},
      audience_template_id: input.audienceTemplateId ?? null,
      created_by_user_id: input.createdByUserId ?? null,
      recipient_count_estimate: input.recipientCountEstimate ?? 0,
      send_status: "draft",
    })
    .select("*").single();
  if (error) throw new Error(`createCampaign: ${error.message}`);
  return rowToCampaign(data as Row);
}

export async function scheduleCampaign(
  campaignId: string, scheduledFor: Date, client?: SupabaseClient
): Promise<Campaign> {
  const db = client ?? getServiceRoleClient();
  const { data, error } = await db
    .from("email_campaigns")
    .update({ scheduled_for: scheduledFor.toISOString(), send_status: "scheduled" })
    .eq("id", campaignId).select("*").single();
  if (error) throw new Error(`scheduleCampaign: ${error.message}`);
  return rowToCampaign(data as Row);
}

export async function cancelCampaign(
  campaignId: string, client?: SupabaseClient
): Promise<Campaign> {
  const db = client ?? getServiceRoleClient();
  const { data, error } = await db
    .from("email_campaigns")
    .update({ send_status: "cancelled" })
    .in("send_status", ["draft","scheduled","in_flight","paused"])
    .eq("id", campaignId).select("*").single();
  if (error) throw new Error(`cancelCampaign: ${error.message}`);
  await db.from("email_jobs").update({ status: "cancelled" })
    .eq("campaign_id", campaignId).eq("status", "pending");
  return rowToCampaign(data as Row);
}

export async function pauseCampaign(
  campaignId: string, reason: string, client?: SupabaseClient
): Promise<Campaign> {
  const db = client ?? getServiceRoleClient();
  const { data, error } = await db
    .from("email_campaigns")
    .update({
      send_status: "paused",
      paused_at: new Date().toISOString(),
      pause_reason: reason,
    })
    .eq("id", campaignId).eq("send_status", "in_flight")
    .select("*").single();
  if (error) throw new Error(`pauseCampaign: ${error.message}`);
  return rowToCampaign(data as Row);
}

export async function resumeCampaign(
  campaignId: string, client?: SupabaseClient
): Promise<Campaign> {
  const db = client ?? getServiceRoleClient();
  const { data, error } = await db
    .from("email_campaigns")
    .update({ send_status: "in_flight", paused_at: null, pause_reason: null })
    .eq("id", campaignId).eq("send_status", "paused")
    .select("*").single();
  if (error) throw new Error(`resumeCampaign: ${error.message}`);
  return rowToCampaign(data as Row);
}

export async function enqueueCampaignJobs(input: {
  campaignId: string;
  recipients: Array<{ email: string; userId?: string | null; payload?: Record<string, unknown> }>;
  client?: SupabaseClient;
}): Promise<{ enqueued: number; suppressedSkipped: number }> {
  const db = input.client ?? getServiceRoleClient();
  const emails = input.recipients.map((r) => r.email.toLowerCase());
  const suppressedSet = await filterSuppressed(emails, "global", db);

  const rows = input.recipients
    .filter((r) => !suppressedSet.has(r.email.toLowerCase()))
    .map((r) => ({
      campaign_id: input.campaignId,
      recipient_email: r.email.toLowerCase(),
      recipient_user_id: r.userId ?? null,
      template_payload: r.payload ?? {},
      status: "pending" as const,
    }));

  const skippedCount = input.recipients.length - rows.length;

  if (rows.length > 0) {
    const { error } = await db.from("email_jobs").upsert(rows, {
      onConflict: "campaign_id,recipient_email",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`enqueueCampaignJobs: ${error.message}`);
  }

  // If audience yielded zero rows, jump straight to completed so the
  // campaign doesn't sit indefinitely in in_flight waiting for jobs that
  // never get enqueued.
  if (rows.length === 0) {
    await db.from("email_campaigns").update({
      recipient_count_actual: 0,
      suppressed_skipped_count: skippedCount,
      send_status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", input.campaignId);
  } else {
    await db.from("email_campaigns").update({
      recipient_count_actual: rows.length,
      suppressed_skipped_count: skippedCount,
      send_status: "in_flight",
    }).eq("id", input.campaignId);
  }

  return { enqueued: rows.length, suppressedSkipped: skippedCount };
}

export async function completeCampaignIfDone(
  campaignId: string, client?: SupabaseClient
): Promise<boolean> {
  const db = client ?? getServiceRoleClient();
  const { count: pendingCount, error: cErr } = await db
    .from("email_jobs")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["pending","dispatching"]);
  if (cErr) throw new Error(`completeCampaignIfDone: ${cErr.message}`);
  if ((pendingCount ?? 0) > 0) return false;

  const { data: c } = await db.from("email_campaigns")
    .select("send_status").eq("id", campaignId).single();
  if (c?.send_status === "completed" || c?.send_status === "cancelled") return false;

  const { error: uErr } = await db.from("email_campaigns")
    .update({ send_status: "completed", completed_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (uErr) throw new Error(`completeCampaignIfDone update: ${uErr.message}`);
  return true;
}

export async function getCampaignStats(
  campaignId: string, client?: SupabaseClient
): Promise<Campaign | null> {
  const db = client ?? getServiceRoleClient();
  const { data, error } = await db.from("email_campaigns")
    .select("*").eq("id", campaignId).maybeSingle();
  if (error) throw new Error(`getCampaignStats: ${error.message}`);
  return data ? rowToCampaign(data as Row) : null;
}

export async function listCampaigns(input: {
  status?: CampaignStatus | CampaignStatus[];
  limit?: number; offset?: number;
  includeVersions?: boolean;
  client?: SupabaseClient;
} = {}): Promise<{ rows: (Campaign & { templateVersionsSent?: string[] })[]; total: number }> {
  const db = input.client ?? getServiceRoleClient();
  let q = db.from("email_campaigns").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 50) - 1);
  if (input.status) {
    q = Array.isArray(input.status) ? q.in("send_status", input.status) : q.eq("send_status", input.status);
  }
  const { data, count, error } = await q;
  if (error) throw new Error(`listCampaigns: ${error.message}`);
  const rows = (data ?? []).map((r) => rowToCampaign(r as Row));

  if (!input.includeVersions || rows.length === 0) {
    return { rows, total: count ?? 0 };
  }

  const ids = rows.map((r) => r.id);
  const { data: jobRows, error: jobErr } = await db
    .from("email_jobs")
    .select("campaign_id, template_version")
    .in("campaign_id", ids)
    .not("template_version", "is", null);
  if (jobErr) throw new Error(`listCampaigns versions: ${jobErr.message}`);

  const versionsByCampaign = new Map<string, string[]>();
  for (const j of (jobRows ?? []) as Array<{ campaign_id: string; template_version: string }>) {
    const arr = versionsByCampaign.get(j.campaign_id) ?? [];
    if (!arr.includes(j.template_version)) arr.push(j.template_version);
    versionsByCampaign.set(j.campaign_id, arr);
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      templateVersionsSent: versionsByCampaign.get(r.id) ?? [],
    })),
    total: count ?? 0,
  };
}
