// src/lib/api/services/sync-engine.ts
// Core sync cycle — runs on every sync trigger (cron, manual, webhook).
// Implements the 12-step flow from spec Section 4C.

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabase, runWithSupabase } from "@/lib/supabase/helpers";
import { escapeIlikeLiteral } from "@/lib/supabase/ilike-literal";
import { EmailService } from "./email-service";
import { EmailMatchingServiceV2 } from "./email-matching-service-v2";
import { EmailFilterService } from "./email-filter-service";
import { StageEvaluator } from "./stage-evaluator";
import { AISyncReviewer } from "./ai-sync-reviewer";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { EmailOutboundLearningService } from "./email-outbound-learning-service";
import {
  EmailSignatureService,
  stripRenderedEmailSignature,
} from "./email-signature-service";
import { WritingProfileService } from "./writing-profile-service";
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
import { normalizeReplySubject } from "@/lib/email/email-subject-policy";
import {
  renderMailboxDraftWithSignature,
  resolveEmailSignatureForMessage,
} from "@/lib/email/email-signature-runtime";
import { ProjectConversionService } from "./project-conversion-service";
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
  buildLeadRoutingIdentity,
  resolvePersistedEmailDirection,
  type LeadRoutingIdentity,
} from "@/lib/email/email-ingestion-routing";
import {
  logInvalidProviderEmailIds,
  validateProviderEmailIds,
} from "@/lib/email/provider-email-ids";
import {
  extractContactFormSubmission,
  type ContactFormSubmissionIdentity,
} from "@/lib/utils/email-parsing";
import { shouldAutoConvertLikelyWon } from "@/lib/email/terminal-stage-decision";
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
  type EmailProviderInterface,
  type NormalizedEmail,
  type SyncResult,
} from "./email-provider";
import { cleanMessageBody } from "./conversation-state/message-cleaner";
import {
  assembleConversationState,
  type RawThreadMessage,
} from "./conversation-state/conversation-state";
import { evaluateOpportunityAcceptance } from "./conversation-state/acceptance-evaluation";
import { fetchOperatorIdentity } from "./conversation-state/operator-identity";
import type {
  OperatorIdentity,
  ResolvedContact,
} from "./conversation-state/types";

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

/** A semantic opportunity write failed, so the provider cursor must not move. */
class LifecyclePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecyclePersistenceError";
  }
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

// ─── P0-C: operator-aware contact hygiene ────────────────────────────────────
//
// Resolving the customer contact (operator-excluded on every field) needs the
// operator's full identity — including company phones/addresses, which require a
// DB read. getCompanyContext is NOT internally cached, so we memoize the built
// identity per connection for a short window to avoid a per-email read during a
// sync (a sync processes one connection's mailbox).
const OPERATOR_IDENTITY_TTL_MS = 10 * 60 * 1000;
const operatorIdentityCache = new Map<
  string,
  { identity: OperatorIdentity; at: number }
>();

async function getCachedOperatorIdentity(
  connection: EmailConnection
): Promise<OperatorIdentity> {
  const now = Date.now();
  const cached = operatorIdentityCache.get(connection.id);
  if (cached && now - cached.at < OPERATOR_IDENTITY_TTL_MS) {
    return cached.identity;
  }
  const identity = await fetchOperatorIdentity(
    connection.companyId,
    connection
  );
  operatorIdentityCache.set(connection.id, { identity, at: now });
  return identity;
}

/** Shape a NormalizedEmail as a single conversation-state RawThreadMessage. */
function rawThreadMessageFromEmail(email: NormalizedEmail): RawThreadMessage {
  return {
    providerMessageId: email.id,
    fromEmail: email.from,
    fromName: email.fromName || null,
    toEmails: email.to,
    ccEmails: email.cc,
    subject: email.subject,
    sentAt: email.date.toISOString(),
    rawBody: email.bodyText || "",
    providerCleanBody: email.bodyTextClean ?? null,
    attachments: [],
  };
}

/**
 * Resolve the customer contact for an inbound lead through the deterministic
 * clean-state layer: operator excluded on name/email/phone/address, phone shape-
 * validated, address bounded, and the name verified (an email local-part is never
 * a verified name). Reuses assembleConversationState so the per-message cleaning +
 * classification matches the rest of the pipeline exactly.
 */
async function resolveInboundLeadContact(
  email: NormalizedEmail,
  connection: EmailConnection,
  submitter: ContactFormSubmissionIdentity | null
): Promise<ResolvedContact> {
  const operator = await getCachedOperatorIdentity(connection);
  return assembleConversationState({
    threadId: email.threadId,
    connectionId: connection.id,
    companyId: connection.companyId,
    operator,
    rawMessages: [rawThreadMessageFromEmail(email)],
    stage: "new_lead",
    contactFormSubmitter: submitter
      ? {
          name: submitter.name,
          email: submitter.email,
          phone: submitter.phone,
          address: submitter.address ?? null,
          company: submitter.company ?? null,
        }
      : null,
    commitments: [],
  }).contact;
}

/**
 * Override the polluted name/phone/address/email on enrichment facts with the
 * operator-excluded resolved contact. The resolved name is applied ONLY when
 * verified; phone/address are replaced outright (dropping any operator-signature
 * value the legacy extractor captured). A null resolved email leaves the
 * already-safeCustomerEmail-guarded fact untouched.
 */
function applyResolvedContactToFacts(
  facts: LeadEnrichmentFacts,
  resolved: ResolvedContact
): void {
  if (resolved.nameIsVerified && resolved.name) {
    facts.contactName = resolved.name;
  }
  if (resolved.email) facts.contactEmail = resolved.email;
  facts.contactPhone = resolved.phone;
  facts.address = resolved.address;
}

// ─── P0-A: per-connection sync lock ──────────────────────────────────────────
//
// Serializes syncs for a single connection so the webhook manual-sync and the
// 15-min cron cannot overlap and double-create leads for the same thread. The
// claim is a single atomic conditional UPDATE: it succeeds only when no fresh
// lock is held (NULL or older than the TTL — a crashed sync self-heals). The DB
// UNIQUE (company_id, source_thread_key) and scoped provider ids are hard
// guarantees, but not every downstream side effect is one statement. If lock
// ownership cannot be proven, fail closed rather than run overlapping cycles.
const SYNC_LOCK_TTL_MS = 10 * 60 * 1000;
const SYNC_LOCK_RENEW_INTERVAL_MS = 2 * 60 * 1000;

async function acquireSyncLock(connectionId: string): Promise<string | null> {
  const supabase = requireSupabase();
  const staleCutoff = new Date(Date.now() - SYNC_LOCK_TTL_MS).toISOString();
  const ownerId = crypto.randomUUID();
  const { data, error } = await supabase
    .from("email_connections")
    .update({
      sync_in_progress_at: new Date().toISOString(),
      sync_lock_owner: ownerId,
    })
    .eq("id", connectionId)
    .or(`sync_in_progress_at.is.null,sync_in_progress_at.lt.${staleCutoff}`)
    .select("id");
  if (error) {
    throw new Error(
      `[sync-engine] acquireSyncLock failed: ${error.message ?? "unknown error"}`
    );
  }
  return (data?.length ?? 0) > 0 ? ownerId : null;
}

