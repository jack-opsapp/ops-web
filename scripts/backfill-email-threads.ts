/* ── scripts/backfill-email-threads.ts ── */
/*
 * Backfill the `email_threads` table from the existing `activities` row set.
 *
 * Groups activities by (connection_id, email_thread_id), builds denormalized
 * summary rows, and optionally runs Phase C classification on each thread.
 *
 * Dry-run by default. Pass --apply to write rows. Pass --classify to also
 * run the thread classifier (uses OpenAI — incurs cost). Pass --company-id
 * <uuid> to limit to a single company (useful for initial rollout).
 *
 *   npx tsx scripts/backfill-email-threads.ts                           # report only
 *   npx tsx scripts/backfill-email-threads.ts --apply                   # insert rows, no classify
 *   npx tsx scripts/backfill-email-threads.ts --apply --classify        # insert + classify
 *   npx tsx scripts/backfill-email-threads.ts --apply --classify \
 *     --company-id 11111111-2222-3333-4444-555555555555                 # one company
 *
 * Reuses EmailThreadService classification pipeline so behavior matches live
 * sync exactly — same prompt, same model, same merge logic. Requires the
 * OPENAI_API_KEY_SYNC (or OPENAI_API_KEY fallback) to be set if --classify.
 */

import { createClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import {
  ThreadClassifier,
  type ClassifyInput,
  type ClassifyMessage,
} from "../src/lib/api/services/thread-classifier-service";
import { stripQuotedContent, extractEmailAddress } from "../src/lib/utils/email-parsing";
import { getSyncOpenAI } from "../src/lib/api/services/openai-clients";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const CLASSIFY = process.argv.includes("--classify");
const companyIdArgIdx = process.argv.indexOf("--company-id");
const COMPANY_ID =
  companyIdArgIdx >= 0 ? process.argv[companyIdArgIdx + 1] : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityRow {
  id: string;
  company_id: string;
  email_thread_id: string;
  email_message_id: string | null;
  subject: string | null;
  content: string | null;
  body_text: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  direction: "inbound" | "outbound" | null;
  is_read: boolean;
  has_attachments: boolean;
  created_at: string;
  opportunity_id: string | null;
}

interface ConnectionRow {
  id: string;
  company_id: string;
  email: string;
}

interface ThreadBundle {
  companyId: string;
  connectionId: string;
  providerThreadId: string;
  subject: string;
  participants: string[];
  firstMessageAt: string;
  lastMessageAt: string;
  messageCount: number;
  unreadCount: number;
  outboundCount: number;
  latestDirection: "inbound" | "outbound" | null;
  latestSenderEmail: string | null;
  latestSenderName: string | null;
  latestSnippet: string | null;
  hasAttachments: boolean;
  opportunityId: string | null;
  messages: ActivityRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCompanies(): Promise<Array<{ id: string; name: string | null }>> {
  if (COMPANY_ID) {
    const { data } = await supabase
      .from("companies")
      .select("id, name")
      .eq("id", COMPANY_ID)
      .is("deleted_at", null);
    return data ?? [];
  }
  const { data } = await supabase
    .from("companies")
    .select("id, name")
    .is("deleted_at", null);
  return data ?? [];
}

async function fetchConnectionsForCompany(
  companyId: string
): Promise<ConnectionRow[]> {
  const { data, error } = await supabase
    .from("email_connections")
    .select("id, company_id, email")
    .eq("company_id", companyId);
  if (error) {
    console.error(`  [error] connections fetch for ${companyId}:`, error.message);
    return [];
  }
  return (data ?? []) as ConnectionRow[];
}

async function fetchActivitiesForCompany(
  companyId: string
): Promise<ActivityRow[]> {
  const all: ActivityRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("activities")
      .select(
        "id, company_id, email_thread_id, email_message_id, subject, content, body_text, from_email, to_emails, cc_emails, direction, is_read, has_attachments, created_at, opportunity_id"
      )
      .eq("company_id", companyId)
      .eq("type", "email")
      .not("email_thread_id", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("  [error] activities fetch:", error.message);
      return all;
    }
    const page = (data ?? []) as ActivityRow[];
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function fetchExistingThreadsForCompany(
  companyId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("email_threads")
    .select("connection_id, provider_thread_id")
    .eq("company_id", companyId);
  if (error) return new Set();
  const set = new Set<string>();
  for (const row of data ?? []) {
    set.add(`${row.connection_id}::${row.provider_thread_id}`);
  }
  return set;
}

function bundleActivitiesIntoThreads(
  activities: ActivityRow[],
  connectionByCompany: Map<string, ConnectionRow>
): ThreadBundle[] {
  const byThread = new Map<string, ThreadBundle>();

  for (const a of activities) {
    if (!a.email_thread_id) continue;
    const conn = connectionByCompany.get(a.company_id);
    if (!conn) continue; // skip orphaned activities

    const key = `${conn.id}::${a.email_thread_id}`;
    const senderEmail = a.from_email ? a.from_email.toLowerCase() : null;
    const senderName = senderEmail ? senderEmail.split("@")[0] : null;

    let bundle = byThread.get(key);
    if (!bundle) {
      bundle = {
        companyId: a.company_id,
        connectionId: conn.id,
        providerThreadId: a.email_thread_id,
        subject: a.subject ?? "",
        participants: [],
        firstMessageAt: a.created_at,
        lastMessageAt: a.created_at,
        messageCount: 0,
        unreadCount: 0,
        outboundCount: 0,
        latestDirection: a.direction ?? null,
        latestSenderEmail: senderEmail,
        latestSenderName: senderName,
        latestSnippet: (a.content ?? a.body_text ?? "").slice(0, 400),
        hasAttachments: false,
        opportunityId: a.opportunity_id,
        messages: [],
      };
      byThread.set(key, bundle);
    }

    bundle.messages.push(a);
    bundle.messageCount += 1;
    if (a.direction === "outbound") bundle.outboundCount += 1;
    if (a.direction === "inbound" && !a.is_read) bundle.unreadCount += 1;
    if (a.has_attachments) bundle.hasAttachments = true;
    if (a.opportunity_id && !bundle.opportunityId) bundle.opportunityId = a.opportunity_id;

    // Update participants union
    const parts = new Set<string>(bundle.participants);
    if (senderEmail) parts.add(senderEmail);
    for (const to of a.to_emails ?? []) parts.add(to.toLowerCase());
    for (const cc of a.cc_emails ?? []) parts.add(cc.toLowerCase());
    bundle.participants = Array.from(parts);

    // Latest message wins for direction/sender/snippet
    if (new Date(a.created_at) >= new Date(bundle.lastMessageAt)) {
      bundle.lastMessageAt = a.created_at;
      bundle.latestDirection = a.direction ?? null;
      bundle.latestSenderEmail = senderEmail;
      bundle.latestSenderName = senderName;
      bundle.latestSnippet = (a.content ?? a.body_text ?? "").slice(0, 400);
      if (a.subject && !bundle.subject) bundle.subject = a.subject;
    }
  }

  return Array.from(byThread.values());
}

async function insertThreads(bundles: ThreadBundle[]): Promise<Array<{ id: string; bundle: ThreadBundle }>> {
  const results: Array<{ id: string; bundle: ThreadBundle }> = [];
  for (const bundle of bundles) {
    const { data, error } = await supabase
      .from("email_threads")
      .insert({
        company_id: bundle.companyId,
        connection_id: bundle.connectionId,
        provider_thread_id: bundle.providerThreadId,
        primary_category: "OTHER",
        category_confidence: 0,
        category_classifier_version: ThreadClassifier.CLASSIFIER_VERSION,
        category_manually_set: false,
        labels: [],
        subject: bundle.subject,
        participants: bundle.participants,
        first_message_at: bundle.firstMessageAt,
        last_message_at: bundle.lastMessageAt,
        message_count: bundle.messageCount,
        unread_count: bundle.unreadCount,
        latest_direction: bundle.latestDirection,
        latest_sender_email: bundle.latestSenderEmail,
        latest_sender_name: bundle.latestSenderName,
        latest_snippet: bundle.latestSnippet,
        opportunity_id: bundle.opportunityId,
      })
      .select("id")
      .single();

    if (error) {
      // Unique constraint collision — thread already exists (race with live sync); skip
      if ((error as { code?: string }).code === "23505") {
        continue;
      }
      console.error(
        `  [error] insert failed for thread ${bundle.providerThreadId}:`,
        error.message
      );
      continue;
    }
    results.push({ id: data.id as string, bundle });
  }
  return results;
}

function buildClassifyInput(
  threadRowId: string,
  bundle: ThreadBundle
): ClassifyInput {
  // Take last 5 messages for classification context
  const sorted = [...bundle.messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const last5 = sorted.slice(-5);

  const messages: ClassifyMessage[] = last5.map((m) => ({
    from: m.from_email ?? "",
    fromName: m.from_email ? extractEmailAddress(m.from_email).split("@")[0] : "",
    to: m.to_emails ?? [],
    cc: m.cc_emails ?? [],
    direction: m.direction ?? "inbound",
    date: m.created_at,
    bodyText: stripQuotedContent(m.body_text ?? m.content ?? ""),
  }));

  return {
    threadId: threadRowId,
    providerThreadId: bundle.providerThreadId,
    subject: bundle.subject,
    participants: bundle.participants,
    messageCount: bundle.messageCount,
    outboundCount: bundle.outboundCount,
    messages,
    learnedRulesForDomain: [], // fresh backfill — no corrections yet
    learnedRulesForSender: [],
    senderIsNew: false, // during backfill we don't know — default safe
  };
}

async function classifyInBatches(
  inputs: Array<{ id: string; bundle: ThreadBundle }>,
  openai: OpenAI
): Promise<void> {
  const BATCH_SIZE = 5;
  const DELAY_MS = 200;

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const classifyInputs = batch.map(({ id, bundle }) =>
      buildClassifyInput(id, bundle)
    );

    const results = await ThreadClassifier.classifyBatch(classifyInputs, openai);

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const update: Record<string, unknown> = {
        primary_category: r.primaryCategory,
        category_confidence: r.confidence,
        labels: r.labels,
        ai_summary: r.aiSummary,
        category_classified_at: new Date().toISOString(),
        category_classifier_version: ThreadClassifier.CLASSIFIER_VERSION,
      };

      const { error } = await supabase
        .from("email_threads")
        .update(update)
        .eq("id", r.threadId);

      if (error) {
        console.error(
          `  [error] classify update failed for ${r.threadId}:`,
          error.message
        );
      }
    }

    const done = Math.min(i + BATCH_SIZE, inputs.length);
    console.log(`  classified ${done} / ${inputs.length}`);

    if (i + BATCH_SIZE < inputs.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("─".repeat(72));
  console.log(
    `Inbox v2 backfill — ${APPLY ? "APPLY" : "DRY-RUN"}${CLASSIFY ? " + CLASSIFY" : ""}${COMPANY_ID ? ` (company=${COMPANY_ID})` : ""}`
  );
  console.log("─".repeat(72));

  const companies = await fetchCompanies();
  console.log(`Companies: ${companies.length}`);

  const openai = CLASSIFY ? getSyncOpenAI() : null;

  let totalActivities = 0;
  let totalThreadsDiscovered = 0;
  let totalThreadsInserted = 0;
  let totalThreadsClassified = 0;
  let totalThreadsSkipped = 0;

  for (const company of companies) {
    const connections = await fetchConnectionsForCompany(company.id);
    if (connections.length === 0) {
      continue;
    }

    // If multiple connections exist, we need to pick the right one per
    // activity. Activities don't carry connection_id today — we rely on the
    // fact that most companies have exactly one connection. For companies
    // with multiple, we pick the oldest as the canonical one and log it.
    const primaryConnection = connections[0];
    const connectionByCompany = new Map<string, ConnectionRow>();
    connectionByCompany.set(company.id, primaryConnection);

    if (connections.length > 1) {
      console.log(
        `  [warn] ${company.id} has ${connections.length} connections — using ${primaryConnection.email} as canonical`
      );
    }

    const activities = await fetchActivitiesForCompany(company.id);
    totalActivities += activities.length;
    if (activities.length === 0) continue;

    const existingKeys = await fetchExistingThreadsForCompany(company.id);

    const bundles = bundleActivitiesIntoThreads(activities, connectionByCompany);
    totalThreadsDiscovered += bundles.length;

    const toInsert = bundles.filter(
      (b) => !existingKeys.has(`${b.connectionId}::${b.providerThreadId}`)
    );
    totalThreadsSkipped += bundles.length - toInsert.length;

    console.log(
      `\n${company.name || company.id}: ${activities.length} activities → ${bundles.length} threads (${toInsert.length} new, ${bundles.length - toInsert.length} already exist)`
    );

    if (!APPLY) {
      // Dry-run: nothing else to do
      totalThreadsInserted += toInsert.length;
      continue;
    }

    const inserted = await insertThreads(toInsert);
    totalThreadsInserted += inserted.length;

    if (CLASSIFY && openai && inserted.length > 0) {
      console.log(`  classifying ${inserted.length} threads...`);
      await classifyInBatches(inserted, openai);
      totalThreadsClassified += inserted.length;
    }
  }

  console.log("\n" + "═".repeat(72));
  console.log("SUMMARY");
  console.log("═".repeat(72));
  console.log(`  Companies processed:    ${companies.length}`);
  console.log(`  Activities scanned:     ${totalActivities}`);
  console.log(`  Threads discovered:     ${totalThreadsDiscovered}`);
  console.log(`  Threads inserted:       ${totalThreadsInserted} ${APPLY ? "" : "(dry-run)"}`);
  console.log(`  Threads skipped (exist): ${totalThreadsSkipped}`);
  if (CLASSIFY) {
    console.log(`  Threads classified:     ${totalThreadsClassified}`);
  }
  console.log("─".repeat(72));
  if (!APPLY) {
    console.log("DRY-RUN — pass --apply to persist changes");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
