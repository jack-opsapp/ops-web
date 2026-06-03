// src/lib/api/services/sync-engine.ts
// Core sync cycle — runs on every sync trigger (cron, manual, webhook).
// Implements the 12-step flow from spec Section 4C.

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import {
  pickExistingMailboxDraft,
  type MailboxDraftRow,
} from "./mailbox-draft-helpers";
import {
  CONTACT_FORM_OUTREACH_SUBJECT,
  buildContactFormDraftInstruction,
  placeNewThreadDraft,
} from "./mailbox-draft-push";
import { AutonomyMilestoneService } from "./autonomy-milestone-service";
import { reconcilePendingMailboxDrafts } from "./draft-reconciliation";
import { maybeSuggestProject } from "./project-suggestion-service";
import { EmailThreadService } from "./email-thread-service";
import { OpportunityLifecycleService } from "./opportunity-lifecycle-service";
import {
  buildEmailOpportunityTitle,
  identityCandidateFromMailbox,
  type EmailOpportunityIdentityCandidate,
  type EmailOpportunityTitleKind,
  type EmailOpportunityUnsafeIdentity,
} from "@/lib/email/opportunity-title";
import {
  applyCanonicalLeadEnrichment,
  buildNewClientEnrichmentFields,
  buildNewOpportunityEnrichmentFields,
  leadEnrichmentFactsFromEmail,
  leadEnrichmentFactsFromImport,
  writeFieldProvenance,
  type LeadEnrichmentFacts,
} from "@/lib/email/lead-enrichment";
import {
  findOpportunityRelationshipMatch,
  type OpportunityRelationshipFacts,
} from "@/lib/email/opportunity-relationship-matching";
import {
  logInvalidProviderEmailIds,
  validateProviderEmailIds,
} from "@/lib/email/provider-email-ids";
import {
  extractContactFormSubmission,
  type ContactFormSubmissionIdentity,
} from "@/lib/utils/email-parsing";
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
  invalidProviderEmails: number;
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

interface CreateOpportunityTitleOptions {
  kind?: EmailOpportunityTitleKind;
  candidates?: EmailOpportunityIdentityCandidate[];
  unsafe?: EmailOpportunityUnsafeIdentity;
  enrichmentFacts?: LeadEnrichmentFacts;
}

function syncTitleUnsafeIdentity(
  connection: EmailConnection,
  profile: SyncProfile
): EmailOpportunityUnsafeIdentity {
  return {
    emails: [connection.email, ...(profile.userEmailAddresses ?? [])],
    domains: profile.companyDomains ?? [],
    platformEmails: profile.knownPlatformSenders ?? [],
  };
}

function contactFormTitleCandidate(
  submitter: ContactFormSubmissionIdentity | null
): EmailOpportunityIdentityCandidate[] {
  if (!submitter) return [];
  return [
    {
      source: "contact_form",
      name: submitter.name,
      email: submitter.email,
    },
  ];
}

function mailboxHeader(email: string, name: string | null | undefined): string {
  const display = (name ?? "").trim();
  if (!display) return email;
  return `${display.replace(/"/g, "")} <${email}>`;
}

function applyContactFormSubmitterIdentity(email: NormalizedEmail): {
  email: NormalizedEmail;
  submitter: ContactFormSubmissionIdentity | null;
} {
  const submitter = extractContactFormSubmission(
    email.subject,
    email.bodyText || email.snippet || "",
  );
  if (!submitter) return { email, submitter: null };

  return {
    email: {
      ...email,
      from: mailboxHeader(submitter.email, submitter.name),
      fromName: submitter.name ?? submitter.email,
    },
    submitter,
  };
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
    invalidProviderEmails: 0,
    errors: [],
  };
}

function normalizeProviderBackedEmailForSync(
  email: NormalizedEmail,
  connection: EmailConnection,
  result: SyncCycleResult,
  boundary: string
): NormalizedEmail | null {
  const validation = validateProviderEmailIds({
    boundary,
    providerThreadId: email.threadId,
    providerMessageId: email.id,
    requireMessageId: true,
  });

  if (!validation.ok) {
    result.invalidProviderEmails++;
    logInvalidProviderEmailIds(validation, {
      companyId: connection.companyId,
      connectionId: connection.id,
      subject: email.subject,
      fromEmail: extractSenderEmail(email.from),
    });
    return null;
  }

  return {
    ...email,
    id: validation.providerMessageId!,
    threadId: validation.providerThreadId,
  };
}

async function createClient(
  email: NormalizedEmail,
  companyId: string,
  submitter?: ContactFormSubmissionIdentity | null,
  enrichmentFacts?: LeadEnrichmentFacts | null
): Promise<string> {
  const supabase = requireSupabase();
  const senderEmail =
    enrichmentFacts !== undefined
      ? enrichmentFacts?.contactEmail
      : submitter?.email ?? extractSenderEmail(email.from);
  const senderName =
    enrichmentFacts?.companyName ??
    enrichmentFacts?.contactName ??
    submitter?.company ??
    submitter?.name ??
    (enrichmentFacts?.sourcePlatform ? null : email.fromName) ??
    senderEmail?.split("@")[0] ??
    "New Lead";

  // Check for existing client first to avoid duplicates
  const { data: existingClients } = senderEmail
    ? await supabase
        .from("clients")
        .select("id")
        .eq("company_id", companyId)
        .ilike("email", senderEmail)
        .is("deleted_at", null)
        .limit(1)
    : { data: null };

  if (existingClients && existingClients.length > 0) {
    return existingClients[0].id;
  }

  const enrichmentFields = enrichmentFacts
    ? buildNewClientEnrichmentFields(enrichmentFacts)
    : {};
  const insertedClient = {
    company_id: companyId,
    name: senderName,
    email: enrichmentFacts?.contactEmail ?? senderEmail ?? null,
    phone_number: enrichmentFacts?.contactPhone ?? submitter?.phone ?? null,
    ...enrichmentFields,
  };
  const { data } = await supabase
    .from("clients")
    .insert(insertedClient)
    .select("id")
    .single();
  const clientId = data!.id as string;

  // Record provenance for the customer facts this insert established. A fresh
  // insert cannot clobber anything, but the dossier/audit feature needs a row
  // for new leads, not only for reuse/link branches.
  if (enrichmentFacts) {
    const clientUpdates: Record<string, unknown> = {};
    if (enrichmentFacts.companyName ?? enrichmentFacts.contactName) {
      clientUpdates.name = enrichmentFacts.companyName ?? enrichmentFacts.contactName;
    }
    if (enrichmentFacts.contactEmail) clientUpdates.email = enrichmentFacts.contactEmail;
    if (enrichmentFacts.contactPhone) clientUpdates.phone_number = enrichmentFacts.contactPhone;
    if (enrichmentFacts.address) clientUpdates.address = enrichmentFacts.address;
    await writeFieldProvenance({
      supabase,
      companyId,
      opportunityId: null,
      clientId,
      opportunityUpdates: {},
      clientUpdates,
      facts: enrichmentFacts,
    });
  }
  return clientId;
}