async function renewSyncLock(
  connectionId: string,
  ownerId: string
): Promise<void> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("email_connections")
    .update({ sync_in_progress_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("sync_lock_owner", ownerId)
    .select("id");
  if (error) {
    throw new Error(
      `[sync-engine] renewSyncLock failed: ${error.message ?? "unknown error"}`
    );
  }
  if ((data?.length ?? 0) !== 1) {
    throw new Error(
      `[sync-engine] sync lease ownership was lost for ${connectionId}`
    );
  }
}

async function releaseSyncLock(
  connectionId: string,
  ownerId: string
): Promise<void> {
  try {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("email_connections")
      .update({ sync_in_progress_at: null, sync_lock_owner: null })
      .eq("id", connectionId)
      .eq("sync_lock_owner", ownerId);
    if (error) {
      console.error(
        "[sync-engine] releaseSyncLock failed (non-fatal):",
        error.message
      );
    }
  } catch (err) {
    console.error("[sync-engine] releaseSyncLock threw (non-fatal):", err);
  }
}

interface CreateOpportunityTitleOptions {
  kind?: EmailOpportunityTitleKind;
  candidates?: EmailOpportunityIdentityCandidate[];
  unsafe?: EmailOpportunityUnsafeIdentity;
  enrichmentFacts?: LeadEnrichmentFacts;
  /** CRM dedupe identity. Contact-form submissions use a message-scoped key. */
  sourceKey?: string | null;
}

interface OpportunityResolution {
  id: string;
  /** The client attached to the persisted winner, including a source-key race. */
  clientId: string;
  created: boolean;
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
    email.bodyText || email.snippet || ""
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

  const defaultConfig = PIPELINE_STAGES_DEFAULT.find(
    (s) => s.slug === stageSlug
  );
  // null on terminal stages (won/lost/discarded) — return a large value so
  // StageEvaluator treats it as "never stale," not "stale in 0 days."
  const resolved = defaultConfig?.autoFollowUpDays ?? 365;
  cache.set(cacheKey, resolved);
  return resolved;
}

async function loadInternalPhonesForCompany(
  companyId: string
): Promise<string[]> {
  const supabase = requireSupabase();
  const phones: string[] = [];

  const { data: users } = await supabase
    .from("users")
    .select("phone")
    .eq("company_id", companyId);
  for (const user of users ?? []) {
    const phone = (user as { phone?: string | null }).phone;
    if (phone) phones.push(phone);
  }

  const { data: company } = await supabase
    .from("companies")
    .select("phone")
    .eq("id", companyId)
    .maybeSingle();
  const companyPhone = (company as { phone?: string | null } | null)?.phone;
  if (companyPhone) phones.push(companyPhone);

  return [...new Set(phones.map((phone) => phone.trim()).filter(Boolean))];
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

// Incremental provider cursors eventually expire. A fresh cursor cannot be
// committed until the interval since the last successful sync has been
// replayed. Gmail walks that interval in bounded batches, durably checkpointing
// the next page only after every message in the current batch has persisted.
const GMAIL_HISTORY_RECONCILIATION_OVERLAP_MS = 15 * 60 * 1000;
const GMAIL_HISTORY_RECONCILIATION_PAGE_SIZE = 100;
const GMAIL_HISTORY_RECONCILIATION_MAX_PAGES = 10;
const GMAIL_HISTORY_RECONCILIATION_MAX_THREADS = 500;
const GMAIL_HISTORY_RECONCILIATION_FETCH_CONCURRENCY = 10;

interface GmailHistoryRecoveryCheckpoint {
  anchor: Date;
  nextPageToken: string | null;
  targetToken: string;
}

interface MailboxHistoryReconciliation {
  inboxResult: SyncResult;
  sentResult: SyncResult;
  gmailCheckpoint?: GmailHistoryRecoveryCheckpoint;
}

async function reconcileExpiredMailboxHistory(
  provider: EmailProviderInterface,
  connection: EmailConnection,
  anchorOverride?: Date | null,
  includeSentMail = true
): Promise<MailboxHistoryReconciliation> {
  const persistedRecoveryTarget = connection.historyRecoveryTargetToken ?? null;
  const persistedRecoveryAnchor = connection.historyRecoveryAnchor ?? null;
  const persistedRecoveryPageToken =
    connection.historyRecoveryPageToken ?? null;
  const hasPersistedGmailRecovery =
    provider.providerType === "gmail" &&
    (persistedRecoveryTarget !== null ||
      persistedRecoveryAnchor !== null ||
      persistedRecoveryPageToken !== null);
  const recoveryAnchor = hasPersistedGmailRecovery
    ? persistedRecoveryAnchor
      ? new Date(persistedRecoveryAnchor)
      : null
    : anchorOverride
      ? new Date(anchorOverride)
      : connection.lastSyncedAt
        ? new Date(connection.lastSyncedAt)
        : null;
  if (!recoveryAnchor || Number.isNaN(recoveryAnchor.getTime())) {
    throw new Error(
      `[sync-engine] ${provider.providerType ?? "unknown"} recovery anchor is missing; cursor was not advanced`
    );
  }

  const after = hasPersistedGmailRecovery
    ? recoveryAnchor
    : new Date(
        recoveryAnchor.getTime() - GMAIL_HISTORY_RECONCILIATION_OVERLAP_MS
      );

  if (provider.providerType === "microsoft365") {
    // A blank Graph delta cursor starts a bounded full walk of the current
    // Inbox and Sent folders and yields fresh terminal links. Snapshot both
    // streams in sequence, then replay only the overlap interval. Mail arriving
    // during the walk is either present in the snapshot or appears after the
    // terminal delta links, so the combined cursor has no gap.
    const initialCursor = await provider.getInitialSyncToken();
    if (!initialCursor) {
      throw new Error(
        "[sync-engine] Microsoft 365 expired-token recovery returned an empty initial cursor; cursor was not advanced"
      );
    }
    const inboxSnapshot = await provider.fetchNewEmailsSince(initialCursor);
    const sentSnapshot = await provider.fetchSentEmailsSince(
      inboxSnapshot.nextSyncToken
    );
    return {
      inboxResult: {
        // M365 continuation cursors can expire during a multi-cycle initial
        // mailbox walk. Replay the fresh snapshot from its beginning instead
        // of filtering by a moving last_synced_at anchor; scoped immutable
        // provider IDs make the replay idempotent and preserve older pages.
        emails: inboxSnapshot.emails,
        nextSyncToken: inboxSnapshot.nextSyncToken,
      },
      sentResult: {
        emails: includeSentMail ? sentSnapshot.emails : [],
        nextSyncToken: sentSnapshot.nextSyncToken,
      },
    };
  }

  if (provider.providerType !== "gmail") {
    throw new Error(
      `[sync-engine] ${provider.providerType ?? "unknown"} expired-token recovery has no completeness guarantee; cursor was not advanced`
    );
  }

  const persistedTargetToken = persistedRecoveryTarget?.trim() || null;
  if (hasPersistedGmailRecovery && !persistedTargetToken) {
    throw new Error(
      "[sync-engine] Gmail expired-history recovery checkpoint is incomplete; cursor was not advanced"
    );
  }

  // Snapshot the future incremental boundary before listing. Persist it with
  // the fixed overlap anchor before the first provider page is requested so a
  // crash or function timeout resumes the same finite interval.
  const targetToken =
    persistedTargetToken ?? (await provider.getInitialSyncToken()).trim();
  if (!targetToken) {
    throw new Error(
      "[sync-engine] Gmail expired-token recovery returned an empty fresh cursor; cursor was not advanced"
    );
  }
  if (!hasPersistedGmailRecovery) {
    await EmailService.updateConnection(connection.id, {
      historyRecoveryAnchor: after,
      historyRecoveryPageToken: null,
      historyRecoveryTargetToken: targetToken,
    });
  }

  const threadIds = new Set<string>();
  let pageToken = hasPersistedGmailRecovery ? persistedRecoveryPageToken : null;
  let nextPageToken: string | null = pageToken;
  let pagesRead = 0;

  do {
    const page = await provider.listThreadIds({
      pageSize: GMAIL_HISTORY_RECONCILIATION_PAGE_SIZE,
      after,
      pageToken,
    });
    pagesRead += 1;

    for (const threadId of page.threadIds) {
      const normalized = threadId.trim();
      if (normalized) threadIds.add(normalized);
    }

    nextPageToken = page.nextPageToken?.trim() || null;
    if (
      !nextPageToken ||
      pagesRead >= GMAIL_HISTORY_RECONCILIATION_MAX_PAGES ||
      threadIds.size >= GMAIL_HISTORY_RECONCILIATION_MAX_THREADS
    ) {
      break;
    }
    pageToken = nextPageToken;
  } while (pageToken);

  const recoveredByMessageId = new Map<string, NormalizedEmail>();
  const ids = [...threadIds];
  for (
    let index = 0;
    index < ids.length;
    index += GMAIL_HISTORY_RECONCILIATION_FETCH_CONCURRENCY
  ) {
    const batch = ids.slice(
      index,
      index + GMAIL_HISTORY_RECONCILIATION_FETCH_CONCURRENCY
    );
    const threads = await Promise.all(
      batch.map((threadId) => provider.fetchThread(threadId))
    );

    for (const emails of threads) {
      for (const email of emails) {
        // fetchThread returns the whole conversation. Only replay the bounded
        // overlap; older messages are outside the lost incremental interval.
        if (email.date.getTime() < after.getTime()) continue;
        recoveredByMessageId.set(email.id, email);
      }
    }
  }

  return {
    // Discovery bucket does not determine persisted direction. runSync merges
    // and re-partitions these messages from author identity + labels below.
    inboxResult: {
      emails: [...recoveredByMessageId.values()],
      nextSyncToken: targetToken,
    },
    sentResult: { emails: [], nextSyncToken: targetToken },
    gmailCheckpoint: {
      anchor: after,
      nextPageToken,
      targetToken,
    },
  };
}

function normalizeProviderBackedEmailForSync(
  email: NormalizedEmail,
  connection: EmailConnection,
  result: SyncCycleResult,
  boundary: string
): NormalizedEmail {
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
    throw new Error(
      `[sync-engine] ${boundary} rejected invalid provider identity: ${validation.reasons.join(", ")}`
    );
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
      : (submitter?.email ?? extractSenderEmail(email.from));
  const senderName =
    enrichmentFacts?.companyName ??
    enrichmentFacts?.contactName ??
    submitter?.company ??
    submitter?.name ??
    (enrichmentFacts?.sourcePlatform ? null : email.fromName) ??
    // P0-C: never fabricate a name from the email local-part ("canprojack").
    "New Lead";

  // Check for existing client first to avoid duplicates
  const { data: existingClients, error: existingClientError } = senderEmail
    ? await supabase
        .from("clients")
        .select("id")
        .eq("company_id", companyId)
        .ilike("email", escapeIlikeLiteral(senderEmail))
        .is("deleted_at", null)
        .limit(1)
    : { data: null, error: null };

  if (existingClientError) {
    throw new LifecyclePersistenceError(
      `[sync-engine] client dedupe lookup failed: ${existingClientError.message ?? "unknown error"}`
    );
  }

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
  const { data, error: insertError } = await supabase
    .from("clients")
    .insert(insertedClient)
    .select("id")
    .single();
  if (insertError || !data?.id) {
    throw new LifecyclePersistenceError(
      `[sync-engine] client insert failed: ${insertError?.message ?? "missing inserted client"}`
    );
  }
  const clientId = data.id as string;

  // Record provenance for the customer facts this insert established. A fresh
  // insert cannot clobber anything, but the dossier/audit feature needs a row
  // for new leads, not only for reuse/link branches.
  if (enrichmentFacts) {
    const clientUpdates: Record<string, unknown> = {};
    if (enrichmentFacts.companyName ?? enrichmentFacts.contactName) {
      clientUpdates.name =
        enrichmentFacts.companyName ?? enrichmentFacts.contactName;
    }
    if (enrichmentFacts.contactEmail)
      clientUpdates.email = enrichmentFacts.contactEmail;
    if (enrichmentFacts.contactPhone)
      clientUpdates.phone_number = enrichmentFacts.contactPhone;
    if (enrichmentFacts.address)
      clientUpdates.address = enrichmentFacts.address;
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

function subClientIdentityFromFacts(
  facts: LeadEnrichmentFacts
): ContactFormSubmissionIdentity | null {
  if (!facts.contactEmail) return null;
  return {
    name: facts.contactName,
    email: facts.contactEmail,
    phone: facts.contactPhone,
    message: facts.description,
    address: facts.address,
    company: facts.companyName,
    estimatedValue: facts.estimatedValue,
  };
}

async function createSubClient(
  email: NormalizedEmail,
  clientId: string,
  companyId: string,
  submitter?: ContactFormSubmissionIdentity | null
): Promise<void> {
  const supabase = requireSupabase();
  const senderEmail = submitter?.email ?? extractSenderEmail(email.from);
  // P0-C: never fabricate a name from the email local-part.
  const senderName = submitter?.name || email.fromName || "New Lead";

  // Check for existing sub-client to avoid duplicates
  const { data: existingSub, error: existingSubError } = await supabase
    .from("sub_clients")
    .select("id")
    .eq("client_id", clientId)
    .ilike("email", escapeIlikeLiteral(senderEmail))
    .is("deleted_at", null)
    .limit(1);

  if (existingSubError) {
    throw new LifecyclePersistenceError(
      `[sync-engine] sub-client lookup failed: ${existingSubError.message}`
    );
  }

  if (existingSub && existingSub.length > 0) return;

  const { error: insertError } = await supabase.from("sub_clients").insert({
    company_id: companyId,
    client_id: clientId,
    name: senderName,
    email: senderEmail,
    phone_number: submitter?.phone ?? null,
  });
  if (insertError) {
    throw new LifecyclePersistenceError(
      `[sync-engine] sub-client insert failed: ${insertError.message}`
    );
  }
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
): Promise<OpportunityResolution> {
  const supabase = requireSupabase();
  const isOutbound = stage === "qualifying"; // sent folder leads start at qualifying
  const sourceKey = titleOptions.sourceKey ?? email.threadId ?? null;
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
  const { data, error } = await supabase
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
      // P0-A: dedupe key. UNIQUE (company_id, source_thread_key) makes a given
      // email thread spawn at most one opportunity, closing the sync race.
      source_thread_key: sourceKey,
      ...opportunityEnrichmentFields,
      // First-message aggregates are intentionally left at their database
      // defaults. The immutable provider event below is the only authority
      // allowed to project counters, including after a create race or replay.
      tags: ["email-import"],
    })
    .select("id, client_id")
    .single();

  // P0-A: a concurrent sync may have created this thread's opportunity first.
  // The UNIQUE (company_id, source_thread_key) raises 23505 — fetch and return
  // the existing winner instead of inserting a duplicate.
  if (error) {
    if ((error as { code?: string }).code === "23505" && sourceKey) {
      const { data: existing } = await supabase
        .from("opportunities")
        .select("id, client_id")
        .eq("company_id", companyId)
        .eq("source_thread_key", sourceKey)
        .maybeSingle();
      if (existing?.id && existing.client_id) {
        console.log("[email-ingest] lead-dedupe-hit", {
          threadKey: sourceKey,
          companyId,
        });
        return {
          id: existing.id as string,
          clientId: existing.client_id as string,
          created: false,
        };
      }
    }
    throw new Error(
      `[sync-engine] createOpportunity failed: ${
        (error as { message?: string }).message ?? "unknown error"
      }`
    );
  }

  if (!data?.id || !data.client_id) {
    throw new Error(
      "[sync-engine] createOpportunity returned no authoritative opportunity/client identity"
    );
  }
  const opportunityId = data.id as string;
  const authoritativeClientId = data.client_id as string;

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

  return {
    id: opportunityId,
    clientId: authoritativeClientId,
    created: true,
  };
}

async function getOrCreateOpportunity(
  clientId: string,
  companyId: string,
  email: NormalizedEmail,
  titleOptions: CreateOpportunityTitleOptions = {},
  // Stage used only when creating a NEW opportunity (existing active opps keep
  // their stage). Defaults to new_lead so existing callers are unchanged.
  stage: string = "new_lead"
): Promise<OpportunityResolution> {
  const supabase = requireSupabase();

  const { data: existing, error: existingError } = await supabase
    .from("opportunities")
    .select("id, client_id")
    .eq("client_id", clientId)
    .eq("company_id", companyId)
    .not("stage", "in", '("won","lost","discarded")')
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) {
    throw new LifecyclePersistenceError(
      `[sync-engine] active opportunity lookup failed: ${existingError.message ?? "unknown error"}`
    );
  }

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
    return {
      id: existing[0].id as string,
      clientId: existing[0].client_id as string,
      created: false,
    };
  }

  return createOpportunity(email, clientId, companyId, stage, titleOptions);
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
  const { error } = await supabase.from("opportunity_email_threads").upsert(
    {
      opportunity_id: opportunityId,
      thread_id: validation.providerThreadId,
      connection_id: connectionId,
    },
    {
      onConflict: "thread_id,connection_id",
      ignoreDuplicates: true,
    }
  );
  if (error) {
    throw new Error(
      `[sync-engine] linkThread failed: ${error.message ?? "unknown error"}`
    );
  }

  // An existing provider thread is immutable CRM ownership. The first writer
  // wins; a concurrent loser must retry and adopt that canonical owner on the
  // next sync, never rewrite the junction row and split future correspondence.
  const { data: canonicalRows, error: canonicalError } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", validation.providerThreadId)
    .eq("connection_id", connectionId)
    .limit(1);
  if (canonicalError) {
    throw new Error(
      `[sync-engine] linkThread canonical read failed: ${canonicalError.message ?? "unknown error"}`
    );
  }
  const canonicalOpportunityId = canonicalRows?.[0]?.opportunity_id as
    | string
    | undefined;
  if (!canonicalOpportunityId) {
    throw new Error(
      "[sync-engine] linkThread did not persist a canonical provider-thread owner"
    );
  }
  if (canonicalOpportunityId !== opportunityId) {
    throw new LifecyclePersistenceError(
      `[sync-engine] provider thread is already owned by opportunity ${canonicalOpportunityId}`
    );
  }
  return true;
}

