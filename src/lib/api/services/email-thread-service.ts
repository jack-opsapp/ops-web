/**
 * OPS Web - Email Thread Service (Inbox v2)
 *
 * CRUD + triage operations on the `email_threads` table. Called by:
 *   - sync-engine (upsertFromEmail + classifyAndUpdate on every inbound/
 *     outbound message)
 *   - API routes under /api/inbox/* (list, getThread, archive, snooze,
 *     recategorize)
 *   - backfill script (upsertFromEmail + classifyAndUpdate on existing
 *     activities)
 *
 * Phase C integration is deliberately scoped OUT of this file — the autonomy
 * router lives in phase-c-autonomy-router.ts and is invoked as a post-hook
 * from the route handlers and sync-engine step 7.5. Keeping the thread CRUD
 * layer agent-unaware means the router can evolve independently.
 */

import {
  requireSupabase,
  parseDate,
  parseDateRequired,
} from "@/lib/supabase/helpers";
import { EmailService } from "./email-service";
import { type EmailConnection } from "@/lib/types/email-connection";
import {
  mapEmailThreadFromDb,
  type ArchiveLeadPreference,
  type ArchiveWritebackPreference,
  type EmailThread,
  type EmailThreadCategory,
  type EmailThreadLabel,
  type InboxScope,
  type ListInboxThreadsParams,
  type ListInboxThreadsResult,
} from "@/lib/types/email-thread";
import { applyRailPredicate } from "@/lib/inbox/rail-predicates";
import {
  derivePhaseC,
  type PhaseCDraftRow,
} from "@/lib/inbox/phase-c-derivation";
import { tryDeterministicInternal } from "./deterministic-internal-rule";
import {
  loadCompanyUsers,
  loadTeamForwarders,
} from "./deterministic-internal-reads";
import { tryDeterministicCustomer } from "./deterministic-customer-rule";
import { loadOpportunityForCustomerRule } from "./deterministic-customer-reads";
import {
  ThreadClassifier,
  type ClassifyMessage,
  type LearnedRule,
} from "./thread-classifier-service";
import {
  isCommonEmailDomain,
  extractContactFormSubmissionPreviewText,
  extractEmailAddress,
  stripQuotedContent,
  resolveEffectiveSenderEmail,
} from "@/lib/utils/email-parsing";
import { assertValidProviderEmailIds } from "@/lib/email/provider-email-ids";
import type { NormalizedEmail } from "./email-provider";
import { listEmailThreadSiblings } from "./email-thread-sibling-service";
import {
  buildEmailThreadListAuthorizationFilter,
  type AllowedEmailInboxListAccess,
} from "@/lib/email/email-opportunity-access";
import {
  applyOpportunityChaseState,
  type OpportunityChaseRow,
} from "@/lib/inbox/opportunity-chase-enrichment";
import { runEmailProviderMailboxOperation } from "./email-provider-mailbox-operation";

const EMAIL_THREAD_MAILBOX_BUSY = "EMAIL_THREAD_MAILBOX_BUSY";
const EMAIL_THREAD_PROVIDER_AUTHORIZATION_REVOKED =
  "EMAIL_THREAD_PROVIDER_AUTHORIZATION_REVOKED";

/**
 * A Gmail/M365 thread's canonical parent (the `email_threads` cache row) is
 * owned by a different opportunity than the one an inbound message routed to —
 * the signature of two duplicate leads claiming one conversation. Carried as a
 * typed error so `sync-engine` can quarantine just this thread (operator-rail
 * alert) and let ingestion + the provider cursor keep moving, instead of the
 * generic throw that froze the mailbox for 20+ hours in the 2026-07-22 outage.
 */
export class EmailThreadParentConflictError extends Error {
  readonly providerThreadId: string;
  /** Existing cache-row owner; null when the conflict is proven inside the DB. */
  readonly threadOpportunityId: string | null;
  readonly routedOpportunityId: string | null;

  constructor(params: {
    providerThreadId: string;
    threadOpportunityId: string | null;
    routedOpportunityId: string | null;
  }) {
    super(
      "upsertFromEmail opportunity projection failed: email_thread_parent_conflict"
    );
    this.name = "EmailThreadParentConflictError";
    this.providerThreadId = params.providerThreadId;
    this.threadOpportunityId = params.threadOpportunityId;
    this.routedOpportunityId = params.routedOpportunityId;
  }
}

type AuthorizeThreadProviderMutation = (threadId: string) => Promise<boolean>;

async function reloadClassificationWinner(input: {
  supabase: ReturnType<typeof requireSupabase>;
  thread: EmailThread;
  context: string;
}): Promise<EmailThread> {
  const { data, error } = await input.supabase
    .from("email_threads")
    .select("*")
    .eq("id", input.thread.id)
    .eq("company_id", input.thread.companyId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `${input.context} concurrent reload failed: ${error.message}`
    );
  }
  if (!data) {
    throw new Error(
      `${input.context} target disappeared during classification`
    );
  }
  return mapEmailThreadFromDb(data);
}

async function runThreadProviderOperation<T>(input: {
  supabase: ReturnType<typeof requireSupabase>;
  connection: EmailConnection;
  context: string;
  authorizeProviderMutation?: () => Promise<boolean>;
  run: (provider: ReturnType<typeof EmailService.getProvider>) => Promise<T>;
}): Promise<T> {
  return runEmailProviderMailboxOperation({
    supabase: input.supabase,
    connectionId: input.connection.id,
    context: input.context,
    busyError: EMAIL_THREAD_MAILBOX_BUSY,
    run: async () => {
      if (
        input.authorizeProviderMutation &&
        !(await input.authorizeProviderMutation())
      ) {
        throw new Error(EMAIL_THREAD_PROVIDER_AUTHORIZATION_REVOKED);
      }
      const provider = EmailService.getProvider(input.connection);
      return input.run(provider);
    },
  });
}

// ─── Sender-name resolution ──────────────────────────────────────────────────
//
// Three-tier lookup against the OPS directory (clients → sub_clients →
// users), case-insensitive on email. Used by upsertFromEmail to populate
// `latest_sender_name` with the canonical name for the contact rather than
// whatever display string the sender's mail client happened to put in the
// From header (or the local-part fallback, which produces garbage like
// "canprojack" for bare-email senders).
//
// Memoized with a short TTL. Sync cycles call upsertFromEmail in tight
// loops — without the cache we'd fire 3 roundtrips per message for what
// are usually the same handful of senders per cycle.

const GENERIC_MAILBOX_TOKENS = new Set([
  "team",
  "info",
  "accounts",
  "accounting",
  "sales",
  "support",
  "billing",
  "help",
  "hello",
  "contact",
  "noreply",
  "no-reply",
  "admin",
  "office",
  "mailbox",
  "inbox",
  "notifications",
  "updates",
  "news",
  "marketing",
  "service",
  "services",
  "enquiries",
  "inquiries",
]);

/**
 * True when a display name looks like a generic mailbox label rather than a
 * person or a company. Triggers if ANY token in the name matches the list —
 * "Info Mailbox" and "Sales Team" both fail. Multi-word person names
 * ("Cecilia Reyes") pass cleanly because none of their tokens are generic.
 */
function isGenericMailboxName(name: string | null | undefined): boolean {
  if (!name) return true;
  const tokens = name
    .toLowerCase()
    .split(/[\s_\-/.]+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.some((t) => GENERIC_MAILBOX_TOKENS.has(t));
}

/**
 * Cache map keyed by `${companyId}::${lowercaseEmail}`. Value is the
 * resolved name or an empty string to represent "looked up, no match"
 * (so we don't re-query every no-match sender repeatedly).
 */
const senderNameCache = new Map<string, { name: string; expiresAt: number }>();
const SENDER_NAME_CACHE_TTL_MS = 60_000;

function getCachedSenderName(key: string): string | undefined {
  const hit = senderNameCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    senderNameCache.delete(key);
    return undefined;
  }
  return hit.name;
}

function setCachedSenderName(key: string, name: string) {
  senderNameCache.set(key, {
    name,
    expiresAt: Date.now() + SENDER_NAME_CACHE_TTL_MS,
  });
}

function snippetFromMessage(
  snippet: string | null | undefined,
  bodyText: string | null | undefined,
  subject: string | null | undefined = ""
): string {
  const formSnippet = extractContactFormSubmissionPreviewText(
    subject ?? "",
    bodyText ?? snippet ?? ""
  );
  if (formSnippet) return formSnippet.slice(0, 400);
  return ((snippet ?? "").trim() || (bodyText ?? "").trim()).slice(0, 400);
}

function isGenericThreadSummary(value: string | null | undefined): boolean {
  const summary = (value ?? "").trim();
  if (!summary) return true;
  return /^(?:Classification unavailable\b|Thread classified as\b|Linked to an? [a-z_ ]+ opportunity\s*[—-]\s*|Customer thread\.?$|No summary available\.?$)/i.test(
    summary
  );
}

const THREAD_SUMMARY_GENERIC_TOKENS = new Set([
  "about",
  "active",
  "ask",
  "client",
  "current",
  "customer",
  "discuss",
  "discussion",
  "email",
  "follow",
  "lead",
  "message",
  "ongoing",
  "open",
  "opportunity",
  "project",
  "request",
  "status",
  "thread",
  "work",
]);

const THREAD_SUMMARY_TOKEN_FAMILIES: ReadonlyArray<ReadonlySet<string>> = [
  new Set([
    "quote",
    "estimate",
    "estimat",
    "proposal",
    "pricing",
    "pric",
    "price",
  ]),
  new Set([
    "schedule",
    "schedul",
    "booking",
    "book",
    "date",
    "timeline",
    "availability",
  ]),
  new Set(["deposit", "payment", "pay", "paid", "invoice"]),
  new Set(["install", "installation"]),
  new Set(["remove", "remov", "removal"]),
  new Set(["reply", "respond", "response"]),
  new Set(["call", "phone"]),
  new Set(["update", "change", "chang"]),
];

function normalizeThreadSummaryToken(value: string): string {
  if (value.length > 5 && value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.length > 6 && value.endsWith("ing")) {
    return value.slice(0, -3);
  }
  if (value.length > 5 && value.endsWith("ed")) {
    return value.slice(0, -2);
  }
  if (value.length > 4 && value.endsWith("s")) {
    return value.slice(0, -1);
  }
  return value;
}

function canonicalThreadSummaryToken(value: string): string {
  const normalized = normalizeThreadSummaryToken(value);
  const familyIndex = THREAD_SUMMARY_TOKEN_FAMILIES.findIndex((family) =>
    family.has(normalized)
  );
  return familyIndex >= 0 ? `family:${familyIndex}` : normalized;
}

function groundedThreadSummaryTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const rawToken of value.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
    const normalized = normalizeThreadSummaryToken(rawToken.replace(/'/g, ""));
    if (
      normalized.length < 4 ||
      THREAD_SUMMARY_GENERIC_TOKENS.has(normalized)
    ) {
      continue;
    }
    tokens.add(canonicalThreadSummaryToken(normalized));
  }
  return tokens;
}

function groundedThreadSummaryNumbers(value: string): Set<string> {
  const numbers = new Set<string>();
  for (const match of value.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) {
    const parsed = Number(match[0].replace(/,/g, ""));
    if (Number.isFinite(parsed)) numbers.add(String(parsed));
  }
  return numbers;
}

/**
 * Accept narrative output only when it is grounded in the cleaned bodies used
 * for this exact classification pass. Subjects, provider snippets, quoted
 * reply chains, and model-authored numbers are not evidence. When grounding
 * is absent, the newest cleaned-message fallback remains authoritative.
 */
function isGroundedThreadSummary(
  candidate: string,
  messages: ClassifyMessage[]
): boolean {
  const cleanedBodies = messages
    .map((message) => message.bodyText.trim())
    .filter(Boolean);
  if (cleanedBodies.length === 0) return false;

  const sourceText = cleanedBodies.join("\n");
  const sourceNumbers = groundedThreadSummaryNumbers(sourceText);
  const candidateNumbers = groundedThreadSummaryNumbers(candidate);
  if ([...candidateNumbers].some((number) => !sourceNumbers.has(number))) {
    return false;
  }

  const sourceTokens = groundedThreadSummaryTokens(sourceText);
  const candidateTokens = groundedThreadSummaryTokens(candidate);
  if (candidateTokens.size === 0) return false;
  return [...candidateTokens].some((token) => sourceTokens.has(token));
}