async function createSubClient(
  email: NormalizedEmail,
  clientId: string,
  companyId: string,
  submitter?: ContactFormSubmissionIdentity | null
): Promise<void> {
  const supabase = requireSupabase();
  const senderEmail = submitter?.email ?? extractSenderEmail(email.from);
  const senderName = submitter?.name || email.fromName || senderEmail.split("@")[0];

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
    name: senderName,
    email: senderEmail,
    phone_number: submitter?.phone ?? null,
  });
}

async function getClientOpportunityTitleCandidate(
  clientId: string
): Promise<EmailOpportunityIdentityCandidate | null> {
  const supabase = requireSupabase();
  const { data: client } = await supabase
    .from("clients")
    .select("name, email")
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!client) return null;
  return {
    source: "client",
    name: (client.name as string | null) ?? null,
    email: (client.email as string | null) ?? null,
  };
}

async function createOpportunity(
  email: NormalizedEmail,
  clientId: string,
  companyId: string,
  stage: string,
  titleOptions: CreateOpportunityTitleOptions = {}
): Promise<string> {
  const supabase = requireSupabase();
  const isOutbound = stage === "qualifying"; // sent folder leads start at qualifying
  const startedAt = Date.now();
  const clientCandidate = await getClientOpportunityTitleCandidate(clientId);
  const senderCandidate = identityCandidateFromMailbox(
    "inbound_sender",
    email.from,
    email.fromName
  );
  const candidates = [
    ...(titleOptions.candidates ?? []),
    senderCandidate,
    clientCandidate,
  ].filter(Boolean) as EmailOpportunityIdentityCandidate[];
  const opportunityEnrichmentFields = titleOptions.enrichmentFacts
    ? buildNewOpportunityEnrichmentFields(titleOptions.enrichmentFacts)
    : {};
  const { data } = await supabase
    .from("opportunities")
    .insert({
      company_id: companyId,
      client_id: clientId,
      title: buildEmailOpportunityTitle({
        kind: titleOptions.kind ?? "email_inquiry",
        candidates,
        unsafe: titleOptions.unsafe,
      }),
      stage,
      source: "email",
      ...opportunityEnrichmentFields,
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

  const opportunityId = data!.id as string;

  // Record provenance for the customer facts this insert established, so new
  // leads (the majority) carry a dossier/audit trail — not only the
  // reuse/link/thread-inherit branches that flow through
  // applyCanonicalLeadEnrichment. A fresh insert cannot overwrite anything.
  if (titleOptions.enrichmentFacts) {
    await writeFieldProvenance({
      supabase,
      companyId,
      opportunityId,
      clientId: null,
      opportunityUpdates: opportunityEnrichmentFields,
      clientUpdates: {},
      facts: titleOptions.enrichmentFacts,
    });
  }

  // Phase C observability: log lead creation so the heartbeat cron has a
  // signal of end-to-end ingestion success, not just webhook delivery.
  console.log("[email-ingest] lead-created", {
    leadId: opportunityId,
    companyId,
    clientId,
    stage,
    direction: isOutbound ? "out" : "in",
    msToCreate: Date.now() - startedAt,
  });

  return opportunityId;
}

async function getOrCreateOpportunity(
  clientId: string,
  companyId: string,
  email: NormalizedEmail,
  titleOptions: CreateOpportunityTitleOptions = {}
): Promise<string> {
  const supabase = requireSupabase();

  const { data: existing } = await supabase
    .from("opportunities")
    .select("id")
    .eq("client_id", clientId)
    .eq("company_id", companyId)
    .not("stage", "in", '("won","lost","discarded")')
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    if (titleOptions.enrichmentFacts) {
      await applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: existing[0].id,
        clientId,
        facts: titleOptions.enrichmentFacts,
        companyId,
      });
    }
    return existing[0].id;
  }

  return createOpportunity(email, clientId, companyId, "new_lead", titleOptions);
}

function opportunityRelationshipFactsFromLeadEnrichment(
  facts: LeadEnrichmentFacts,
  email: NormalizedEmail
): OpportunityRelationshipFacts {
  return {
    contactName: facts.contactName,
    contactEmail: facts.contactEmail,
    contactPhone: facts.contactPhone,
    address: facts.address,
    description: facts.description ?? email.bodyText ?? email.snippet ?? null,
    subject: email.subject,
    providerThreadId: facts.providerThreadId,
    sourcePlatform: facts.sourcePlatform,
    phaseCEnabled: false,
  };
}