interface ProviderThreadOpportunity {
  opportunityId: string;
  clientId: string | null;
}

async function loadProviderThreadOpportunity(
  supabase: ReturnType<typeof requireSupabase>,
  connection: EmailConnection,
  providerThreadId: string
): Promise<ProviderThreadOpportunity | null> {
  const { data: links, error: linkError } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", providerThreadId)
    .eq("connection_id", connection.id)
    .limit(1);
  if (linkError) {
    throw new LifecyclePersistenceError(
      `[sync-engine] provider thread lookup failed: ${linkError.message ?? "unknown error"}`
    );
  }
  const opportunityId = links?.[0]?.opportunity_id as string | undefined;
  if (!opportunityId) return null;

  const { data: opportunityRows, error: opportunityError } = await supabase
    .from("opportunities")
    .select("id, client_id")
    .eq("id", opportunityId)
    .eq("company_id", connection.companyId)
    .is("deleted_at", null)
    .limit(1);
  if (opportunityError) {
    throw new LifecyclePersistenceError(
      `[sync-engine] provider thread opportunity lookup failed: ${opportunityError.message ?? "unknown error"}`
    );
  }
  if (!opportunityRows?.[0]?.id) {
    throw new LifecyclePersistenceError(
      "[sync-engine] provider thread owner is not an active opportunity in the mailbox company"
    );
  }

  return {
    opportunityId: opportunityRows[0].id as string,
    clientId: (opportunityRows[0].client_id as string | null) ?? null,
  };
}

async function recordActivityCorrespondenceEvent(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string | null,
  activityId: string | null,
  direction: "inbound" | "outbound"
): Promise<void> {
  if (!opportunityId) return;
  const supabase = requireSupabase();
  const profile = connection.syncFilters as Partial<SyncProfile> | null;
  const result = await OpportunityLifecycleService.recordCorrespondenceEvent({
    supabase,
    companyId: connection.companyId,
    opportunityId,
    activityId,
    connectionId: connection.id,
    providerThreadId: email.threadId,
    providerMessageId: email.id,
    requireProviderMessageId: true,
    direction,
    occurredAt: email.date,
    source: "sync_activity",
    applyOpportunityProjection: true,
    fromEmail: extractSenderEmail(email.from),
    fromName: email.fromName,
    toEmails: email.to.map(extractSenderEmail),
    ccEmails: email.cc.map(extractSenderEmail),
    subject: email.subject,
    bodyText: email.bodyText,
    labels: email.labelIds,
    connectionEmail: connection.email,
    companyDomains: profile?.companyDomains ?? [],
    userEmailAddresses: profile?.userEmailAddresses ?? [],
    knownPlatformSenders: profile?.knownPlatformSenders ?? [],
  });

  if (!result.created && result.reason !== "duplicate_provider_message_id") {
    throw new Error(
      `[sync-engine] correspondence event rejected: ${result.reason}`
    );
  }
}

interface ActivityPersistenceOptions {
  matchNeedsReview?: boolean;
  suggestedClientId?: string | null;
  matchConfidence?: string;
  /** A platform thread may contain unrelated form submitters; do not collapse it. */
  skipThreadState?: boolean;
}

/**
 * Keep thread classification off the synchronous sync/send path without
 * assuming the caller is currently inside a Next.js request. Route handlers
 * get Next's response-lifecycle guarantee; cron workers and direct provider
 * syncs fall back to a detached task. New messages are already persisted with
 * category_classified_at cleared, so interruption or failure remains eligible
 * for the bounded durable retry sweep.
 */
function scheduleThreadBackgroundTask(task: () => Promise<void>): void {
  const supabase = requireSupabase();
  const scopedTask = () => runWithSupabase(supabase, task);

  try {
    after(scopedTask);
  } catch {
    setTimeout(() => {
      void scopedTask();
    }, 0);
  }
}

