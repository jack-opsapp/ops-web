// src/lib/api/services/sync-engine.ts
// Core sync cycle — runs on every sync trigger (cron, manual, webhook).
// Implements the 12-step flow from spec Section 4C.

import { requireSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "./email-service";
import { EmailMatchingServiceV2 } from "./email-matching-service-v2";
import { EmailFilterService } from "./email-filter-service";
import { StageEvaluator } from "./stage-evaluator";
import { AISyncReviewer } from "./ai-sync-reviewer";
import { MemoryService } from "./memory-service";
import { WritingProfileService } from "./writing-profile-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { matchPlatform, isFormSubmissionSubject } from "./known-platforms";
import { AutoSendService } from "./auto-send-service";
import { AIDraftService } from "./ai-draft-service";
import { AutonomyMilestoneService } from "./autonomy-milestone-service";
import { maybeSuggestProject } from "./project-suggestion-service";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";
import {
  PIPELINE_STAGES_DEFAULT,
  type GmailSyncFilters,
} from "@/lib/types/pipeline";
import {
  ProviderAuthError,
  ProviderScopeError,
  SyncTokenExpiredError,
  type NormalizedEmail,
  type SyncResult,
} from "./email-provider";

export interface SyncCycleResult {
  activitiesCreated: number;
  matched: number;
  needsReview: number;
  newLeads: number;
  stageChanges: number;
  labelsApplied: number;
  errors: string[];
}

// ─── Module-level helpers ───────────────────────────────────────────────────

function matchesPattern(email: NormalizedEmail, profile: SyncProfile): boolean {
  const normalized = email.subject
    .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
    .trim()
    .toLowerCase();
  return (profile.estimateSubjectPatterns || []).some((p) =>
    normalized.includes(p.toLowerCase())
  );
}

function extractSenderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).toLowerCase().trim();
}

/**
 * Resolve the per-company `auto_follow_up_days` for a given stage.
 *
 * Reads pipeline_stage_configs (per-company override) first, falling back
 * to PIPELINE_STAGES_DEFAULT and finally to 5 so terminal stages
 * (won/lost/discarded) never trigger auto-follow-ups. Cached per sync
 * cycle via a caller-supplied Map to avoid an N+1 lookup per email.
 */