function currentThreadSummary(input: {
  subject: string;
  latestSnippet?: string | null;
  messages: ClassifyMessage[];
}): string {
  const latestMessage = [...input.messages]
    .reverse()
    .map((message) => snippetFromMessage(null, message.bodyText, input.subject))
    .find(Boolean);
  const current =
    latestMessage ??
    snippetFromMessage(input.latestSnippet, null, input.subject) ??
    input.subject.trim();
  const compact = current.replace(/\s+/g, " ").trim().slice(0, 400);
  const factual =
    compact || input.subject.trim() || "No readable message content.";
  return /[.!?]$/.test(factual) ? factual : `${factual}.`;
}

function chooseThreadSummary(
  candidate: string | null | undefined,
  fallback: string,
  messages: ClassifyMessage[]
): string {
  const trimmed = (candidate ?? "").trim();
  return isGenericThreadSummary(trimmed) ||
    !isGroundedThreadSummary(trimmed, messages)
    ? fallback
    : trimmed;
}

/**
 * Look up a canonical name for `senderEmail` in this company's directory.
 * Priority: clients → sub_clients → users. Returns "" (empty) when no row
 * matches — caller can fall through to the display-name / email-address
 * fallback chain.
 *
 * Both sides of the email comparison are lowercased. Queries fire in
 * parallel so wall-time is one roundtrip.
 */
async function resolveSenderNameFromDirectory(
  supabase: ReturnType<typeof requireSupabase>,
  companyId: string,
  senderEmail: string
): Promise<string> {
  if (!senderEmail || !companyId) return "";
  const lc = senderEmail.toLowerCase();
  const cacheKey = `${companyId}::${lc}`;
  const cached = getCachedSenderName(cacheKey);
  if (cached !== undefined) return cached;

  // Fire all three lookups in parallel. PostgREST's `ilike` is
  // case-insensitive and exact-match — cheaper than lower(email) function
  // calls and works with any existing index on the column.
  const [clientsRes, subClientsRes, usersRes] = await Promise.all([
    supabase
      .from("clients")
      .select("name")
      .eq("company_id", companyId)
      .ilike("email", lc)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sub_clients")
      .select("name")
      .eq("company_id", companyId)
      .ilike("email", lc)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("users")
      .select("first_name, last_name")
      .eq("company_id", companyId)
      .ilike("email", lc)
      .limit(1)
      .maybeSingle(),
  ]);

  let resolved = "";
  if (clientsRes.data?.name) {
    resolved = String(clientsRes.data.name).trim();
  } else if (subClientsRes.data?.name) {
    resolved = String(subClientsRes.data.name).trim();
  } else if (usersRes.data) {
    const fn = (usersRes.data.first_name as string | null) ?? "";
    const ln = (usersRes.data.last_name as string | null) ?? "";
    resolved = `${fn} ${ln}`.trim();
  }

  setCachedSenderName(cacheKey, resolved);
  return resolved;
}

/**
 * Compose the final `latest_sender_name` we want to persist. Policy:
 *   1. Directory lookup (clients → sub_clients → users) if match.
 *   2. Raw From display name IF it's not a generic mailbox label.
 *   3. Full email address (NOT the local part — avoids "canprojack" for
 *      canprojack@gmail.com). Guarantees we never persist a naked local
 *      part and never persist null unless the email itself is empty.
 */
async function composeSenderName(
  supabase: ReturnType<typeof requireSupabase>,
  companyId: string,
  senderEmail: string,
  fromName: string | null | undefined
): Promise<string> {
  const directory = await resolveSenderNameFromDirectory(
    supabase,
    companyId,
    senderEmail
  );
  if (directory) return directory;
  const candidate = (fromName ?? "").trim();
  if (candidate && !isGenericMailboxName(candidate)) return candidate;
  return senderEmail || candidate || "Unknown";
}

// ─── Client-id resolution ──────────────────────────────────────────────────
//
// Find the canonical `client_id` for a message by checking every
// participant email against clients + sub_clients for this company. Used
// by upsertFromEmail so threads auto-link to their client the first time
// a matching participant appears — the inbox list can then render the
// client's name instead of the raw sender. Clients take priority over
// sub_clients (a direct match is stronger than a parent-of-contact match).
//
// Returns null when no participant matches. A single query with IN-list
// covers both tables in one roundtrip per table.

async function resolveClientIdFromEmails(
  supabase: ReturnType<typeof requireSupabase>,
  companyId: string,
  participantEmails: string[]
): Promise<string | null> {
  if (!companyId || participantEmails.length === 0) return null;
  const unique = Array.from(
    new Set(
      participantEmails.map((e) => e.toLowerCase().trim()).filter(Boolean)
    )
  );
  if (unique.length === 0) return null;

  const [clientsRes, subClientsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, email")
      .eq("company_id", companyId)
      .in("email", unique)
      .limit(1),
    supabase
      .from("sub_clients")
      .select("client_id, email")
      .eq("company_id", companyId)
      .in("email", unique)
      .limit(1),
  ]);

  const clientRow = clientsRes.data?.[0];
  if (clientRow?.id) return String(clientRow.id);
  const subRow = subClientsRes.data?.[0];
  if (subRow?.client_id) return String(subRow.client_id);
  return null;
}

// ─── Labels (label-toggle helpers) ───────────────────────────────────────────