async function persistDeterministicEmailThreadState(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string | null,
  direction: "inbound" | "outbound",
  skipThreadState = false,
  messageIsNew = true
): Promise<void> {
  if (skipThreadState) return;

  try {
    const { threadRow, isNew } = await EmailThreadService.upsertFromEmail({
      companyId: connection.companyId,
      connectionId: connection.id,
      providerThreadId: email.threadId,
      email,
      direction,
      opportunityId,
      markClassificationDirty: messageIsNew,
    });

    const needsClassify =
      isNew ||
      messageIsNew ||
      threadRow.categoryClassifiedAt === null ||
      threadRow.categoryConfidence < 0.6 ||
      (direction === "inbound" && !threadRow.categoryManuallySet);

    if (needsClassify) {
      scheduleThreadBackgroundTask(async () => {
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
      scheduleThreadBackgroundTask(async () => {
        try {
          const { PhaseCAutonomyRouter } =
            await import("./phase-c-autonomy-router");
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
    throw new Error(
      `[sync-engine] email_threads upsert failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

async function createActivity(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string | null,
  direction: "inbound" | "outbound",
  extra?: ActivityPersistenceOptions
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
  // P0-B (clean-state layer): persist a quote- + signature-stripped clean body
  // alongside the RAW body. `body_text` stays verbatim (audit); `body_text_clean`
  // is the provider-clean base the conversation-state layer reads before any AI.
  // Prefer the provider's pre-stripped uniqueBody when present; the cleaner falls
  // back to deriving it from the raw body. Cross-message overlap stripping is
  // applied later (it needs the thread's prior messages, unavailable per-message
  // here), so this is quote + signature only.
  const bodyTextClean = cleanMessageBody(normalizedEmail.bodyText || "", {
    subject: normalizedEmail.subject,
    providerCleanBody: normalizedEmail.bodyTextClean ?? null,
  });
  const { data: insertedActivity, error: activityError } = await supabase
    .from("activities")
    .insert({
      company_id: connection.companyId,
      type: "email",
      subject: normalizedEmail.subject,
      content: normalizedEmail.snippet,
      body_text: normalizedEmail.bodyText || null,
      body_text_clean: bodyTextClean || null,
      email_connection_id: connection.id,
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
      // `activities.created_at` is the conversation occurrence timestamp for
      // email rows. Persist the provider timestamp so delayed catch-up and
      // history pagination cannot rewrite conversation chronology as worker
      // insertion order.
      created_at: normalizedEmail.date.toISOString(),
    })
    .select("id")
    .single();
  if (activityError || !insertedActivity) {
    throw new Error(
      `[sync-engine] createActivity failed: ${activityError?.message ?? "insert returned no row"}`
    );
  }

  await recordActivityCorrespondenceEvent(
    normalizedEmail,
    connection,
    opportunityId,
    ((insertedActivity as Record<string, unknown> | null)?.id as
      | string
      | null) ?? null,
    direction
  );

  await persistDeterministicEmailThreadState(
    normalizedEmail,
    connection,
    opportunityId,
    direction,
    extra?.skipThreadState
  );
  return true;
}

async function updateCorrespondenceCounts(
  opportunityId: string,
  email: NormalizedEmail,
  connection: EmailConnection,
  followUpDaysCache: Map<string, number>,
  result: SyncCycleResult
): Promise<void> {
  const supabase = requireSupabase();

  // Apply the immutable provider event to the opportunity projection exactly
  // once. The event row is the retry latch: if a later write fails, the same
  // provider message can be replayed without skipping or double-incrementing.
  const { data: updated, error: rpcError } = await supabase.rpc(
    "apply_opportunity_correspondence_event",
    {
      p_company_id: connection.companyId,
      p_opportunity_id: opportunityId,
      p_connection_id: connection.id,
      p_provider_message_id: email.id,
    }
  );

  if (rpcError || !updated) {
    throw new Error(
      `[sync-engine] correspondence projection failed for ${opportunityId}: ${rpcError?.message ?? "RPC returned no rows"}`
    );
  }

  // RPC returns a single-row table — Supabase shapes that as an array.
  const row = Array.isArray(updated) ? updated[0] : updated;
  if (!row) {
    throw new Error(
      `[sync-engine] correspondence projection returned no opportunity for ${opportunityId}`
    );
  }

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
      connection.companyId,
      currentStage,
      followUpDaysCache
    );
    const evaluation = StageEvaluator.evaluate({
      outboundCount: newOutboundCount,
      inboundCount: newInboundCount,
      totalMessages: newCorrespondenceCount,
      lastMessageDirection: row.last_message_direction === "out" ? "out" : "in",
      lastInboundAt,
      lastOutboundAt,
      currentStage,
      autoFollowUpDays,
    });

    if (evaluation.changed) {
      const { data: transitionRows, error: stageUpdateError } =
        await supabase.rpc("apply_email_opportunity_stage_transition", {
          p_company_id: connection.companyId,
          p_opportunity_id: opportunityId,
          p_to_stage: evaluation.stage,
        });
      if (stageUpdateError || !transitionRows) {
        throw new Error(
          `[sync-engine] deterministic stage transition failed for ${opportunityId}: ${stageUpdateError?.message ?? "RPC returned no rows"}`
        );
      }
      const transition = Array.isArray(transitionRows)
        ? transitionRows[0]
        : transitionRows;
      if (!transition) {
        throw new Error(
          `[sync-engine] deterministic stage transition returned no opportunity for ${opportunityId}`
        );
      }
      if (transition.changed) result.stageChanges++;
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

/**
 * P0/Phase-2: deterministic accept → stage. After an inbound lands on an existing
 * opportunity, build the clean conversation state and let the deterministic
 * accept-detector decide: a clear "yes" auto-advances the lead to Won; a softer
 * verbal accept surfaces a one-tap "Mark Won" notification. Never overrides a
 * manual stage, a terminal lead, or a thread the router held for human review.
 * Non-fatal — a failure here must not break the sync loop. The cheap stage/manual
 * guard runs BEFORE the (heavier) state build to skip the common no-op case.
 */
async function maybeAutoAdvanceOnAccept(args: {
  providerThreadId: string;
  opportunityId: string;
  connection: EmailConnection;
  result: SyncCycleResult;
}): Promise<void> {
  const { providerThreadId, opportunityId, connection, result } = args;
  try {
    const supabase = requireSupabase();

    const { data: opp, error: opportunityError } = await supabase
      .from("opportunities")
      .select("stage, stage_manually_set")
      .eq("id", opportunityId)
      .eq("company_id", connection.companyId)
      .maybeSingle();
    if (opportunityError) {
      throw new Error(
        `accept opportunity lookup failed: ${opportunityError.message}`
      );
    }
    if (!opp) return;
    if (opp.stage_manually_set) return;
    if (["won", "lost", "discarded"].includes(opp.stage as string)) return;

    // Attachment copying and cost-once inspection run only in the durable
    // attachment worker. That worker re-evaluates acceptance after persisting a
    // cached signed-estimate result, so provider I/O can never pin this mailbox
    // cursor while the immediate text-only acceptance path remains intact.
    const evaluation = await evaluateOpportunityAcceptance({
      supabase,
      providerThreadId,
      opportunityId,
      connection,
    });
    if (evaluation.stageChanged) result.stageChanges++;
  } catch (err) {
    throw new LifecyclePersistenceError(
      `[sync-engine] accept-to-project conversion failed before cursor advancement: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

async function createTerminalFlagNotification(
  stageResult: { threadId: string; terminalFlag: string | null },
  connection: EmailConnection,
  opportunityId: string
): Promise<void> {
  if (!stageResult.terminalFlag || !connection.userId) return;

  const supabase = requireSupabase();

  const { data: opp, error: opportunityError } = await supabase
    .from("opportunities")
    .select("title, client_id")
    .eq("id", opportunityId)
    .eq("company_id", connection.companyId)
    .single();
  if (opportunityError || !opp) {
    throw new Error(
      `terminal notification opportunity lookup failed for ${opportunityId}: ${opportunityError?.message ?? "row not found"}`
    );
  }

  let clientName = "A client";
  if (opp?.client_id) {
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("name")
      .eq("id", opp.client_id as string)
      .single();
    if (clientError) {
      throw new Error(
        `terminal notification client lookup failed: ${clientError.message}`
      );
    }
    if (client?.name) clientName = client.name as string;
  }

  const action =
    stageResult.terminalFlag === "likely_won"
      ? "accepted your estimate"
      : "declined";

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
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
  if (notificationError) {
    throw new Error(
      `terminal notification persistence failed: ${notificationError.message}`
    );
  }
}

function numericOpportunityValue(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

async function maybeAutoConvertLikelyWon(
  stageResult: {
    threadId: string;
    terminalFlag: string | null;
    summary?: string | null;
  },
  connection: EmailConnection,
  opportunityId: string,
  opportunity: {
    stage?: string | null;
    stage_manually_set?: boolean | null;
    actual_value?: unknown;
    detected_value?: unknown;
    estimated_value?: unknown;
  } | null
): Promise<boolean> {
  if (
    !shouldAutoConvertLikelyWon({
      terminalFlag: stageResult.terminalFlag,
      currentStage: opportunity?.stage,
      stageManuallySet: opportunity?.stage_manually_set,
    })
  ) {
    return false;
  }

  try {
    await ProjectConversionService.convertOpportunityToProject({
      opportunityId,
      companyId: connection.companyId,
      decidedBy: connection.userId ?? null,
      sourcePath: "won_dialog",
      actualValue:
        numericOpportunityValue(opportunity?.actual_value) ??
        numericOpportunityValue(opportunity?.detected_value) ??
        numericOpportunityValue(opportunity?.estimated_value),
      expectedStage: opportunity?.stage ?? null,
      notesSeed: stageResult.summary ?? null,
    });
    return true;
  } catch (err) {
    throw new LifecyclePersistenceError(
      `[sync-engine] likely-won conversion failed before cursor advancement for opportunity ${opportunityId}: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
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
    parts.push(`${result.newLeads} new lead${result.newLeads > 1 ? "s" : ""}`);
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
      .eq("email_connection_id", connection.id)
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

interface ExistingProviderActivity {
  id?: string | null;
  opportunity_id?: string | null;
  email_connection_id?: string | null;
  email_thread_id?: string | null;
  subject?: string | null;
  body_text?: string | null;
  draft_history_id?: string | null;
  created_by?: string | null;
}

async function legacyActivityMatchesConnection(
  supabase: SupabaseClient,
  connection: EmailConnection,
  activity: ExistingProviderActivity,
  providerThreadId: string
): Promise<"match" | "different" | "unknown"> {
  if (!activity.id) return "unknown";

  const { data: eventRows, error: eventError } = await supabase
    .from("opportunity_correspondence_events")
    .select("connection_id")
    .eq("company_id", connection.companyId)
    .eq("activity_id", activity.id)
    .limit(2);
  if (eventError) {
    throw new Error(
      `[sync-engine] legacy activity event proof failed: ${eventError.message ?? "unknown error"}`
    );
  }
  const eventConnectionIds = Array.from(
    new Set(
      (eventRows ?? [])
        .map((row) => (row.connection_id as string | null) ?? null)
        .filter((value): value is string => Boolean(value))
    )
  );
  if (eventConnectionIds.length > 1) {
    throw new Error(
      `[sync-engine] legacy activity ${activity.id} has conflicting connection evidence`
    );
  }
  if (eventConnectionIds[0]) {
    return eventConnectionIds[0] === connection.id ? "match" : "different";
  }

  if (activity.opportunity_id && providerThreadId) {
    const { data: threadLinks, error: threadLinkError } = await supabase
      .from("opportunity_email_threads")
      .select("id")
      .eq("opportunity_id", activity.opportunity_id)
      .eq("thread_id", providerThreadId)
      .eq("connection_id", connection.id)
      .limit(1);
    if (threadLinkError) {
      throw new Error(
        `[sync-engine] legacy activity thread proof failed: ${threadLinkError.message ?? "unknown error"}`
      );
    }
    if (threadLinks && threadLinks.length > 0) return "match";
  }

  const { data: deterministicThreads, error: deterministicThreadError } =
    await supabase
      .from("email_threads")
      .select("id")
      .eq("company_id", connection.companyId)
      .eq("connection_id", connection.id)
      .eq("provider_thread_id", providerThreadId)
      .limit(1);
  if (deterministicThreadError) {
    throw new Error(
      `[sync-engine] legacy email-thread proof failed: ${deterministicThreadError.message ?? "unknown error"}`
    );
  }
  return deterministicThreads && deterministicThreads.length > 0
    ? "match"
    : "unknown";
}

async function findExistingProviderActivity(
  supabase: SupabaseClient,
  connection: EmailConnection,
  providerMessageId: string,
  providerThreadId: string
): Promise<ExistingProviderActivity | null> {
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, opportunity_id, email_connection_id, email_thread_id, subject, body_text, draft_history_id, created_by"
    )
    .eq("company_id", connection.companyId)
    .eq("email_message_id", providerMessageId);

  if (error) {
    throw new Error(
      `[sync-engine] activity dedupe failed: ${error.message ?? "unknown error"}`
    );
  }

  const rows = (data ?? []) as ExistingProviderActivity[];
  const exact = rows.filter((row) => row.email_connection_id === connection.id);
  if (exact.length > 1) {
    throw new Error(
      `[sync-engine] duplicate scoped activities for provider message ${providerMessageId}`
    );
  }
  if (exact[0]) return exact[0];

  // Legacy activities predate email_connection_id. Never infer ownership from
  // a same-company opaque ID alone: require an immutable correspondence event,
  // an opportunity-thread link, or the deterministic email_threads row.
  const legacy = rows.filter((row) => !row.email_connection_id);
  const matchingLegacy: ExistingProviderActivity[] = [];
  let hasUnknownLegacy = false;
  for (const row of legacy) {
    const proof = await legacyActivityMatchesConnection(
      supabase,
      connection,
      row,
      providerThreadId
    );
    if (proof === "match") matchingLegacy.push(row);
    if (proof === "unknown") hasUnknownLegacy = true;
  }
  if (matchingLegacy.length > 1) {
    throw new Error(
      `[sync-engine] multiple proven legacy activities for provider message ${providerMessageId}`
    );
  }
  if (matchingLegacy[0]) {
    const { data: claimedRows, error: claimError } = await supabase
      .from("activities")
      .update({ email_connection_id: connection.id })
      .eq("id", matchingLegacy[0].id)
      .eq("company_id", connection.companyId)
      .is("email_connection_id", null)
      .select("id, email_connection_id");
    if (claimError) {
      throw new Error(
        `[sync-engine] legacy activity connection claim failed: ${claimError.message ?? "unknown error"}`
      );
    }
    if (!Array.isArray(claimedRows) || claimedRows.length !== 1) {
      throw new Error(
        `[sync-engine] legacy activity connection claim lost a concurrent race for ${providerMessageId}`
      );
    }
    return { ...matchingLegacy[0], email_connection_id: connection.id };
  }
  if (hasUnknownLegacy) {
    throw new Error(
      `[sync-engine] legacy activity ownership is unproven for provider message ${providerMessageId}`
    );
  }
  return null;
}

// ─── Inbound / Outbound Processors ─────────────────────────────────────────

interface UnmatchedInboundContext {
  email: NormalizedEmail;
  effectiveEmail: NormalizedEmail;
  routingIdentity: LeadRoutingIdentity;
  contactFormSubmitter: ContactFormSubmissionIdentity | null;
  enrichmentFacts: LeadEnrichmentFacts;
  resolvedContact: ResolvedContact;
}

/** Returns the sanitized context only when no deterministic branch claimed it. */
async function processInboundEmail(
  email: NormalizedEmail,
  connection: EmailConnection,
  profile: SyncProfile,
  followUpDaysCache: Map<string, number>,
  result: SyncCycleResult
): Promise<UnmatchedInboundContext | null> {
  const normalizedEmail = normalizeProviderBackedEmailForSync(
    email,
    connection,
    result,
    "sync_inbound_email"
  );
  email = normalizedEmail;

  const supabase = requireSupabase();

  // Dedup: check if we already have this email
  const existingActivity = await findExistingProviderActivity(
    supabase,
    connection,
    email.id,
    email.threadId
  );
  if (existingActivity) {
    const { email: effectiveExistingEmail, submitter: existingSubmitter } =
      applyContactFormSubmitterIdentity(email);
    const existingRoutingIdentity = buildLeadRoutingIdentity(email, {
      provider: connection.provider,
      connectionId: connection.id,
    });
    const existingEnrichmentFacts = leadEnrichmentFactsFromEmail({
      email,
      direction: "inbound",
      connection,
      profile,
      submitter: existingSubmitter,
    });
    let existingResolvedContact: ResolvedContact | null = null;
    try {
      existingResolvedContact = await resolveInboundLeadContact(
        effectiveExistingEmail,
        connection,
        existingSubmitter
      );
      applyResolvedContactToFacts(
        existingEnrichmentFacts,
        existingResolvedContact
      );
    } catch (err) {
      throw new Error(
        `[sync-engine] contact hygiene retry failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }

    if (
      existingActivity.opportunity_id &&
      existingRoutingIdentity.mayInheritProviderThread
    ) {
      await linkThread(
        existingActivity.opportunity_id,
        email.threadId,
        connection.id
      );
    }
    await persistDeterministicEmailThreadState(
      effectiveExistingEmail,
      connection,
      existingActivity.opportunity_id ?? null,
      "inbound",
      existingRoutingIdentity.isContactFormSubmission,
      false
    );
    if (existingActivity.opportunity_id) {
      await applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: existingActivity.opportunity_id,
        facts: existingEnrichmentFacts,
        companyId: connection.companyId,
      });
    }
    await recordActivityCorrespondenceEvent(
      effectiveExistingEmail,
      connection,
      existingActivity.opportunity_id ?? null,
      existingActivity.id ?? null,
      "inbound"
    );
    if (existingActivity.opportunity_id) {
      await updateCorrespondenceCounts(
        existingActivity.opportunity_id,
        effectiveExistingEmail,
        connection,
        followUpDaysCache,
        result
      );
    }
    return null;
  }

  const { email: effectiveEmail, submitter: contactFormSubmitter } =
    applyContactFormSubmitterIdentity(email);
  const routingIdentity = buildLeadRoutingIdentity(email, {
    provider: connection.provider,
    connectionId: connection.id,
  });
  const activityRoutingExtra = routingIdentity.isContactFormSubmission
    ? { skipThreadState: true }
    : undefined;
  const linkInboundThread = (opportunityId: string) =>
    routingIdentity.mayInheritProviderThread
      ? linkThread(opportunityId, email.threadId, connection.id)
      : Promise.resolve(true);
  const inboundEnrichmentFacts = leadEnrichmentFactsFromEmail({
    email,
    direction: "inbound",
    connection,
    profile,
    submitter: contactFormSubmitter,
  });

  // P0-C: operator-aware contact hygiene. Resolve the customer's name / phone /
  // address / email with the operator excluded on every field (so a forwarded
  // lead's operator signature cannot pollute the customer record), then override
  // the polluted enrichment-derived fields BEFORE any branch creates or enriches.
  // The resolved contact is also the provenance source for newly-created leads.
  // This deterministic contact resolution is part of the durable ingest
  // boundary; a failure must retry before the provider cursor advances.
  let resolvedInboundContact: ResolvedContact;
  try {
    resolvedInboundContact = await resolveInboundLeadContact(
      effectiveEmail,
      connection,
      contactFormSubmitter
    );
    applyResolvedContactToFacts(inboundEnrichmentFacts, resolvedInboundContact);
  } catch (err) {
    throw new Error(
      `[sync-engine] contact hygiene failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  // Thread inheritance — is this thread already linked to an OPS lead?
  const threadOpportunity = routingIdentity.mayInheritProviderThread
    ? await loadProviderThreadOpportunity(supabase, connection, email.threadId)
    : null;

  if (threadOpportunity) {
    const activityCreated = await createActivity(
      effectiveEmail,
      connection,
      threadOpportunity.opportunityId,
      "inbound"
    );
    if (!activityCreated) return null;
    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: threadOpportunity.opportunityId,
      clientId: threadOpportunity.clientId,
      facts: inboundEnrichmentFacts,
      companyId: connection.companyId,
    });
    await updateCorrespondenceCounts(
      threadOpportunity.opportunityId,
      effectiveEmail,
      connection,
      followUpDaysCache,
      result
    );
    await applyLabel(email.threadId, connection, result);
    result.activitiesCreated++;
    result.matched++;

    // ── Phase 2: deterministic accept → stage (auto-Won / surface Mark Won) ──
    await maybeAutoAdvanceOnAccept({
      providerThreadId: email.threadId,
      opportunityId: threadOpportunity.opportunityId,
      connection,
      result,
    });

    // ── E5: Auto-draft / auto-send trigger (fire-and-forget) ───────────
    // Never awaited — AI inference must not block the sync loop.
    maybeAutoGenerateDraft(
      effectiveEmail,
      connection,
      threadOpportunity.opportunityId,
      contactFormSubmitter
    ).catch((err) =>
      console.error("[sync-engine] Auto-draft error (non-fatal):", err)
    );

    // ── S2.3: Reschedule request detection (fire-and-forget) ───────────
    // Looks up the just-created activity row and runs the reschedule
    // classifier (phase_c gated + heuristic + GPT). Never blocks sync.
    maybeDetectRescheduleRequest(
      effectiveEmail,
      connection,
      threadOpportunity.opportunityId
    ).catch((err) =>
      console.error(
        "[sync-engine] Reschedule detection error (non-fatal):",
        err
      )
    );

    return null;
  }

  // Pattern matching
  const senderEmail = extractSenderEmail(email.from);
  const isPatternMatch = matchesPattern(email, profile);
  const isPlatformMatch = matchPlatform(senderEmail) !== null;
  const isForwarderMatch =
    profile.teamForwarders?.some((f) =>
      senderEmail.includes(f.toLowerCase())
    ) && isFormSubmissionSubject(email.subject);

  if (
    isPatternMatch ||
    isPlatformMatch ||
    isForwarderMatch ||
    routingIdentity.isContactFormSubmission
  ) {
    const matchResult = await EmailMatchingServiceV2.match(
      connection.companyId,
      extractSenderEmail(effectiveEmail.from),
      {
        ...(routingIdentity.mayInheritProviderThread
          ? {
              threadId: routingIdentity.providerThreadId,
              connectionId: connection.id,
            }
          : {}),
        name: effectiveEmail.fromName,
      }
    );
    const relationshipDecision = await findOpportunityRelationshipMatch({
      supabase,
      companyId: connection.companyId,
      connectionId: connection.id,
      providerThreadId: routingIdentity.mayInheritProviderThread
        ? email.threadId
        : null,
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
      const authoritativeClientId = relationshipDecision.clientId;

      // Finish retryable semantic writes before the activity checkpoint. If a
      // sub-contact insert fails once, retry must run this branch again rather
      // than short-circuit through the existing-activity replay path.
      await applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: oppId,
        clientId: authoritativeClientId,
        facts: inboundEnrichmentFacts,
        companyId: connection.companyId,
      });
      const subClientIdentity = subClientIdentityFromFacts(
        inboundEnrichmentFacts
      );
      if (
        matchResult.action === "create_subclient" &&
        authoritativeClientId &&
        matchResult.clientId === authoritativeClientId &&
        subClientIdentity
      ) {
        await createSubClient(
          effectiveEmail,
          authoritativeClientId,
          connection.companyId,
          subClientIdentity
        );
      }

      const linked = await linkInboundThread(oppId);
      if (!linked) return null;
      const activityCreated = await createActivity(
        effectiveEmail,
        connection,
        oppId,
        "inbound",
        {
          matchConfidence: relationshipDecision.confidence,
          ...activityRoutingExtra,
        }
      );
      if (!activityCreated) return null;
      await updateCorrespondenceCounts(
        oppId,
        effectiveEmail,
        connection,
        followUpDaysCache,
        result
      );
      await applyLabel(email.threadId, connection, result);
      result.matched++;
      result.activitiesCreated++;

      // ── Phase 2: deterministic accept → stage ──
      await maybeAutoAdvanceOnAccept({
        providerThreadId: email.threadId,
        opportunityId: oppId,
        connection,
        result,
      });

      maybeAutoGenerateDraft(
        effectiveEmail,
        connection,
        oppId,
        contactFormSubmitter
      ).catch((err) =>
        console.error("[sync-engine] Auto-draft error (non-fatal):", err)
      );
      return null;
    }

    if (matchResult.action === "create_new") {
      const requestedClientId = await createClient(
        effectiveEmail,
        connection.companyId,
        contactFormSubmitter,
        inboundEnrichmentFacts
      );
      const opportunity = await createOpportunity(
        effectiveEmail,
        requestedClientId,
        connection.companyId,
        "new_lead",
        {
          candidates: contactFormTitleCandidate(contactFormSubmitter),
          unsafe: syncTitleUnsafeIdentity(connection, profile),
          enrichmentFacts: inboundEnrichmentFacts,
          sourceKey: routingIdentity.sourceKey,
        }
      );
      const oppId = opportunity.id;
      const clientId = opportunity.clientId;

      const linked = await linkInboundThread(oppId);
      if (!linked) return null;
      const activityCreated = await createActivity(
        effectiveEmail,
        connection,
        oppId,
        "inbound",
        activityRoutingExtra
      );
      if (!activityCreated) return null;
      await updateCorrespondenceCounts(
        oppId,
        effectiveEmail,
        connection,
        followUpDaysCache,
        result
      );
      await applyLabel(email.threadId, connection, result);
      result.newLeads++;
      result.activitiesCreated++;

      // ── Forwarded contact-form NEW lead: draft a fresh first reply on a new
      // thread to the client. Scoped to contact-form submissions so ordinary new
      // leads are unchanged — this create_new branch does not otherwise
      // auto-draft. Gating (phase_c + autonomy + confidence) lives inside.
      if (contactFormSubmitter) {
        maybeAutoGenerateDraft(
          effectiveEmail,
          connection,
          oppId,
          contactFormSubmitter
        ).catch((err) =>
          console.error("[sync-engine] Auto-draft error (non-fatal):", err)
        );
      }

      // ── P1: Suggest project creation for new leads (fire-and-forget) ──
      // Gated behind phase_c — only enabled companies get suggestions.
      if (connection.userId) {
        AdminFeatureOverrideService.isAIFeatureEnabled(
          connection.companyId,
          "phase_c"
        )
          .then((enabled) => {
            if (!enabled) return;
            maybeSuggestProject({
              email: effectiveEmail,
              companyId: connection.companyId,
              userId: connection.userId!,
              clientId,
              opportunityId: oppId,
            }).catch((err) =>
              console.error(
                "[sync-engine] Project suggestion error (non-fatal):",
                err
              )
            );
          })
          .catch((err) =>
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
        sourceKey: routingIdentity.sourceKey,
      };
      const opportunity = relationshipDecisionRequiresNewOpportunity
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
      const oppId = opportunity.id;
      const authoritativeClientId = opportunity.clientId;

      await applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: oppId,
        clientId: authoritativeClientId,
        facts: inboundEnrichmentFacts,
        companyId: connection.companyId,
      });
      const subClientIdentity = subClientIdentityFromFacts(
        inboundEnrichmentFacts
      );
      if (
        matchResult.action === "create_subclient" &&
        matchResult.clientId === authoritativeClientId &&
        subClientIdentity
      ) {
        await createSubClient(
          effectiveEmail,
          authoritativeClientId,
          connection.companyId,
          subClientIdentity
        );
      }

      const linked = await linkInboundThread(oppId);
      if (!linked) return null;
      const activityCreated = await createActivity(
        effectiveEmail,
        connection,
        oppId,
        "inbound",
        activityRoutingExtra
      );
      if (!activityCreated) return null;
      await updateCorrespondenceCounts(
        oppId,
        effectiveEmail,
        connection,
        followUpDaysCache,
        result
      );
      await applyLabel(email.threadId, connection, result);
      if (relationshipDecisionRequiresNewOpportunity) {
        result.newLeads++;
      } else {
        result.matched++;
      }
      result.activitiesCreated++;

      // ── Phase 2 + E5: accept→stage, then auto-draft — only when reusing an
      //    existing opportunity (a brand-new lead has nothing to accept yet). ──
      if (!relationshipDecisionRequiresNewOpportunity) {
        await maybeAutoAdvanceOnAccept({
          providerThreadId: email.threadId,
          opportunityId: oppId,
          connection,
          result,
        });
        maybeAutoGenerateDraft(effectiveEmail, connection, oppId).catch((err) =>
          console.error("[sync-engine] Auto-draft error (non-fatal):", err)
        );
      }
    } else if (matchResult.action === "review") {
      const activityCreated = await createActivity(
        effectiveEmail,
        connection,
        null,
        "inbound",
        {
          matchNeedsReview: true,
          suggestedClientId: matchResult.suggestedClientId,
          matchConfidence: matchResult.confidence,
          ...activityRoutingExtra,
        }
      );
      if (!activityCreated) return null;
      result.needsReview++;
      result.activitiesCreated++;
    }
    return null; // Matched by a deterministic rule.
  }

  // Unmatched — upsert into email_threads so it appears in inbox,
  // then send to AI classification if feature-gated.
  if (routingIdentity.isContactFormSubmission) {
    return {
      email,
      effectiveEmail,
      routingIdentity,
      contactFormSubmitter,
      enrichmentFacts: inboundEnrichmentFacts,
      resolvedContact: resolvedInboundContact,
    };
  }

  try {
    await EmailThreadService.upsertFromEmail({
      companyId: connection.companyId,
      connectionId: connection.id,
      providerThreadId: email.threadId,
      email: effectiveEmail,
      direction: "inbound",
    });
  } catch (err) {
    throw new Error(
      `[sync-engine] unmatched email thread persistence failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
  return {
    email,
    effectiveEmail,
    routingIdentity,
    contactFormSubmitter,
    enrichmentFacts: inboundEnrichmentFacts,
    resolvedContact: resolvedInboundContact,
  };
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
  email = normalizedEmail;
  const routingIdentity = buildLeadRoutingIdentity(email, {
    provider: connection.provider,
    connectionId: connection.id,
  });

  const supabase = requireSupabase();

  // Dedup
  const existingActivity = await findExistingProviderActivity(
    supabase,
    connection,
    email.id,
    email.threadId
  );
  // Queue the immutable provider sample before any ownership branch. If the
  // queue write fails, the sync checkpoint must not advance; replay then
  // repairs the same provider identity without double-learning.
  await learnFromOutboundEmail(email, connection, existingActivity);
  if (existingActivity) {
    if (existingActivity.opportunity_id) {
      await linkThread(
        existingActivity.opportunity_id,
        email.threadId,
        connection.id
      );
    }
    await persistDeterministicEmailThreadState(
      email,
      connection,
      existingActivity.opportunity_id ?? null,
      "outbound",
      false,
      false
    );
    if (existingActivity.opportunity_id) {
      await applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: existingActivity.opportunity_id,
        facts: leadEnrichmentFactsFromEmail({
          email,
          direction: "outbound",
          connection,
          profile,
        }),
        companyId: connection.companyId,
      });
    }
    await recordActivityCorrespondenceEvent(
      email,
      connection,
      existingActivity.opportunity_id ?? null,
      existingActivity.id ?? null,
      "outbound"
    );
    if (existingActivity.opportunity_id) {
      await updateCorrespondenceCounts(
        existingActivity.opportunity_id,
        email,
        connection,
        followUpDaysCache,
        result
      );
    }
    return;
  }

  // Thread inheritance for sent mail
  const threadOpportunity = await loadProviderThreadOpportunity(
    supabase,
    connection,
    email.threadId
  );

  if (threadOpportunity) {
    const activityCreated = await createActivity(
      email,
      connection,
      threadOpportunity.opportunityId,
      "outbound"
    );
    if (!activityCreated) return;
    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: threadOpportunity.opportunityId,
      clientId: threadOpportunity.clientId,
      facts: leadEnrichmentFactsFromEmail({
        email,
        direction: "outbound",
        connection,
        profile,
      }),
      companyId: connection.companyId,
    });
    await updateCorrespondenceCounts(
      threadOpportunity.opportunityId,
      email,
      connection,
      followUpDaysCache,
      result
    );
    result.activitiesCreated++;
    result.matched++;

    // Task 5: Reconcile pending mailbox drafts now that the outbound activity
    // is persisted. Fire-and-forget — must not block or throw from the sync loop.
    reconcilePendingMailboxDrafts({
      connection,
      providerThreadId: email.threadId,
      supabase,
    }).catch((err) =>
      console.error(
        "[sync-engine] reconcilePendingMailboxDrafts error (non-fatal):",
        err
      )
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
    const recipientEmail =
      recipientCandidate.email || extractSenderEmail(recipient);
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
        const opportunity = await createOpportunity(
          effectiveRecipientEmail,
          clientId,
          connection.companyId,
          "qualifying",
          {
            kind: "estimate",
            candidates: [recipientCandidate],
            unsafe: syncTitleUnsafeIdentity(connection, profile),
            enrichmentFacts: outboundEnrichmentFacts,
            sourceKey: routingIdentity.sourceKey,
          }
        );
        const oppId = opportunity.id;
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
          email,
          connection,
          followUpDaysCache,
          result
        );
        await applyLabel(email.threadId, connection, result);
        result.newLeads++;
        result.activitiesCreated++;
        threadLinkedByThisEmail = true;
      } else if (matchResult.clientId) {
        const opportunity = await getOrCreateOpportunity(
          matchResult.clientId,
          connection.companyId,
          email,
          {
            kind: "estimate",
            candidates: [recipientCandidate],
            unsafe: syncTitleUnsafeIdentity(connection, profile),
            enrichmentFacts: outboundEnrichmentFacts,
            sourceKey: routingIdentity.sourceKey,
          }
        );
        const oppId = opportunity.id;
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
          email,
          connection,
          followUpDaysCache,
          result
        );
        result.matched++;
        result.activitiesCreated++;
        threadLinkedByThisEmail = true;
      }
    }
  }

  // Task 5: Reconcile pending mailbox drafts after activities are persisted.
  // Fires for the safety-net path (new-external-address sends and estimate
  // pattern matches that didn't hit the thread-linked early-return above).
  // Fire-and-forget — must not block or throw from the sync loop.
  reconcilePendingMailboxDrafts({
    connection,
    providerThreadId: email.threadId,
    supabase,
  }).catch((err) =>
    console.error(
      "[sync-engine] reconcilePendingMailboxDrafts error (non-fatal):",
      err
    )
  );
}

/**
 * Persist one durable learning sample for any operator-authored outbound email.
 * Model work happens later in the bounded cron worker. A queue failure is a
 * semantic sync failure so the provider cursor cannot advance past lost data.
 */
async function learnFromOutboundEmail(
  email: NormalizedEmail,
  connection: EmailConnection,
  existingActivity: ExistingProviderActivity | null
): Promise<void> {
  try {
    const supabase = requireSupabase();
    const userId = await resolveOutboundLearningUserId(
      supabase,
      email,
      connection,
      existingActivity
    );
    // Shared-mailbox provider messages do not identify the human sender. If no
    // in-app activity or exact active-user email proves authorship, skip the
    // personal profile update instead of poisoning another operator's voice.
    if (!userId) return;
    // The send route stores the exact source body before provider rendering.
    // When that canonical activity carries draft provenance, use it for the
    // edit diff so markdown/HTML/plain-text conversion is never learned as a
    // human correction during a provider replay race.
    const hasAuthenticatedOpsActivity = Boolean(existingActivity?.created_by);
    const canonicalDraftSubject =
      hasAuthenticatedOpsActivity && existingActivity?.subject != null
        ? existingActivity.subject
        : email.subject;
    const canonicalDraftBody =
      hasAuthenticatedOpsActivity && existingActivity?.body_text != null
        ? existingActivity.body_text
        : email.bodyText;
    let canonicalAuthoredBody = canonicalDraftBody;
    const hasCanonicalOpsBody = Boolean(
      hasAuthenticatedOpsActivity && existingActivity?.body_text != null
    );
    if (!hasCanonicalOpsBody) {
      // Provider sent-mail bodies include the mailbox signature. Keep that
      // deterministic footer out of both the voice sample and AI-draft edit
      // distance. Prefer the exact configured signature; if the provider has
      // reformatted it beyond recognition, fall back to the conservative clean
      // body rather than teach contact details as writing style.
      const effectiveSignature = await EmailSignatureService.resolveEffective({
        companyId: connection.companyId,
        connectionId: connection.id,
        userId,
        mailboxAddress: connection.email,
      });
      const withoutKnownSignature = effectiveSignature
        ? stripRenderedEmailSignature({
            body: canonicalDraftBody,
            contentType: "text",
            signature: effectiveSignature,
          }).trim()
        : canonicalDraftBody.trim();
      canonicalAuthoredBody =
        withoutKnownSignature &&
        withoutKnownSignature !== canonicalDraftBody.trim()
          ? withoutKnownSignature
          : cleanMessageBody(canonicalDraftBody, {
              subject: canonicalDraftSubject,
              providerCleanBody: email.bodyTextClean ?? null,
            });
    }

    let profileType = "general";
    if (existingActivity?.draft_history_id) {
      const { data: draftProfile, error: draftProfileError } = await supabase
        .from("ai_draft_history")
        .select("profile_type")
        .eq("id", existingActivity.draft_history_id)
        .eq("company_id", connection.companyId)
        .maybeSingle();
      if (draftProfileError) throw draftProfileError;
      if (
        typeof draftProfile?.profile_type === "string" &&
        draftProfile.profile_type.trim()
      ) {
        profileType = draftProfile.profile_type;
      }
    }
    await new EmailOutboundLearningService(supabase).enqueueIfEnabled({
      companyId: connection.companyId,
      connectionId: connection.id,
      providerMessageId: email.id,
      providerThreadId: email.threadId,
      userId,
      fromEmail: email.from,
      toEmails: email.to,
      subject: canonicalDraftSubject,
      bodyText: canonicalDraftBody,
      authoredBody: canonicalAuthoredBody,
      occurredAt: email.date,
      labelIds: email.labelIds,
      draftHistoryId: existingActivity?.draft_history_id ?? null,
      draftDeliveryChannel: existingActivity?.draft_history_id
        ? "ops_send"
        : null,
      opportunityId: existingActivity?.opportunity_id ?? null,
      profileType,
      // Only an OPS-created activity with an authenticated actor proves human
      // authorship here. Generic provider Sent mail and mailbox-draft sends are
      // recorded as autonomous; exact mailbox-draft reconciliation upgrades
      // the latter only after immutable draft/message evidence is matched.
      learningAuthority: existingActivity?.draft_history_id
        ? "autonomous"
        : hasAuthenticatedOpsActivity
          ? "operator_authored"
          : "autonomous",
    });
  } catch (err) {
    throw new LifecyclePersistenceError(
      `[sync-engine] outbound learning enqueue failed before cursor advancement: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

async function resolveOutboundLearningUserId(
  supabase: SupabaseClient,
  email: NormalizedEmail,
  connection: EmailConnection,
  existingActivity: ExistingProviderActivity | null
): Promise<string | null> {
  if (existingActivity?.created_by) return existingActivity.created_by;

  // An individual mailbox has one authoritative owner, including messages sent
  // through a provider-side alias. Company/shared mailboxes need stronger proof.
  if (connection.type === "individual") return connection.userId;

  const senderEmail = extractSenderEmail(email.from);
  if (!senderEmail) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id, email")
    .eq("company_id", connection.companyId)
    .eq("is_active", true)
    .is("deleted_at", null);
  if (error) {
    throw new Error(
      `outbound learning actor lookup failed: ${error.message ?? "unknown error"}`
    );
  }
  const matches = (data ?? []).filter(
    (row) =>
      typeof row.email === "string" &&
      row.email.trim().toLowerCase() === senderEmail
  );
  return matches.length === 1 ? String(matches[0].id) : null;
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
  submitter?: ContactFormSubmissionIdentity | null
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
    const categoryAutonomy =
      (settings.category_autonomy as Record<string, string>) || {};
    const primaryCustomerLevel = categoryAutonomy["primary:CUSTOMER"];
    const primaryCustomerDraftEnabled =
      primaryCustomerLevel === "auto_draft" ||
      primaryCustomerLevel === "auto_send" ||
      primaryCustomerLevel === "auto_follow_up";
    const autoDraftEnabled =
      settings.auto_draft_enabled === true || primaryCustomerDraftEnabled;
    if (!autoDraftEnabled) return;

    // Determine profile type from subject heuristics for category lookup.
    // Contact-form submissions are general new-client inquiries — gate them on
    // "general" and skip the heuristic, because the forwarder's junk subject
    // ("New submission", "Got a new submission") misclassifies (e.g.
    // "submission" matches "sub" → subtrade_coordination → draft_on_request),
    // which would silently suppress the draft.
    const lowerSubject = email.subject.toLowerCase();
    let profileType = "general";
    if (!submitter) {
      if (lowerSubject.includes("warranty") || lowerSubject.includes("defect"))
        profileType = "warranty_claim";
      else if (
        lowerSubject.includes("quote") ||
        lowerSubject.includes("estimate") ||
        lowerSubject.includes("pricing")
      )
        profileType = "client_quoting";
      else if (
        lowerSubject.includes("order") ||
        lowerSubject.includes("supply") ||
        lowerSubject.includes("material")
      )
        profileType = "vendor_ordering";
      else if (
        lowerSubject.includes("sub") ||
        lowerSubject.includes("coordinate")
      )
        profileType = "subtrade_coordination";
      else if (
        lowerSubject.includes("follow") ||
        lowerSubject.includes("checking in")
      )
        profileType = "client_followup";
    }

    let categoryLevel = categoryAutonomy[profileType];
    if (
      !categoryLevel &&
      ["general", "client_quoting", "client_followup"].includes(profileType)
    ) {
      categoryLevel = primaryCustomerLevel;
    }
    categoryLevel ||= "draft_on_request";

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
      if (
        !draftResult.available ||
        !draftResult.draft ||
        !draftResult.draftHistoryId
      ) {
        return;
      }

      const inboxUiEnabled = await AdminFeatureOverrideService.isFeatureEnabled(
        connection.companyId,
        "inbox_ui"
      );
      try {
        const provider = EmailService.getProvider(connection);
        const signature = await resolveEmailSignatureForMessage({
          supabase,
          connection,
          userId: connection.userId,
          refreshProviderIfMissing: true,
        });
        if (!signature) throw new Error("EMAIL_SIGNATURE_REQUIRED");
        const renderedDraft = renderMailboxDraftWithSignature(
          draftResult.draft,
          signature
        );
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
          subject: draftResult.subject || CONTACT_FORM_OUTREACH_SUBJECT,
          body: renderedDraft.body,
          contentType: renderedDraft.contentType,
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

    // All checks passed — generate auto-draft. `autonomous` arms the Phase 3
    // routing gate: a thread held for review (require_human_review) is suppressed.
    const draftResult = await AIDraftService.generateDraft({
      companyId: connection.companyId,
      userId: connection.userId,
      connectionId: connection.id,
      opportunityId,
      threadId: email.threadId,
      autonomous: true,
      origin: "phase_c",
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
        const signature = await resolveEmailSignatureForMessage({
          supabase,
          connection,
          userId: connection.userId,
          refreshProviderIfMissing: true,
        });
        if (!signature) throw new Error("EMAIL_SIGNATURE_REQUIRED");
        const renderedDraft = renderMailboxDraftWithSignature(
          draftResult.draft,
          signature
        );
        const replySubject = normalizeReplySubject(email.subject);
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
            renderedDraft.body,
            email.threadId,
            renderedDraft.contentType
          );
          mailboxDraftId = existing.mailbox_draft_id;
        } else {
          mailboxDraftId = await provider.createDraft(
            to,
            replySubject,
            renderedDraft.body,
            email.threadId,
            renderedDraft.contentType
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
          subject: normalizeReplySubject(email.subject),
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
          action_url: pending
            ? `/inbox?cancelAutoSend=${pending.id}`
            : "/inbox",
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
    console.error(
      "[sync-engine] Auto-draft generation failed (non-fatal):",
      err
    );
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
      .eq("email_connection_id", connection.id)
      .limit(1)
      .maybeSingle();

    if (!activityRow?.id) return;

    const { ClientSchedulingCommsService } =
      await import("./client-scheduling-comms-service");
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
    const profile: SyncProfile = { ...(connection.syncFilters as SyncProfile) };
    const result = emptyResult();

    // Per-cycle cache so each stage lookup against pipeline_stage_configs
    // runs at most once per connection sync — dozens of emails may touch
    // the same stage within a single invocation.
    const followUpDaysCache = new Map<string, number>();

    // P0-A: claim the per-connection sync lock. If another sync holds it, skip
    // this cycle rather than racing it (the next cron tick re-runs). Released in
    // finally below so a crash can't strand the lock past its TTL.
    const syncLockOwner = await acquireSyncLock(connectionId);
    if (!syncLockOwner) {
      return {
        ...emptyResult(),
        errors: ["Sync already in progress for this connection"],
      };
    }
    let syncLockRenewedAt = Date.now();
    const renewSyncLeaseIfNeeded = async (force = false) => {
      if (
        !force &&
        Date.now() - syncLockRenewedAt < SYNC_LOCK_RENEW_INTERVAL_MS
      ) {
        return;
      }
      await renewSyncLock(connectionId, syncLockOwner);
      syncLockRenewedAt = Date.now();
    };

    try {
      const includeSentMail = profile.includeSentMail !== false;
      let mailboxReconciliation: MailboxHistoryReconciliation | null = null;

      // A recovery page token is a durable cursor in its own right. Resume it
      // before touching the expired historyId so retries advance through large
      // mailboxes instead of restarting from page one forever.
      if (
        provider.providerType === "gmail" &&
        connection.historyRecoveryTargetToken
      ) {
        mailboxReconciliation = await reconcileExpiredMailboxHistory(
          provider,
          connection,
          undefined,
          includeSentMail
        );
      }

      // ── Step 0: Bootstrap sync token if missing ─────────────────────────
      //
      // A fresh Gmail token is only a future boundary. Reconcile from the
      // connection creation time before committing it, otherwise mail arriving
      // between authorization and the first cron tick is permanently skipped.
      if (!connection.historyId && !mailboxReconciliation) {
        try {
          if (provider.providerType === "gmail") {
            mailboxReconciliation = await reconcileExpiredMailboxHistory(
              provider,
              connection,
              connection.lastSyncedAt ?? connection.createdAt
            );
          } else if (provider.providerType === "microsoft365") {
            // Graph delta's initial walk returns the full current contents of
            // each folder before yielding its terminal deltaLink. The provider
            // encodes independent Inbox/Sent links in one non-empty cursor;
            // neither link is committed until this entire cycle succeeds.
            connection.historyId = await provider.getInitialSyncToken();
            if (!connection.historyId) {
              throw new Error(
                "[sync-engine] microsoft365 returned an empty initial folder cursor"
              );
            }
          } else {
            throw new Error(
              `[sync-engine] ${provider.providerType ?? "unknown"} initial-token bootstrap has no completeness guarantee; cursor was not advanced`
            );
          }
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
      // If either side reports SyncTokenExpiredError, Gmail must reconcile a
      // bounded overlap from the last committed sync before the fresh historyId
      // can be persisted. Providers without a complete reconciliation seam fail
      // closed and keep their old cursor.
      let inboxResult: SyncResult;
      let sentResult: SyncResult;
      if (mailboxReconciliation) {
        ({ inboxResult, sentResult } = mailboxReconciliation);
      } else
        try {
          if (!syncToken) {
            throw new Error(
              `[sync-engine] ${provider.providerType ?? "unknown"} sync token is missing; cursor was not advanced`
            );
          }
          const usesUnifiedMailboxHistory = provider.providerType === "gmail";
          if (provider.providerType === "microsoft365") {
            // Inbox and Sent are distinct Graph delta streams. Walk them in
            // sequence so the second call receives and preserves the first
            // folder's new cursor, then commit the combined token atomically at
            // the end of the cycle.
            inboxResult = await provider.fetchNewEmailsSince(syncToken);
            sentResult = includeSentMail
              ? await provider.fetchSentEmailsSince(inboxResult.nextSyncToken)
              : { emails: [], nextSyncToken: inboxResult.nextSyncToken };
          } else {
            const fetches: [Promise<SyncResult>, Promise<SyncResult>] = [
              provider.fetchNewEmailsSince(syncToken),
              includeSentMail && !usesUnifiedMailboxHistory
                ? provider.fetchSentEmailsSince(syncToken)
                : Promise.resolve({ emails: [], nextSyncToken: syncToken }),
            ];
            [inboxResult, sentResult] = await Promise.all(fetches);
          }
        } catch (err) {
          if (err instanceof SyncTokenExpiredError) {
            console.warn(
              `[sync-engine] Sync token expired for ${connectionId}, reconciling bounded overlap`
            );
            try {
              mailboxReconciliation = await reconcileExpiredMailboxHistory(
                provider,
                connection,
                undefined,
                includeSentMail
              );
              ({ inboxResult, sentResult } = mailboxReconciliation);
            } catch (reconciliationErr) {
              if (reconciliationErr instanceof ProviderAuthError) {
                await markConnectionNeedsReconnect(
                  connectionId,
                  reconciliationErr.message
                );
              } else if (reconciliationErr instanceof ProviderScopeError) {
                await markConnectionNeedsReconnect(
                  connectionId,
                  reconciliationErr.message
                );
              }
              throw reconciliationErr;
            }
          } else {
            if (err instanceof ProviderAuthError) {
              await markConnectionNeedsReconnect(connectionId, err.message);
            } else if (err instanceof ProviderScopeError) {
              await markConnectionNeedsReconnect(connectionId, err.message);
            }
            throw err;
          }
        }

      // Discovery buckets are not authoritative direction. Gmail labels can
      // overlap and aliases/forwarding can surface operator-authored messages in
      // an INBOX history result. Dedupe across both provider reads, then resolve
      // each persisted direction from author identity before any CRM write.
      const discoveredByMessageId = new Map<string, NormalizedEmail>();
      for (const discovered of [...inboxResult.emails, ...sentResult.emails]) {
        const existing = discoveredByMessageId.get(discovered.id);
        discoveredByMessageId.set(
          discovered.id,
          existing
            ? {
                ...existing,
                ...discovered,
                labelIds: Array.from(
                  new Set([...existing.labelIds, ...discovered.labelIds])
                ),
              }
            : discovered
        );
      }
      const discoveredEmails = [...discoveredByMessageId.values()];
      const directionIdentity = {
        connectionEmail: connection.email,
        userEmailAddresses: profile.userEmailAddresses ?? [],
        companyDomains: profile.companyDomains ?? [],
      };
      const rawInboxEmails = discoveredEmails.filter(
        (email) =>
          resolvePersistedEmailDirection(email, directionIdentity) === "inbound"
      );
      const rawSentEmails = includeSentMail
        ? discoveredEmails.filter(
            (email) =>
              resolvePersistedEmailDirection(email, directionIdentity) ===
              "outbound"
          )
        : [];
      const newSyncToken =
        provider.providerType === "microsoft365"
          ? sentResult.nextSyncToken
          : inboxResult.nextSyncToken;
      const gmailRecoveryCheckpoint =
        mailboxReconciliation?.gmailCheckpoint ?? null;
      const persistSyncCheckpoint = async () => {
        if (gmailRecoveryCheckpoint?.nextPageToken) {
          await EmailService.updateConnection(connectionId, {
            historyRecoveryAnchor: gmailRecoveryCheckpoint.anchor,
            historyRecoveryPageToken: gmailRecoveryCheckpoint.nextPageToken,
            historyRecoveryTargetToken: gmailRecoveryCheckpoint.targetToken,
          });
          return;
        }

        await EmailService.updateConnection(connectionId, {
          lastSyncedAt: new Date(),
          historyId: newSyncToken,
          ...(gmailRecoveryCheckpoint
            ? {
                historyRecoveryAnchor: null,
                historyRecoveryPageToken: null,
                historyRecoveryTargetToken: null,
              }
            : {}),
        });
      };
      await renewSyncLeaseIfNeeded(true);

      if (rawInboxEmails.length === 0 && rawSentEmails.length === 0) {
        await persistSyncCheckpoint();
        return result;
      }

      profile.internalPhones = [
        ...(profile.internalPhones ?? []),
        ...(await loadInternalPhonesForCompany(connection.companyId)),
      ];

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

      // Step 2-4: Process the canonical delivered-message stream in provider
      // chronology. Provider discovery order is not conversation order, and
      // processing inbound/outbound buckets separately destroys interleaving
      // during catch-up. A stable message-id tie-breaker keeps retries
      // deterministic when providers return identical timestamps.
      const unmatchedContexts: UnmatchedInboundContext[] = [];
      const processingQueue = [
        ...inboxEmails.map((email) => ({
          email,
          direction: "inbound" as const,
        })),
        ...sentEmails.map((email) => ({
          email,
          direction: "outbound" as const,
        })),
      ].sort((left, right) => {
        const byDate = left.email.date.getTime() - right.email.date.getTime();
        return byDate !== 0
          ? byDate
          : left.email.id.localeCompare(right.email.id);
      });

      for (const item of processingQueue) {
        await renewSyncLeaseIfNeeded();
        if (item.direction === "inbound") {
          const unmatchedContext = await processInboundEmail(
            item.email,
            connection,
            profile,
            followUpDaysCache,
            result
          );
          if (unmatchedContext) unmatchedContexts.push(unmatchedContext);
        } else {
          await processSentEmail(
            item.email,
            connection,
            profile,
            followUpDaysCache,
            result
          );
        }
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
        if (unmatchedContexts.length > 0) {
          await renewSyncLeaseIfNeeded(true);
          const unmatchedEmails = unmatchedContexts.map(
            (context) => context.email
          );
          const unmatchedContextByIdentity = new Map(
            unmatchedContexts.map((context) => [
              `${context.email.threadId}\u0000${context.email.id}`,
              context,
            ])
          );
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
            await renewSyncLeaseIfNeeded();
            try {
              const classifiedEmail = normalizeProviderBackedEmailForSync(
                classified.email,
                connection,
                result,
                "sync_ai_classified_lead"
              );
              const context = unmatchedContextByIdentity.get(
                `${classifiedEmail.threadId}\u0000${classifiedEmail.id}`
              );
              if (!context) {
                throw new Error(
                  "AI reviewer returned a message outside the sanitized unmatched set"
                );
              }
              const {
                effectiveEmail,
                routingIdentity,
                contactFormSubmitter,
                enrichmentFacts: deterministicFacts,
                resolvedContact,
              } = context;

              const matchResult = await EmailMatchingServiceV2.match(
                connection.companyId,
                deterministicFacts.contactEmail ?? "",
                {
                  ...(routingIdentity.mayInheritProviderThread
                    ? {
                        threadId: routingIdentity.providerThreadId,
                        connectionId: connection.id,
                      }
                    : {}),
                  name: deterministicFacts.contactName ?? undefined,
                }
              );

              // The model may classify the lead/stage and fill safe missing
              // non-identity facts. Customer identity always comes from the
              // deterministic operator-excluding context captured before AI.
              const aiSupplementalFacts = leadEnrichmentFactsFromImport({
                contactName: null,
                contactEmail: null,
                contactPhone: null,
                address: null,
                estimatedValue:
                  deterministicFacts.estimatedValue == null
                    ? classified.estimatedValue
                    : null,
                description:
                  deterministicFacts.description == null
                    ? classified.description
                    : null,
                providerThreadId: classifiedEmail.threadId,
                providerMessageId: classifiedEmail.id,
                extractionSource: "ai_classified",
                aiConfidence: classified.confidence,
              });

              const relationshipDecision =
                await findOpportunityRelationshipMatch({
                  supabase,
                  companyId: connection.companyId,
                  connectionId: connection.id,
                  providerThreadId: routingIdentity.mayInheritProviderThread
                    ? classifiedEmail.threadId
                    : null,
                  clientId: matchResult.clientId,
                  facts: opportunityRelationshipFactsFromLeadEnrichment(
                    deterministicFacts,
                    effectiveEmail
                  ),
                });

              let clientId =
                matchResult.action === "link" ||
                matchResult.action === "create_subclient"
                  ? matchResult.clientId!
                  : null;
              let oppId: string;

              if (relationshipDecision.action === "link") {
                oppId = relationshipDecision.opportunityId;
                // The relationship winner is authoritative even when the
                // opportunity legitimately has no client yet. Never fall back
                // to a preliminary email/domain match for another customer.
                clientId = relationshipDecision.clientId;
              } else {
                clientId ??= await createClient(
                  effectiveEmail,
                  connection.companyId,
                  contactFormSubmitter,
                  deterministicFacts
                );
                const opportunity = await createOpportunity(
                  effectiveEmail,
                  clientId,
                  connection.companyId,
                  classified.stage,
                  {
                    candidates: [
                      {
                        source: "contact",
                        name: deterministicFacts.contactName,
                        email: deterministicFacts.contactEmail,
                      },
                    ],
                    unsafe: syncTitleUnsafeIdentity(connection, profile),
                    enrichmentFacts: deterministicFacts,
                    sourceKey: routingIdentity.sourceKey,
                  }
                );
                oppId = opportunity.id;
                clientId = opportunity.clientId;
              }

              // Complete retryable semantic writes before publishing the
              // durable thread/activity checkpoints. A failure now retries AI
              // instead of being diverted by an already-created activity.
              await applyCanonicalLeadEnrichment({
                supabase,
                opportunityId: oppId,
                clientId,
                facts: deterministicFacts,
                companyId: connection.companyId,
              });
              if (
                aiSupplementalFacts.estimatedValue != null ||
                aiSupplementalFacts.description != null
              ) {
                await applyCanonicalLeadEnrichment({
                  supabase,
                  opportunityId: oppId,
                  clientId,
                  facts: aiSupplementalFacts,
                  companyId: connection.companyId,
                });
              }

              const subClientIdentity =
                subClientIdentityFromFacts(deterministicFacts);
              if (
                matchResult.action === "create_subclient" &&
                clientId &&
                matchResult.clientId === clientId &&
                subClientIdentity
              ) {
                await createSubClient(
                  effectiveEmail,
                  clientId,
                  connection.companyId,
                  subClientIdentity
                );
              }

              const linked = routingIdentity.mayInheritProviderThread
                ? await linkThread(
                    oppId,
                    classifiedEmail.threadId,
                    connection.id
                  )
                : true;
              if (!linked) continue;
              const activityCreated = await createActivity(
                effectiveEmail,
                connection,
                oppId,
                "inbound",
                {
                  matchConfidence:
                    relationshipDecision.action === "link"
                      ? relationshipDecision.confidence
                      : "ai",
                  ...(routingIdentity.isContactFormSubmission
                    ? { skipThreadState: true }
                    : {}),
                }
              );
              if (!activityCreated) continue;
              await updateCorrespondenceCounts(
                oppId,
                effectiveEmail,
                connection,
                followUpDaysCache,
                result
              );
              await applyLabel(classifiedEmail.threadId, connection, result);
              result.activitiesCreated++;
            } catch (err) {
              throw new LifecyclePersistenceError(
                `[sync-engine] failed to persist AI-classified lead ${classified.clientEmail}: ${err instanceof Error ? err.message : "unknown error"}`
              );
            }
          }
          result.newLeads += aiResult.newLeadsClassified;
        }

        // Step 6: AI stage evaluation for threads that received new emails
        const activeLeadTargets = new Map<
          string,
          string | { threadId: string; messages: NormalizedEmail[] }
        >();
        const opportunityByEvaluationKey = new Map<string, string>();
        for (const email of [...inboxEmails, ...sentEmails]) {
          const activity = await findExistingProviderActivity(
            supabase,
            connection,
            email.id,
            email.threadId
          );
          const opportunityId = activity?.opportunity_id ?? null;
          if (!opportunityId) continue;

          const routing = buildLeadRoutingIdentity(email, {
            provider: connection.provider,
            connectionId: connection.id,
          });
          const evaluationKey = routing.isContactFormSubmission
            ? routing.sourceKey
            : routing.providerThreadId;
          const priorOpportunityId =
            opportunityByEvaluationKey.get(evaluationKey);
          if (priorOpportunityId && priorOpportunityId !== opportunityId) {
            throw new LifecyclePersistenceError(
              `[sync-engine] stage evaluation identity ${evaluationKey} resolved to multiple opportunities`
            );
          }
          opportunityByEvaluationKey.set(evaluationKey, opportunityId);
          if (!activeLeadTargets.has(evaluationKey)) {
            activeLeadTargets.set(
              evaluationKey,
              routing.isContactFormSubmission
                ? { threadId: evaluationKey, messages: [email] }
                : email.threadId
            );
          }
        }

        if (activeLeadTargets.size > 0) {
          await renewSyncLeaseIfNeeded(true);
          // Combined stage evaluation + opportunity summary in a single AI call
          const stageResults = await AISyncReviewer.evaluateStagesWithSummary(
            [...activeLeadTargets.values()],
            connection,
            { name: companyName }
          );

          for (const sr of stageResults) {
            await renewSyncLeaseIfNeeded();
            const oppId = opportunityByEvaluationKey.get(sr.threadId);
            if (!oppId) {
              throw new LifecyclePersistenceError(
                `[sync-engine] stage evaluation returned unknown identity ${sr.threadId}`
              );
            }

            // Check current stage + manual override flag
            const { data: oppData, error: opportunityLookupError } =
              await supabase
                .from("opportunities")
                .select(
                  "stage, stage_manually_set, actual_value, detected_value, estimated_value"
                )
                .eq("id", oppId)
                .single();
            if (opportunityLookupError || !oppData) {
              throw new LifecyclePersistenceError(
                `[sync-engine] stage evaluation opportunity lookup failed for ${oppId}: ${opportunityLookupError?.message ?? "row not found"}`
              );
            }

            let autoConvertedLikelyWon = false;
            if (sr.terminalFlag) {
              autoConvertedLikelyWon = await maybeAutoConvertLikelyWon(
                sr,
                connection,
                oppId,
                oppData
              );

              if (!autoConvertedLikelyWon) {
                // Manual stages, likely_lost, already-terminal opportunities,
                // or conversion failures still surface for operator review.
                await createTerminalFlagNotification(sr, connection, oppId);
              }
            }

            // Build update payload — always write summary if present
            const updates: Record<string, unknown> = {};
            let requestedStage: string | null = null;

            if (sr.summary) {
              updates.ai_summary = sr.summary;
            }
            // The evidence describes the latest evaluated conversation, not
            // only the last transition. Refresh it even when the inferred
            // stage remains unchanged so the lead never displays stale proof.
            updates.ai_stage_signals = [sr.terminalFlag || "ai_evaluated"];

            // Only write stage if it actually changed AND user hasn't manually set it
            if (
              !autoConvertedLikelyWon &&
              sr.newStage &&
              !oppData?.stage_manually_set &&
              sr.newStage !== oppData?.stage
            ) {
              requestedStage = sr.newStage;
            }

            if (Object.keys(updates).length > 0) {
              try {
                const { error: updateError } = await supabase
                  .from("opportunities")
                  .update(updates)
                  .eq("id", oppId);

                if (updateError) {
                  throw new LifecyclePersistenceError(
                    `[sync-engine] lifecycle update failed for opportunity ${oppId}: ${updateError.message ?? "unknown error"}`
                  );
                }
              } catch (updateError) {
                if (updateError instanceof LifecyclePersistenceError) {
                  throw updateError;
                }
                throw new LifecyclePersistenceError(
                  `[sync-engine] lifecycle update failed for opportunity ${oppId}: ${updateError instanceof Error ? updateError.message : "unknown error"}`
                );
              }
            }

            if (requestedStage) {
              const { data: transitionRows, error: transitionError } =
                await supabase.rpc("apply_email_opportunity_stage_transition", {
                  p_company_id: connection.companyId,
                  p_opportunity_id: oppId,
                  p_to_stage: requestedStage,
                  p_ai_signal: sr.terminalFlag || "ai_evaluated",
                });
              if (transitionError || !transitionRows) {
                throw new LifecyclePersistenceError(
                  `[sync-engine] AI stage transition failed for opportunity ${oppId}: ${transitionError?.message ?? "RPC returned no rows"}`
                );
              }
              const transition = Array.isArray(transitionRows)
                ? transitionRows[0]
                : transitionRows;
              if (!transition) {
                throw new LifecyclePersistenceError(
                  `[sync-engine] AI stage transition returned no opportunity for ${oppId}`
                );
              }
              if (transition.changed) result.stageChanges++;
            }
          }
        }
      } catch (aiErr) {
        if (aiErr instanceof LifecyclePersistenceError) throw aiErr;
        throw new LifecyclePersistenceError(
          `[sync-engine] AI review failed before cursor advancement: ${aiErr instanceof Error ? aiErr.message : "unknown error"}`
        );
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
          connectionId
        ).catch((err) => {
          console.error(
            "[sync-engine] Milestone check failed (non-fatal):",
            err
          );
        });
      }

      // Step 12: Update sync token
      await renewSyncLeaseIfNeeded(true);
      await persistSyncCheckpoint();
    } catch (err) {
      console.error(`[sync-engine] Error syncing ${connectionId}:`, err);
      result.errors.push(err instanceof Error ? err.message : "Unknown error");
    } finally {
      // P0-A: always release the per-connection sync lock.
      await releaseSyncLock(connectionId, syncLockOwner);
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
        lastMessageDirection:
          (opp.last_message_direction as "in" | "out") || "out",
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