async function resolveAutoFollowUpDays(
  companyId: string,
  stageSlug: string,
  cache: Map<string, number>
): Promise<number> {
  const cacheKey = `${companyId}:${stageSlug}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const supabase = requireSupabase();
  const { data } = await supabase
    .from("pipeline_stage_configs")
    .select("auto_follow_up_days")
    .eq("company_id", companyId)
    .eq("slug", stageSlug)
    .is("deleted_at", null)
    .maybeSingle();

  if (data?.auto_follow_up_days != null) {
    const value = Number(data.auto_follow_up_days);
    cache.set(cacheKey, value);
    return value;
  }

  const defaultConfig = PIPELINE_STAGES_DEFAULT.find((s) => s.slug === stageSlug);
  // null on terminal stages (won/lost/discarded) — return a large value so
  // StageEvaluator treats it as "never stale," not "stale in 0 days."
  const resolved = defaultConfig?.autoFollowUpDays ?? 365;
  cache.set(cacheKey, resolved);
  return resolved;
}

function emptyResult(): SyncCycleResult {
  return {
    activitiesCreated: 0,
    matched: 0,
    needsReview: 0,
    newLeads: 0,
    stageChanges: 0,
    labelsApplied: 0,
    errors: [],
  };
}

async function createClient(
  email: NormalizedEmail,
  companyId: string
): Promise<string> {
  const supabase = requireSupabase();
  const senderEmail = extractSenderEmail(email.from);

  // Check for existing client first to avoid duplicates
  const { data: existingClients } = await supabase
    .from("clients")
    .select("id")
    .eq("company_id", companyId)
    .ilike("email", senderEmail)
    .is("deleted_at", null)
    .limit(1);

  if (existingClients && existingClients.length > 0) {
    return existingClients[0].id;
  }

  const { data } = await supabase
    .from("clients")
    .insert({
      company_id: companyId,
      name: email.fromName || senderEmail.split("@")[0],
      email: senderEmail,
    })
    .select("id")
    .single();
  return data!.id;
}

async function createSubClient(
  email: NormalizedEmail,
  clientId: string,
  companyId: string
): Promise<void> {
  const supabase = requireSupabase();
  const senderEmail = extractSenderEmail(email.from);

  // Check for existing sub-client to avoid duplicates
  const { data: existingSub } = await supabase
    .from("sub_clients")
    .select("id")
    .eq("client_id", clientId)
    .ilike("email", senderEmail)
    .is("deleted_at", null)
    .limit(1);

  if (existingSub && existingSub.length > 0) return;

  await supabase.from("sub_clients").insert({
    company_id: companyId,
    client_id: clientId,
    name: email.fromName || senderEmail.split("@")[0],
    email: senderEmail,
  });
}

async function createOpportunity(
  email: NormalizedEmail,
  clientId: string,
  companyId: string,
  stage: string
): Promise<string> {
  const supabase = requireSupabase();
  const isOutbound = stage === "qualifying"; // sent folder leads start at qualifying
  const { data } = await supabase
    .from("opportunities")
    .insert({
      company_id: companyId,
      client_id: clientId,
      title: `${email.fromName || "New Lead"} — Email Inquiry`,
      stage,
      source: "email",
      correspondence_count: 1,
      outbound_count: isOutbound ? 1 : 0,
      inbound_count: isOutbound ? 0 : 1,
      last_inbound_at: isOutbound ? null : email.date.toISOString(),
      last_outbound_at: isOutbound ? email.date.toISOString() : null,
      last_message_direction: isOutbound ? "out" : "in",
      tags: ["email-import"],
    })
    .select("id")
    .single();
  return data!.id;
}

async function getOrCreateOpportunity(
  clientId: string,
  companyId: string,
  email: NormalizedEmail
): Promise<string> {
  const supabase = requireSupabase();

  const { data: existing } = await supabase
    .from("opportunities")
    .select("id")
    .eq("client_id", clientId)
    .eq("company_id", companyId)
    .not("stage", "in", '("won","lost")')
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id;

  return createOpportunity(email, clientId, companyId, "new_lead");
}

async function linkThread(
  opportunityId: string,
  threadId: string,
  connectionId: string
): Promise<void> {
  const supabase = requireSupabase();
  await supabase.from("opportunity_email_threads").upsert(
    {
      opportunity_id: opportunityId,
      thread_id: threadId,
      connection_id: connectionId,
    },
    { onConflict: "thread_id,connection_id" }
  );
}

async function createActivity(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string | null,
  direction: "inbound" | "outbound",
  extra?: {
    matchNeedsReview?: boolean;
    suggestedClientId?: string | null;
    matchConfidence?: string;
  }
): Promise<void> {
  const supabase = requireSupabase();
  await supabase.from("activities").insert({
    company_id: connection.companyId,
    type: "email",
    subject: email.subject,
    content: email.snippet,
    body_text: email.bodyText || null,
    email_message_id: email.id,
    email_thread_id: email.threadId,
    opportunity_id: opportunityId,
    direction,
    from_email: extractSenderEmail(email.from),
    to_emails: email.to.map(extractSenderEmail),
    cc_emails: email.cc.map(extractSenderEmail),
    has_attachments: email.hasAttachments,
    attachment_count: email.hasAttachments ? 1 : 0, // provider doesn't give exact count yet
    match_needs_review: extra?.matchNeedsReview || false,
    suggested_client_id: extra?.suggestedClientId || null,
    match_confidence: extra?.matchConfidence || "pattern",
    is_read: !extra?.matchNeedsReview,
  });
}

async function updateCorrespondenceCounts(
  opportunityId: string,
  direction: "inbound" | "outbound",
  date: Date,
  companyId: string,
  followUpDaysCache: Map<string, number>,
  result: SyncCycleResult
): Promise<void> {
  const supabase = requireSupabase();

  // Atomic increment via RPC so two concurrent syncs can't both read
  // count=5, both write count=6 (instead of 7). The function also
  // clears stage_manually_set on inbound (situation evolved, AI may
  // re-evaluate) and only advances last_inbound_at / last_outbound_at
  // if the new date is strictly newer.
  const { data: updated, error: rpcError } = await supabase.rpc(
    "increment_opportunity_correspondence",
    {
      p_opportunity_id: opportunityId,
      p_is_inbound: direction === "inbound",
      p_email_date: date.toISOString(),
    }
  );

  if (rpcError || !updated) {
    console.error(
      `[sync-engine] Atomic count increment failed for ${opportunityId}:`,
      rpcError
    );
    return;
  }

  // RPC returns a single-row table — Supabase shapes that as an array.
  const row = Array.isArray(updated) ? updated[0] : updated;
  if (!row) return;

  const newCorrespondenceCount = Number(row.correspondence_count ?? 0);
  const newInboundCount = Number(row.inbound_count ?? 0);
  const newOutboundCount = Number(row.outbound_count ?? 0);
  const currentStage = row.stage as string;
  const stageManuallySet = Boolean(row.stage_manually_set);
  const lastInboundAt = row.last_inbound_at
    ? new Date(row.last_inbound_at as string)
    : null;
  const lastOutboundAt = row.last_outbound_at
    ? new Date(row.last_outbound_at as string)
    : null;

  // Evaluate stage — respect manual overrides.
  if (!stageManuallySet) {
    const autoFollowUpDays = await resolveAutoFollowUpDays(
      companyId,
      currentStage,
      followUpDaysCache
    );
    const evaluation = StageEvaluator.evaluate({
      outboundCount: newOutboundCount,
      inboundCount: newInboundCount,
      totalMessages: newCorrespondenceCount,
      lastMessageDirection: direction === "inbound" ? "in" : "out",
      lastInboundAt,
      lastOutboundAt,
      currentStage,
      autoFollowUpDays,
    });

    if (evaluation.changed) {
      await supabase
        .from("opportunities")
        .update({
          stage: evaluation.stage,
          stage_entered_at: new Date().toISOString(),
        })
        .eq("id", opportunityId);
      result.stageChanges++;
    }
  }
}

async function applyLabel(
  threadId: string,
  connection: EmailConnection,
  result: SyncCycleResult
): Promise<void> {
  if (!connection.opsLabelId) return;
  try {
    const provider = EmailService.getProvider(connection);
    await provider.applyLabel(threadId, connection.opsLabelId);
    result.labelsApplied++;
  } catch (err) {
    console.error(
      `[sync-engine] Failed to apply label to thread ${threadId}:`,
      err
    );
  }
}

async function createTerminalFlagNotification(
  stageResult: { threadId: string; terminalFlag: string | null },
  connection: EmailConnection
): Promise<void> {
  if (!stageResult.terminalFlag || !connection.userId) return;

  const supabase = requireSupabase();

  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", stageResult.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (!threadLink || threadLink.length === 0) return;

  const oppId = threadLink[0].opportunity_id;
  const { data: opp } = await supabase
    .from("opportunities")
    .select("title, client_id")
    .eq("id", oppId)
    .single();

  let clientName = "A client";
  if (opp?.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("name")
      .eq("id", opp.client_id as string)
      .single();
    if (client?.name) clientName = client.name as string;
  }

  const action =
    stageResult.terminalFlag === "likely_won"
      ? "accepted your estimate"
      : "declined";

  await supabase.from("notifications").insert({
    user_id: connection.userId,
    company_id: connection.companyId,
    type: "role_needed",
    title:
      stageResult.terminalFlag === "likely_won"
        ? "Possible deal won"
        : "Possible deal lost",
    body: `${clientName} may have ${action}. Review and confirm.`,
    is_read: false,
    persistent: true,
    action_url: "/pipeline",
    action_label:
      stageResult.terminalFlag === "likely_won" ? "Mark as Won" : "Review",
  });
}

async function createSyncNotification(
  connection: EmailConnection,
  result: SyncCycleResult
): Promise<void> {
  const userId = connection.userId;
  if (!userId) return;

  const parts: string[] = [];
  if (result.newLeads > 0)
    parts.push(
      `${result.newLeads} new lead${result.newLeads > 1 ? "s" : ""}`
    );
  if (result.matched > 0)
    parts.push(
      `${result.matched} email${result.matched > 1 ? "s" : ""} matched`
    );
  if (result.needsReview > 0)
    parts.push(
      `${result.needsReview} need${result.needsReview > 1 ? "" : "s"} review`
    );

  if (parts.length === 0) return;

  const supabase = requireSupabase();
  await supabase.from("notifications").insert({
    user_id: userId,
    company_id: connection.companyId,
    type: "mention",
    title: "Email sync complete",
    body: parts.join(" · "),
    is_read: false,
    persistent: false,
    action_url: "/pipeline",
    action_label: "View Pipeline",
  });
}

/**
 * Mark a connection as needing reconnect. Used when the provider throws
 * ProviderAuthError (refresh token revoked) or ProviderScopeError (grant
 * lacks required permissions). The cron filters on status='active' so this
 * effectively parks the connection until the user re-authorizes. Also fires
 * a persistent notification so the user sees the call-to-action.
 */
async function markConnectionNeedsReconnect(
  connectionId: string,
  reason: string
): Promise<void> {
  try {
    await EmailService.updateConnection(connectionId, {
      status: "needs_reconnect",
    });
  } catch (err) {
    console.error(
      `[sync-engine] Failed to mark ${connectionId} needs_reconnect:`,
      err
    );
  }

  try {
    const supabase = requireSupabase();
    const { data: connRow } = await supabase
      .from("email_connections")
      .select("company_id, user_id, email")
      .eq("id", connectionId)
      .maybeSingle();

    if (connRow?.user_id) {
      await supabase.from("notifications").insert({
        user_id: connRow.user_id as string,
        company_id: connRow.company_id as string,
        type: "role_needed",
        title: "Email connection needs attention",
        body: `${connRow.email as string}: ${reason}. Please reconnect in Settings.`,
        is_read: false,
        persistent: true,
        action_url: "/settings?tab=integrations",
        action_label: "Reconnect",
      });
    }
  } catch (err) {
    console.error(
      `[sync-engine] Failed to notify on needs_reconnect for ${connectionId}:`,
      err
    );
  }
}

// ─── Inbound / Outbound Processors ─────────────────────────────────────────

/** Returns true if the email was unmatched (no pattern, no thread link). */
async function processInboundEmail(
  email: NormalizedEmail,
  connection: EmailConnection,
  profile: SyncProfile,
  followUpDaysCache: Map<string, number>,
  result: SyncCycleResult
): Promise<boolean> {
  const supabase = requireSupabase();

  // Dedup: check if we already have this email
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("email_message_id", email.id)
    .limit(1);

  if (existing && existing.length > 0) return false;

  // Thread inheritance — is this thread already linked to an OPS lead?
  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", email.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (threadLink && threadLink.length > 0) {
    await createActivity(
      email,
      connection,
      threadLink[0].opportunity_id,
      "inbound"
    );
    await updateCorrespondenceCounts(
      threadLink[0].opportunity_id,
      "inbound",
      email.date,
      connection.companyId,
      followUpDaysCache,
      result
    );
    await applyLabel(email.threadId, connection, result);
    result.activitiesCreated++;
    result.matched++;

    // ── E5: Auto-draft / auto-send trigger (fire-and-forget) ───────────
    // Never awaited — AI inference must not block the sync loop.
    maybeAutoGenerateDraft(email, connection, threadLink[0].opportunity_id)
      .catch((err) => console.error("[sync-engine] Auto-draft error (non-fatal):", err));

    // ── S2.3: Reschedule request detection (fire-and-forget) ───────────
    // Looks up the just-created activity row and runs the reschedule
    // classifier (phase_c gated + heuristic + GPT). Never blocks sync.
    maybeDetectRescheduleRequest(email, connection, threadLink[0].opportunity_id)
      .catch((err) =>
        console.error("[sync-engine] Reschedule detection error (non-fatal):", err)
      );

    return false;
  }

  // Pattern matching
  const isPatternMatch = matchesPattern(email, profile);
  const isPlatformMatch = matchPlatform(email.from) !== null;
  const isForwarderMatch =
    profile.teamForwarders?.some((f) =>
      email.from.toLowerCase().includes(f.toLowerCase())
    ) && isFormSubmissionSubject(email.subject);

  if (isPatternMatch || isPlatformMatch || isForwarderMatch) {
    const matchResult = await EmailMatchingServiceV2.match(
      connection.companyId,
      extractSenderEmail(email.from),
      {
        threadId: email.threadId,
        name: email.fromName,
        connectionId: connection.id,
      }
    );

    if (matchResult.action === "create_new") {
      const clientId = await createClient(email, connection.companyId);
      const oppId = await createOpportunity(
        email,
        clientId,
        connection.companyId,
        "new_lead"
      );
      await linkThread(oppId, email.threadId, connection.id);
      await createActivity(email, connection, oppId, "inbound");
      await applyLabel(email.threadId, connection, result);
      result.newLeads++;
      result.activitiesCreated++;

      // ── P1: Suggest project creation for new leads (fire-and-forget) ──
      // Gated behind phase_c — only enabled companies get suggestions.
      if (connection.userId) {
        AdminFeatureOverrideService.isAIFeatureEnabled(
          connection.companyId,
          "phase_c"
        ).then((enabled) => {
          if (!enabled) return;
          maybeSuggestProject({
            email,
            companyId: connection.companyId,
            userId: connection.userId!,
            clientId,
            opportunityId: oppId,
          }).catch((err) =>
            console.error("[sync-engine] Project suggestion error (non-fatal):", err)
          );
        }).catch((err) =>
          console.error("[sync-engine] Phase C check error (non-fatal):", err)
        );
      }
    } else if (
      matchResult.action === "link" ||
      matchResult.action === "create_subclient"
    ) {
      const oppId = await getOrCreateOpportunity(
        matchResult.clientId!,
        connection.companyId,
        email
      );
      await linkThread(oppId, email.threadId, connection.id);
      await createActivity(email, connection, oppId, "inbound");
      await updateCorrespondenceCounts(
        oppId,
        "inbound",
        email.date,
        connection.companyId,
        followUpDaysCache,
        result
      );
      await applyLabel(email.threadId, connection, result);
      result.matched++;
      result.activitiesCreated++;

      if (matchResult.action === "create_subclient") {
        await createSubClient(
          email,
          matchResult.clientId!,
          connection.companyId
        );
      }

      // ── E5: Auto-draft / auto-send (fire-and-forget) ─────────────────
      maybeAutoGenerateDraft(email, connection, oppId)
        .catch((err) => console.error("[sync-engine] Auto-draft error (non-fatal):", err));
    } else if (matchResult.action === "review") {
      await createActivity(email, connection, null, "inbound", {
        matchNeedsReview: true,
        suggestedClientId: matchResult.suggestedClientId,
        matchConfidence: matchResult.confidence,
      });
      result.needsReview++;
      result.activitiesCreated++;
    }
    return false; // Matched by pattern
  }

  // Unmatched — will be sent to AI classification if feature-gated
  return true;
}

async function processSentEmail(
  email: NormalizedEmail,
  connection: EmailConnection,
  profile: SyncProfile,
  followUpDaysCache: Map<string, number>,
  result: SyncCycleResult
): Promise<void> {
  const supabase = requireSupabase();

  // Dedup
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("email_message_id", email.id)
    .limit(1);

  if (existing && existing.length > 0) return;

  // Thread inheritance for sent mail
  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", email.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (threadLink && threadLink.length > 0) {
    await createActivity(
      email,
      connection,
      threadLink[0].opportunity_id,
      "outbound"
    );
    await updateCorrespondenceCounts(
      threadLink[0].opportunity_id,
      "outbound",
      email.date,
      connection.companyId,
      followUpDaysCache,
      result
    );
    result.activitiesCreated++;
    result.matched++;

    // Memory/profile learning fires below for ALL outbound emails
    await learnFromOutboundEmail(email, connection);
    return;
  }

  // Sent folder safety net: user sent to a NEW external address.
  // Only process the FIRST external recipient per thread to avoid
  // duplicate thread link constraint violations (#8).
  let threadLinkedByThisEmail = false;

  // Also check CC'd recipients alongside TO recipients (#11)
  const allRecipients = [...email.to, ...email.cc];

  for (const recipient of allRecipients) {
    if (threadLinkedByThisEmail) break; // One thread link per email

    const recipientEmail = extractSenderEmail(recipient);
    const recipientDomain = recipientEmail.split("@")[1]?.toLowerCase();

    // Skip internal/company emails
    if (profile.companyDomains?.some((d) => recipientDomain === d)) continue;
    if (recipientEmail === connection.email) continue;

    // Check if subject matches estimate pattern
    const normalizedSubject = email.subject
      .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
      .trim();
    const isEstimate = profile.estimateSubjectPatterns?.some((p) =>
      normalizedSubject.toLowerCase().includes(p.toLowerCase())
    );

    if (isEstimate) {
      const matchResult = await EmailMatchingServiceV2.match(
        connection.companyId,
        recipientEmail,
        {
          threadId: email.threadId,
          name: "",
          connectionId: connection.id,
        }
      );

      if (matchResult.action === "create_new") {
        const clientId = await createClient(
          {
            ...email,
            from: recipientEmail,
            fromName: recipientEmail.split("@")[0],
          },
          connection.companyId
        );
        const oppId = await createOpportunity(
          email,
          clientId,
          connection.companyId,
          "qualifying"
        );
        await linkThread(oppId, email.threadId, connection.id);
        await createActivity(email, connection, oppId, "outbound");
        await applyLabel(email.threadId, connection, result);
        result.newLeads++;
        result.activitiesCreated++;
        threadLinkedByThisEmail = true;
      } else if (matchResult.clientId) {
        const oppId = await getOrCreateOpportunity(
          matchResult.clientId,
          connection.companyId,
          email
        );
        await linkThread(oppId, email.threadId, connection.id);
        await createActivity(email, connection, oppId, "outbound");
        await updateCorrespondenceCounts(
          oppId,
          "outbound",
          email.date,
          connection.companyId,
          followUpDaysCache,
          result
        );
        result.matched++;
        result.activitiesCreated++;
        threadLinkedByThisEmail = true;
      }
    }
  }

  // Phase C: Learn from ALL outbound emails — not just thread-linked ones.
  // Emails that matched an estimate pattern above already created activities;
  // emails that matched nothing are still valuable learning signals.
  await learnFromOutboundEmail(email, connection);
}

/**
 * Phase C: Extract memory facts and update writing profile from any outbound email.
 * Gated behind the phase_c admin feature flag. Fire-and-forget (errors logged, not thrown).
 */
async function learnFromOutboundEmail(
  email: NormalizedEmail,
  connection: EmailConnection
): Promise<void> {
  if (!connection.userId) return;

  try {
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      connection.companyId,
      "phase_c"
    );
    if (!enabled) return;

    await Promise.all([
      MemoryService.processOutboundEmail(
        connection.companyId,
        connection.userId,
        {
          from: email.from,
          to: email.to,
          subject: email.subject,
          bodyText: email.bodyText,
          date: email.date.toISOString(),
        }
      ),
      WritingProfileService.updateFromEmail(
        connection.companyId,
        connection.userId,
        { bodyText: email.bodyText }
      ),
    ]);
  } catch (err) {
    console.error("[sync-engine] Phase C learning error (non-fatal):", err);
  }
}

/**
 * Sprint E5: Auto-draft generation for inbound emails on linked threads.
 * Checks auto_draft_enabled + category autonomy + writing profile confidence.
 * Fire-and-forget — errors logged, not thrown.
 */
async function maybeAutoGenerateDraft(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string,
): Promise<void> {
  if (!connection.userId) return;

  try {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      connection.companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return;

    const supabase = requireSupabase();

    // Fetch connection settings
    const { data: conn } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connection.id)
      .eq("company_id", connection.companyId)
      .single();

    if (!conn?.auto_send_settings) return;

    const settings = conn.auto_send_settings as Record<string, unknown>;
    const autoDraftEnabled = settings.auto_draft_enabled === true;
    if (!autoDraftEnabled) return;

    // Check category autonomy — determine profile type from thread subject
    const categoryAutonomy = (settings.category_autonomy as Record<string, string>) || {};

    // Determine profile type from subject heuristics for category lookup
    const lowerSubject = email.subject.toLowerCase();
    let profileType = "general";
    if (lowerSubject.includes("warranty") || lowerSubject.includes("defect")) profileType = "warranty_claim";
    else if (lowerSubject.includes("quote") || lowerSubject.includes("estimate") || lowerSubject.includes("pricing")) profileType = "client_quoting";
    else if (lowerSubject.includes("order") || lowerSubject.includes("supply") || lowerSubject.includes("material")) profileType = "vendor_ordering";
    else if (lowerSubject.includes("sub") || lowerSubject.includes("coordinate")) profileType = "subtrade_coordination";
    else if (lowerSubject.includes("follow") || lowerSubject.includes("checking in")) profileType = "client_followup";

    const categoryLevel = categoryAutonomy[profileType] || "draft_on_request";

    // "off" or "draft_on_request" → don't auto-draft
    if (categoryLevel === "off" || categoryLevel === "draft_on_request") return;

    // Check writing profile confidence > 0.75
    const profile = await WritingProfileService.getProfile(
      connection.companyId,
      connection.userId
    );
    const emailsAnalyzed = (profile?.emails_analyzed as number) || 0;
    const confidence = WritingProfileService.getConfidence(emailsAnalyzed);
    if (confidence <= 0.75) return;

    // All checks passed — generate auto-draft
    const draftResult = await AIDraftService.generateDraft({
      companyId: connection.companyId,
      userId: connection.userId,
      connectionId: connection.id,
      opportunityId,
      threadId: email.threadId,
    });

    if (!draftResult.available || !draftResult.draft) return;

    // Update the draft history entry to status 'auto_drafted'
    if (draftResult.draftHistoryId) {
      await supabase
        .from("ai_draft_history")
        .update({ status: "auto_drafted" })
        .eq("id", draftResult.draftHistoryId);
    }

    // If category is "auto_send", schedule auto-send with delay.
    // The user gets a window to cancel before the cron sends it.
    if (categoryLevel === "auto_send") {
      const { enabled: autoSendEnabled, settings: autoSendSettings } =
        await AutoSendService.isEnabled(connection.companyId, connection.id);

      if (autoSendEnabled && autoSendSettings) {
        const pending = await AutoSendService.scheduleAutoSend({
          companyId: connection.companyId,
          userId: connection.userId,
          connectionId: connection.id,
          opportunityId,
          threadId: email.threadId,
          inReplyTo: email.id,
          toEmails: [extractSenderEmail(email.from)],
          subject: email.subject.startsWith("Re: ")
            ? email.subject
            : `Re: ${email.subject}`,
          settings: autoSendSettings,
        });

        // Notify with cancel link — user has delay window to intervene
        const delayMin = autoSendSettings.delayMinMinutes || 30;
        await supabase.from("notifications").insert({
          user_id: connection.userId,
          company_id: connection.companyId,
          type: "ai_milestone" as const,
          title: "Auto-sending reply",
          body: `Sending in ~${delayMin} min: ${email.subject.slice(0, 50)}`,
          is_read: false,
          persistent: true,
          action_url: pending ? `/inbox?cancelAutoSend=${pending.id}` : "/inbox",
          action_label: "Cancel",
        });
        return; // auto-send path done — don't also send "Draft ready"
      }
    }

    // Fire notification for auto-draft only (no auto-send)
    await supabase.from("notifications").insert({
      user_id: connection.userId,
      company_id: connection.companyId,
      type: "ai_milestone" as const,
      title: "Draft ready",
      body: `AI draft generated for: ${email.subject.slice(0, 60)}`,
      is_read: false,
      persistent: false,
      action_url: "/inbox",
      action_label: "Review",
    });
  } catch (err) {
    console.error("[sync-engine] Auto-draft generation failed (non-fatal):", err);
  }
}

/**
 * S2.3: Detect inbound reschedule requests on opportunity-linked threads.
 *
 * Fire-and-forget — never awaited, never blocks the sync loop.
 * Gated inside the service (phase_c + client_comms_settings + keyword heuristic).
 *
 * Filters early so GPT is only called when there are active upcoming tasks
 * on the linked project — avoids wasted classification calls.
 */
async function maybeDetectRescheduleRequest(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string
): Promise<void> {
  if (!connection.userId) return;

  try {
    const supabase = requireSupabase();

    // Quick pre-check: does the opportunity link to a project with any
    // scheduled tasks in the near future? If not, skip.
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("company_id", connection.companyId)
      .eq("opportunity_id", opportunityId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (!project) {
      const { data: oppRow } = await supabase
        .from("opportunities")
        .select("project_id")
        .eq("id", opportunityId)
        .maybeSingle();
      if (!oppRow?.project_id) return;
    }

    const projectId = (project?.id as string) ?? null;
    if (projectId) {
      const nowIso = new Date().toISOString();
      const windowEnd = new Date();
      windowEnd.setDate(windowEnd.getDate() + 30);
      const { data: upcoming } = await supabase
        .from("project_tasks")
        .select("id")
        .eq("company_id", connection.companyId)
        .eq("project_id", projectId)
        .eq("status", "active")
        .is("deleted_at", null)
        .not("start_date", "is", null)
        .gte("start_date", nowIso)
        .lte("start_date", windowEnd.toISOString())
        .limit(1);
      if (!upcoming || upcoming.length === 0) return;
    }

    // Look up the just-created activity row by email_message_id
    const { data: activityRow } = await supabase
      .from("activities")
      .select("id")
      .eq("email_message_id", email.id)
      .eq("company_id", connection.companyId)
      .limit(1)
      .maybeSingle();

    if (!activityRow?.id) return;

    const { ClientSchedulingCommsService } = await import(
      "./client-scheduling-comms-service"
    );
    await ClientSchedulingCommsService.detectRescheduleRequest(
      connection.companyId,
      connection.userId,
      activityRow.id as string
    );
  } catch (err) {
    console.error(
      "[sync-engine] maybeDetectRescheduleRequest failed (non-fatal):",
      err
    );
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export const SyncEngine = {
  /**
   * Run a full sync cycle for a connection.
   * This is the main entry point — called by cron, manual sync, and webhook.
   */
  async runSync(connectionId: string): Promise<SyncCycleResult> {
    const connection = await EmailService.getConnection(connectionId);

    if (!connection || connection.status !== "active") {
      return { ...emptyResult(), errors: ["Connection not active"] };
    }

    const provider = EmailService.getProvider(connection);
    const profile = connection.syncFilters as SyncProfile;
    const result = emptyResult();

    // Per-cycle cache so each stage lookup against pipeline_stage_configs
    // runs at most once per connection sync — dozens of emails may touch
    // the same stage within a single invocation.
    const followUpDaysCache = new Map<string, number>();

    try {
      // ── Step 0: Bootstrap sync token if missing ─────────────────────────
      //
      // First-ever sync for a newly-activated connection: historyId is null.
      // Fetch a fresh token from the provider (Gmail: /profile.historyId,
      // M365: empty — delta self-seeds), persist it, and return empty
      // without touching the message pipeline for this cycle. The next
      // cron tick will start fetching real messages.
      if (!connection.historyId) {
        try {
          const freshToken = await provider.getInitialSyncToken();
          await EmailService.updateConnection(connectionId, {
            historyId: freshToken,
            lastSyncedAt: new Date(),
          });
          connection.historyId = freshToken;
          return result;
        } catch (err) {
          if (err instanceof ProviderAuthError) {
            await markConnectionNeedsReconnect(connectionId, err.message);
          } else if (err instanceof ProviderScopeError) {
            await markConnectionNeedsReconnect(connectionId, err.message);
          }
          throw err;
        }
      }

      const syncToken = connection.historyId;

      // Step 1: Fetch new emails since last sync (inbox + sent)
      //
      // `includeSentMail` defaults to true but the user can disable it in
      // their sync filters — previously the flag was defined in types but
      // never consulted, so turning it off silently did nothing. When
      // disabled we skip the Sent-folder fetch (and the downstream
      // processSentEmail loop below operates on an empty array, which
      // means no outbound-triggered thread linking and no writing-profile
      // learning from outbound mail).
      //
      // Wrapped in a re-seed recovery: if either side reports
      // SyncTokenExpiredError, re-fetch the mailbox's current historyId
      // from /profile, persist it, and return empty. The next cron tick
      // will pick up from the new baseline.
      const includeSentMail = profile.includeSentMail !== false;
      let inboxResult: SyncResult;
      let sentResult: SyncResult;
      try {
        const fetches: [Promise<SyncResult>, Promise<SyncResult>] = [
          provider.fetchNewEmailsSince(syncToken),
          includeSentMail
            ? provider.fetchSentEmailsSince(syncToken)
            : Promise.resolve({ emails: [], nextSyncToken: syncToken }),
        ];
        [inboxResult, sentResult] = await Promise.all(fetches);
      } catch (err) {
        if (err instanceof SyncTokenExpiredError) {
          console.warn(
            `[sync-engine] Sync token expired for ${connectionId}, re-seeding`
          );
          try {
            const freshToken = await provider.getInitialSyncToken();
            await EmailService.updateConnection(connectionId, {
              historyId: freshToken,
              lastSyncedAt: new Date(),
            });
          } catch (reseedErr) {
            if (reseedErr instanceof ProviderAuthError) {
              await markConnectionNeedsReconnect(connectionId, reseedErr.message);
            } else if (reseedErr instanceof ProviderScopeError) {
              await markConnectionNeedsReconnect(connectionId, reseedErr.message);
            }
            throw reseedErr;
          }
          return result;
        }
        if (err instanceof ProviderAuthError) {
          await markConnectionNeedsReconnect(connectionId, err.message);
        } else if (err instanceof ProviderScopeError) {
          await markConnectionNeedsReconnect(connectionId, err.message);
        }
        throw err;
      }

      const rawInboxEmails = inboxResult.emails;
      const rawSentEmails = sentResult.emails;
      const newSyncToken = inboxResult.nextSyncToken;

      if (rawInboxEmails.length === 0 && rawSentEmails.length === 0) {
        await EmailService.updateConnection(connectionId, {
          lastSyncedAt: new Date(),
          historyId: newSyncToken,
        });
        return result;
      }

      // ── Step 1.5: Noise filtering ────────────────────────────────────────
      //
      // Drop marketing, noreply, domain-blocked, and rule-filtered mail
      // before any matching / Phase C learning / OpenAI classification runs.
      // Without this, every cron cycle burns tokens on newsletters and
      // pollutes the inbox leads view with junk.
      const blocklist = await EmailFilterService.buildBlocklist(
        profile as unknown as GmailSyncFilters
      );
      const inboxEmails = rawInboxEmails.filter(
        (email) =>
          !EmailFilterService.shouldFilter(
            extractSenderEmail(email.from),
            email.subject,
            blocklist,
            profile as unknown as GmailSyncFilters,
            email.labelIds,
            email.bodyText
          )
      );
      // Sent mail is not filtered — user's own outbound is always relevant
      // to the pipeline (auto-linking, writing-profile learning).
      const sentEmails = rawSentEmails;

      // Step 2-4: Process inbound emails, collect unmatched for AI review
      const unmatchedEmails: NormalizedEmail[] = [];
      for (const email of inboxEmails) {
        const unmatched = await processInboundEmail(email, connection, profile, followUpDaysCache, result);
        if (unmatched) unmatchedEmails.push(email);
      }

      // Step 3: Process sent emails (sent folder safety net)
      for (const email of sentEmails) {
        await processSentEmail(email, connection, profile, followUpDaysCache, result);
      }

      // Step 5: AI classification for unmatched emails (feature-gated)
      // Step 6: AI stage evaluation for leads with new emails (feature-gated)
      try {
        const supabase = requireSupabase();

        // Get company context for AI
        const { data: company } = await supabase
          .from("companies")
          .select("name, industry")
          .eq("id", connection.companyId)
          .single();

        const companyName = (company?.name as string) || "";
        const companyIndustry = (company?.industry as string) || "trades";

        // Step 5: AI classification for unmatched emails
        if (unmatchedEmails.length > 0) {
          const aiResult = await AISyncReviewer.reviewUnmatchedEmails(
            unmatchedEmails,
            connection,
            {
              name: companyName,
              industry: companyIndustry,
              domains: profile.companyDomains || [],
            }
          );

          // Persist AI-classified leads as opportunities
          for (const classified of aiResult.classifiedLeads) {
            try {
              const matchResult = await EmailMatchingServiceV2.match(
                connection.companyId,
                classified.clientEmail,
                {
                  threadId: classified.email.threadId,
                  name: classified.clientName,
                  connectionId: connection.id,
                }
              );

              let clientId: string;
              if (matchResult.action === "link" || matchResult.action === "create_subclient") {
                clientId = matchResult.clientId!;
              } else {
                clientId = await createClient(classified.email, connection.companyId);
              }

              const oppId = await createOpportunity(
                classified.email,
                clientId,
                connection.companyId,
                classified.stage
              );
              await linkThread(oppId, classified.email.threadId, connection.id);
              await createActivity(classified.email, connection, oppId, "inbound", {
                matchConfidence: "ai",
              });
              await applyLabel(classified.email.threadId, connection, result);
              result.activitiesCreated++;
            } catch (err) {
              console.error(`[sync-engine] Failed to persist AI lead ${classified.clientEmail}:`, err);
            }
          }
          result.newLeads += aiResult.newLeadsClassified;
        }

        // Step 6: AI stage evaluation for threads that received new emails
        const activeThreadIds: string[] = [];
        for (const email of [...inboxEmails, ...sentEmails]) {
          const { data: tl } = await supabase
            .from("opportunity_email_threads")
            .select("thread_id")
            .eq("thread_id", email.threadId)
            .eq("connection_id", connection.id)
            .limit(1);
          if (tl && tl.length > 0 && !activeThreadIds.includes(email.threadId)) {
            activeThreadIds.push(email.threadId);
          }
        }

        if (activeThreadIds.length > 0) {
          // Combined stage evaluation + opportunity summary in a single AI call
          const stageResults = await AISyncReviewer.evaluateStagesWithSummary(
            activeThreadIds,
            connection,
            { name: companyName }
          );

          for (const sr of stageResults) {
            // Resolve opportunity for this thread
            const { data: threadOpp } = await supabase
              .from("opportunity_email_threads")
              .select("opportunity_id")
              .eq("thread_id", sr.threadId)
              .eq("connection_id", connection.id)
              .limit(1);

            if (!threadOpp || threadOpp.length === 0) continue;

            const oppId = threadOpp[0].opportunity_id;

            // Check current stage + manual override flag
            const { data: oppData } = await supabase
              .from("opportunities")
              .select("stage, stage_manually_set")
              .eq("id", oppId)
              .single();

            if (sr.terminalFlag) {
              // Always send terminal notifications (likely_won/likely_lost),
              // even for manually-set stages — user should know about signals
              await createTerminalFlagNotification(sr, connection);
            }

            // Build update payload — always write summary if present
            const updates: Record<string, unknown> = {};

            if (sr.summary) {
              updates.ai_summary = sr.summary;
            }

            // Only write stage if it actually changed AND user hasn't manually set it
            if (
              sr.newStage &&
              !oppData?.stage_manually_set &&
              sr.newStage !== oppData?.stage
            ) {
              updates.stage = sr.newStage;
              updates.stage_entered_at = new Date().toISOString();
              updates.ai_stage_confidence = 1.0;
              // ai_stage_signals is text[] — wrap the signal in an array so
              // Postgres doesn't reject the write with a type error.
              updates.ai_stage_signals = [sr.terminalFlag || "ai_evaluated"];
              result.stageChanges++;
            }

            if (Object.keys(updates).length > 0) {
              await supabase
                .from("opportunities")
                .update(updates)
                .eq("id", oppId);
            }
          }
        }
      } catch (aiErr) {
        console.error("[sync-engine] AI review error (non-fatal):", aiErr);
      }

      // Step 11: Notifications
      if (result.newLeads > 0 || result.activitiesCreated > 0) {
        await createSyncNotification(connection, result);
      }

      // Step 11b: Check autonomy milestones (E5)
      if (connection.userId && result.activitiesCreated > 0) {
        AutonomyMilestoneService.checkMilestonesAfterSync(
          connection.companyId,
          connection.userId,
          connectionId,
        ).catch((err) => {
          console.error("[sync-engine] Milestone check failed (non-fatal):", err);
        });
      }

      // Step 12: Update sync token
      await EmailService.updateConnection(connectionId, {
        lastSyncedAt: new Date(),
        historyId: newSyncToken,
      });
    } catch (err) {
      console.error(`[sync-engine] Error syncing ${connectionId}:`, err);
      result.errors.push(
        err instanceof Error ? err.message : "Unknown error"
      );
    }

    return result;
  },

  /**
   * Sweep all active opportunities for stale follow-up detection.
   * Called by the cron independently of new email arrival — catches leads
   * that go quiet (no new emails trigger the per-email evaluator).
   *
   * Resolves autoFollowUpDays per-company per-stage from
   * pipeline_stage_configs, cached for the duration of the sweep.
   */
  async sweepStaleLeads(): Promise<number> {
    const supabase = requireSupabase();
    let stageChanges = 0;

    // Select company_id too so we can resolve the per-company autoFollowUpDays
    // from pipeline_stage_configs.
    const { data: staleOpps } = await supabase
      .from("opportunities")
      .select(
        "id, company_id, stage, stage_manually_set, correspondence_count, outbound_count, inbound_count, last_inbound_at, last_outbound_at, last_message_direction"
      )
      .eq("last_message_direction", "out")
      .not("stage", "in", '("won","lost","follow_up")')
      .is("deleted_at", null)
      .not("last_outbound_at", "is", null);

    const cache = new Map<string, number>();

    for (const opp of staleOpps ?? []) {
      if (opp.stage_manually_set) continue;

      const autoFollowUpDays = await resolveAutoFollowUpDays(
        opp.company_id as string,
        opp.stage as string,
        cache
      );

      const evaluation = StageEvaluator.evaluate({
        outboundCount: opp.outbound_count || 0,
        inboundCount: opp.inbound_count || 0,
        totalMessages: opp.correspondence_count || 0,
        lastMessageDirection: (opp.last_message_direction as "in" | "out") || "out",
        lastInboundAt: opp.last_inbound_at
          ? new Date(opp.last_inbound_at)
          : null,
        lastOutboundAt: opp.last_outbound_at
          ? new Date(opp.last_outbound_at)
          : null,
        currentStage: opp.stage,
        autoFollowUpDays,
      });

      if (evaluation.changed) {
        await supabase
          .from("opportunities")
          .update({
            stage: evaluation.stage,
            stage_entered_at: new Date().toISOString(),
          })
          .eq("id", opp.id);
        stageChanges++;
      }
    }

    return stageChanges;
  },
};