function evaluateLabelsFromMessages(
  messages: Array<{
    direction: "inbound" | "outbound";
    bodyText: string;
    hasAttachments?: boolean;
  }>,
  senderIsNew: boolean
): EmailThreadLabel[] {
  if (messages.length === 0) return [];
  const last = messages[messages.length - 1];
  const labels = new Set<EmailThreadLabel>();

  // AWAITING_REPLY — last message inbound AND looks like a question/request
  if (last.direction === "inbound") {
    const body = (last.bodyText || "").toLowerCase();
    const hasQuestion =
      body.includes("?") ||
      /\b(can you|could you|please|let me know|any chance|when|what time|confirm|awaiting|looking forward)\b/i.test(
        body
      );
    if (hasQuestion) labels.add("AWAITING_REPLY");
  }

  // HAS_ATTACHMENT
  if (messages.some((m) => m.hasAttachments)) {
    labels.add("HAS_ATTACHMENT");
  }

  // HAS_QUOTE / HAS_INVOICE — simple keyword heuristics (classifier may add more)
  const allText = messages
    .map((m) => m.bodyText || "")
    .join(" ")
    .toLowerCase();
  if (
    /\b(quote|estimate|pricing|total due|subtotal)\b/i.test(allText) &&
    /\$\s*\d/.test(allText)
  ) {
    labels.add("HAS_QUOTE");
  }
  if (
    /\binvoice\s*(?:#|number|:)\s*\w+/i.test(allText) ||
    /\bpayable upon receipt\b/i.test(allText)
  ) {
    labels.add("HAS_INVOICE");
  }

  // URGENT — explicit time pressure
  if (
    /\b(urgent|asap|emergency|by (?:friday|monday|tomorrow|today|eod)|deadline)\b/i.test(
      allText
    )
  ) {
    labels.add("URGENT");
  }

  // FROM_NEW_SENDER
  if (senderIsNew) labels.add("FROM_NEW_SENDER");

  return Array.from(labels);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const addr = extractEmailAddress(email).toLowerCase();
  const at = addr.indexOf("@");
  return at >= 0 ? addr.slice(at + 1) : null;
}

async function loadLearnedRules(
  companyId: string,
  senderEmail: string | null,
  senderDomain: string | null
): Promise<{ forDomain: LearnedRule[]; forSender: LearnedRule[] }> {
  const supabase = requireSupabase();

  const [domainRes, senderRes] = await Promise.all([
    senderDomain
      ? supabase
          .from("email_thread_category_corrections")
          .select("from_category, to_category")
          .eq("company_id", companyId)
          .eq("sender_domain", senderDomain)
      : Promise.resolve({
          data: [] as Array<Record<string, unknown>>,
          error: null,
        }),
    senderEmail
      ? supabase
          .from("email_thread_category_corrections")
          .select("from_category, to_category")
          .eq("company_id", companyId)
          .eq("sender_email", senderEmail.toLowerCase())
      : Promise.resolve({
          data: [] as Array<Record<string, unknown>>,
          error: null,
        }),
  ]);

  return {
    forDomain: countRulePairs(domainRes.data ?? []),
    forSender: countRulePairs(senderRes.data ?? []),
  };
}

function countRulePairs(rows: Array<Record<string, unknown>>): LearnedRule[] {
  const counts = new Map<string, LearnedRule>();
  for (const r of rows) {
    const from = r.from_category as EmailThreadCategory;
    const to = r.to_category as EmailThreadCategory;
    const key = `${from}->${to}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { fromCategory: from, toCategory: to, count: 1 });
  }
  return Array.from(counts.values());
}

async function senderHasPriorConversations(
  companyId: string,
  senderEmail: string
): Promise<boolean> {
  const supabase = requireSupabase();
  const { count } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("type", "email")
    .eq("from_email", senderEmail.toLowerCase())
    .limit(1);
  return (count ?? 0) > 1; // >1 because the one that just arrived is already stored
}

// ─── Upsert from email ───────────────────────────────────────────────────────

export interface UpsertFromEmailParams {
  companyId: string;
  connectionId: string;
  providerThreadId: string;
  email: NormalizedEmail;
  direction: "inbound" | "outbound";
  opportunityId?: string | null;
  clientId?: string | null;
  /**
   * A newly materialized provider message invalidates every derived thread
   * field, including summaries on manually categorized threads. Replays pass
   * false so an already-classified row is not made dirty again.
   */
  markClassificationDirty?: boolean;
}

export interface UpsertFromEmailResult {
  threadRow: EmailThread;
  isNew: boolean;
}

// ─── Phase C draft-state enrichment ─────────────────────────────────────────
//
// Overlays the derived `phaseC` field on each thread by joining the page
// against the latest matching `ai_draft_history` row. The pure derivation
// rules live in `@/lib/inbox/phase-c-derivation`; this function is only the
// orchestration: gather IDs, run one batched query, dedupe, dispatch.
//
// Defensive: if the join query fails for any reason, log and return the
// threads unchanged (phaseC stays the mapper's default of "none"). The
// inbox must keep rendering even when ai_draft_history is unreachable.

interface DraftHistoryQueryRow extends PhaseCDraftRow {
  connection_id: string;
  thread_id: string;
  created_at: string;
}

async function enrichWithPhaseC(
  threads: EmailThread[]
): Promise<EmailThread[]> {
  if (threads.length === 0) return threads;
  const supabase = requireSupabase();

  const connectionIds = Array.from(new Set(threads.map((t) => t.connectionId)));
  const providerThreadIds = Array.from(
    new Set(threads.map((t) => t.providerThreadId))
  );

  // Single batched lookup. Page size is bounded (≤ LIST_LIMIT_MAX) so the
  // IN-list stays small. Order DESC by created_at and dedupe in JS — keeping
  // the latest row per (connection_id, thread_id). A Postgres-side DISTINCT ON
  // would be cleaner but requires a custom RPC; this is fine at page-scale.
  // Index: idx_ai_draft_history_thread_lookup (connection_id, thread_id, created_at DESC).
  const { data, error } = await supabase
    .from("ai_draft_history")
    .select(
      "connection_id, thread_id, status, sent_without_changes, created_at"
    )
    .in("connection_id", connectionIds)
    .in("thread_id", providerThreadIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      "[email-thread-service] enrichWithPhaseC query failed:",
      error.message
    );
    return threads;
  }

  const latest = new Map<string, DraftHistoryQueryRow>();
  for (const row of (data ?? []) as DraftHistoryQueryRow[]) {
    const key = `${row.connection_id}::${row.thread_id}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  return threads.map((t) => {
    const key = `${t.connectionId}::${t.providerThreadId}`;
    const row = latest.get(key) ?? null;
    const phaseC = derivePhaseC({ latestDirection: t.latestDirection }, row);
    return phaseC === "none" ? t : { ...t, phaseC };
  });
}

// ─── Linked-opportunity chase-state enrichment ─────────────────────────────
//
// Thread unread/label data remains untouched. This overlay contributes only
// the linked lead's canonical YOUR MOVE answer, letting triage suppress stale
// thread-level reply debt after the operator marks the lead handled. Missing
// rows stay unknown (null), so authorization or projection gaps fail open to
// the existing thread signals rather than hiding customer work.

async function enrichWithOpportunityChaseState(
  threads: EmailThread[]
): Promise<EmailThread[]> {
  const opportunityIds = Array.from(
    new Set(
      threads
        .map((thread) => thread.opportunityId)
        .filter((id): id is string => id !== null)
    )
  );
  if (threads.length === 0 || opportunityIds.length === 0) {
    return applyOpportunityChaseState(threads, []);
  }

  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("opportunities")
    .select(
      "id, stage, last_message_direction, last_inbound_at, last_outbound_at, handled_at, operator_action_required_at"
    )
    .eq("company_id", threads[0].companyId)
    .in("id", opportunityIds);

  if (error) {
    console.error(
      "[email-thread-service] enrichWithOpportunityChaseState query failed:",
      error.message
    );
    return applyOpportunityChaseState(threads, []);
  }

  return applyOpportunityChaseState(
    threads,
    (data ?? []) as OpportunityChaseRow[]
  );
}

// ─── Next-commitment id enrichment ──────────────────────────────────────────
//
// `email_threads.next_commitment_due_at` is denormalized via DB trigger but
// the underlying `agent_memories.id` isn't — and the today-bar's inline ✓
// resolve affordance needs that id to PATCH /api/inbox/commitments/:id.
//
// One batched query against agent_memories per page, scoped to threads that
// the trigger already flagged via `has_unresolved_commitments`. The query
// touches the indexed (company_id, source_id, category, resolved_at)
// surface — bounded both in input (page-size threads) and output (one
// memory per thread on the result set after dedupe).

async function enrichWithNextCommitmentId(
  threads: EmailThread[]
): Promise<EmailThread[]> {
  const candidates = threads.filter((t) => t.hasUnresolvedCommitments);
  if (candidates.length === 0) return threads;
  const supabase = requireSupabase();

  const threadIds = candidates.map((t) => t.id);
  const companyId = candidates[0].companyId;

  const { data, error } = await supabase
    .from("agent_memories")
    .select("id, source_id, due_date")
    .eq("company_id", companyId)
    .eq("category", "commitment")
    .is("resolved_at", null)
    .in("source_id", threadIds)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) {
    console.error(
      "[email-thread-service] enrichWithNextCommitmentId query failed:",
      error.message
    );
    return threads;
  }

  // Dedupe by source_id keeping the earliest-due row. The query already
  // returned them ordered by due_date ASC, so a "first wins" pass is
  // equivalent to a window function pick.
  const idByThread = new Map<string, string>();
  for (const row of (data ?? []) as Array<{
    id: string;
    source_id: string;
  }>) {
    if (!idByThread.has(row.source_id)) {
      idByThread.set(row.source_id, row.id);
    }
  }

  return threads.map((t) => {
    const id = idByThread.get(t.id);
    return id ? { ...t, nextCommitmentId: id } : t;
  });
}

export function shouldRepairLatestSnippetFromActivities(
  thread: Pick<EmailThread, "latestSnippet" | "latestDirection">
): boolean {
  return !thread.latestSnippet?.trim() || thread.latestDirection !== null;
}

async function enrichWithActivitySnippets(
  threads: EmailThread[]
): Promise<EmailThread[]> {
  const candidates = threads.filter(shouldRepairLatestSnippetFromActivities);
  if (candidates.length === 0) return threads;

  const supabase = requireSupabase();
  const companyId = threads[0].companyId;
  const providerThreadIds = Array.from(
    new Set(candidates.map((t) => t.providerThreadId).filter(Boolean))
  );
  const connectionIds = Array.from(
    new Set(candidates.map((t) => t.connectionId).filter(Boolean))
  );
  if (providerThreadIds.length === 0) return threads;

  const [activityRes, connectionRes] = await Promise.all([
    supabase
      .from("activities")
      .select(
        "email_thread_id, from_email, subject, body_text, content, created_at"
      )
      .eq("company_id", companyId)
      .eq("type", "email")
      .in("email_thread_id", providerThreadIds)
      .order("created_at", { ascending: false }),
    connectionIds.length > 0
      ? supabase
          .from("email_connections")
          .select("id, email")
          .in("id", connectionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (activityRes.error || connectionRes.error) {
    console.error(
      "[email-thread-service] enrichWithActivitySnippets query failed:",
      activityRes.error?.message ?? connectionRes.error?.message
    );
    return threads;
  }

  const connectionEmailById = new Map<string, string>();
  for (const row of (connectionRes.data ?? []) as Array<{
    id: string;
    email: string | null;
  }>) {
    const email = row.email?.toLowerCase().trim();
    if (email) connectionEmailById.set(row.id, email);
  }

  const latestActivityByThread = new Map<
    string,
    { snippet: string; fromEmail: string | null; createdAt: Date | null }
  >();
  for (const row of (activityRes.data ?? []) as Array<{
    email_thread_id: string | null;
    from_email: string | null;
    subject: string | null;
    body_text: string | null;
    content: string | null;
    created_at: string | null;
  }>) {
    const threadId = row.email_thread_id;
    if (!threadId || latestActivityByThread.has(threadId)) continue;
    const snippet = snippetFromMessage(row.content, row.body_text, row.subject);
    if (!snippet) continue;
    latestActivityByThread.set(threadId, {
      snippet,
      fromEmail: row.from_email?.toLowerCase().trim() || null,
      createdAt: row.created_at ? new Date(row.created_at) : null,
    });
  }

  return threads.map((t) => {
    const activity = latestActivityByThread.get(t.providerThreadId);
    if (!activity) return t;

    const cachedSnippetIsBlank = !t.latestSnippet?.trim();
    const connectionEmail = connectionEmailById.get(t.connectionId) ?? null;
    const latestActivityIsFromConnection =
      !!connectionEmail && activity.fromEmail === connectionEmail;
    const activityMatchesThreadLast =
      activity.createdAt === null ||
      activity.createdAt.getTime() >= t.lastMessageAt.getTime() - 300_000;

    if (
      !cachedSnippetIsBlank &&
      (!latestActivityIsFromConnection || !activityMatchesThreadLast)
    ) {
      return t;
    }

    if (t.latestSnippet === activity.snippet) return t;
    return { ...t, latestSnippet: activity.snippet };
  });
}

// ─── List query ──────────────────────────────────────────────────────────────

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

/**
 * Build the PostgREST `.or(...)` expression for the inbox header's in-place
 * search input. The search ILIKEs across subject + latest snippet + sender
 * name + sender email so the operator's "acme" hits any of those signals.
 *
 * Two layers of escaping have to compose correctly to keep arbitrary user
 * input safe:
 *
 *   1. SQL ILIKE pattern — `\` is the escape, `%` and `_` are wildcards.
 *      The user's literal `%` must become `\%`, etc., so we don't promote
 *      it to a wildcard.
 *   2. PostgREST quoted value — `,`, `.`, `(`, `)` are reserved in `.or()`
 *      expressions, so the value is double-quoted. Inside the quotes, `\`
 *      and `"` need backslash-escaping.
 *
 * Without this, a query like `a, b` truncates the filter list (the comma
 * becomes a separator) and a query like `100%` matches every row (the `%`
 * becomes a wildcard).
 *
 * Exported for unit testing.
 */
export function buildSearchOrExpression(raw: string): string {
  const ilikePattern = raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  const quoted = ilikePattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const value = `"%${quoted}%"`;
  return [
    `subject.ilike.${value}`,
    `latest_snippet.ilike.${value}`,
    `latest_sender_name.ilike.${value}`,
    `latest_sender_email.ilike.${value}`,
  ].join(",");
}

async function listThreads(
  companyId: string,
  userConnectionIds: string[],
  params: ListInboxThreadsParams,
  authorization: AllowedEmailInboxListAccess
): Promise<ListInboxThreadsResult> {
  const supabase = requireSupabase();
  const limit = Math.min(params.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX);

  let query = supabase
    .from("email_threads")
    .select("*")
    .eq("company_id", companyId);

  const authorizationFilter =
    buildEmailThreadListAuthorizationFilter(authorization);
  if (authorizationFilter.empty) {
    return { threads: [], nextCursor: null };
  }
  if (authorizationFilter.connectionIds) {
    query = query.in("connection_id", authorizationFilter.connectionIds);
  }
  if (authorizationFilter.unlinkedOnly) {
    query = query.is("opportunity_id", null);
  }
  if (authorizationFilter.or) {
    query = query.or(authorizationFilter.or);
  }

  // Scope: own mailbox(es) vs all company mail
  if (params.scope === "own") {
    if (userConnectionIds.length === 0) {
      return { threads: [], nextCursor: null };
    }
    query = query.in("connection_id", userConnectionIds);
  }

  // Rail filter. The three operator-facing audience rails
  // (CLIENTS/EVERYTHING_ELSE/ALL) plus utility ARCHIVED/SNOOZED share one
  // predicate module so the SQL, the in-memory classification test, and any
  // downstream consumer can't drift. `applyRailPredicate` returns the
  // narrowed builder.
  query = applyRailPredicate(query, params.filter, new Date().toISOString());

  if (params.category) {
    query = query.eq("primary_category", params.category);
  }

  if (params.search && params.search.trim().length > 0) {
    query = query.or(buildSearchOrExpression(params.search.trim()));
  }

  // Every rail sorts DESC on last_message_at (most recent first). The
  // operator-facing urgency surface for commitments lives on the TodayBar
  // at the top of the list — it pulls `next_commitment_due_at` directly,
  // so the conversation list itself doesn't need to re-sort around it.
  query = query.order("last_message_at", { ascending: false }).limit(limit + 1);
  if (params.cursor) {
    query = query.lt("last_message_at", params.cursor);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listThreads failed: ${error.message}`);

  const rows = (data ?? []).map(mapEmailThreadFromDb);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? page[page.length - 1].lastMessageAt.toISOString()
    : null;

  // Overlay derived fields on the page after the cursor is computed so a
  // join hiccup never affects pagination semantics. The snippet pass repairs
  // legacy blank/stale cached snippets from activities, then Phase C and
  // commitment enrichers add their per-page derived state.
  const withActivitySnippets = await enrichWithActivitySnippets(page);
  const withPhaseC = await enrichWithPhaseC(withActivitySnippets);
  const withCommitments = await enrichWithNextCommitmentId(withPhaseC);
  const enriched = await enrichWithOpportunityChaseState(withCommitments);

  return { threads: enriched, nextCursor };
}

// ─── Service export ──────────────────────────────────────────────────────────

export const EmailThreadService = {
  /**
   * Upsert a thread row from a just-synced email. Creates the row if the
   * provider thread hasn't been seen before, otherwise updates denormalized
   * summary fields (last_message_at, counts, latest_*, participants).
   */
  async upsertFromEmail(
    params: UpsertFromEmailParams
  ): Promise<UpsertFromEmailResult> {
    const supabase = requireSupabase();
    const { companyId, connectionId, direction } = params;
    const providerIds = assertValidProviderEmailIds({
      boundary: "email_thread_upsert",
      providerThreadId: params.providerThreadId,
      providerMessageId: params.email.id,
      requireMessageId: true,
    });
    const providerThreadId = providerIds.providerThreadId;
    const email: NormalizedEmail = {
      ...params.email,
      id: providerIds.providerMessageId!,
      threadId: providerThreadId,
    };

    // Check existing row
    const { data: existing, error: existingError } = await supabase
      .from("email_threads")
      .select("*")
      .eq("connection_id", connectionId)
      .eq("provider_thread_id", providerThreadId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`upsertFromEmail read failed: ${existingError.message}`);
    }

    // Connection email — needed for both forwarded-sender extraction (so we
    // don't "recover" the operator's own address as the upstream sender)
    // AND the self-forward guard below. Cached per call; the lookup is one
    // indexed point-read so the cost is negligible vs. the directory
    // queries that follow.
    const { data: connRow } = await supabase
      .from("email_connections")
      .select("email")
      .eq("id", connectionId)
      .maybeSingle();
    const connectionEmail =
      ((connRow?.email as string | null) ?? "").toLowerCase().trim() || null;

    // Resolve the *effective* sender. When the message body looks like a
    // forwarded lead (Fwd: subject, Gmail "Forwarded message" preamble,
    // Outlook "From:/Sent:/To:" header block, or Apple Mail "Begin
    // forwarded message:"), we prefer the upstream From: address so
    // latest_sender_email points at the real customer rather than the
    // operator's own mailbox.
    const resolved = resolveEffectiveSenderEmail({
      fromHeader: email.from,
      subject: email.subject ?? "",
      bodyText: email.bodyText ?? "",
      connectionEmail,
    });
    const senderEmail = resolved.email;
    // True when the resolved sender is still the operator's own mailbox
    // (no recoverable upstream sender, AND the From header is the
    // connection itself). Treated as "no real sender update" — we still
    // bump message_count / last_message_at, but we leave the existing
    // latest_sender_* fields alone so a stray draft sync or an outbound
    // copy mis-tagged as inbound can't clobber the real customer's
    // identity on the thread row.
    const senderIsSelf =
      direction === "inbound" &&
      !!connectionEmail &&
      senderEmail === connectionEmail;

    // Canonical name via directory lookup (clients/sub_clients/users),
    // falling through to the raw From display name when it isn't a generic
    // mailbox label, then the full email. Never the local part — that
    // produces garbage like "canprojack" for bare-email senders. When the
    // sender came from a forwarded body (no display name available), pass
    // an empty fromName so the directory lookup is the only signal.
    const senderName = await composeSenderName(
      supabase,
      companyId,
      senderEmail,
      resolved.source === "contact_form"
        ? (resolved.name ?? "")
        : resolved.source === "forwarded"
          ? ""
          : email.fromName
    );
    const snippet = snippetFromMessage(
      email.snippet,
      email.bodyText,
      email.subject
    );

    if (existing) {
      if (
        params.opportunityId &&
        existing.opportunity_id &&
        existing.opportunity_id !== params.opportunityId
      ) {
        throw new EmailThreadParentConflictError({
          providerThreadId,
          threadOpportunityId:
            (existing.opportunity_id as string | null) ?? null,
          routedOpportunityId: params.opportunityId,
        });
      }
      if (params.opportunityId && !existing.opportunity_id) {
        const { data: projection, error: projectionError } = await supabase.rpc(
          "attach_email_thread_to_opportunity_as_system",
          {
            p_company_id: companyId,
            p_connection_id: connectionId,
            p_provider_thread_id: providerThreadId,
            p_opportunity_id: params.opportunityId,
          }
        );
        if (projectionError) {
          if (
            projectionError.message?.includes("email_thread_parent_conflict") ||
            projectionError.message?.includes("email_thread_client_conflict")
          ) {
            throw new EmailThreadParentConflictError({
              providerThreadId,
              // The cache row is unattached here; the conflicting owner is
              // proven inside attach_email_thread_to_opportunity_as_system,
              // not observable on `existing`.
              threadOpportunityId: null,
              routedOpportunityId: params.opportunityId,
            });
          }
          throw new Error(
            `upsertFromEmail opportunity projection failed: ${projectionError.message}`
          );
        }
        const projectionReceipt =
          projection &&
          typeof projection === "object" &&
          !Array.isArray(projection)
            ? (projection as Record<string, unknown>)
            : null;
        if (
          projectionReceipt?.ok !== true ||
          typeof projectionReceipt.attached !== "boolean" ||
          projectionReceipt.email_thread_id !== existing.id ||
          projectionReceipt.opportunity_id !== params.opportunityId
        ) {
          throw new Error(
            "upsertFromEmail opportunity projection failed: invalid_projection_receipt"
          );
        }
        existing.opportunity_id = params.opportunityId;
      }

      // Merge participants (union)
      const existingParticipants = new Set<string>(
        ((existing.participants as string[]) ?? []).map((p) => p.toLowerCase())
      );
      for (const addr of [email.from, ...email.to, ...email.cc]) {
        const extracted = extractEmailAddress(addr).toLowerCase();
        if (extracted) existingParticipants.add(extracted);
      }
      if (senderEmail) existingParticipants.add(senderEmail);

      const emailDate =
        email.date instanceof Date ? email.date : new Date(email.date);
      const existingLastMsg = parseDateRequired(existing.last_message_at);
      const isNewer = emailDate.getTime() >= existingLastMsg.getTime();

      // `activities` is the delivered-message ledger. Sync and operator-send
      // persist the provider activity before refreshing this cache, so retries
      // must derive denormalized counts/head state from those immutable message
      // identities instead of incrementing the thread row again. The mailbox
      // scope is essential: Gmail thread IDs and M365 conversation IDs are only
      // unique inside one connection.
      const { data: deliveredRows, error: deliveredError } = await supabase
        .from("activities")
        .select(
          "email_message_id, direction, from_email, subject, content, body_text, created_at, is_read"
        )
        .eq("company_id", companyId)
        .eq("email_connection_id", connectionId)
        .eq("email_thread_id", providerThreadId)
        .eq("type", "email");

      if (deliveredError) {
        throw new Error(
          `upsertFromEmail activity ledger read failed: ${deliveredError.message}`
        );
      }

      const deliveredByMessageId = new Map<
        string,
        NonNullable<typeof deliveredRows>[number]
      >();
      for (const row of deliveredRows ?? []) {
        const messageId = (
          (row.email_message_id as string | null) ?? ""
        ).trim();
        if (!messageId) continue;
        deliveredByMessageId.set(messageId, row);
      }
      const delivered = [...deliveredByMessageId.entries()].sort(
        ([leftId, left], [rightId, right]) => {
          const timeDifference =
            parseDateRequired(left.created_at).getTime() -
            parseDateRequired(right.created_at).getTime();
          return timeDifference || leftId.localeCompare(rightId);
        }
      );

      const update: Record<string, unknown> = {
        participants: Array.from(existingParticipants),
      };
      let deliveredStateChanged = false;

      if (delivered.length > 0) {
        const [, firstDelivered] = delivered[0];
        const [latestMessageId, latestDelivered] =
          delivered[delivered.length - 1];
        const latestSenderEmail = extractEmailAddress(
          (latestDelivered.from_email as string | null) ?? ""
        ).toLowerCase();
        const latestDirectionRaw = String(
          latestDelivered.direction ?? ""
        ).toLowerCase();
        const latestDirection: "inbound" | "outbound" =
          latestDirectionRaw === "outbound" || latestDirectionRaw === "out"
            ? "outbound"
            : latestDirectionRaw === "inbound" || latestDirectionRaw === "in"
              ? "inbound"
              : connectionEmail && latestSenderEmail === connectionEmail
                ? "outbound"
                : "inbound";
        const latestSenderName =
          latestMessageId === email.id
            ? senderName
            : latestSenderEmail ===
                  String(existing.latest_sender_email ?? "").toLowerCase() &&
                existing.latest_sender_name
              ? String(existing.latest_sender_name)
              : await composeSenderName(
                  supabase,
                  companyId,
                  latestSenderEmail,
                  ""
                );

        const firstDeliveredAt = parseDateRequired(firstDelivered.created_at);
        const latestDeliveredAt = parseDateRequired(latestDelivered.created_at);
        const unreadCount = delivered.reduce((count, [, row]) => {
          const rowDirection = String(row.direction ?? "").toLowerCase();
          const rowSenderEmail = extractEmailAddress(
            (row.from_email as string | null) ?? ""
          ).toLowerCase();
          const inbound =
            rowDirection === "inbound" ||
            rowDirection === "in" ||
            (!rowDirection &&
              (!connectionEmail || rowSenderEmail !== connectionEmail));
          return inbound && row.is_read !== true ? count + 1 : count;
        }, 0);
        const latestDeliveredSnippet = snippetFromMessage(
          latestDelivered.content as string | null,
          latestDelivered.body_text as string | null,
          latestDelivered.subject as string | null
        );

        deliveredStateChanged =
          Number(existing.message_count ?? 0) !== delivered.length ||
          Number(existing.unread_count ?? 0) !== unreadCount ||
          parseDateRequired(existing.first_message_at).getTime() !==
            firstDeliveredAt.getTime() ||
          existingLastMsg.getTime() !== latestDeliveredAt.getTime() ||
          String(existing.latest_direction ?? "") !== latestDirection ||
          String(existing.latest_snippet ?? "") !== latestDeliveredSnippet;

        update.first_message_at = firstDeliveredAt.toISOString();
        update.last_message_at = latestDeliveredAt.toISOString();
        update.message_count = delivered.length;
        update.unread_count = unreadCount;
        update.latest_direction = latestDirection;
        update.latest_sender_email = latestSenderEmail;
        update.latest_sender_name = latestSenderName;
        update.latest_snippet = latestDeliveredSnippet;

        // Keep an existing subject unless it is blank. The first delivered
        // activity is the same source used by historical activity backfills.
        if (!(existing.subject as string).length) {
          update.subject =
            ((firstDelivered.subject as string | null) ?? "").trim() ||
            email.subject;
        }
      } else {
        // Provider-only inbox backfill intentionally has no activity rows.
        // Preserve its sequential insert/update behavior until Task 8 routes
        // historical messages through the canonical delivered ledger too.
        update.message_count = (existing.message_count as number) + 1;
        update.unread_count =
          direction === "inbound" && !email.isRead
            ? (existing.unread_count as number) + 1
            : (existing.unread_count as number);

        if (isNewer) {
          update.last_message_at = emailDate.toISOString();
          update.latest_direction = direction;
          update.latest_snippet = snippet;
          // Self-forward guard: when the resolved sender is the operator's
          // own mailbox (e.g. Gmail surfaced an outbound reply or a draft
          // autosave under the INBOX label, or a forward whose upstream
          // could not be parsed), skip the latest_sender_* writes. Keeping
          // the prior values means the thread row continues to point at the
          // real customer's identity even though a junk "from-self" message
          // just came in.
          if (!senderIsSelf) {
            update.latest_sender_email = senderEmail;
            update.latest_sender_name = senderName;
          }
          if (email.subject && (existing.subject as string).length === 0) {
            update.subject = email.subject;
          }
        }
      }

      if (params.markClassificationDirty !== false || deliveredStateChanged) {
        update.category_classified_at = null;
      }

      // Opportunity/client linkage — set if currently null. Explicit
      // params.clientId wins; otherwise auto-derive from participants so
      // a thread links to its client the first time a matching address
      // shows up in the conversation.
      if (!existing.client_id) {
        if (params.clientId) {
          update.client_id = params.clientId;
        } else {
          const auto = await resolveClientIdFromEmails(
            supabase,
            companyId,
            Array.from(existingParticipants)
          );
          if (auto) update.client_id = auto;
        }
      }

      // If this thread links to a client whose name is still a raw email
      // address, backfill it now that we have the sender's display name.
      // Skip when senderName itself is an email (composeSenderName fallback)
      // OR when senderIsSelf (we'd clobber the customer's client.name with
      // the operator's directory name).
      const linkedClientId =
        (update.client_id as string | undefined) ??
        (existing.client_id as string | null) ??
        null;
      if (
        linkedClientId &&
        senderName &&
        !senderName.includes("@") &&
        direction === "inbound" &&
        !senderIsSelf
      ) {
        const { data: clientRow } = await supabase
          .from("clients")
          .select("id, name")
          .eq("id", linkedClientId)
          .single();
        if (clientRow && clientRow.name?.includes("@")) {
          await supabase
            .from("clients")
            .update({ name: senderName })
            .eq("id", linkedClientId);
        }
      }

      const { data: updated, error: updError } = await supabase
        .from("email_threads")
        .update(update)
        .eq("id", existing.id as string)
        .select("*")
        .single();

      if (updError)
        throw new Error(`upsertFromEmail update failed: ${updError.message}`);
      const updatedThread = mapEmailThreadFromDb(updated);
      if (
        params.opportunityId &&
        updatedThread.opportunityId !== params.opportunityId
      ) {
        throw new Error(
          "upsertFromEmail opportunity projection failed: projection_not_persisted"
        );
      }
      return { threadRow: updatedThread, isNew: false };
    }

    // New row
    const emailDate =
      email.date instanceof Date ? email.date : new Date(email.date);
    const participants = new Set<string>();
    for (const addr of [email.from, ...email.to, ...email.cc]) {
      const extracted = extractEmailAddress(addr).toLowerCase();
      if (extracted) participants.add(extracted);
    }
    if (senderEmail) participants.add(senderEmail);

    // Auto-link to a client on insert if caller didn't pass one. Same
    // directory lookup the update path uses — keeps the two branches
    // semantically identical.
    const autoClientId =
      params.clientId ??
      (await resolveClientIdFromEmails(
        supabase,
        companyId,
        Array.from(participants)
      )) ??
      null;

    // If the matched client's name is still a raw email address, backfill
    // it with the sender's display name now that we have it. Skip when
    // senderName itself is an email (composeSenderName fallback) OR when
    // senderIsSelf (we'd write the operator's name onto the customer's
    // client row).
    if (
      autoClientId &&
      senderName &&
      !senderName.includes("@") &&
      direction === "inbound" &&
      !senderIsSelf
    ) {
      const { data: clientRow } = await supabase
        .from("clients")
        .select("id, name")
        .eq("id", autoClientId)
        .single();
      if (clientRow && clientRow.name?.includes("@")) {
        await supabase
          .from("clients")
          .update({ name: senderName })
          .eq("id", autoClientId);
      }
    }

    const insert: Record<string, unknown> = {
      company_id: companyId,
      connection_id: connectionId,
      provider_thread_id: providerThreadId,
      primary_category: "OTHER",
      category_confidence: 0,
      category_classifier_version: ThreadClassifier.CLASSIFIER_VERSION,
      category_manually_set: false,
      labels: [],
      subject: email.subject || "",
      participants: Array.from(participants),
      first_message_at: emailDate.toISOString(),
      last_message_at: emailDate.toISOString(),
      message_count: 1,
      unread_count: direction === "inbound" && !email.isRead ? 1 : 0,
      latest_direction: direction,
      latest_sender_email: senderEmail,
      latest_sender_name: senderName,
      latest_snippet: snippet,
      opportunity_id: params.opportunityId ?? null,
      client_id: autoClientId,
    };

    const { data: inserted, error: insError } = await supabase
      .from("email_threads")
      .insert(insert)
      .select("*")
      .single();

    if (insError)
      throw new Error(`upsertFromEmail insert failed: ${insError.message}`);
    return { threadRow: mapEmailThreadFromDb(inserted), isNew: true };
  },

  /**
   * Classify a thread using Phase C's ThreadClassifier and persist results.
   * Respects `category_manually_set` — user overrides never get clobbered.
   */
  async classifyAndUpdate(
    threadRow: EmailThread,
    options: { summaryOnly?: boolean; summaryConflictAttempt?: number } = {}
  ): Promise<EmailThread> {
    const supabase = requireSupabase();
    const summaryOnly = options.summaryOnly === true;
    const summaryConflictAttempt = options.summaryConflictAttempt ?? 0;
    const reloadOrRetrySummaryConflict = async (
      context: string
    ): Promise<EmailThread> => {
      const winner = await reloadClassificationWinner({
        supabase,
        thread: threadRow,
        context,
      });
      if (!summaryOnly) return winner;
      if (summaryConflictAttempt >= 2) {
        throw new Error(
          `${context} summary-only CAS remained contested after 3 attempts`
        );
      }
      return EmailThreadService.classifyAndUpdate(winner, {
        summaryOnly: true,
        summaryConflictAttempt: summaryConflictAttempt + 1,
      });
    };

    // Pull last 5 messages from activities for classification context
    const { data: msgs, error: msgError } = await supabase
      .from("activities")
      .select(
        "from_email, direction, body_text, content, subject, created_at, to_emails, cc_emails, has_attachments"
      )
      .eq("company_id", threadRow.companyId)
      .eq("email_connection_id", threadRow.connectionId)
      .eq("type", "email")
      .eq("email_thread_id", threadRow.providerThreadId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (msgError) {
      throw new Error(
        `classifyAndUpdate message load failed: ${msgError.message}`
      );
    }

    const messages: ClassifyMessage[] = (
      (msgs ?? []) as Array<Record<string, unknown>>
    )
      .reverse()
      .map((row) => {
        const messageSubject = (
          (row.subject as string | null) ??
          threadRow.subject ??
          ""
        ).trim();
        const rawBody =
          (row.body_text as string) || (row.content as string) || "";
        return {
          from: (row.from_email as string) || "",
          fromName: "",
          to: (row.to_emails as string[]) ?? [],
          cc: (row.cc_emails as string[]) ?? [],
          direction: (row.direction as "inbound" | "outbound") ?? "inbound",
          date: parseDateRequired(row.created_at).toISOString(),
          bodyText: stripQuotedContent(rawBody, messageSubject),
        };
      });

    const senderEmail = threadRow.latestSenderEmail;
    const senderDomain = domainOf(senderEmail);

    const [learned, senderIsNew, companyUsers, teamForwarders] =
      await Promise.all([
        loadLearnedRules(threadRow.companyId, senderEmail, senderDomain),
        senderEmail
          ? senderHasPriorConversations(threadRow.companyId, senderEmail).then(
              (v) => !v
            )
          : Promise.resolve(false),
        loadCompanyUsers(threadRow.companyId),
        loadTeamForwarders(threadRow.connectionId),
      ]);

    // Used as a fallback when the connection owner's users row is missing.
    const { data: connectionRow } = await supabase
      .from("email_connections")
      .select("email")
      .eq("id", threadRow.connectionId)
      .maybeSingle();
    const connectionEmail =
      (connectionRow?.email as string | null)?.toLowerCase().trim() ??
      undefined;

    // ── Deterministic INTERNAL classification ──────────────────────────
    // When every participant of the thread is a company user (and the
    // thread isn't a forward), we skip the LLM and write the result
    // directly. Manual corrections are respected by the rule itself.
    const firstMessageBody =
      messages[0]?.bodyText ?? messages[messages.length - 1]?.bodyText ?? "";
    const deterministic = tryDeterministicInternal({
      subject: threadRow.subject,
      firstMessageBody,
      participants: threadRow.participants,
      senderEmail,
      categoryManuallySet: threadRow.categoryManuallySet,
      companyUsers,
      teamForwarders,
      connectionEmail,
    });

    if (deterministic) {
      const detUpdate: Record<string, unknown> = summaryOnly
        ? { ai_summary: deterministic.summary }
        : {
            labels: threadRow.labels, // preserve any existing labels
            ai_summary: deterministic.summary,
            category_classified_at: new Date().toISOString(),
            category_classifier_version: deterministic.classifierVersion,
            primary_category: deterministic.category,
            category_confidence: deterministic.confidence,
          };

      const { data: detUpdated, error: detErr } = await supabase
        .from("email_threads")
        .update(detUpdate)
        .eq("id", threadRow.id)
        .eq("message_count", threadRow.messageCount)
        .eq("last_message_at", threadRow.lastMessageAt.toISOString())
        .eq("category_manually_set", threadRow.categoryManuallySet)
        .eq("primary_category", threadRow.primaryCategory)
        .select("*")
        .maybeSingle();

      if (detErr) {
        throw new Error(
          `classifyAndUpdate deterministic-internal update failed: ${detErr.message}`
        );
      }
      if (!detUpdated) {
        return reloadOrRetrySummaryConflict(
          "classifyAndUpdate deterministic-internal update"
        );
      }
      const mappedInternal = mapEmailThreadFromDb(detUpdated);
      // P4-A: run the Phase C router uniformly. INTERNAL is unmapped in the
      // autonomy config so this no-ops in practice, but routing it here keeps
      // the firing path uniform and future-proofs an INTERNAL autonomy level.
      // No notification on INTERNAL (fireThreadNotifications is LLM-path only
      // and INTERNAL never warrants a page).
      if (!summaryOnly) await runPhaseCRouter(mappedInternal);
      return mappedInternal;
    }

    // ── Deterministic CUSTOMER classification ──────────────────────────
    // Threads linked to a non-terminal opportunity stage are — by definition
    // — customer conversations. Category is fixed before the narrative model
    // runs, which avoids the legacy LEAD/CLIENT category drift while still
    // producing a current, useful summary and ball-in-court labels.
    if (threadRow.opportunityId && !threadRow.categoryManuallySet) {
      const opp = await loadOpportunityForCustomerRule(threadRow.opportunityId);
      const messagePreview =
        [...messages]
          .reverse()
          .map((message) =>
            extractContactFormSubmissionPreviewText(
              threadRow.subject,
              message.bodyText
            )
          )
          .find((preview): preview is string => Boolean(preview)) ??
        extractContactFormSubmissionPreviewText(
          threadRow.subject,
          threadRow.latestSnippet ?? ""
        );
      const customer = tryDeterministicCustomer({
        subject: threadRow.subject,
        messagePreview,
        opportunityId: threadRow.opportunityId,
        opportunityStage: opp?.stage ?? null,
        opportunityArchivedAt: opp?.archivedAt ?? null,
        categoryManuallySet: threadRow.categoryManuallySet,
      });

      if (customer) {
        const fallbackSummary = currentThreadSummary({
          subject: threadRow.subject,
          latestSnippet: threadRow.latestSnippet,
          messages,
        });
        // The deterministic rule owns category truth, not narrative quality.
        // Always begin from the newest cleaned message so a generic subject
        // such as "Re: Estimate" cannot survive as the thread summary when the
        // classifier is unavailable.
        let narrativeSummary = fallbackSummary;
        let narrativeLabels = threadRow.labels;
        try {
          // Category remains deterministic CUSTOMER; the model contributes only
          // the current-state narrative and ball-in-court labels. Its category
          // output is deliberately ignored, so legacy category drift cannot
          // freeze the thread or weaken the relationship proof.
          const narrative = await ThreadClassifier.classifyThread({
            threadId: threadRow.id,
            providerThreadId: threadRow.providerThreadId,
            subject: threadRow.subject,
            participants: threadRow.participants,
            messageCount: threadRow.messageCount,
            outboundCount: messages.filter(
              (message) => message.direction === "outbound"
            ).length,
            messages,
            learnedRulesForDomain: learned.forDomain,
            learnedRulesForSender: learned.forSender,
            senderIsNew,
          });
          narrativeSummary = chooseThreadSummary(
            narrative.aiSummary,
            narrativeSummary,
            messages
          );
          narrativeLabels = narrative.labels;
        } catch (error) {
          console.warn(
            "[email-thread] CUSTOMER narrative fallback",
            threadRow.id,
            error instanceof Error ? error.message : "unknown error"
          );
        }
        const custUpdate: Record<string, unknown> = summaryOnly
          ? { ai_summary: narrativeSummary }
          : {
              labels: narrativeLabels,
              ai_summary: narrativeSummary,
              category_classified_at: new Date().toISOString(),
              category_classifier_version: customer.classifierVersion,
              primary_category: customer.category,
              category_confidence: customer.confidence,
            };

        const { data: custUpdated, error: custErr } = await supabase
          .from("email_threads")
          .update(custUpdate)
          .eq("id", threadRow.id)
          .eq("message_count", threadRow.messageCount)
          .eq("last_message_at", threadRow.lastMessageAt.toISOString())
          .eq("category_manually_set", threadRow.categoryManuallySet)
          .eq("primary_category", threadRow.primaryCategory)
          .select("*")
          .maybeSingle();

        if (custErr) {
          throw new Error(
            `classifyAndUpdate deterministic-customer update failed: ${custErr.message}`
          );
        }
        if (!custUpdated) {
          return reloadOrRetrySummaryConflict(
            "classifyAndUpdate deterministic-customer update"
          );
        }

        const mappedCustomer = mapEmailThreadFromDb(custUpdated);

        // Preserve the established, authorization-gated Phase C behavior for
        // deterministic customer threads. The router owns autonomy checks and
        // idempotent draft creation; summary refresh must not bypass it.
        if (!summaryOnly) await runPhaseCRouter(mappedCustomer);

        // Notification hook — parity with the LLM path. Fires on CUSTOMER
        // transitions for inbound threads (the "new lead landed" page).
        if (!summaryOnly) {
          fireThreadNotifications(threadRow, mappedCustomer).catch((err) =>
            console.error("[thread-notify] hook failed (non-fatal):", err)
          );
        }

        return mappedCustomer;
      }
    }

    const outboundCount = messages.filter(
      (m) => m.direction === "outbound"
    ).length;

    const result = await ThreadClassifier.classifyThread({
      threadId: threadRow.id,
      providerThreadId: threadRow.providerThreadId,
      subject: threadRow.subject,
      participants: threadRow.participants,
      messageCount: threadRow.messageCount,
      outboundCount,
      messages,
      learnedRulesForDomain: learned.forDomain,
      learnedRulesForSender: learned.forSender,
      senderIsNew,
    });

    // Merge classifier labels with heuristic labels
    const heuristicLabels = evaluateLabelsFromMessages(
      messages.map((m) => ({
        direction: m.direction,
        bodyText: m.bodyText,
        hasAttachments: (msgs ?? []).some(
          (r) => (r as Record<string, unknown>).has_attachments
        ),
      })),
      senderIsNew
    );
    const mergedLabels = Array.from(
      new Set([...result.labels, ...heuristicLabels])
    );

    const currentSummary = chooseThreadSummary(
      result.aiSummary,
      currentThreadSummary({
        subject: threadRow.subject,
        latestSnippet: threadRow.latestSnippet,
        messages,
      }),
      messages
    );
    const update: Record<string, unknown> = summaryOnly
      ? { ai_summary: currentSummary }
      : {
          labels: mergedLabels,
          ai_summary: currentSummary,
          category_classified_at: new Date().toISOString(),
          category_classifier_version: ThreadClassifier.CLASSIFIER_VERSION,
        };

    // Only update primary_category if not manually set
    if (!summaryOnly && !threadRow.categoryManuallySet) {
      update.primary_category = result.primaryCategory;
      update.category_confidence = result.confidence;
    }

    const { data: updated, error: updError } = await supabase
      .from("email_threads")
      .update(update)
      .eq("id", threadRow.id)
      .eq("message_count", threadRow.messageCount)
      .eq("last_message_at", threadRow.lastMessageAt.toISOString())
      .eq("category_manually_set", threadRow.categoryManuallySet)
      .eq("primary_category", threadRow.primaryCategory)
      .select("*")
      .maybeSingle();

    if (updError) {
      throw new Error(`classifyAndUpdate update failed: ${updError.message}`);
    }
    if (!updated) {
      return reloadOrRetrySummaryConflict("classifyAndUpdate update");
    }

    const mappedUpdated = mapEmailThreadFromDb(updated);

    // P4-A: Phase C post-classification hook — awaited inside the existing
    // background `after()` sync job so mailbox draft placement is not abandoned
    // when the serverless callback resolves.
    if (!summaryOnly) await runPhaseCRouter(mappedUpdated);

    // Notification hook — fire-and-forget. Only fires on category TRANSITIONS
    // (LEAD/PLATFORM_BID that wasn't LEAD/PLATFORM_BID before) or on a newly
    // surfaced URGENT label for an inbound thread. Defensive-by-default: any
    // error is logged, never thrown.
    if (!summaryOnly) {
      fireThreadNotifications(threadRow, mappedUpdated).catch((err) =>
        console.error("[thread-notify] hook failed (non-fatal):", err)
      );
    }

    return mappedUpdated;
  },

  /**
   * Refresh only the current narrative. Recovery uses this path so stale or
   * generic summaries are repaired without re-routing Phase C, creating a
   * draft/action, firing a notification, or changing a manual category.
   */
  async refreshSummaryOnly(threadRow: EmailThread): Promise<EmailThread> {
    return EmailThreadService.classifyAndUpdate(threadRow, {
      summaryOnly: true,
    });
  },

  /** Refresh an existing canonical provider thread without creating/relinking it. */
  async refreshSummaryOnlyForProviderThread(params: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
  }): Promise<EmailThread | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_threads")
      .select("*")
      .eq("company_id", params.companyId)
      .eq("connection_id", params.connectionId)
      .eq("provider_thread_id", params.providerThreadId)
      .limit(2);
    if (error) {
      throw new Error(
        `summary-only provider thread lookup failed: ${error.message}`
      );
    }
    if (!data || data.length === 0) return null;
    if (data.length !== 1) {
      throw new Error("summary-only provider thread was not found uniquely");
    }
    return EmailThreadService.refreshSummaryOnly(
      mapEmailThreadFromDb(data[0])
    );
  },

  /**
   * Recategorize a thread. Creates a correction row (so Phase C learns),
   * sets category_manually_set=true, and updates the thread.
   *
   * Learning (apply-to-similar) is dispatched separately by phase-c-learning-
   * service — it reads the correction row and fans out to similar threads
   * without blocking this call.
   */
  async recategorize(params: {
    threadId: string;
    userId: string;
    toCategory: EmailThreadCategory;
    note?: string;
  }): Promise<{ thread: EmailThread; correctionId: string }> {
    const supabase = requireSupabase();

    const { data: row, error: readError } = await supabase
      .from("email_threads")
      .select("*")
      .eq("id", params.threadId)
      .single();

    if (readError || !row) {
      throw new Error(`recategorize: thread ${params.threadId} not found`);
    }

    const existing = mapEmailThreadFromDb(row);
    const senderEmail = existing.latestSenderEmail?.toLowerCase() ?? null;
    const senderDomain = domainOf(senderEmail);
    const participantsHash = hashParticipants(existing.participants);
    const subjectKeywords = extractSubjectKeywords(existing.subject);

    // Insert correction
    const { data: correction, error: corrError } = await supabase
      .from("email_thread_category_corrections")
      .insert({
        company_id: existing.companyId,
        thread_id: params.threadId,
        user_id: params.userId,
        from_category: existing.primaryCategory,
        to_category: params.toCategory,
        sender_email: senderEmail,
        sender_domain: senderDomain,
        participants_hash: participantsHash,
        subject_keywords: subjectKeywords,
        note: params.note ?? null,
      })
      .select("id")
      .single();

    if (corrError)
      throw new Error(
        `recategorize correction insert failed: ${corrError.message}`
      );

    // Update thread
    const { data: updated, error: updError } = await supabase
      .from("email_threads")
      .update({
        primary_category: params.toCategory,
        category_confidence: 1.0,
        category_manually_set: true,
        category_classified_at: new Date().toISOString(),
      })
      .eq("id", params.threadId)
      .select("*")
      .single();

    if (updError)
      throw new Error(`recategorize update failed: ${updError.message}`);

    return {
      thread: mapEmailThreadFromDb(updated),
      correctionId: correction.id as string,
    };
  },

  /**
   * Archive a thread. Decides one of three outcomes:
   *
   *   1. `needsPreference` — first archive on this connection; UI must show
   *      the writeback-preference modal, persist the choice, then retry.
   *   2. `needsConfirmation` — thread has a linked opportunity AND either
   *      sibling threads exist on that opp OR the connection's lead
   *      preference is still 'ask'. UI shows the multi-select confirmation
   *      modal and then dispatches `archiveBatch` with the user's selections.
   *   3. `archived` — nothing requires user input; the thread (and the
   *      linked opportunity, when the connection is set to 'archive') was
   *      archived in this call.
   *
   * Provider write-back (Gmail / M365) honors archive_writeback_preference.
   */
  async archive(params: {
    threadId: string;
    authorizeProviderMutation: AuthorizeThreadProviderMutation;
  }): Promise<
    | { archived: true; leadArchivedOpportunityId: string | null }
    | { needsPreference: true; connectionId: string }
    | {
        needsConfirmation: true;
        connectionId: string;
        leadPreference: ArchiveLeadPreference;
        linkedOpportunity: { id: string; title: string };
        siblingThreads: Array<{
          id: string;
          subject: string;
          lastMessageAt: string;
          latestSenderName: string | null;
          latestSenderEmail: string | null;
          latestSnippet: string | null;
        }>;
      }
  > {
    const supabase = requireSupabase();

    const { data: row, error } = await supabase
      .from("email_threads")
      .select(
        "id, connection_id, provider_thread_id, company_id, opportunity_id"
      )
      .eq("id", params.threadId)
      .single();

    if (error || !row) throw new Error(`archive: thread not found`);

    const { data: connRow, error: connError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", row.connection_id as string)
      .single();

    if (connError || !connRow) throw new Error(`archive: connection not found`);

    const writebackPreference =
      (connRow.archive_writeback_preference as ArchiveWritebackPreference) ??
      "ask";
    if (writebackPreference === "ask") {
      return {
        needsPreference: true,
        connectionId: row.connection_id as string,
      };
    }

    const opportunityId = (row.opportunity_id as string | null) ?? null;
    const leadPreference =
      (connRow.archive_lead_preference as ArchiveLeadPreference | null) ??
      "ask";

    // Inspect linked opportunity + siblings before deciding to commit. If the
    // opp is already archived we treat it as "no linked lead" — there's
    // nothing to ask the user about.
    let linkedOpportunity: { id: string; title: string } | null = null;
    let siblingThreads: Array<{
      id: string;
      subject: string;
      lastMessageAt: string;
      latestSenderName: string | null;
      latestSenderEmail: string | null;
      latestSnippet: string | null;
    }> = [];

    if (opportunityId) {
      const { data: oppRow, error: opportunityReadError } = await supabase
        .from("opportunities")
        .select("id, title, archived_at")
        .eq("id", opportunityId)
        .maybeSingle();
      if (opportunityReadError) {
        throw new Error(
          `archive lead read failed: ${opportunityReadError.message}`
        );
      }

      if (oppRow && !oppRow.archived_at) {
        linkedOpportunity = {
          id: oppRow.id as string,
          title: ((oppRow.title as string) ?? "").trim() || "Untitled lead",
        };

        const { data: siblings, error: siblingReadError } = await supabase
          .from("email_threads")
          .select(
            "id, subject, last_message_at, latest_sender_name, latest_sender_email, latest_snippet"
          )
          .eq("opportunity_id", opportunityId)
          .eq("company_id", row.company_id as string)
          .neq("id", params.threadId)
          .is("archived_at", null)
          .order("last_message_at", { ascending: false });
        if (siblingReadError) {
          throw new Error(
            `archive sibling read failed: ${siblingReadError.message}`
          );
        }

        siblingThreads = (siblings ?? []).map((s) => ({
          id: s.id as string,
          subject: ((s.subject as string) ?? "").trim() || "(no subject)",
          lastMessageAt: s.last_message_at as string,
          latestSenderName: (s.latest_sender_name as string | null) ?? null,
          latestSenderEmail: (s.latest_sender_email as string | null) ?? null,
          latestSnippet: (s.latest_snippet as string | null) ?? null,
        }));
      }
    }

    // If the opp is linked AND we either have siblings or the lead preference
    // is still 'ask', defer the decision to the user.
    if (
      linkedOpportunity &&
      (siblingThreads.length > 0 || leadPreference === "ask")
    ) {
      return {
        needsConfirmation: true,
        connectionId: row.connection_id as string,
        leadPreference,
        linkedOpportunity,
        siblingThreads,
      };
    }

    // Commit path. Provider write-back must succeed before the OPS mirror is
    // changed. A split-brain result is surfaced to the route, never reported
    // as a successful archive.
    const connection = mapConnectionFromDb(connRow);

    if (writebackPreference === "archive_in_gmail") {
      await runThreadProviderOperation({
        supabase,
        connection,
        context: "email-thread-archive",
        authorizeProviderMutation: () =>
          params.authorizeProviderMutation(params.threadId),
        run: (provider) =>
          provider.archiveThread(row.provider_thread_id as string),
      });
    } else if (writebackPreference === "mark_read_only") {
      await runThreadProviderOperation({
        supabase,
        connection,
        context: "email-thread-archive-mark-read",
        authorizeProviderMutation: () =>
          params.authorizeProviderMutation(params.threadId),
        run: (provider) =>
          provider.markThreadRead(row.provider_thread_id as string, true),
      });
    }
    // 'ops_only' does no provider call

    const { error: threadArchiveError } = await supabase
      .from("email_threads")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", params.threadId);
    if (threadArchiveError) {
      throw new Error(
        `archive mirror update failed: ${threadArchiveError.message}`
      );
    }

    // No-prompt opp archive: only when the user has explicitly opted in via
    // the saved 'archive' preference AND the opp has no other live threads.
    let leadArchivedOpportunityId: string | null = null;
    if (
      linkedOpportunity &&
      leadPreference === "archive" &&
      siblingThreads.length === 0
    ) {
      const { error: opportunityArchiveError } = await supabase
        .from("opportunities")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", linkedOpportunity.id);
      if (opportunityArchiveError) {
        throw new Error(
          `archive lead mirror update failed: ${opportunityArchiveError.message}`
        );
      }
      leadArchivedOpportunityId = linkedOpportunity.id;
    }

    return { archived: true, leadArchivedOpportunityId };
  },

  /**
   * Archive multiple threads in one transaction-ish unit, plus optionally
   * archive a linked opportunity. Used when the user confirms the
   * multi-select modal — the modal already validated which threads/opp the
   * user wants to act on, so this method commits without re-asking.
   *
   * Each thread independently honors its own connection's
   * `archive_writeback_preference` for provider write-back. Failures on one
   * thread do not roll back others — the caller logs partial failures.
   */
  async archiveBatch(params: {
    companyId: string;
    threadIds: string[];
    archiveOpportunityId: string | null;
    authorizeProviderMutation: AuthorizeThreadProviderMutation;
  }): Promise<{
    archivedThreadIds: string[];
    failedThreadIds: string[];
    leadArchivedOpportunityId: string | null;
    failedOpportunityId: string | null;
  }> {
    const supabase = requireSupabase();

    const archivedThreadIds: string[] = [];
    const failedThreadIds: string[] = [];

    // Cache connection rows so we don't refetch when multiple threads share
    // the same mailbox (common — siblings on a single opp usually do).
    const connectionCache = new Map<string, Record<string, unknown>>();

    for (const threadId of params.threadIds) {
      try {
        const { data: row, error } = await supabase
          .from("email_threads")
          .select(
            "id, connection_id, provider_thread_id, company_id, archived_at"
          )
          .eq("id", threadId)
          .eq("company_id", params.companyId)
          .single();

        if (error || !row) {
          failedThreadIds.push(threadId);
          continue;
        }

        // Already archived — count as success without redoing work.
        if (row.archived_at) {
          archivedThreadIds.push(threadId);
          continue;
        }

        const connectionId = row.connection_id as string;
        const cached = connectionCache.get(connectionId);
        let connRow: Record<string, unknown>;
        if (cached) {
          connRow = cached;
        } else {
          const { data: fetched, error: connectionReadError } = await supabase
            .from("email_connections")
            .select("*")
            .eq("id", connectionId)
            .single();
          if (connectionReadError || !fetched) {
            failedThreadIds.push(threadId);
            continue;
          }
          connRow = fetched;
          connectionCache.set(connectionId, fetched);
        }

        const writebackPreference =
          (connRow.archive_writeback_preference as ArchiveWritebackPreference) ??
          "ask";

        // 'ask' means the user hasn't picked yet — for the batch path we
        // skip provider write-back rather than block on a modal we can't
        // show mid-batch. The user picked the writeback choice on the first
        // archive of this batch already; only edge cases (siblings on a
        // different connection) hit this branch.
        if (writebackPreference === "archive_in_gmail") {
          await runThreadProviderOperation({
            supabase,
            connection: mapConnectionFromDb(connRow),
            context: "email-thread-archive-batch",
            authorizeProviderMutation: () =>
              params.authorizeProviderMutation(threadId),
            run: (provider) =>
              provider.archiveThread(row.provider_thread_id as string),
          });
        } else if (writebackPreference === "mark_read_only") {
          await runThreadProviderOperation({
            supabase,
            connection: mapConnectionFromDb(connRow),
            context: "email-thread-archive-batch-mark-read",
            authorizeProviderMutation: () =>
              params.authorizeProviderMutation(threadId),
            run: (provider) =>
              provider.markThreadRead(row.provider_thread_id as string, true),
          });
        }

        const { error: threadArchiveError } = await supabase
          .from("email_threads")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", threadId);
        if (threadArchiveError) {
          throw new Error(
            `archiveBatch mirror update failed: ${threadArchiveError.message}`
          );
        }

        archivedThreadIds.push(threadId);
      } catch (err) {
        console.error(
          `[email-thread-service] archiveBatch failed for ${threadId}:`,
          err
        );
        failedThreadIds.push(threadId);
      }
    }

    let leadArchivedOpportunityId: string | null = null;
    let failedOpportunityId: string | null = null;
    if (params.archiveOpportunityId && failedThreadIds.length > 0) {
      failedOpportunityId = params.archiveOpportunityId;
    } else if (params.archiveOpportunityId) {
      const { error: oppError } = await supabase
        .from("opportunities")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", params.archiveOpportunityId)
        .eq("company_id", params.companyId);

      if (!oppError) {
        leadArchivedOpportunityId = params.archiveOpportunityId;
      } else {
        failedOpportunityId = params.archiveOpportunityId;
        console.error(
          "[email-thread-service] archiveBatch opportunity archive failed:",
          oppError
        );
      }
    }

    return {
      archivedThreadIds,
      failedThreadIds,
      leadArchivedOpportunityId,
      failedOpportunityId,
    };
  },

  /**
   * Reverse a batch archive — used by the undo path on the multi-archive
   * toast. Mirrors archiveBatch: per-thread provider write-back honored,
   * partial failures surfaced rather than aborted, optional opportunity
   * unarchive.
   */
  async unarchiveBatch(params: {
    companyId: string;
    threadIds: string[];
    unarchiveOpportunityId: string | null;
    authorizeProviderMutation: AuthorizeThreadProviderMutation;
  }): Promise<{
    unarchivedThreadIds: string[];
    failedThreadIds: string[];
    unarchivedOpportunityId: string | null;
    failedOpportunityId: string | null;
  }> {
    const supabase = requireSupabase();

    const unarchivedThreadIds: string[] = [];
    const failedThreadIds: string[] = [];
    const connectionCache = new Map<string, Record<string, unknown>>();

    for (const threadId of params.threadIds) {
      try {
        const { data: row, error: threadReadError } = await supabase
          .from("email_threads")
          .select("id, connection_id, provider_thread_id, company_id")
          .eq("id", threadId)
          .eq("company_id", params.companyId)
          .single();

        if (threadReadError || !row) {
          failedThreadIds.push(threadId);
          continue;
        }

        const connectionId = row.connection_id as string;
        const cached = connectionCache.get(connectionId);
        let connRow: Record<string, unknown>;
        if (cached) {
          connRow = cached;
        } else {
          const { data: fetched, error: connectionReadError } = await supabase
            .from("email_connections")
            .select("*")
            .eq("id", connectionId)
            .single();
          if (connectionReadError || !fetched) {
            failedThreadIds.push(threadId);
            continue;
          }
          connRow = fetched;
          connectionCache.set(connectionId, fetched);
        }

        const writebackPreference =
          (connRow.archive_writeback_preference as ArchiveWritebackPreference) ??
          "ask";
        if (writebackPreference === "archive_in_gmail") {
          await runThreadProviderOperation({
            supabase,
            connection: mapConnectionFromDb(connRow),
            context: "email-thread-unarchive-batch",
            authorizeProviderMutation: () =>
              params.authorizeProviderMutation(threadId),
            run: (provider) =>
              provider.unarchiveThread(row.provider_thread_id as string),
          });
        }

        const { error: threadUnarchiveError } = await supabase
          .from("email_threads")
          .update({ archived_at: null })
          .eq("id", threadId);
        if (threadUnarchiveError) {
          throw new Error(
            `unarchiveBatch mirror update failed: ${threadUnarchiveError.message}`
          );
        }

        unarchivedThreadIds.push(threadId);
      } catch (err) {
        console.error(
          `[email-thread-service] unarchiveBatch failed for ${threadId}:`,
          err
        );
        failedThreadIds.push(threadId);
      }
    }

    let unarchivedOpportunityId: string | null = null;
    let failedOpportunityId: string | null = null;
    if (params.unarchiveOpportunityId && failedThreadIds.length > 0) {
      failedOpportunityId = params.unarchiveOpportunityId;
    } else if (params.unarchiveOpportunityId) {
      const { error: oppError } = await supabase
        .from("opportunities")
        .update({ archived_at: null })
        .eq("id", params.unarchiveOpportunityId)
        .eq("company_id", params.companyId);

      if (!oppError) {
        unarchivedOpportunityId = params.unarchiveOpportunityId;
      } else {
        failedOpportunityId = params.unarchiveOpportunityId;
        console.error(
          "[email-thread-service] unarchiveBatch opportunity unarchive failed:",
          oppError
        );
      }
    }

    return {
      unarchivedThreadIds,
      failedThreadIds,
      unarchivedOpportunityId,
      failedOpportunityId,
    };
  },

  async unarchive(params: {
    threadId: string;
    authorizeProviderMutation: AuthorizeThreadProviderMutation;
  }): Promise<void> {
    const supabase = requireSupabase();

    const { data: row, error: readError } = await supabase
      .from("email_threads")
      .select("id, connection_id, provider_thread_id")
      .eq("id", params.threadId)
      .single();

    if (readError)
      throw new Error(`unarchive read failed: ${readError.message}`);
    if (!row) throw new Error("unarchive: thread not found");

    const { data: connRow, error: connectionReadError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", row.connection_id as string)
      .single();

    if (connectionReadError) {
      throw new Error(
        `unarchive connection read failed: ${connectionReadError.message}`
      );
    }
    if (!connRow) throw new Error("unarchive: connection not found");
    const preference =
      (connRow.archive_writeback_preference as ArchiveWritebackPreference) ??
      "ask";
    if (preference === "archive_in_gmail") {
      await runThreadProviderOperation({
        supabase,
        connection: mapConnectionFromDb(connRow),
        context: "email-thread-unarchive",
        authorizeProviderMutation: () =>
          params.authorizeProviderMutation(params.threadId),
        run: (provider) =>
          provider.unarchiveThread(row.provider_thread_id as string),
      });
    }

    const { error: unarchiveError } = await supabase
      .from("email_threads")
      .update({ archived_at: null })
      .eq("id", params.threadId);
    if (unarchiveError) {
      throw new Error(
        `unarchive mirror update failed: ${unarchiveError.message}`
      );
    }
  },

  async snooze(params: { threadId: string; until: Date }): Promise<void> {
    const supabase = requireSupabase();

    const { data: row, error: readError } = await supabase
      .from("email_threads")
      .select("id, connection_id, provider_thread_id")
      .eq("id", params.threadId)
      .single();

    if (readError) throw new Error(`snooze read failed: ${readError.message}`);
    if (!row) throw new Error(`snooze: thread not found`);

    const { data: connRow, error: connectionReadError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", row.connection_id as string)
      .single();

    if (connectionReadError) {
      throw new Error(
        `snooze connection read failed: ${connectionReadError.message}`
      );
    }
    if (!connRow) throw new Error("snooze: connection not found");
    await runThreadProviderOperation({
      supabase,
      connection: mapConnectionFromDb(connRow),
      context: "email-thread-snooze",
      run: (provider) =>
        provider.snoozeThread(row.provider_thread_id as string),
    });

    const { error: snoozeError } = await supabase
      .from("email_threads")
      .update({ snoozed_until: params.until.toISOString() })
      .eq("id", params.threadId);
    if (snoozeError) {
      throw new Error(`snooze mirror update failed: ${snoozeError.message}`);
    }
  },

  /**
   * Called by the /api/cron/unsnooze handler. Moves the thread back into the
   * inbox (Gmail INBOX label / M365 inbox folder) and clears snoozed_until.
   */
  async unsnooze(threadId: string): Promise<void> {
    const supabase = requireSupabase();

    const { data: row, error: readError } = await supabase
      .from("email_threads")
      .select("id, connection_id, provider_thread_id")
      .eq("id", threadId)
      .single();

    if (readError)
      throw new Error(`unsnooze read failed: ${readError.message}`);
    if (!row) throw new Error("unsnooze: thread not found");

    const { data: connRow, error: connectionReadError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", row.connection_id as string)
      .single();

    if (connectionReadError) {
      throw new Error(
        `unsnooze connection read failed: ${connectionReadError.message}`
      );
    }
    if (!connRow) throw new Error("unsnooze: connection not found");
    await runThreadProviderOperation({
      supabase,
      connection: mapConnectionFromDb(connRow),
      context: "email-thread-unsnooze",
      run: (provider) =>
        provider.unarchiveThread(row.provider_thread_id as string),
    });

    const { error: unsnoozeError } = await supabase
      .from("email_threads")
      .update({ snoozed_until: null })
      .eq("id", threadId);
    if (unsnoozeError) {
      throw new Error(
        `unsnooze mirror update failed: ${unsnoozeError.message}`
      );
    }
  },

  async markRead(threadId: string, isRead: boolean): Promise<void> {
    const supabase = requireSupabase();

    const { data: row, error: readError } = await supabase
      .from("email_threads")
      .select("id, connection_id, provider_thread_id, unread_count")
      .eq("id", threadId)
      .single();

    if (readError)
      throw new Error(`markRead read failed: ${readError.message}`);
    if (!row) throw new Error("markRead: thread not found");

    const { data: connRow, error: connectionReadError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("id", row.connection_id as string)
      .single();

    if (connectionReadError) {
      throw new Error(
        `markRead connection read failed: ${connectionReadError.message}`
      );
    }
    if (!connRow) throw new Error("markRead: connection not found");
    await runThreadProviderOperation({
      supabase,
      connection: mapConnectionFromDb(connRow),
      context: "email-thread-mark-read",
      run: (provider) =>
        provider.markThreadRead(row.provider_thread_id as string, isRead),
    });

    const { error: markReadError } = await supabase
      .from("email_threads")
      .update({
        unread_count: isRead ? 0 : Math.max(1, row.unread_count as number),
      })
      .eq("id", threadId);
    if (markReadError) {
      throw new Error(
        `markRead mirror update failed: ${markReadError.message}`
      );
    }
  },

  /**
   * Operator override: clear the `AWAITING_REPLY` label on a thread, signalling
   * "the classifier said this needs a reply, but it doesn't." Drives the
   * hover-X affordance on the YOURS state-tag — collapses the thread from
   * YOURS → FYI on the next list refetch (computeStateTag gates YOURS on
   * this label).
   *
   * Idempotent: no-op when the label is already absent. Does NOT touch the
   * provider — labels are an OPS-side concept on `email_threads.labels`.
   * Returns the resulting label array so the caller can update local cache
   * without a refetch round-trip.
   */
  async dismissAwaitingReply(
    threadId: string,
    companyId: string
  ): Promise<EmailThreadLabel[]> {
    const supabase = requireSupabase();
    const { data: row, error: readError } = await supabase
      .from("email_threads")
      .select("id, labels")
      .eq("id", threadId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (readError) {
      throw new Error(`dismissAwaitingReply read failed: ${readError.message}`);
    }
    if (!row) throw new Error("dismissAwaitingReply: thread not found");

    const current = ((row.labels as EmailThreadLabel[] | null) ??
      []) as EmailThreadLabel[];
    if (!current.includes("AWAITING_REPLY")) return current;

    const next = current.filter((l) => l !== "AWAITING_REPLY");
    const { error: updateError } = await supabase
      .from("email_threads")
      .update({ labels: next })
      .eq("id", threadId);
    if (updateError) {
      throw new Error(
        `dismissAwaitingReply mirror update failed: ${updateError.message}`
      );
    }
    return next;
  },

  /**
   * Counterpart to `dismissAwaitingReply` — re-applies `AWAITING_REPLY` to
   * the thread's label array. Used as the undo path for the dismiss action.
   * Idempotent: no-op when the label is already present.
   */
  async restoreAwaitingReply(
    threadId: string,
    companyId: string
  ): Promise<EmailThreadLabel[]> {
    const supabase = requireSupabase();
    const { data: row, error: readError } = await supabase
      .from("email_threads")
      .select("id, labels")
      .eq("id", threadId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (readError) {
      throw new Error(`restoreAwaitingReply read failed: ${readError.message}`);
    }
    if (!row) throw new Error("restoreAwaitingReply: thread not found");

    const current = ((row.labels as EmailThreadLabel[] | null) ??
      []) as EmailThreadLabel[];
    if (current.includes("AWAITING_REPLY")) return current;

    const next: EmailThreadLabel[] = [...current, "AWAITING_REPLY"];
    const { error: updateError } = await supabase
      .from("email_threads")
      .update({ labels: next })
      .eq("id", threadId);
    if (updateError) {
      throw new Error(
        `restoreAwaitingReply mirror update failed: ${updateError.message}`
      );
    }
    return next;
  },

  async list(
    companyId: string,
    userConnectionIds: string[],
    params: ListInboxThreadsParams,
    authorization: AllowedEmailInboxListAccess
  ): Promise<ListInboxThreadsResult> {
    return listThreads(companyId, userConnectionIds, params, authorization);
  },

  async getThread(
    threadId: string,
    companyId: string
  ): Promise<EmailThread | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_threads")
      .select("*")
      .eq("id", threadId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) return null;
    const mapped = mapEmailThreadFromDb(data);
    // Single-thread enrichment uses the same batched helpers (n=1) so the
    // mapping logic stays in one place across list and detail paths.
    const [withPhaseC] = await enrichWithPhaseC([mapped]);
    const [withCommitments] = await enrichWithNextCommitmentId([withPhaseC]);
    const [enriched] = await enrichWithOpportunityChaseState([withCommitments]);
    return enriched;
  },

  /**
   * Retry the durable `category_classified_at IS NULL` queue. New provider
   * messages clear that marker before background classification starts, so a
   * serverless interruption or transient model/database failure cannot leave a
   * stale summary forever. The caller supplies active tenant ids and tight
   * bounds to keep each cron invocation predictable.
   */
  async retryDirtyClassifications(params: {
    companyIds: string[];
    limit?: number;
    concurrency?: number;
  }): Promise<{ scanned: number; classified: number; errors: number }> {
    const companyIds = Array.from(
      new Set(params.companyIds.map((id) => id.trim()).filter(Boolean))
    );
    if (companyIds.length === 0) {
      return { scanned: 0, classified: 0, errors: 0 };
    }

    const limit = Math.min(Math.max(params.limit ?? 10, 1), 25);
    const concurrency = Math.min(Math.max(params.concurrency ?? 2, 1), 3);
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_threads")
      .select("*")
      .in("company_id", companyIds)
      .is("category_classified_at", null)
      .order("last_message_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(
        `retryDirtyClassifications query failed: ${error.message}`
      );
    }

    const threads = (data ?? []).map(mapEmailThreadFromDb);
    const result = { scanned: 0, classified: 0, errors: 0 };
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= threads.length) return;
        const thread = threads[index];
        result.scanned++;
        try {
          await EmailThreadService.classifyAndUpdate(thread);
          result.classified++;
        } catch (classificationError) {
          result.errors++;
          console.error(
            "[email-thread-service] dirty classification retry failed:",
            thread.id,
            classificationError instanceof Error
              ? classificationError.message
              : classificationError
          );
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, Math.max(threads.length, 1)) },
        () => worker()
      )
    );
    return result;
  },

  /**
   * Other threads tied to the same client. Used by the detail view's
   * "other threads with …" strip so the user can jump between parallel
   * conversations (quote + invoice + scheduling) without bouncing through
   * the list. Returns the most recent first; caps at `limit` (default 5)
   * because the strip is a peek, not a full history — the client profile
   * page owns the exhaustive view.
   *
   * Category filter is intentionally absent: opening this thread is a
   * deliberate "show me context for this client" act, and narrowing by
   * rail would hide the very cross-category surprises the user wants
   * to notice (e.g., an open invoice sitting next to a LEAD conversation).
   */
  async listSiblings(
    companyId: string,
    clientId: string,
    excludingThreadId: string,
    authorization: AllowedEmailInboxListAccess,
    limit = 5
  ): Promise<EmailThread[]> {
    const siblings = await listEmailThreadSiblings(
      companyId,
      clientId,
      excludingThreadId,
      authorization,
      limit
    );
    return enrichWithOpportunityChaseState(siblings);
  },
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function mapConnectionFromDb(row: Record<string, unknown>): EmailConnection {
  const type = row.type as EmailConnection["type"];
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as EmailConnection["provider"],
    type,
    userId: type === "individual" ? ((row.user_id as string) ?? null) : null,
    email: row.email as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    expiresAt: new Date(row.expires_at as string),
    historyId: (row.history_id as string) ?? null,
    syncEnabled: (row.sync_enabled as boolean) ?? true,
    lastSyncedAt: parseDate(row.last_synced_at),
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    syncFilters: (row.sync_filters as EmailConnection["syncFilters"]) ?? {},
    webhookSubscriptionId: (row.webhook_subscription_id as string) ?? null,
    webhookExpiresAt: row.webhook_expires_at
      ? new Date(row.webhook_expires_at as string)
      : null,
    opsLabelId: (row.ops_label_id as string) ?? null,
    aiReviewEnabled: (row.ai_review_enabled as boolean) ?? false,
    aiMemoryEnabled: (row.ai_memory_enabled as boolean) ?? false,
    status: (row.status as EmailConnection["status"]) ?? "active",
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export function hashParticipants(participants: string[]): string {
  if (participants.length === 0) return "";
  const normalized = [...participants]
    .map((p) => p.toLowerCase())
    .sort()
    .join("|");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

export function extractSubjectKeywords(subject: string): string[] {
  if (!subject) return [];
  const cleaned = subject
    .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ");
  const stopwords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "for",
    "to",
    "from",
    "of",
    "in",
    "on",
    "at",
    "is",
    "it",
    "be",
    "as",
    "by",
    "with",
    "your",
    "you",
    "me",
    "my",
    "we",
    "our",
    "their",
    "this",
    "that",
    "these",
    "those",
    "have",
    "has",
    "had",
    "will",
    "would",
    "can",
    "could",
    "should",
    "may",
    "might",
    "re",
    "fwd",
    "fw",
  ]);
  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopwords.has(w));
  return Array.from(new Set(words)).slice(0, 8);
}

export type { RailFilter, InboxScope } from "@/lib/types/email-thread";

// ─── Notification hook ──────────────────────────────────────────────────────
// Fired after classifyAndUpdate. Only notifies on meaningful transitions:
//   - Thread just became LEAD (wasn't LEAD before)
//   - URGENT label appeared on an inbound thread (wasn't URGENT before)
//   - Thread just became PLATFORM_BID
//
// Addressed through the canonical lead-assignment notification helper. Company
// mailbox connector metadata is never an actor or notification recipient.

/**
 * Phase C post-classification hook — awaited by classifyAndUpdate.
 *
 * P4-A: classification must fire the autonomy router *uniformly*, regardless
 * of which classification path produced the category. Before P4-A the router
 * only ran on the LLM path; the deterministic INTERNAL and CUSTOMER branches
 * early-returned without ever invoking it, so CUSTOMER `auto_draft` (the only
 * level Canpro has enabled) was silently inert on first deterministic
 * classification. This helper is now awaited before every return in
 * `classifyAndUpdate`.
 *
 * Non-throwing by contract: classification must never fail because of a
 * routing error. The caller already runs classifyAndUpdate inside Next `after()`
 * during sync, so awaiting here keeps Gmail/Outlook draft placement alive while
 * preserving a fast user response.
 */
async function runPhaseCRouter(thread: EmailThread): Promise<void> {
  try {
    const { PhaseCAutonomyRouter } = await import("./phase-c-autonomy-router");
    const result = await PhaseCAutonomyRouter.route(thread);
    if (
      result.outcome !== "noop_off" &&
      result.outcome !== "noop_draft_on_request"
    ) {
      console.log(
        "[phase-c-router] thread=%s outcome=%s level=%s",
        thread.id,
        result.outcome,
        result.effectiveLevel
      );
    }
  } catch (err) {
    console.error(
      "[phase-c-router] post-classify route failed:",
      err instanceof Error ? err.message : err
    );
  }
}

async function fireThreadNotifications(
  previous: EmailThread,
  next: EmailThread
): Promise<void> {
  const { createClassifiedEmailThreadNotifications } =
    await import("@/lib/email/email-opportunity-notification");
  await createClassifiedEmailThreadNotifications({
    previous,
    next,
    supabase: requireSupabase(),
  });
}