async function linkThread(
  opportunityId: string,
  threadId: string,
  connectionId: string
): Promise<boolean> {
  const validation = validateProviderEmailIds({
    boundary: "sync_thread_link",
    providerThreadId: threadId,
    providerMessageId: null,
    requireMessageId: false,
  });

  if (!validation.ok) {
    logInvalidProviderEmailIds(validation, {
      opportunityId,
      connectionId,
    });
    return false;
  }

  const supabase = requireSupabase();
  await supabase.from("opportunity_email_threads").upsert(
    {
      opportunity_id: opportunityId,
      thread_id: validation.providerThreadId,
      connection_id: connectionId,
    },
    { onConflict: "thread_id,connection_id" }
  );
  return true;
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
): Promise<boolean> {
  const validation = validateProviderEmailIds({
    boundary: "sync_activity",
    providerThreadId: email.threadId,
    providerMessageId: email.id,
    requireMessageId: true,
  });

  if (!validation.ok) {
    logInvalidProviderEmailIds(validation, {
      companyId: connection.companyId,
      connectionId: connection.id,
      opportunityId,
      direction,
      subject: email.subject,
      fromEmail: extractSenderEmail(email.from),
    });
    return false;
  }

  const normalizedEmail: NormalizedEmail = {
    ...email,
    id: validation.providerMessageId!,
    threadId: validation.providerThreadId,
  };
  const supabase = requireSupabase();
  const fromEmail = extractSenderEmail(normalizedEmail.from);
  const toEmails = normalizedEmail.to.map(extractSenderEmail);
  const ccEmails = normalizedEmail.cc.map(extractSenderEmail);
  const { data: insertedActivity } = await supabase.from("activities").insert({
    company_id: connection.companyId,
    type: "email",
    subject: normalizedEmail.subject,
    content: normalizedEmail.snippet,
    body_text: normalizedEmail.bodyText || null,
    email_message_id: normalizedEmail.id,
    email_thread_id: normalizedEmail.threadId,
    opportunity_id: opportunityId,
    direction,
    from_email: fromEmail,
    to_emails: toEmails,
    cc_emails: ccEmails,
    has_attachments: normalizedEmail.hasAttachments,
    attachment_count: normalizedEmail.hasAttachments ? 1 : 0, // provider doesn't give exact count yet
    match_needs_review: extra?.matchNeedsReview || false,
    suggested_client_id: extra?.suggestedClientId || null,
    match_confidence: extra?.matchConfidence || "pattern",
    is_read: !extra?.matchNeedsReview,
  }).select("id").single();

  const profile = connection.syncFilters as Partial<SyncProfile> | null;
  await OpportunityLifecycleService.recordCorrespondenceEvent({
    supabase,
    companyId: connection.companyId,
    opportunityId,
    activityId:
      ((insertedActivity as Record<string, unknown> | null)?.id as string | null) ??
      null,
    connectionId: connection.id,
    providerThreadId: normalizedEmail.threadId,
    providerMessageId: normalizedEmail.id,
    requireProviderMessageId: true,
    direction,
    occurredAt: normalizedEmail.date,
    source: "sync_activity",
    fromEmail,
    fromName: normalizedEmail.fromName,
    toEmails,
    ccEmails,
    subject: normalizedEmail.subject,
    bodyText: normalizedEmail.bodyText,
    labels: normalizedEmail.labelIds,
    connectionEmail: connection.email,
    companyDomains: profile?.companyDomains ?? [],
    userEmailAddresses: profile?.userEmailAddresses ?? [],
    knownPlatformSenders: profile?.knownPlatformSenders ?? [],
  });

  // ── Inbox v2: Sync-step 7.5 — upsert email_threads row + classify ──────
  //
  // Every email flows through this function, so it's the single integration
  // point for the new inbox's per-thread state. We upsert first (fast), then
  // defer classification to after the response so an OpenAI call never blocks
  // sync — Next.js `after()` keeps the function alive past the response so
  // the in-flight OpenAI + Supabase UPDATE aren't aborted when the serverless
  // container freezes (the pre-`after()` `.catch()` form left ~95% of threads
  // with NULL `ai_summary` because the UPDATE never reached Postgres).
  //
  // A failure here must not break the sync loop — swallow errors into the
  // log and keep going.
  try {
    const { threadRow, isNew } = await EmailThreadService.upsertFromEmail({
      companyId: connection.companyId,
      connectionId: connection.id,
      providerThreadId: normalizedEmail.threadId,
      email: normalizedEmail,
      direction,
      opportunityId,
    });

    const needsClassify =
      isNew ||
      threadRow.categoryConfidence < 0.6 ||
      (direction === "inbound" && !threadRow.categoryManuallySet);

    if (needsClassify) {
      after(async () => {
        try {
          await EmailThreadService.classifyAndUpdate(threadRow);
        } catch (err) {
          console.error(
            "[sync-engine] thread classify failed (non-fatal) for",
            threadRow.id,
            err instanceof Error ? err.message : err
          );
        }
      });
    } else if (direction === "inbound") {
      // New inbound on an already-classified thread — no need to reclassify,
      // but Phase C still needs to decide whether to draft/send/archive.
      after(async () => {
        try {
          const { PhaseCAutonomyRouter } = await import("./phase-c-autonomy-router");
          const result = await PhaseCAutonomyRouter.route(threadRow);
          if (
            result.outcome !== "noop_off" &&
            result.outcome !== "noop_draft_on_request"
          ) {
            console.log(
              "[phase-c-router] thread=%s outcome=%s level=%s (inbound reuse)",
              threadRow.id,
              result.outcome,
              result.effectiveLevel
            );
          }
        } catch (err) {
          console.error(
            "[phase-c-router] sync-engine inbound route failed (non-fatal):",
            err instanceof Error ? err.message : err
          );
        }
      });
    }
  } catch (err) {
    console.error(
      "[sync-engine] email_threads upsert failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
  }
  return true;
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

  // Bug bb63c37e — the prior body ("3 new leads · 5 matched") was abstract:
  // the user couldn't tell what to do or what was actually waiting for them.
  // Build a sender-flavored detail line so the notification names the
  // highest-signal item (the most recent unmatched email or the freshest new
  // lead) and points the action button at the right destination.
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

  const summary = parts.join(" · ");

  // Pull the most recent inbound activity for this connection so we can name
  // a real sender / subject in the body. Best-effort: if the read fails or
  // there's nothing fresh, fall back to the count summary alone.
  const supabase = requireSupabase();
  let recentDetail: string | null = null;
  try {
    const { data: latest } = await supabase
      .from("activities")
      .select("from_email, subject")
      .eq("company_id", connection.companyId)
      .eq("direction", "inbound")
      .not("email_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest) {
      const sender = (latest.from_email as string | null) || null;
      const subject = latest.subject as string | null;
      if (sender && subject) {
        const trimmedSubject =
          subject.length > 60 ? subject.slice(0, 57) + "…" : subject;
        recentDetail = `Latest: ${sender} — ${trimmedSubject}`;
      } else if (sender) {
        recentDetail = `Latest sender: ${sender}`;
      }
    }
  } catch (err) {
    console.warn("[sync-engine] recent-detail lookup failed:", err);
  }

  // Prefer a clear count-led title with the connection's mailbox so the user
  // knows which inbox the result came from (multi-mailbox accounts).
  const mailbox = connection.email || "Inbox";
  const body = recentDetail ? `${summary}. ${recentDetail}` : summary;

  // When the in-app inbox is hidden for this company, the "Review Inbox" CTA
  // is a dead end. Repoint to /pipeline (the right destination when the sync
  // surfaces new leads) and relabel accordingly.
  const inboxEnabled = await AdminFeatureOverrideService.isFeatureEnabled(
    connection.companyId,
    "inbox_ui"
  );

  // `email_sync_complete` is the canonical type — both web (drawer registry
  // via NOTIF_TYPE_META) and iOS (NotificationListView icon table + deep
  // link) recognize it. Action lands on /pipeline since iOS has no inbox.
  await supabase.from("notifications").insert({
    user_id: userId,
    company_id: connection.companyId,
    type: "email_sync_complete",
    title: `Email sync · ${mailbox}`,
    body,
    is_read: false,
    persistent: false,
    deep_link_type: "inbox",
    action_url: inboxEnabled ? "/inbox" : "/pipeline",
    action_label: inboxEnabled ? "Review Inbox" : "View pipeline",
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

// ─── Import-shell reconciliation ───────────────────────────────────────────

/**
 * Reconcile a wizard-import shell activity against a freshly-synced provider
 * message on the same thread.
 *
 * The wizard import (`/api/integrations/email/import`) creates "shell"
 * activities with a deterministic synthetic message id of the form
 * `import:<threadId>:<seq>` because it has no real Gmail message id. Steady
 * sync dedupes on the exact `email_message_id`, so those synthetic shells are
 * invisible to it — a re-sync of an imported thread would otherwise create a
 * duplicate activity for correspondence the import already captured.
 *
 * This promotes the oldest still-synthetic shell on the thread to the real
 * provider message id and reports the reconciliation, so the caller skips
 * creating a new row. It only ever touches the `import:<threadId>:%` synthetic
 * form, never a real-id activity, and each promotion writes a unique real id —
 * respecting the partial unique index `activities_email_message_id_unique`.
 *
 * Returns true when a shell was reconciled (caller must NOT create a new row),
 * false otherwise.
 */
async function reconcileImportShell(
  supabase: SupabaseClient,
  threadId: string,
  realMessageId: string
): Promise<boolean> {
  const { data: importShells } = await supabase
    .from("activities")
    .select("id")
    .eq("email_thread_id", threadId)
    .like("email_message_id", `import:${threadId}:%`)
    .order("created_at", { ascending: true })
    .limit(1);

  if (!importShells || importShells.length === 0) return false;

  const { error } = await supabase
    .from("activities")
    .update({ email_message_id: realMessageId })
    .eq("id", importShells[0].id);

  if (error) {
    // A unique-violation here means the real id already exists on another row
    // (it was synced into a different activity). The exact-id dedup upstream
    // already handles that case, so treat the shell as un-reconciled and let
    // the caller proceed; do not duplicate or crash the sync loop.
    console.error(
      "[sync-engine] Failed to reconcile import shell (non-fatal):",
      error.message
    );
    return false;
  }

  return true;
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
  const normalizedEmail = normalizeProviderBackedEmailForSync(
    email,
    connection,
    result,
    "sync_inbound_email"
  );
  if (!normalizedEmail) return false;
  email = normalizedEmail;

  const supabase = requireSupabase();

  // Dedup: check if we already have this email
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("email_message_id", email.id)
    .limit(1);

  if (existing && existing.length > 0) return false;

  // Reconcile a wizard-import shell on the same provider thread before
  // creating a fresh activity. Wizard imports mint synthetic message ids of
  // the form `import:<threadId>:<seq>` (see email/import/route.ts); those
  // shells carry no real Gmail message id, so the exact-id dedup above can
  // never match them. Without reconciliation a re-sync of an imported thread
  // would create a duplicate activity for correspondence the import already
  // recorded. Promote the oldest unreconciled shell to this real message id
  // instead. Guarded to the synthetic form so a real-id activity is never
  // touched. The partial unique index activities_email_message_id_unique is
  // respected: each promotion writes a real, unique id and frees the synthetic
  // one.
  if (await reconcileImportShell(supabase, email.threadId, email.id)) {
    return false;
  }

  const {
    email: effectiveEmail,
    submitter: contactFormSubmitter,
  } = applyContactFormSubmitterIdentity(email);
  const inboundEnrichmentFacts = leadEnrichmentFactsFromEmail({
    email,
    direction: "inbound",
    connection,
    profile,
    submitter: contactFormSubmitter,
  });

  // Thread inheritance — is this thread already linked to an OPS lead?
  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", email.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (threadLink && threadLink.length > 0) {
    const activityCreated = await createActivity(
      effectiveEmail,
      connection,
      threadLink[0].opportunity_id,
      "inbound"
    );
    if (!activityCreated) return false;
    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: threadLink[0].opportunity_id,
      facts: inboundEnrichmentFacts,
      companyId: connection.companyId,
    });
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
    maybeAutoGenerateDraft(effectiveEmail, connection, threadLink[0].opportunity_id, contactFormSubmitter)
      .catch((err) => console.error("[sync-engine] Auto-draft error (non-fatal):", err));

    // ── S2.3: Reschedule request detection (fire-and-forget) ───────────
    // Looks up the just-created activity row and runs the reschedule
    // classifier (phase_c gated + heuristic + GPT). Never blocks sync.
    maybeDetectRescheduleRequest(effectiveEmail, connection, threadLink[0].opportunity_id)
      .catch((err) =>
        console.error("[sync-engine] Reschedule detection error (non-fatal):", err)
      );

    return false;
  }

  // Pattern matching
  const senderEmail = extractSenderEmail(email.from);
  const isPatternMatch = matchesPattern(email, profile);
  const isPlatformMatch = matchPlatform(senderEmail) !== null;
  const isForwarderMatch =
    profile.teamForwarders?.some((f) =>
      senderEmail.includes(f.toLowerCase())
    ) && isFormSubmissionSubject(email.subject);

  if (isPatternMatch || isPlatformMatch || isForwarderMatch) {
    const matchResult = await EmailMatchingServiceV2.match(
      connection.companyId,
      extractSenderEmail(effectiveEmail.from),
      {
        threadId: email.threadId,
        name: effectiveEmail.fromName,
        connectionId: connection.id,
      }
    );
    const relationshipDecision = await findOpportunityRelationshipMatch({
      supabase,
      companyId: connection.companyId,
      connectionId: connection.id,
      providerThreadId: email.threadId,
      clientId: matchResult.clientId,
      facts: opportunityRelationshipFactsFromLeadEnrichment(
        inboundEnrichmentFacts,
        effectiveEmail
      ),
    });
    const relationshipDecisionRequiresNewOpportunity =
      relationshipDecision.action === "create_new";

    if (relationshipDecision.action === "link") {
      const oppId = relationshipDecision.opportunityId;
      const linked = await linkThread(oppId, email.threadId, connection.id);
      if (!linked) return false;
      const activityCreated = await createActivity(
        effectiveEmail,
        connection,
        oppId,
        "inbound",
        {
          matchConfidence: relationshipDecision.confidence,
        }
      );
      if (!activityCreated) return false;
      await applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: oppId,
        clientId: relationshipDecision.clientId ?? matchResult.clientId,
        facts: inboundEnrichmentFacts,
        companyId: connection.companyId,
      });
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

      if (matchResult.action === "create_subclient" && matchResult.clientId) {
        await createSubClient(
          effectiveEmail,
          matchResult.clientId,
          connection.companyId,
          contactFormSubmitter
        );
      }

      maybeAutoGenerateDraft(effectiveEmail, connection, oppId, contactFormSubmitter)
        .catch((err) => console.error("[sync-engine] Auto-draft error (non-fatal):", err));
      return false;
    }

    if (matchResult.action === "create_new") {
      const clientId = await createClient(
        effectiveEmail,
        connection.companyId,
        contactFormSubmitter,
        inboundEnrichmentFacts
      );
      const oppId = await createOpportunity(
        effectiveEmail,
        clientId,
        connection.companyId,
        "new_lead",
        {
          candidates: contactFormTitleCandidate(contactFormSubmitter),
          unsafe: syncTitleUnsafeIdentity(connection, profile),
          enrichmentFacts: inboundEnrichmentFacts,
        }
      );
      const linked = await linkThread(oppId, email.threadId, connection.id);
      if (!linked) return false;
      const activityCreated = await createActivity(
        effectiveEmail,
        connection,
        oppId,
        "inbound"
      );
      if (!activityCreated) return false;
      await applyLabel(email.threadId, connection, result);
      result.newLeads++;
      result.activitiesCreated++;

      // ── Forwarded contact-form NEW lead: draft a fresh first reply on a new
      // thread to the client. Scoped to contact-form submissions so ordinary new
      // leads are unchanged — this create_new branch does not otherwise
      // auto-draft. Gating (phase_c + autonomy + confidence) lives inside.
      if (contactFormSubmitter) {
        maybeAutoGenerateDraft(effectiveEmail, connection, oppId, contactFormSubmitter)
          .catch((err) => console.error("[sync-engine] Auto-draft error (non-fatal):", err));
      }

      // ── P1: Suggest project creation for new leads (fire-and-forget) ──
      // Gated behind phase_c — only enabled companies get suggestions.
      if (connection.userId) {
        AdminFeatureOverrideService.isAIFeatureEnabled(
          connection.companyId,
          "phase_c"
        ).then((enabled) => {
          if (!enabled) return;
          maybeSuggestProject({
            email: effectiveEmail,
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
      const matchedClientId = matchResult.clientId!;
      const titleOptions = {
        candidates: contactFormTitleCandidate(contactFormSubmitter),
        unsafe: syncTitleUnsafeIdentity(connection, profile),
        enrichmentFacts: inboundEnrichmentFacts,
      };
      const oppId = relationshipDecisionRequiresNewOpportunity
        ? await createOpportunity(
            effectiveEmail,
            matchedClientId,
            connection.companyId,
            "new_lead",
            titleOptions
          )
        : await getOrCreateOpportunity(
            matchedClientId,
            connection.companyId,
            effectiveEmail,
            titleOptions
          );
      const linked = await linkThread(oppId, email.threadId, connection.id);
      if (!linked) return false;
      const activityCreated = await createActivity(
        effectiveEmail,
        connection,
        oppId,
        "inbound"
      );
      if (!activityCreated) return false;
      if (relationshipDecisionRequiresNewOpportunity) {
        await applyCanonicalLeadEnrichment({
          supabase,
          opportunityId: oppId,
          clientId: matchedClientId,
          facts: inboundEnrichmentFacts,
          companyId: connection.companyId,
        });
      } else {
        await updateCorrespondenceCounts(
          oppId,
          "inbound",
          email.date,
          connection.companyId,
          followUpDaysCache,
          result
        );
      }
      await applyLabel(email.threadId, connection, result);
      if (relationshipDecisionRequiresNewOpportunity) {
        result.newLeads++;
      } else {
        result.matched++;
      }
      result.activitiesCreated++;

      if (matchResult.action === "create_subclient") {
        await createSubClient(
          effectiveEmail,
          matchedClientId,
          connection.companyId,
          contactFormSubmitter
        );
      }

      // ── E5: Auto-draft / auto-send (fire-and-forget) ─────────────────
      if (!relationshipDecisionRequiresNewOpportunity) {
        maybeAutoGenerateDraft(effectiveEmail, connection, oppId)
          .catch((err) => console.error("[sync-engine] Auto-draft error (non-fatal):", err));
      }
    } else if (matchResult.action === "review") {
      const activityCreated = await createActivity(effectiveEmail, connection, null, "inbound", {
        matchNeedsReview: true,
        suggestedClientId: matchResult.suggestedClientId,
        matchConfidence: matchResult.confidence,
      });
      if (!activityCreated) return false;
      result.needsReview++;
      result.activitiesCreated++;
    }
    return false; // Matched by pattern
  }

  // Unmatched — upsert into email_threads so it appears in inbox,
  // then send to AI classification if feature-gated.
  try {
    await EmailThreadService.upsertFromEmail({
      companyId: connection.companyId,
      connectionId: connection.id,
      providerThreadId: email.threadId,
      email: effectiveEmail,
      direction: "inbound",
    });
  } catch (err) {
    console.error("[sync-engine] upsertFromEmail failed for unmatched email (non-fatal):", err);
  }
  return true;
}

async function processSentEmail(
  email: NormalizedEmail,
  connection: EmailConnection,
  profile: SyncProfile,
  followUpDaysCache: Map<string, number>,
  result: SyncCycleResult
): Promise<void> {
  const normalizedEmail = normalizeProviderBackedEmailForSync(
    email,
    connection,
    result,
    "sync_sent_email"
  );
  if (!normalizedEmail) return;
  email = normalizedEmail;

  const supabase = requireSupabase();

  // Dedup
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("email_message_id", email.id)
    .limit(1);

  if (existing && existing.length > 0) return;

  // Reconcile a wizard-import shell before minting a fresh sent activity, for
  // the same reason as inbound: import shells carry synthetic ids and are
  // invisible to the exact-id dedup. Promote the oldest shell on this thread
  // to the real message id rather than duplicating the row.
  if (await reconcileImportShell(supabase, email.threadId, email.id)) {
    return;
  }

  // Thread inheritance for sent mail
  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", email.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (threadLink && threadLink.length > 0) {
    const activityCreated = await createActivity(
      email,
      connection,
      threadLink[0].opportunity_id,
      "outbound"
    );
    if (!activityCreated) return;
    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: threadLink[0].opportunity_id,
      facts: leadEnrichmentFactsFromEmail({
        email,
        direction: "outbound",
        connection,
        profile,
      }),
      companyId: connection.companyId,
    });
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

    // Task 5: Reconcile pending mailbox drafts now that the outbound activity
    // is persisted. Fire-and-forget — must not block or throw from the sync loop.
    reconcilePendingMailboxDrafts({
      connection,
      providerThreadId: email.threadId,
      supabase,
    }).catch((err) =>
      console.error("[sync-engine] reconcilePendingMailboxDrafts error (non-fatal):", err)
    );
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

    const recipientCandidate = identityCandidateFromMailbox(
      "outbound_recipient",
      recipient
    );
    const recipientEmail = recipientCandidate.email || extractSenderEmail(recipient);
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
      const outboundEnrichmentFacts = leadEnrichmentFactsFromEmail({
        email: {
          ...email,
          to: [recipient],
          cc: [],
        },
        direction: "outbound",
        connection,
        profile,
      });
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
        const effectiveRecipientEmail: NormalizedEmail = {
          ...email,
          from: recipientEmail,
          fromName: recipientCandidate.name ?? recipientEmail.split("@")[0],
        };
        const clientId = await createClient(
          effectiveRecipientEmail,
          connection.companyId,
          null,
          outboundEnrichmentFacts
        );
        const oppId = await createOpportunity(
          effectiveRecipientEmail,
          clientId,
          connection.companyId,
          "qualifying",
          {
            kind: "estimate",
            candidates: [recipientCandidate],
            unsafe: syncTitleUnsafeIdentity(connection, profile),
            enrichmentFacts: outboundEnrichmentFacts,
          }
        );
        const linked = await linkThread(oppId, email.threadId, connection.id);
        if (!linked) return;
        const activityCreated = await createActivity(
          email,
          connection,
          oppId,
          "outbound"
        );
        if (!activityCreated) return;
        await applyLabel(email.threadId, connection, result);
        result.newLeads++;
        result.activitiesCreated++;
        threadLinkedByThisEmail = true;
      } else if (matchResult.clientId) {
        const oppId = await getOrCreateOpportunity(
          matchResult.clientId,
          connection.companyId,
          email,
          {
            kind: "estimate",
            candidates: [recipientCandidate],
            unsafe: syncTitleUnsafeIdentity(connection, profile),
            enrichmentFacts: outboundEnrichmentFacts,
          }
        );
        const linked = await linkThread(oppId, email.threadId, connection.id);
        if (!linked) return;
        const activityCreated = await createActivity(
          email,
          connection,
          oppId,
          "outbound"
        );
        if (!activityCreated) return;
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

  // Task 5: Reconcile pending mailbox drafts after activities are persisted.
  // Fires for the safety-net path (new-external-address sends and estimate
  // pattern matches that didn't hit the thread-linked early-return above).
  // Fire-and-forget — must not block or throw from the sync loop.
  reconcilePendingMailboxDrafts({
    connection,
    providerThreadId: email.threadId,
    supabase,
  }).catch((err) =>
    console.error("[sync-engine] reconcilePendingMailboxDrafts error (non-fatal):", err)
  );
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

/** True when no ai_draft_history row for this connection has yet carried a
 *  mailbox_draft_id — i.e. this is the first time OPS places a draft in the
 *  user's real mailbox. Drives the one-time discovery explainer. Callers must
 *  check this BEFORE the current placement's mailbox_draft_id is persisted, so
 *  the current draft isn't counted as a prior one. */
async function isFirstMailboxDraftEver(
  supabase: ReturnType<typeof requireSupabase>,
  connectionId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("ai_draft_history")
    .select("id")
    .eq("connection_id", connectionId)
    .not("mailbox_draft_id", "is", null)
    .limit(1);
  return !data || (data as unknown[]).length === 0;
}

/** One-time "OPS now drafts your replies" notification, fired the first time a
 *  mailbox draft is placed for a connection while the in-app inbox is hidden.
 *  Self-contained + non-fatal: a failure here never surfaces to the caller. */
async function fireFirstMailboxDraftExplainer(
  supabase: ReturnType<typeof requireSupabase>,
  connection: EmailConnection
): Promise<void> {
  if (!connection.userId) return;
  try {
    const mailboxName = connection.provider === "gmail" ? "Gmail" : "Outlook";
    await supabase.from("notifications").insert({
      user_id: connection.userId,
      company_id: connection.companyId,
      type: "ai_milestone" as const,
      title: "Replies, drafted",
      body: `OPS now writes your replies and drops them in your ${mailboxName} drafts. Review and send.`,
      is_read: false,
      persistent: false,
      action_url: "/settings?tab=integrations",
      action_label: "Email settings",
    });
  } catch (explainerErr) {
    console.warn(
      "[sync-engine] draft-explainer notification failed (non-fatal):",
      explainerErr
    );
  }
}

/**
 * Sprint E5: Auto-draft generation for inbound emails on linked threads.
 * Checks auto_draft_enabled + category autonomy + writing profile confidence.
 * Fire-and-forget — errors logged, not thrown.
 *
 * `submitter` (forwarded contact-form identity, when present) flips the draft
 * from a thread reply to a fresh NEW-THREAD outreach addressed to the actual
 * client — see the contact-form branch below.
 */
export async function maybeAutoGenerateDraft(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string,
  submitter?: ContactFormSubmissionIdentity | null,
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

    // Determine profile type from subject heuristics for category lookup.
    // Contact-form submissions are general new-client inquiries — gate them on
    // "general" and skip the heuristic, because the forwarder's junk subject
    // ("New submission", "Got a new submission") misclassifies (e.g.
    // "submission" matches "sub" → subtrade_coordination → draft_on_request),
    // which would silently suppress the draft.
    const lowerSubject = email.subject.toLowerCase();
    let profileType = "general";
    if (!submitter) {
      if (lowerSubject.includes("warranty") || lowerSubject.includes("defect")) profileType = "warranty_claim";
      else if (lowerSubject.includes("quote") || lowerSubject.includes("estimate") || lowerSubject.includes("pricing")) profileType = "client_quoting";
      else if (lowerSubject.includes("order") || lowerSubject.includes("supply") || lowerSubject.includes("material")) profileType = "vendor_ordering";
      else if (lowerSubject.includes("sub") || lowerSubject.includes("coordinate")) profileType = "subtrade_coordination";
      else if (lowerSubject.includes("follow") || lowerSubject.includes("checking in")) profileType = "client_followup";
    }

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

    // ── Forwarded / contact-form submission → fresh NEW-THREAD outreach ─────
    // The inbound lives on the forwarder's (or platform's) thread; a reply glued
    // there with "Re: <form subject>" is wrong. Draft a clean new thread to the
    // actual client instead, capture the provider-minted thread id (so
    // reconciliation can track the reply), and link it to the opportunity.
    // Never auto-sends — a cold first contact is always review-only, regardless
    // of the category autonomy level.
    if (submitter && submitter.email) {
      const draftResult = await AIDraftService.generateDraft({
        companyId: connection.companyId,
        userId: connection.userId,
        connectionId: connection.id,
        opportunityId,
        recipientEmail: submitter.email,
        recipientName: submitter.name ?? undefined,
        userInstruction: buildContactFormDraftInstruction(submitter),
        origin: "phase_c",
      });
      if (!draftResult.available || !draftResult.draft || !draftResult.draftHistoryId) {
        return;
      }

      const inboxUiEnabled = await AdminFeatureOverrideService.isFeatureEnabled(
        connection.companyId,
        "inbox_ui"
      );
      try {
        const provider = EmailService.getProvider(connection);
        // Compute BEFORE the push so this placement isn't counted as prior.
        const wasFirstMailboxDraft =
          !inboxUiEnabled &&
          (await isFirstMailboxDraftEver(supabase, connection.id));
        await placeNewThreadDraft({
          provider,
          connectionId: connection.id,
          opportunityId,
          draftHistoryId: draftResult.draftHistoryId,
          to: submitter.email,
          subject: CONTACT_FORM_OUTREACH_SUBJECT,
          body: draftResult.draft,
        });
        if (wasFirstMailboxDraft) {
          await fireFirstMailboxDraftExplainer(supabase, connection);
        }
      } catch (err) {
        console.error(
          "[sync-engine] contact-form new-thread draft push failed (non-fatal):",
          err
        );
        // Status-only fallback so the UI still surfaces the AI draft.
        await supabase
          .from("ai_draft_history")
          .update({ status: "auto_drafted" })
          .eq("id", draftResult.draftHistoryId);
      }

      if (inboxUiEnabled) {
        await supabase.from("notifications").insert({
          user_id: connection.userId,
          company_id: connection.companyId,
          type: "ai_milestone" as const,
          title: "Draft ready",
          body: `AI drafted a first reply to ${submitter.name ?? submitter.email}`,
          is_read: false,
          persistent: false,
          action_url: "/inbox",
          action_label: "Review",
        });
      }
      return;
    }

    // All checks passed — generate auto-draft
    const draftResult = await AIDraftService.generateDraft({
      companyId: connection.companyId,
      userId: connection.userId,
      connectionId: connection.id,
      opportunityId,
      threadId: email.threadId,
    });

    if (!draftResult.available || !draftResult.draft) return;

    // Determine once whether the in-app inbox is visible for this company.
    // Used below to gate per-draft notifications and the one-time explainer.
    const inboxUiEnabled = await AdminFeatureOverrideService.isFeatureEnabled(
      connection.companyId,
      "inbox_ui"
    );

    // Push the draft into the user's real mailbox Drafts folder (idempotent).
    // Fire-and-forget context already; keep failures non-fatal.
    if (draftResult.draftHistoryId) {
      try {
        const provider = EmailService.getProvider(connection);
        const replySubject = /^re:/i.test(email.subject)
          ? email.subject
          : `Re: ${email.subject}`;
        const to = extractSenderEmail(email.from);

        const { data: priorRows } = await supabase
          .from("ai_draft_history")
          .select("id, mailbox_draft_id, status")
          .eq("connection_id", connection.id)
          .eq("thread_id", email.threadId);
        const existing = pickExistingMailboxDraft(
          (priorRows ?? []) as MailboxDraftRow[]
        );

        let mailboxDraftId: string;
        if (existing?.mailbox_draft_id) {
          // Reuse the existing provider draft — update in-place rather than
          // creating a duplicate in the user's Drafts folder. updateDraft
          // returns void; keep the id from the prior row.
          await provider.updateDraft(
            existing.mailbox_draft_id,
            to,
            replySubject,
            draftResult.draft,
            email.threadId
          );
          mailboxDraftId = existing.mailbox_draft_id;
        } else {
          mailboxDraftId = await provider.createDraft(
            to,
            replySubject,
            draftResult.draft,
            email.threadId
          );

          // One-time discovery explainer: fired the first time OPS successfully
          // places a mailbox draft for this connection AND the in-app inbox is
          // hidden. Dedup: only if no prior ai_draft_history row for this
          // connection carries a mailbox_draft_id (i.e., this is the first
          // successful mailbox placement ever). Wrapped so a failure never
          // surfaces to the caller.
          // One-time discovery explainer — first mailbox placement for this
          // connection while the in-app inbox is hidden. Checked here (after
          // createDraft, before the row's mailbox_draft_id is persisted below)
          // so the current draft isn't counted as a prior placement.
          if (
            !inboxUiEnabled &&
            connection.userId &&
            (await isFirstMailboxDraftEver(supabase, connection.id))
          ) {
            await fireFirstMailboxDraftExplainer(supabase, connection);
          }
        }

        await supabase
          .from("ai_draft_history")
          .update({ status: "auto_drafted", mailbox_draft_id: mailboxDraftId })
          .eq("id", draftResult.draftHistoryId);
      } catch (err) {
        console.error(
          "[sync-engine] mailbox draft push failed (non-fatal):",
          err
        );
        // Status-only fallback — still mark the row so the UI surfaces the
        // AI draft even if mailbox placement failed.
        await supabase
          .from("ai_draft_history")
          .update({ status: "auto_drafted" })
          .eq("id", draftResult.draftHistoryId);
      }
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

    // Fire notification for auto-draft only (no auto-send) — but only when the
    // in-app inbox is visible. When hidden, the draft lands silently in Gmail/
    // Outlook and the one-time explainer (above) already told the user once.
    if (inboxUiEnabled) {
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
    }
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
              const classifiedEmail = normalizeProviderBackedEmailForSync(
                classified.email,
                connection,
                result,
                "sync_ai_classified_lead"
              );
              if (!classifiedEmail) continue;

              const matchResult = await EmailMatchingServiceV2.match(
                connection.companyId,
                classified.clientEmail,
                {
                  threadId: classifiedEmail.threadId,
                  name: classified.clientName,
                  connectionId: connection.id,
                }
              );

              const classifiedEnrichmentFacts = leadEnrichmentFactsFromImport({
                contactName: classified.clientName,
                contactEmail: classified.clientEmail,
                contactPhone: classified.clientPhone,
                address: classified.address,
                estimatedValue: classified.estimatedValue,
                description: classified.description,
                providerThreadId: classifiedEmail.threadId,
                providerMessageId: classifiedEmail.id,
                // Steady-sync AI classifier output is genuinely model-derived;
                // record it as source='ai' carrying the model's own confidence.
                extractionSource: "ai_classified",
                aiConfidence: classified.confidence,
              });

              let clientId: string;
              if (matchResult.action === "link" || matchResult.action === "create_subclient") {
                clientId = matchResult.clientId!;
              } else {
                clientId = await createClient(
                  classifiedEmail,
                  connection.companyId,
                  null,
                  classifiedEnrichmentFacts
                );
              }

              const oppId = await createOpportunity(
                classifiedEmail,
                clientId,
                connection.companyId,
                classified.stage,
                {
                  candidates: [
                    {
                      source: "contact",
                      name: classified.clientName,
                      email: classified.clientEmail,
                    },
                  ],
                  unsafe: syncTitleUnsafeIdentity(connection, profile),
                  enrichmentFacts: classifiedEnrichmentFacts,
                }
              );
              const linked = await linkThread(
                oppId,
                classifiedEmail.threadId,
                connection.id
              );
              if (!linked) continue;
              const activityCreated = await createActivity(classifiedEmail, connection, oppId, "inbound", {
                matchConfidence: "ai",
              });
              if (!activityCreated) continue;
              await applyLabel(classifiedEmail.threadId, connection, result);
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
