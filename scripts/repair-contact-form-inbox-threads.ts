/*
 * Dry-run and gated repair for contact-form inbox threads whose cached
 * email_threads row still points at the form platform or an internal
 * forwarder instead of the parsed submitter.
 *
 * Default mode is read-only:
 *   npx tsx scripts/repair-contact-form-inbox-threads.ts --company-id <uuid>
 *   npx tsx scripts/repair-contact-form-inbox-threads.ts --company-id <uuid> --json
 *
 * Apply mode is intentionally explicit and must not be run without PM/user
 * approval:
 *   npx tsx scripts/repair-contact-form-inbox-threads.ts --company-id <uuid> --apply
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  buildContactFormRepairDecision,
  isInternalOrSystemEmail,
  normalizeRepairEmail,
  resolveSubmitterMatch,
  type ContactFormRepairClientRow,
  type ContactFormRepairDecision,
  type ContactFormRepairOpportunityRow,
  type ContactFormRepairSubClientRow,
  type ContactFormRepairThreadRow,
} from "../src/lib/inbox/contact-form-thread-repair";
import { PUBLIC_EMAIL_DOMAINS } from "../src/lib/types/pipeline";
import {
  extractContactFormSubmissionDiagnostics,
  type ContactFormSubmissionIdentity,
} from "../src/lib/utils/email-parsing";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const APPLY = process.argv.includes("--apply");
const JSON_OUTPUT = process.argv.includes("--json");
const companyIdArgIdx = process.argv.indexOf("--company-id");
const COMPANY_ID =
  companyIdArgIdx >= 0 ? process.argv[companyIdArgIdx + 1] : null;
const maxArgIdx = process.argv.indexOf("--max");
const MAX_ACTIVITIES =
  maxArgIdx >= 0 ? Number.parseInt(process.argv[maxArgIdx + 1], 10) : 500;

if (Number.isNaN(MAX_ACTIVITIES) || MAX_ACTIVITIES <= 0) {
  console.error("--max must be a positive integer");
  process.exit(1);
}

interface ActivityRow {
  id: string;
  company_id: string;
  email_thread_id: string;
  subject: string | null;
  body_text: string | null;
  content: string | null;
  from_email: string | null;
  created_at: string;
  opportunity_id: string | null;
}

interface ParsedActivity {
  activity: ActivityRow;
  submitter: ContactFormSubmissionIdentity;
  dataQualityWarnings: string[];
}

interface SyncFiltersShape {
  companyDomains?: unknown;
  teamForwarders?: unknown;
  knownPlatformSenders?: unknown;
  userEmailAddresses?: unknown;
}

interface ReportItem extends ContactFormRepairDecision {
  companyId: string;
  connectionId: string;
  activityId: string;
  activityFrom: string | null;
  activityAt: string;
}

const CONTACT_FORM_ACTIVITY_MARKERS = [
  "subject.ilike.%got a new submission%",
  "subject.ilike.%new submission%",
  "subject.ilike.%new contact form%",
  "subject.ilike.%contact form%",
  "body_text.ilike.%Submission summary%",
  "body_text.ilike.%Reply-To:%",
  "content.ilike.%Submission summary%",
  "content.ilike.%Reply-To:%",
].join(",");

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function keyFor(companyId: string, providerThreadId: string): string {
  return `${companyId}::${providerThreadId}`;
}

async function fetchContactFormActivities(): Promise<ActivityRow[]> {
  let query = sb
    .from("activities")
    .select(
      "id, company_id, email_thread_id, subject, body_text, content, from_email, created_at, opportunity_id"
    )
    .eq("type", "email")
    .not("email_thread_id", "is", null)
    .or(CONTACT_FORM_ACTIVITY_MARKERS)
    .order("created_at", { ascending: false })
    .limit(MAX_ACTIVITIES);

  if (COMPANY_ID) query = query.eq("company_id", COMPANY_ID);

  const { data, error } = await query;
  if (error) throw new Error(`Activity query failed: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}

function parseActivities(activities: ActivityRow[]): ParsedActivity[] {
  const parsed: ParsedActivity[] = [];
  for (const activity of activities) {
    const body = String(activity.body_text ?? activity.content ?? "");
    const diagnostics = extractContactFormSubmissionDiagnostics(
      activity.subject ?? "",
      body
    );
    if (diagnostics) {
      parsed.push({
        activity,
        submitter: diagnostics.identity,
        dataQualityWarnings: diagnostics.warnings,
      });
    }
  }
  return parsed;
}

function latestParsedActivityPerThread(
  parsed: ParsedActivity[]
): ParsedActivity[] {
  const byThread = new Map<string, ParsedActivity>();
  for (const item of parsed) {
    const key = keyFor(item.activity.company_id, item.activity.email_thread_id);
    if (!byThread.has(key)) byThread.set(key, item);
  }
  return Array.from(byThread.values());
}

async function fetchThreads(
  parsedThreads: ParsedActivity[]
): Promise<ContactFormRepairThreadRow[]> {
  const idsByCompany = new Map<string, string[]>();
  for (const item of parsedThreads) {
    const ids = idsByCompany.get(item.activity.company_id) ?? [];
    ids.push(item.activity.email_thread_id);
    idsByCompany.set(item.activity.company_id, ids);
  }

  const threads: ContactFormRepairThreadRow[] = [];
  for (const [companyId, providerThreadIds] of idsByCompany) {
    for (const ids of chunk(unique(providerThreadIds), 100)) {
      const { data, error } = await sb
        .from("email_threads")
        .select(
          "id, company_id, connection_id, provider_thread_id, subject, latest_sender_email, latest_sender_name, participants, client_id, opportunity_id"
        )
        .eq("company_id", companyId)
        .in("provider_thread_id", ids);
      if (error) throw new Error(`Thread query failed: ${error.message}`);
      threads.push(...((data ?? []) as ContactFormRepairThreadRow[]));
    }
  }
  return threads;
}

async function fetchClientsByIds(
  clientIds: string[]
): Promise<ContactFormRepairClientRow[]> {
  const rows: ContactFormRepairClientRow[] = [];
  for (const ids of chunk(unique(clientIds.filter(Boolean)), 100)) {
    const { data, error } = await sb
      .from("clients")
      .select("id, company_id, name, email")
      .in("id", ids);
    if (error) throw new Error(`Client query failed: ${error.message}`);
    rows.push(...((data ?? []) as ContactFormRepairClientRow[]));
  }
  return rows;
}

async function fetchOpportunitiesByIds(
  opportunityIds: string[]
): Promise<ContactFormRepairOpportunityRow[]> {
  const rows: ContactFormRepairOpportunityRow[] = [];
  for (const ids of chunk(unique(opportunityIds.filter(Boolean)), 100)) {
    const { data, error } = await sb
      .from("opportunities")
      .select("id, company_id, client_id, title, stage")
      .in("id", ids);
    if (error) throw new Error(`Opportunity query failed: ${error.message}`);
    rows.push(...((data ?? []) as ContactFormRepairOpportunityRow[]));
  }
  return rows;
}

async function fetchInternalIdentity(companyIds: string[]): Promise<{
  emails: Set<string>;
  domains: Set<string>;
}> {
  const internalEmails = new Set<string>();
  const internalDomains = new Set<string>();
  for (const companyId of unique(companyIds)) {
    const [connectionRows, userRows] = await Promise.all([
      sb
        .from("email_connections")
        .select("email, sync_filters")
        .eq("company_id", companyId),
      sb.from("users").select("email").eq("company_id", companyId),
    ]);
    if (connectionRows.error) {
      throw new Error(
        `Connection query failed: ${connectionRows.error.message}`
      );
    }
    if (userRows.error) {
      throw new Error(`User query failed: ${userRows.error.message}`);
    }
    for (const row of connectionRows.data ?? []) {
      const email = normalizeRepairEmail(row.email as string | null);
      if (email) {
        internalEmails.add(email);
        const domain = email.split("@")[1] ?? "";
        if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
          internalDomains.add(domain);
        }
      }
      const syncFilters = (row.sync_filters ?? {}) as SyncFiltersShape;
      const configuredDomains = Array.isArray(syncFilters.companyDomains)
        ? syncFilters.companyDomains
        : [];
      for (const value of configuredDomains) {
        const domain = normalizeRepairEmail(String(value)).replace(/^@/, "");
        if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
          internalDomains.add(domain);
        }
      }
      const configuredEmails = [
        ...(Array.isArray(syncFilters.teamForwarders)
          ? syncFilters.teamForwarders
          : []),
        ...(Array.isArray(syncFilters.knownPlatformSenders)
          ? syncFilters.knownPlatformSenders
          : []),
        ...(Array.isArray(syncFilters.userEmailAddresses)
          ? syncFilters.userEmailAddresses
          : []),
      ];
      for (const value of configuredEmails) {
        const configuredEmail = normalizeRepairEmail(String(value));
        if (!configuredEmail || !configuredEmail.includes("@")) continue;
        internalEmails.add(configuredEmail);
        const domain = configuredEmail.split("@")[1] ?? "";
        if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
          internalDomains.add(domain);
        }
      }
    }
    for (const row of userRows.data ?? []) {
      const email = normalizeRepairEmail(row.email as string | null);
      if (email) {
        internalEmails.add(email);
        const domain = email.split("@")[1] ?? "";
        if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
          internalDomains.add(domain);
        }
      }
    }
  }
  return { emails: internalEmails, domains: internalDomains };
}

async function fetchCompanyDirectoryRows(
  companyId: string,
  submitters: ContactFormSubmissionIdentity[]
): Promise<{
  clients: ContactFormRepairClientRow[];
  subClients: ContactFormRepairSubClientRow[];
}> {
  const emails = unique(
    submitters.map((submitter) => normalizeRepairEmail(submitter.email))
  ).filter(Boolean);
  const domains = unique(
    emails
      .map((email) => email.split("@")[1] ?? "")
      .filter((domain) => domain.length > 0)
  );
  const lastNames = unique(
    submitters
      .map(
        (submitter) =>
          (submitter.name ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? ""
      )
      .filter((name) => name.length >= 3)
  );

  const clientsById = new Map<string, ContactFormRepairClientRow>();
  const subClientsById = new Map<string, ContactFormRepairSubClientRow>();

  async function addClients(
    query: PromiseLike<{ data: unknown; error: { message: string } | null }>
  ) {
    const { data, error } = await query;
    if (error)
      throw new Error(`Client directory query failed: ${error.message}`);
    for (const row of (data ?? []) as ContactFormRepairClientRow[]) {
      clientsById.set(row.id, row);
    }
  }

  async function addSubClients(
    query: PromiseLike<{ data: unknown; error: { message: string } | null }>
  ) {
    const { data, error } = await query;
    if (error) {
      throw new Error(`Sub-client directory query failed: ${error.message}`);
    }
    for (const row of (data ?? []) as ContactFormRepairSubClientRow[]) {
      subClientsById.set(row.id, row);
    }
  }

  for (const email of emails) {
    await Promise.all([
      addClients(
        sb
          .from("clients")
          .select("id, company_id, name, email")
          .eq("company_id", companyId)
          .ilike("email", email)
          .is("deleted_at", null)
      ),
      addSubClients(
        sb
          .from("sub_clients")
          .select("id, company_id, client_id, name, email")
          .eq("company_id", companyId)
          .ilike("email", email)
          .is("deleted_at", null)
      ),
    ]);
  }

  for (const domain of domains) {
    const safeDomain = domain.replace(/[%_\\]/g, (char) => `\\${char}`);
    await Promise.all([
      addClients(
        sb
          .from("clients")
          .select("id, company_id, name, email")
          .eq("company_id", companyId)
          .ilike("email", `%@${safeDomain}`)
          .is("deleted_at", null)
      ),
      addSubClients(
        sb
          .from("sub_clients")
          .select("id, company_id, client_id, name, email")
          .eq("company_id", companyId)
          .ilike("email", `%@${safeDomain}`)
          .is("deleted_at", null)
      ),
    ]);
  }

  for (const lastName of lastNames) {
    const safeLastName = lastName.replace(/[%_\\]/g, (char) => `\\${char}`);
    await addClients(
      sb
        .from("clients")
        .select("id, company_id, name, email")
        .eq("company_id", companyId)
        .ilike("name", `%${safeLastName}%`)
        .is("deleted_at", null)
    );
  }

  return {
    clients: Array.from(clientsById.values()),
    subClients: Array.from(subClientsById.values()),
  };
}

async function findOpenOpportunityForClient(
  companyId: string,
  clientId: string | null
): Promise<ContactFormRepairOpportunityRow | null> {
  if (!clientId) return null;
  const { data, error } = await sb
    .from("opportunities")
    .select("id, company_id, client_id, title, stage")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .not("stage", "in", '("won","lost")')
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Open opportunity query failed: ${error.message}`);
  }
  return (data as ContactFormRepairOpportunityRow | null) ?? null;
}

async function buildReport(): Promise<{
  activitiesScanned: number;
  parsedActivities: number;
  parsedThreads: number;
  cachedThreads: number;
  items: ReportItem[];
}> {
  const activities = await fetchContactFormActivities();
  const parsedActivities = parseActivities(activities);
  const parsedThreads = latestParsedActivityPerThread(parsedActivities);
  const threads = await fetchThreads(parsedThreads);
  const threadsByKey = new Map(
    threads.map((thread) => [
      keyFor(thread.company_id, thread.provider_thread_id),
      thread,
    ])
  );
  const currentClients = await fetchClientsByIds(
    threads.map((thread) => thread.client_id ?? "").filter(Boolean)
  );
  const currentOpportunities = await fetchOpportunitiesByIds(
    threads.map((thread) => thread.opportunity_id ?? "").filter(Boolean)
  );
  const currentClientsById = new Map(
    currentClients.map((row) => [row.id, row])
  );
  const currentOpportunitiesById = new Map(
    currentOpportunities.map((row) => [row.id, row])
  );
  const companyIds = unique(threads.map((thread) => thread.company_id));
  const internalIdentity = await fetchInternalIdentity(companyIds);

  const directoryByCompany = new Map<
    string,
    {
      clients: ContactFormRepairClientRow[];
      subClients: ContactFormRepairSubClientRow[];
    }
  >();
  for (const companyId of companyIds) {
    const submitters = parsedThreads
      .filter((item) => item.activity.company_id === companyId)
      .map((item) => item.submitter);
    directoryByCompany.set(
      companyId,
      await fetchCompanyDirectoryRows(companyId, submitters)
    );
  }

  const items: ReportItem[] = [];
  for (const parsed of parsedThreads) {
    const thread = threadsByKey.get(
      keyFor(parsed.activity.company_id, parsed.activity.email_thread_id)
    );
    if (!thread) continue;
    const directory = directoryByCompany.get(thread.company_id) ?? {
      clients: [],
      subClients: [],
    };
    const match = resolveSubmitterMatch({
      submitter: parsed.submitter,
      clients: directory.clients,
      subClients: directory.subClients,
    });
    const targetClientId =
      match.action === "link_existing_client" ||
      match.action === "create_sub_client"
        ? match.clientId
        : null;
    const existingOpenOpportunityForTarget = await findOpenOpportunityForClient(
      thread.company_id,
      targetClientId
    );
    const decision = buildContactFormRepairDecision({
      thread,
      submitter: parsed.submitter,
      currentClient: thread.client_id
        ? (currentClientsById.get(thread.client_id) ?? null)
        : null,
      currentOpportunity: thread.opportunity_id
        ? (currentOpportunitiesById.get(thread.opportunity_id) ?? null)
        : null,
      match,
      internalEmails: internalIdentity.emails,
      internalDomains: internalIdentity.domains,
      existingOpenOpportunityForTarget,
    });
    if (decision.status !== "no_change") {
      items.push({
        ...decision,
        dataQualityWarnings: unique([
          ...parsed.dataQualityWarnings,
          ...decision.dataQualityWarnings,
        ]),
        companyId: thread.company_id,
        connectionId: thread.connection_id,
        activityId: parsed.activity.id,
        activityFrom: parsed.activity.from_email,
        activityAt: parsed.activity.created_at,
      });
    }
  }

  return {
    activitiesScanned: activities.length,
    parsedActivities: parsedActivities.length,
    parsedThreads: parsedThreads.length,
    cachedThreads: threads.length,
    items,
  };
}

function phoneValueLooksPolluted(phone: string | null): boolean {
  if (!phone) return false;
  return /[\r\n]/.test(phone) || /[A-Za-z]/.test(phone);
}

async function applySafeRepair(item: ReportItem): Promise<void> {
  if (item.status !== "safe") return;
  if (isInternalOrSystemEmail(item.parsed.email, new Set())) {
    throw new Error(
      `Refusing to apply internal/system parsed email: ${item.threadId}`
    );
  }
  if (phoneValueLooksPolluted(item.parsed.phone)) {
    throw new Error(
      `Refusing to apply polluted parsed phone: ${item.threadId}`
    );
  }

  let targetClientId = item.proposed.targetClientId;
  if (item.proposed.clientAction === "create_client") {
    const { data: existingClient, error: existingClientError } = await sb
      .from("clients")
      .select("id")
      .eq("company_id", item.companyId)
      .ilike("email", item.parsed.email)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existingClientError) {
      throw new Error(`Client recheck failed: ${existingClientError.message}`);
    }
    if (existingClient?.id) {
      targetClientId = existingClient.id as string;
    } else {
      const { data, error } = await sb
        .from("clients")
        .insert({
          company_id: item.companyId,
          name: item.parsed.name ?? item.parsed.email,
          email: item.parsed.email,
          phone_number: item.parsed.phone ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Client create failed: ${error.message}`);
      targetClientId = data.id as string;
    }
  }

  if (!targetClientId) {
    throw new Error(`Safe repair has no target client: ${item.threadId}`);
  }

  if (item.proposed.clientAction === "create_sub_client") {
    const { data: existingSub, error: existingSubError } = await sb
      .from("sub_clients")
      .select("id")
      .eq("client_id", targetClientId)
      .ilike("email", item.parsed.email)
      .is("deleted_at", null)
      .limit(1);
    if (existingSubError) {
      throw new Error(`Sub-client lookup failed: ${existingSubError.message}`);
    }
    if ((existingSub ?? []).length === 0) {
      const { error } = await sb.from("sub_clients").insert({
        company_id: item.companyId,
        client_id: targetClientId,
        name: item.parsed.name ?? item.parsed.email,
        email: item.parsed.email,
        phone_number: item.parsed.phone ?? null,
      });
      if (error) throw new Error(`Sub-client create failed: ${error.message}`);
    }
  }

  let targetOpportunityId = item.proposed.targetOpportunityId;
  if (!targetOpportunityId) {
    const { data: existingOpportunity, error: existingOpportunityError } =
      await sb
        .from("opportunities")
        .select("id")
        .eq("company_id", item.companyId)
        .eq("client_id", targetClientId)
        .not("stage", "in", '("won","lost")')
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (existingOpportunityError) {
      throw new Error(
        `Opportunity lookup failed: ${existingOpportunityError.message}`
      );
    }
    if (existingOpportunity?.id) {
      targetOpportunityId = existingOpportunity.id as string;
    } else {
      const { data, error } = await sb
        .from("opportunities")
        .insert({
          company_id: item.companyId,
          client_id: targetClientId,
          title: `${item.parsed.name ?? item.parsed.email} - Email Inquiry`,
          stage: "new_lead",
          source: "email",
          correspondence_count: 1,
          inbound_count: 1,
          outbound_count: 0,
          last_inbound_at: item.activityAt,
          last_message_direction: "in",
          tags: ["email-import"],
        })
        .select("id")
        .single();
      if (error) throw new Error(`Opportunity create failed: ${error.message}`);
      targetOpportunityId = data.id as string;
    }
  }

  const { error: linkError } = await sb
    .from("opportunity_email_threads")
    .upsert(
      {
        opportunity_id: targetOpportunityId,
        thread_id: item.providerThreadId,
        connection_id: item.connectionId,
      },
      { onConflict: "thread_id,connection_id" }
    );
  if (linkError)
    throw new Error(`Thread link upsert failed: ${linkError.message}`);

  const { error: updateError } = await sb
    .from("email_threads")
    .update({
      latest_sender_email: item.proposed.latestSenderEmail,
      latest_sender_name: item.proposed.latestSenderName,
      participants: item.proposed.participants,
      client_id: targetClientId,
      opportunity_id: targetOpportunityId,
    })
    .eq("id", item.threadId);
  if (updateError) {
    throw new Error(`Thread update failed: ${updateError.message}`);
  }
}

function printReport(report: Awaited<ReturnType<typeof buildReport>>) {
  const safe = report.items.filter((item) => item.status === "safe");
  const manual = report.items.filter((item) => item.status === "manual_review");
  const warningItems = report.items.filter(
    (item) => item.dataQualityWarnings.length > 0
  );
  const safePollutedPhones = safe.filter((item) =>
    phoneValueLooksPolluted(item.parsed.phone)
  );

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? "APPLY" : "DRY_RUN",
          activitiesScanned: report.activitiesScanned,
          parsedActivities: report.parsedActivities,
          parsedThreads: report.parsedThreads,
          cachedThreads: report.cachedThreads,
          affected: report.items.length,
          safe: safe.length,
          manualReview: manual.length,
          dataWarningItems: warningItems.length,
          safePollutedPhones: safePollutedPhones.length,
          items: report.items,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("Contact-form inbox thread repair");
  console.log(`  mode:              ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`  activities scanned: ${report.activitiesScanned}`);
  console.log(`  parsed activities:  ${report.parsedActivities}`);
  console.log(`  parsed threads:     ${report.parsedThreads}`);
  console.log(`  cached threads:     ${report.cachedThreads}`);
  console.log(`  affected:           ${report.items.length}`);
  console.log(`  safe:               ${safe.length}`);
  console.log(`  manual review:      ${manual.length}`);
  console.log(`  data warnings:      ${warningItems.length}`);
  console.log(`  safe polluted phones: ${safePollutedPhones.length}`);
  console.log();

  for (const item of report.items.slice(0, 25)) {
    console.log(
      [
        item.status.toUpperCase(),
        item.threadId,
        `${item.current.latestSenderEmail ?? "-"} -> ${item.parsed.email}`,
        item.current.clientName
          ? `client=${item.current.clientName}`
          : "client=-",
        `action=${item.proposed.clientAction}/${item.proposed.opportunityAction}`,
        `reason=${item.reason}`,
        item.dataQualityWarnings.length > 0
          ? `warnings=${item.dataQualityWarnings.join("; ")}`
          : "warnings=-",
      ].join(" | ")
    );
  }
  if (report.items.length > 25) {
    console.log(`... ${report.items.length - 25} more item(s) omitted`);
  }
}

async function main() {
  const report = await buildReport();
  printReport(report);

  if (!APPLY) return;

  for (const item of report.items) {
    if (item.status !== "safe") continue;
    await applySafeRepair(item);
  }
}

main().catch((err) => {
  console.error("Contact-form repair failed:", err);
  process.exit(1);
});
