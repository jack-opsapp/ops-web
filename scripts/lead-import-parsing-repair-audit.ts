/*
 * Lead import parsing repair audit.
 *
 * Dry-run by default. The default path reads live pipeline/email data and writes
 * only a local markdown artifact. Apply mode is intentionally gated and only:
 * - fills/repairs customer contact fields when the replacement is extracted
 *   from non-internal inbound email body evidence;
 * - reports likely-won signals for review but never treats the model-style
 *   heuristic as conversion authority;
 * - reports duplicate clusters without merging them.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-import-parsing-repair-audit.ts --company-name Canpro
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-import-parsing-repair-audit.ts --company-id <uuid>
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-import-parsing-repair-audit.ts --company-id <uuid> --opportunity-id <uuid>
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-import-parsing-repair-audit.ts --company-id <uuid> --opportunity-id <uuid> --apply --i-understand-live-lead-repair
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  extractAddressFromBody,
  extractPhoneFromBody,
} from "../src/lib/utils/body-fact-extractors";
import {
  extractEmailAddress,
  extractForwardedSender,
  htmlToPlainText,
} from "../src/lib/utils/email-parsing";
import { normalizeAddress } from "../src/lib/utils/name-normalization";
import {
  detectTerminalStageFromMessages,
  type TerminalStageMessage,
} from "../src/lib/email/terminal-stage-decision";

const ENV_DIR = process.env.OPS_WEB_ENV_DIR || process.cwd();
loadEnvConfig(ENV_DIR);

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
const APPLY_ACK = process.argv.includes("--i-understand-live-lead-repair");
const companyIdArgIdx = process.argv.indexOf("--company-id");
const COMPANY_ID =
  companyIdArgIdx >= 0 ? process.argv[companyIdArgIdx + 1] : null;
const companyNameArgIdx = process.argv.indexOf("--company-name");
const COMPANY_NAME =
  companyNameArgIdx >= 0 ? process.argv[companyNameArgIdx + 1] : "Canpro";
const maxOppArgIdx = process.argv.indexOf("--max-opportunities");
const MAX_OPPORTUNITIES =
  maxOppArgIdx >= 0
    ? Number.parseInt(process.argv[maxOppArgIdx + 1], 10)
    : 2000;
const maxActivityArgIdx = process.argv.indexOf("--max-activities");
const MAX_ACTIVITIES =
  maxActivityArgIdx >= 0
    ? Number.parseInt(process.argv[maxActivityArgIdx + 1], 10)
    : 30000;
const OPPORTUNITY_IDS = cliValues("--opportunity-id")
  .map((value) => value.trim())
  .filter(Boolean);
const OPPORTUNITY_ID_SET = new Set(OPPORTUNITY_IDS);
const targetTerms = cliValues("--target");
const outputArgIdx = process.argv.indexOf("--output");

const DEFAULT_TARGETS = [
  "Liane Kern",
  "Erin Young",
  "canprojack@gmail.com",
  "Canprojack",
];

const ACTIVE_TERMS = targetTerms.length > 0 ? targetTerms : DEFAULT_TARGETS;

const DEFAULT_OUTPUT = `/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-import-parsing-repair-audit-${vancouverDateKey(new Date())}.md`;
const OUTPUT_PATH =
  outputArgIdx >= 0 ? process.argv[outputArgIdx + 1] : DEFAULT_OUTPUT;

const TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);
const CONVERSION_RPC = "convert_opportunity_to_project";
const NOTIFICATION_RPC = "create_notification_if_new";
const INCONSISTENT_TITLE_SUFFIX_RE =
  /\s-\s(?:estimate|email inquiry|new lead)$/i;
const BAD_ADDRESS_TEXT_RE =
  /\b(?:resurface|deck your size|sq ft|approximate time|make thursday work|sounds great|thanks|sent from my iphone|for a)\b/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (APPLY && !APPLY_ACK) {
  console.error(
    "--apply requires --i-understand-live-lead-repair. Run dry-run first."
  );
  process.exit(1);
}

if (APPLY && OPPORTUNITY_IDS.length === 0) {
  console.error(
    "Live apply requires at least one --opportunity-id so repairs cannot fan out broadly."
  );
  process.exit(1);
}

for (const id of OPPORTUNITY_IDS) {
  if (!UUID_RE.test(id)) {
    console.error(`--opportunity-id must be a UUID: ${id}`);
    process.exit(1);
  }
}

for (const [name, value] of [
  ["--max-opportunities", MAX_OPPORTUNITIES],
  ["--max-activities", MAX_ACTIVITIES],
] as const) {
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }
}

if (!OUTPUT_PATH) {
  console.error("--output must not be blank");
  process.exit(1);
}

interface CompanyRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  physical_address: string | null;
  account_holder_id: string | null;
}

interface UserRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

interface EmailConnectionRow {
  id: string;
  email: string;
  user_id: string | null;
}

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  address: string | null;
  deleted_at: string | null;
}

interface OpportunityRow {
  id: string;
  company_id: string;
  client_id: string | null;
  title: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  stage: string;
  stage_manually_set: boolean;
  actual_value: number | string | null;
  detected_value: number | string | null;
  estimated_value: number | string | null;
  project_id: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  source: string | null;
  updated_at: string;
}

interface EmailThreadRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  opportunity_id: string | null;
  client_id: string | null;
  subject: string;
  latest_sender_email: string | null;
  latest_sender_name: string | null;
  latest_snippet: string | null;
  participants: string[];
  primary_category: string;
  labels: string[];
  last_message_at: string;
}

interface ThreadLinkRow {
  id: string;
  opportunity_id: string;
  thread_id: string;
  connection_id: string | null;
}

interface ActivityRow {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  email_thread_id: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  direction: string | null;
  subject: string | null;
  body_text: string | null;
  content: string | null;
  created_at: string | null;
  type: string | null;
}

type RepairPlanKind =
  | "opportunity_contact_phone"
  | "client_phone"
  | "opportunity_address"
  | "client_address"
  | "client_name"
  | "opportunity_contact_name"
  | "likely_won_conversion";

interface RepairPlan {
  kind: RepairPlanKind;
  table: "opportunities" | "clients" | "conversion";
  rowId: string;
  field: string;
  before: string | null;
  after: string;
  reason: string;
  evidenceActivityId?: string | null;
}

interface DuplicateGroup {
  key: string;
  reason: string;
  opportunityIds: string[];
}

interface CandidateReport {
  opportunity: OpportunityRow;
  client: ClientRow | null;
  threads: EmailThreadRow[];
  activityCount: number;
  targetHit: boolean;
  suspiciousReasons: string[];
  extractedAddress: string | null;
  extractedPhone: string | null;
  extractedName: string | null;
  terminalLikelyWon: boolean;
  plans: RepairPlan[];
  duplicateGroups: DuplicateGroup[];
  applyResults: string[];
  applyErrors: string[];
}

interface UnifiedConversionResult {
  converted?: boolean;
  already_converted?: boolean;
  project_id?: string;
  opportunity_id?: string;
  disposition_id?: string;
  relinked_estimates?: number;
  materialized_tasks?: number;
  attached_photos?: number;
  linked_existing?: boolean;
  won?: boolean;
  guard_reason?: string;
}

interface RepairConversionResult {
  converted: boolean;
  alreadyConverted: boolean;
  projectId: string;
  opportunityId: string;
  linkedExisting: boolean;
}

function cliValues(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) {
      values.push(process.argv[i + 1]);
      i++;
    }
  }
  return values;
}

function vancouverDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function md(value: unknown): string {
  const text = value == null || value === "" ? "-" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const extracted = extractEmailAddress(value ?? "")
    .toLowerCase()
    .trim();
  return extracted.includes("@") ? extracted : null;
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

function textKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAddressKey(value: string | null | undefined): string | null {
  const extracted = extractAddressFromBody(value) ?? clean(value);
  if (!extracted) return null;
  const normalized = normalizeAddress(extracted);
  return normalized || null;
}

function isWeak(value: string | null | undefined): boolean {
  return !clean(value);
}

function isInternalEmail(
  value: string | null | undefined,
  internalEmails: Set<string>
): boolean {
  const normalized = normalizeEmail(value);
  return Boolean(normalized && internalEmails.has(normalized));
}

function isInternalPhone(
  value: string | null | undefined,
  internalPhones: Set<string>
): boolean {
  const normalized = normalizePhone(value);
  return Boolean(normalized && internalPhones.has(normalized));
}

function localPart(value: string | null | undefined): string | null {
  const email = normalizeEmail(value);
  return email?.split("@")[0] ?? null;
}

function isEmailLocalPartName(
  name: string | null | undefined,
  email: string | null | undefined
): boolean {
  const cleaned = clean(name);
  const local = localPart(email);
  if (!cleaned || !local) return false;
  return textKey(cleaned) === textKey(local);
}

function isSafePersonName(
  value: string | null | undefined,
  email: string | null | undefined,
  internalNameKeys: Set<string>
): boolean {
  const cleaned = clean(value);
  if (!cleaned) return false;
  if (cleaned.includes("@") || cleaned.length > 80) return false;
  const key = textKey(cleaned);
  if (!key || internalNameKeys.has(key)) return false;
  if (isEmailLocalPartName(cleaned, email)) return false;
  if (/^(?:unknown|new lead|n\/a|na|null|undefined|none)$/i.test(cleaned)) {
    return false;
  }
  return /\s/.test(cleaned);
}

function looksLikeBadAddress(value: string | null | undefined): boolean {
  const current = clean(value);
  if (!current) return false;
  const extracted = extractAddressFromBody(current);
  if (!extracted) return true;
  if (BAD_ADDRESS_TEXT_RE.test(current)) return true;
  return current.length > extracted.length + 20;
}

function shouldReplaceAddress(
  current: string | null | undefined,
  candidate: string | null,
  companyAddressKeys: Set<string>
): boolean {
  if (!candidate) return false;
  const candidateKey = normalizeAddressKey(candidate);
  if (candidateKey && companyAddressKeys.has(candidateKey)) return false;
  if (isWeak(current)) return true;
  const currentKey = normalizeAddressKey(current);
  if (currentKey && candidateKey && currentKey === candidateKey) {
    return looksLikeBadAddress(current);
  }
  return looksLikeBadAddress(current);
}

function shouldReplacePhone(
  current: string | null | undefined,
  candidate: string | null,
  internalPhones: Set<string>
): boolean {
  if (!candidate) return false;
  if (isWeak(current)) return true;
  if (isInternalPhone(current, internalPhones)) return true;
  return false;
}

function bodyForActivity(activity: ActivityRow): string {
  const bodyText = activity.body_text?.trim();
  if (bodyText) return bodyText;
  const raw = activity.content ?? "";
  return raw.includes("<") ? htmlToPlainText(raw) : raw;
}

function effectiveSenderEmail(
  activity: ActivityRow,
  internalEmails: Set<string>
): string | null {
  const body = bodyForActivity(activity);
  const forwarded = extractForwardedSender(activity.subject ?? "", body);
  if (forwarded && !internalEmails.has(forwarded.toLowerCase())) {
    return forwarded.toLowerCase();
  }
  return normalizeEmail(activity.from_email);
}

function activityDirection(
  activity: ActivityRow,
  internalEmails: Set<string>
): "inbound" | "outbound" {
  const direction = activity.direction?.toLowerCase().trim() ?? "";
  if (direction.includes("out")) return "outbound";
  const sender = effectiveSenderEmail(activity, internalEmails);
  if (sender && internalEmails.has(sender)) return "outbound";
  return "inbound";
}

function numericValue(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function firstNumericValue(opp: OpportunityRow): number | null {
  return (
    numericValue(opp.actual_value) ??
    numericValue(opp.detected_value) ??
    numericValue(opp.estimated_value)
  );
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function fetchCompany(): Promise<CompanyRow> {
  if (COMPANY_ID) {
    const { data, error } = await sb
      .from("companies")
      .select(
        "id, name, email, phone, address, physical_address, account_holder_id"
      )
      .eq("id", COMPANY_ID)
      .maybeSingle();
    if (error) throw new Error(`companies query failed: ${error.message}`);
    if (!data) throw new Error(`No company found for id ${COMPANY_ID}`);
    return data as CompanyRow;
  }

  const { data, error } = await sb
    .from("companies")
    .select(
      "id, name, email, phone, address, physical_address, account_holder_id"
    )
    .ilike("name", `%${COMPANY_NAME}%`)
    .is("deleted_at", null)
    .limit(5);
  if (error) throw new Error(`companies query failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No company found matching ${COMPANY_NAME}`);
  }
  if (data.length > 1) {
    throw new Error(
      `Company name ${COMPANY_NAME} matched ${data.length} rows; rerun with --company-id`
    );
  }
  return data[0] as CompanyRow;
}

async function fetchUsers(companyId: string): Promise<UserRow[]> {
  const { data, error } = await sb
    .from("users")
    .select("id, email, first_name, last_name, phone")
    .eq("company_id", companyId);
  if (error) throw new Error(`users query failed: ${error.message}`);
  return (data ?? []) as UserRow[];
}

async function fetchConnections(
  companyId: string
): Promise<EmailConnectionRow[]> {
  const { data, error } = await sb
    .from("email_connections")
    .select("id, email, user_id")
    .eq("company_id", companyId);
  if (error)
    throw new Error(`email_connections query failed: ${error.message}`);
  return (data ?? []) as EmailConnectionRow[];
}

async function fetchOpportunities(
  companyId: string
): Promise<OpportunityRow[]> {
  if (OPPORTUNITY_IDS.length > 0) {
    const rows: OpportunityRow[] = [];
    for (const idChunk of chunk(OPPORTUNITY_IDS, 250)) {
      const { data, error } = await sb
        .from("opportunities")
        .select(
          "id, company_id, client_id, title, contact_name, contact_email, contact_phone, address, stage, stage_manually_set, actual_value, detected_value, estimated_value, project_id, archived_at, deleted_at, source, updated_at"
        )
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .in("id", idChunk);
      if (error)
        throw new Error(`opportunities query failed: ${error.message}`);
      rows.push(...((data ?? []) as OpportunityRow[]));
    }

    const found = new Set(rows.map((row) => row.id));
    const missing = OPPORTUNITY_IDS.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(
        `No non-deleted opportunity rows found for: ${missing.join(", ")}`
      );
    }
    return rows;
  }

  const rows: OpportunityRow[] = [];
  const pageSize = 1000;
  for (let start = 0; start < MAX_OPPORTUNITIES; start += pageSize) {
    const end = Math.min(start + pageSize - 1, MAX_OPPORTUNITIES - 1);
    const { data, error } = await sb
      .from("opportunities")
      .select(
        "id, company_id, client_id, title, contact_name, contact_email, contact_phone, address, stage, stage_manually_set, actual_value, detected_value, estimated_value, project_id, archived_at, deleted_at, source, updated_at"
      )
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .range(start, end);
    if (error) throw new Error(`opportunities query failed: ${error.message}`);
    rows.push(...((data ?? []) as OpportunityRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchClients(ids: string[]): Promise<Map<string, ClientRow>> {
  const byId = new Map<string, ClientRow>();
  for (const idChunk of chunk([...new Set(ids)].filter(Boolean), 250)) {
    const { data, error } = await sb
      .from("clients")
      .select("id, name, email, phone_number, address, deleted_at")
      .in("id", idChunk);
    if (error) throw new Error(`clients query failed: ${error.message}`);
    for (const row of (data ?? []) as ClientRow[]) {
      byId.set(row.id, row);
    }
  }
  return byId;
}

async function fetchThreadLinks(ids: string[]): Promise<ThreadLinkRow[]> {
  const rows: ThreadLinkRow[] = [];
  for (const idChunk of chunk(ids, 250)) {
    const { data, error } = await sb
      .from("opportunity_email_threads")
      .select("id, opportunity_id, thread_id, connection_id")
      .in("opportunity_id", idChunk);
    if (error) {
      throw new Error(
        `opportunity_email_threads query failed: ${error.message}`
      );
    }
    rows.push(...((data ?? []) as ThreadLinkRow[]));
  }
  return rows;
}

async function fetchThreads(
  companyId: string,
  opportunityIds: string[],
  providerThreadIds: string[]
): Promise<EmailThreadRow[]> {
  const byId = new Map<string, EmailThreadRow>();
  for (const idChunk of chunk(opportunityIds, 250)) {
    const { data, error } = await sb
      .from("email_threads")
      .select(
        "id, company_id, connection_id, provider_thread_id, opportunity_id, client_id, subject, latest_sender_email, latest_sender_name, latest_snippet, participants, primary_category, labels, last_message_at"
      )
      .eq("company_id", companyId)
      .in("opportunity_id", idChunk);
    if (error) throw new Error(`email_threads query failed: ${error.message}`);
    for (const row of (data ?? []) as EmailThreadRow[]) byId.set(row.id, row);
  }
  for (const threadChunk of chunk(
    [...new Set(providerThreadIds)].filter(Boolean),
    250
  )) {
    const { data, error } = await sb
      .from("email_threads")
      .select(
        "id, company_id, connection_id, provider_thread_id, opportunity_id, client_id, subject, latest_sender_email, latest_sender_name, latest_snippet, participants, primary_category, labels, last_message_at"
      )
      .eq("company_id", companyId)
      .in("provider_thread_id", threadChunk);
    if (error) throw new Error(`email_threads query failed: ${error.message}`);
    for (const row of (data ?? []) as EmailThreadRow[]) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function fetchActivities(companyId: string): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  const pageSize = 1000;
  for (let start = 0; start < MAX_ACTIVITIES; start += pageSize) {
    const end = Math.min(start + pageSize - 1, MAX_ACTIVITIES - 1);
    const { data, error } = await sb
      .from("activities")
      .select(
        "id, company_id, opportunity_id, email_thread_id, from_email, to_emails, cc_emails, direction, subject, body_text, content, created_at, type"
      )
      .eq("company_id", companyId)
      .eq("type", "email")
      .order("created_at", { ascending: false })
      .range(start, end);
    if (error) throw new Error(`activities query failed: ${error.message}`);
    rows.push(...((data ?? []) as ActivityRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function deriveInternalSets(
  company: CompanyRow,
  users: UserRow[],
  connections: EmailConnectionRow[]
): {
  internalEmails: Set<string>;
  internalPhones: Set<string>;
  internalNameKeys: Set<string>;
  companyAddresses: string[];
} {
  const internalEmails = new Set<string>();
  const internalPhones = new Set<string>();
  const internalNameKeys = new Set<string>();
  const companyAddresses = [company.address, company.physical_address].filter(
    (value): value is string => Boolean(clean(value))
  );

  for (const email of [
    company.email,
    ...users.map((user) => user.email),
    ...connections.map((connection) => connection.email),
  ]) {
    const normalized = normalizeEmail(email);
    if (normalized) internalEmails.add(normalized);
  }

  for (const phone of [company.phone, ...users.map((user) => user.phone)]) {
    const normalized = normalizePhone(phone);
    if (normalized) internalPhones.add(normalized);
  }

  for (const name of [
    company.name,
    ...users.map((user) =>
      `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim()
    ),
  ]) {
    const key = textKey(name);
    if (key) internalNameKeys.add(key);
  }

  return { internalEmails, internalPhones, internalNameKeys, companyAddresses };
}

function buildDuplicateGroups(
  opportunities: OpportunityRow[],
  clientsById: Map<string, ClientRow>,
  internalEmails: Set<string>,
  internalPhones: Set<string>
): Map<string, DuplicateGroup[]> {
  const groups = new Map<string, Set<string>>();
  const reasons = new Map<string, string>();
  const active = opportunities.filter(
    (opp) => !opp.archived_at && !TERMINAL_STAGES.has(opp.stage)
  );

  for (const opp of active) {
    const client = opp.client_id
      ? (clientsById.get(opp.client_id) ?? null)
      : null;
    const email = normalizeEmail(opp.contact_email ?? client?.email);
    if (email && !internalEmails.has(email)) {
      const key = `email:${email}`;
      groups.set(key, (groups.get(key) ?? new Set()).add(opp.id));
      reasons.set(key, "same customer email");
    }

    const phone = normalizePhone(opp.contact_phone ?? client?.phone_number);
    if (phone && !internalPhones.has(phone)) {
      const key = `phone:${phone}`;
      groups.set(key, (groups.get(key) ?? new Set()).add(opp.id));
      reasons.set(key, "same customer phone");
    }

    const address = normalizeAddressKey(opp.address ?? client?.address);
    if (address) {
      const key = `address:${address}`;
      groups.set(key, (groups.get(key) ?? new Set()).add(opp.id));
      reasons.set(key, "same job-site address");
    }
  }

  const byOpp = new Map<string, DuplicateGroup[]>();
  for (const [key, ids] of groups) {
    if (ids.size <= 1) continue;
    const group: DuplicateGroup = {
      key,
      reason: reasons.get(key) ?? "same identity key",
      opportunityIds: [...ids],
    };
    for (const id of ids) {
      const list = byOpp.get(id) ?? [];
      list.push(group);
      byOpp.set(id, list);
    }
  }
  return byOpp;
}

function targetHit(
  opp: OpportunityRow,
  client: ClientRow | null,
  threads: EmailThreadRow[]
): boolean {
  const haystack = [
    opp.title,
    opp.contact_name,
    opp.contact_email,
    opp.contact_phone,
    opp.address,
    client?.name,
    client?.email,
    client?.phone_number,
    client?.address,
    ...threads.flatMap((thread) => [
      thread.subject,
      thread.latest_sender_email,
      thread.latest_sender_name,
      thread.latest_snippet,
      ...(thread.participants ?? []),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return ACTIVE_TERMS.some((term) => haystack.includes(term.toLowerCase()));
}

function bestSafeName(
  opp: OpportunityRow,
  client: ClientRow | null,
  threads: EmailThreadRow[],
  internalNameKeys: Set<string>,
  internalEmails: Set<string>
): string | null {
  const identityEmail = opp.contact_email ?? client?.email ?? null;
  for (const candidate of [
    opp.contact_name,
    client?.name,
    ...threads
      .filter(
        (thread) => !isInternalEmail(thread.latest_sender_email, internalEmails)
      )
      .map((thread) => thread.latest_sender_name),
  ]) {
    if (isSafePersonName(candidate, identityEmail, internalNameKeys)) {
      return clean(candidate);
    }
  }
  return null;
}

function extractFactsFromActivities(
  activities: ActivityRow[],
  internalEmails: Set<string>,
  internalPhones: Set<string>,
  companyAddressKeys: Set<string>
): {
  messages: TerminalStageMessage[];
  inboundBody: string;
  address: string | null;
  phone: string | null;
  evidenceByField: { address?: string; phone?: string };
} {
  const sorted = [...activities].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  );
  const messages: TerminalStageMessage[] = [];
  const inboundBodies: Array<{ id: string; body: string }> = [];

  for (const activity of sorted) {
    const body = bodyForActivity(activity);
    const direction = activityDirection(activity, internalEmails);
    messages.push({ direction, body });
    if (direction === "inbound") {
      inboundBodies.push({ id: activity.id, body });
    }
  }

  const addressFact = newestAddressFact(inboundBodies, companyAddressKeys);
  const phoneFact = newestPhoneFact(inboundBodies, internalPhones);

  return {
    messages,
    inboundBody: inboundBodies.map((item) => item.body).join("\n"),
    address: addressFact?.value ?? null,
    phone: phoneFact?.value ?? null,
    evidenceByField: {
      address: addressFact?.activityId,
      phone: phoneFact?.activityId,
    },
  };
}

function newestAddressFact(
  inboundBodies: Array<{ id: string; body: string }>,
  companyAddressKeys: Set<string>
): { value: string; activityId: string } | null {
  for (let index = inboundBodies.length - 1; index >= 0; index--) {
    const item = inboundBodies[index];
    const value = extractAddressFromBody(item.body);
    const key = normalizeAddressKey(value);
    if (value && (!key || !companyAddressKeys.has(key))) {
      return { value, activityId: item.id };
    }
  }
  return null;
}

function newestPhoneFact(
  inboundBodies: Array<{ id: string; body: string }>,
  internalPhones: Set<string>
): { value: string; activityId: string } | null {
  for (let index = inboundBodies.length - 1; index >= 0; index--) {
    const item = inboundBodies[index];
    const value = extractPhoneFromBody(item.body, {
      excludedPhones: [...internalPhones],
    });
    if (value) return { value, activityId: item.id };
  }
  return null;
}

function analyzeOpportunity(input: {
  opp: OpportunityRow;
  client: ClientRow | null;
  threads: EmailThreadRow[];
  activities: ActivityRow[];
  duplicateGroups: DuplicateGroup[];
  internalEmails: Set<string>;
  internalPhones: Set<string>;
  internalNameKeys: Set<string>;
  companyAddressKeys: Set<string>;
}): CandidateReport {
  const facts = extractFactsFromActivities(
    input.activities,
    input.internalEmails,
    input.internalPhones,
    input.companyAddressKeys
  );
  const terminal = detectTerminalStageFromMessages(facts.messages);
  const terminalLikelyWon =
    terminal?.terminalFlag === "likely_won" &&
    !input.opp.stage_manually_set &&
    !TERMINAL_STAGES.has(input.opp.stage.trim().toLowerCase());
  const extractedName = bestSafeName(
    input.opp,
    input.client,
    input.threads,
    input.internalNameKeys,
    input.internalEmails
  );
  const plans: RepairPlan[] = [];
  const suspiciousReasons: string[] = [];

  const oppPhoneInternal = isInternalPhone(
    input.opp.contact_phone,
    input.internalPhones
  );
  const clientPhoneInternal = isInternalPhone(
    input.client?.phone_number,
    input.internalPhones
  );

  if (looksLikeBadAddress(input.opp.address)) {
    suspiciousReasons.push(
      "opportunity address is not an address-shaped value"
    );
  }
  if (looksLikeBadAddress(input.client?.address)) {
    suspiciousReasons.push("client address is not an address-shaped value");
  }
  if (oppPhoneInternal || clientPhoneInternal) {
    suspiciousReasons.push("stored phone matches internal contact info");
  }
  if (
    isEmailLocalPartName(input.opp.contact_name, input.opp.contact_email) ||
    isEmailLocalPartName(input.client?.name, input.client?.email)
  ) {
    suspiciousReasons.push(
      "stored name appears to be only the email local part"
    );
  }
  if (INCONSISTENT_TITLE_SUFFIX_RE.test(input.opp.title)) {
    suspiciousReasons.push(
      "legacy title suffix should be left to shared title builder"
    );
  }
  if (terminalLikelyWon) {
    suspiciousReasons.push(
      "thread contains likely-won review evidence; deterministic lifecycle evaluation is required before conversion"
    );
  }
  if (input.duplicateGroups.length > 0) {
    suspiciousReasons.push("possible duplicate opportunity cluster");
  }

  if (
    shouldReplaceAddress(
      input.opp.address,
      facts.address,
      input.companyAddressKeys
    )
  ) {
    plans.push({
      kind: "opportunity_address",
      table: "opportunities",
      rowId: input.opp.id,
      field: "address",
      before: input.opp.address,
      after: facts.address!,
      reason: "replace blank/bad opportunity address from inbound body",
      evidenceActivityId: facts.evidenceByField.address ?? null,
    });
  }

  if (
    input.client &&
    shouldReplaceAddress(
      input.client.address,
      facts.address,
      input.companyAddressKeys
    )
  ) {
    plans.push({
      kind: "client_address",
      table: "clients",
      rowId: input.client.id,
      field: "address",
      before: input.client.address,
      after: facts.address!,
      reason: "replace blank/bad client address from inbound body",
      evidenceActivityId: facts.evidenceByField.address ?? null,
    });
  }

  if (
    shouldReplacePhone(
      input.opp.contact_phone,
      facts.phone,
      input.internalPhones
    )
  ) {
    plans.push({
      kind: "opportunity_contact_phone",
      table: "opportunities",
      rowId: input.opp.id,
      field: "contact_phone",
      before: input.opp.contact_phone,
      after: facts.phone!,
      reason: "fill/replace opportunity phone from inbound body",
      evidenceActivityId: facts.evidenceByField.phone ?? null,
    });
  }

  if (
    input.client &&
    shouldReplacePhone(
      input.client.phone_number,
      facts.phone,
      input.internalPhones
    )
  ) {
    plans.push({
      kind: "client_phone",
      table: "clients",
      rowId: input.client.id,
      field: "phone_number",
      before: input.client.phone_number,
      after: facts.phone!,
      reason: "fill/replace client phone from inbound body",
      evidenceActivityId: facts.evidenceByField.phone ?? null,
    });
  }

  if (
    input.client &&
    extractedName &&
    isEmailLocalPartName(input.client.name, input.client.email)
  ) {
    plans.push({
      kind: "client_name",
      table: "clients",
      rowId: input.client.id,
      field: "name",
      before: input.client.name,
      after: extractedName,
      reason: "replace email-local-part client name with safe display name",
    });
  }

  if (
    extractedName &&
    isEmailLocalPartName(input.opp.contact_name, input.opp.contact_email)
  ) {
    plans.push({
      kind: "opportunity_contact_name",
      table: "opportunities",
      rowId: input.opp.id,
      field: "contact_name",
      before: input.opp.contact_name,
      after: extractedName,
      reason: "replace email-local-part opportunity contact name",
    });
  }

  return {
    opportunity: input.opp,
    client: input.client,
    threads: input.threads,
    activityCount: input.activities.length,
    targetHit: targetHit(input.opp, input.client, input.threads),
    suspiciousReasons,
    extractedAddress: facts.address,
    extractedPhone: facts.phone,
    extractedName,
    terminalLikelyWon,
    plans,
    duplicateGroups: input.duplicateGroups,
    applyResults: [],
    applyErrors: [],
  };
}

async function applyCandidate(
  candidate: CandidateReport,
  connectionByThread: Map<string, EmailConnectionRow>,
  company: CompanyRow
): Promise<void> {
  const clientUpdates: Record<string, Record<string, unknown>> = {};
  const opportunityUpdates: Record<string, Record<string, unknown>> = {};

  for (const plan of candidate.plans) {
    if (plan.table === "clients") {
      clientUpdates[plan.rowId] = {
        ...(clientUpdates[plan.rowId] ?? {}),
        [plan.field]: plan.after,
        updated_at: new Date().toISOString(),
      };
    }
    if (plan.table === "opportunities") {
      opportunityUpdates[plan.rowId] = {
        ...(opportunityUpdates[plan.rowId] ?? {}),
        [plan.field]: plan.after,
        updated_at: new Date().toISOString(),
      };
    }
  }

  for (const [id, updates] of Object.entries(clientUpdates)) {
    const { error } = await sb.from("clients").update(updates).eq("id", id);
    if (error) {
      candidate.applyErrors.push(`clients ${id}: ${error.message}`);
    } else {
      candidate.applyResults.push(`updated clients ${id}`);
    }
  }

  for (const [id, updates] of Object.entries(opportunityUpdates)) {
    const { error } = await sb
      .from("opportunities")
      .update(updates)
      .eq("id", id);
    if (error) {
      candidate.applyErrors.push(`opportunities ${id}: ${error.message}`);
    } else {
      candidate.applyResults.push(`updated opportunities ${id}`);
    }
  }

  const conversionPlan = candidate.plans.find(
    (plan) => plan.kind === "likely_won_conversion"
  );
  if (!conversionPlan) return;

  const decidedBy =
    candidate.threads
      .map((thread) => connectionByThread.get(thread.id)?.user_id ?? null)
      .find(Boolean) ??
    company.account_holder_id ??
    null;

  try {
    const result = await convertOpportunityToProjectForRepair({
      opportunityId: candidate.opportunity.id,
      companyId: company.id,
      decidedBy,
      actualValue: firstNumericValue(candidate.opportunity),
      expectedStage: candidate.opportunity.stage,
      notesSeed: "Lead import repair: deterministic likely-won email evidence.",
    });
    if (result.converted && !result.linkedExisting && decidedBy) {
      await createProjectCreatedNotification({
        userId: decidedBy,
        companyId: company.id,
        projectId: result.projectId,
        opportunityTitle: candidate.opportunity.title,
        candidate,
      });
    }
    candidate.applyResults.push(
      `converted opportunity ${candidate.opportunity.id} to project ${result.projectId}`
    );
  } catch (err) {
    candidate.applyErrors.push(
      `conversion ${candidate.opportunity.id}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function convertOpportunityToProjectForRepair(params: {
  opportunityId: string;
  companyId: string;
  decidedBy?: string | null;
  actualValue?: number | null;
  expectedStage?: string | null;
  notesSeed?: string | null;
}): Promise<RepairConversionResult> {
  const { data, error } = await sb.rpc(CONVERSION_RPC, {
    p_company_id: params.companyId,
    p_opportunity_id: params.opportunityId,
    p_actual_value: params.actualValue ?? null,
    p_expected_stage: params.expectedStage ?? null,
    p_decided_by: params.decidedBy ?? null,
    p_notes: params.notesSeed ?? null,
    p_title_override: null,
    p_link_to_project_id: null,
    p_source_path: "won_dialog",
    p_win_opportunity: true,
  });

  if (error) {
    throw new Error(`Project conversion RPC failed: ${error.message}`);
  }

  const result = (data ?? {}) as UnifiedConversionResult;
  if (!result.converted && result.guard_reason === "snapshot_mismatch") {
    throw new Error("Opportunity changed before conversion completed");
  }

  if (!result.converted && result.already_converted) {
    return {
      converted: false,
      alreadyConverted: true,
      projectId: result.project_id ?? "",
      opportunityId: params.opportunityId,
      linkedExisting: Boolean(result.linked_existing),
    };
  }

  return {
    converted: Boolean(result.converted),
    alreadyConverted: false,
    projectId: result.project_id ?? "",
    opportunityId: params.opportunityId,
    linkedExisting: Boolean(result.linked_existing),
  };
}

async function createProjectCreatedNotification(params: {
  userId: string;
  companyId: string;
  projectId: string;
  opportunityTitle: string;
  candidate: CandidateReport;
}): Promise<void> {
  const { error } = await sb.rpc(NOTIFICATION_RPC, {
    p_user_id: params.userId,
    p_company_id: params.companyId,
    p_type: "mention",
    p_title: "Project created",
    p_body: `Created from ${params.opportunityTitle || "an opportunity"}`,
    p_persistent: false,
    p_action_url: `/dashboard?openProject=${params.projectId}&mode=view`,
    p_action_label: "View Project",
    p_project_id: params.projectId,
  });

  if (error) {
    params.candidate.applyErrors.push(
      `notification ${params.projectId}: ${error.message}`
    );
  }
}

function renderReport(input: {
  company: CompanyRow;
  users: UserRow[];
  connections: EmailConnectionRow[];
  opportunityCount: number;
  activityCount: number;
  candidates: CandidateReport[];
  duplicateOnlyCount: number;
}): string {
  const totalPlans = input.candidates.reduce(
    (sum, candidate) => sum + candidate.plans.length,
    0
  );
  const totalErrors = input.candidates.reduce(
    (sum, candidate) => sum + candidate.applyErrors.length,
    0
  );
  const lines: string[] = [];

  lines.push("# Lead Import Parsing Repair Audit");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Company: ${input.company.name} (${input.company.id})`);
  lines.push(`- Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  lines.push(`- Opportunities scanned: ${input.opportunityCount}`);
  lines.push(
    `- Opportunity ID filter: ${OPPORTUNITY_IDS.length > 0 ? OPPORTUNITY_IDS.map(md).join(", ") : "-"}`
  );
  lines.push(`- Email activities scanned: ${input.activityCount}`);
  lines.push(`- Candidates: ${input.candidates.length}`);
  lines.push(`- Planned repair actions: ${totalPlans}`);
  lines.push(`- Duplicate-only candidates: ${input.duplicateOnlyCount}`);
  lines.push(`- Apply errors: ${totalErrors}`);
  lines.push("");
  lines.push("## Hard-Stop Proof");
  lines.push("");
  lines.push("- Emails sent: no.");
  lines.push("- Provider drafts created: no.");
  lines.push("- Duplicate merges performed: no.");
  lines.push(
    APPLY
      ? "- Live writes: yes, limited to planned contact-field repairs and likely-won project conversion."
      : "- Live writes: no."
  );
  lines.push("");
  lines.push("## Internal Exclusion Context");
  lines.push("");
  lines.push(
    `- Connected mailboxes: ${
      input.connections
        .map((connection) => connection.email)
        .filter(Boolean)
        .map(md)
        .join(", ") || "-"
    }`
  );
  lines.push(
    `- Company/user contacts loaded: ${input.users.length} user(s), company phone ${
      input.company.phone ? "present" : "missing"
    }, company address ${input.company.address || input.company.physical_address ? "present" : "missing"}`
  );
  lines.push("");
  lines.push("## Candidate Summary");
  lines.push("");
  lines.push(
    "| Opportunity | Client | Stage | Reasons | Extracted Address | Extracted Phone | Plans |"
  );
  lines.push("|---|---|---:|---|---|---|---|");
  for (const candidate of input.candidates) {
    lines.push(
      [
        candidate.opportunity.id,
        candidate.client?.name ?? candidate.opportunity.contact_name ?? "-",
        candidate.opportunity.stage,
        candidate.suspiciousReasons.join("; ") || "-",
        candidate.extractedAddress ?? "-",
        candidate.extractedPhone ?? "-",
        candidate.plans
          .map((plan) => `${plan.kind}:${plan.after}`)
          .join("; ") || "-",
      ]
        .map(md)
        .join("|")
        .replace(/^/, "|")
        .concat("|")
    );
  }
  lines.push("");

  for (const candidate of input.candidates) {
    lines.push(`## ${candidate.opportunity.title}`);
    lines.push("");
    lines.push(`- Opportunity: ${candidate.opportunity.id}`);
    lines.push(
      `- Client: ${candidate.client?.id ?? "-"} (${md(candidate.client?.name)})`
    );
    lines.push(
      `- Contact: ${md(candidate.opportunity.contact_name)} / ${md(candidate.opportunity.contact_email)} / ${md(candidate.opportunity.contact_phone)}`
    );
    lines.push(`- Address: ${md(candidate.opportunity.address)}`);
    lines.push(`- Stage: ${candidate.opportunity.stage}`);
    lines.push(`- Target hit: ${candidate.targetHit ? "yes" : "no"}`);
    lines.push(`- Related threads: ${candidate.threads.length}`);
    lines.push(`- Related activities: ${candidate.activityCount}`);
    lines.push(`- Extracted address: ${md(candidate.extractedAddress)}`);
    lines.push(`- Extracted phone: ${md(candidate.extractedPhone)}`);
    lines.push(`- Extracted safe name: ${md(candidate.extractedName)}`);
    lines.push(
      `- Likely-won evidence: ${candidate.terminalLikelyWon ? "yes" : "no"}`
    );
    lines.push("");
    lines.push("### Plans");
    lines.push("");
    if (candidate.plans.length === 0) {
      lines.push("- No automatic repair plan. Review only.");
    } else {
      for (const plan of candidate.plans) {
        lines.push(
          `- ${plan.kind}: ${plan.table}.${plan.field} ${md(plan.before)} -> ${md(plan.after)} (${plan.reason}; evidence ${plan.evidenceActivityId ?? "-"})`
        );
      }
    }
    lines.push("");
    if (candidate.duplicateGroups.length > 0) {
      lines.push("### Duplicate Signals");
      lines.push("");
      for (const group of candidate.duplicateGroups) {
        lines.push(
          `- ${group.reason}: ${group.opportunityIds.join(", ")} (${group.key})`
        );
      }
      lines.push("");
    }
    if (candidate.applyResults.length > 0 || candidate.applyErrors.length > 0) {
      lines.push("### Apply Results");
      lines.push("");
      for (const result of candidate.applyResults)
        lines.push(`- OK: ${result}`);
      for (const error of candidate.applyErrors)
        lines.push(`- ERROR: ${error}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main() {
  console.log("Lead import parsing repair audit");
  console.log("  mode:             ", APPLY ? "APPLY" : "DRY-RUN");
  console.log("  company id:       ", COMPANY_ID ?? "-");
  console.log("  company name:     ", COMPANY_ID ? "-" : COMPANY_NAME);
  console.log(
    "  opportunity ids:  ",
    OPPORTUNITY_IDS.length > 0 ? OPPORTUNITY_IDS.join(", ") : "-"
  );
  console.log("  max opportunities:", MAX_OPPORTUNITIES);
  console.log("  max activities:   ", MAX_ACTIVITIES);
  console.log("  output:           ", OUTPUT_PATH);
  console.log();

  const company = await fetchCompany();
  const [users, connections, opportunities] = await Promise.all([
    fetchUsers(company.id),
    fetchConnections(company.id),
    fetchOpportunities(company.id),
  ]);
  const clientIds = opportunities
    .map((opp) => opp.client_id)
    .filter((id): id is string => Boolean(id));
  const clientsById = await fetchClients(clientIds);
  const opportunityIds = opportunities.map((opp) => opp.id);
  const threadLinks = await fetchThreadLinks(opportunityIds);
  const linkedProviderThreadIds = threadLinks.map((link) => link.thread_id);
  const [threads, activities] = await Promise.all([
    fetchThreads(company.id, opportunityIds, linkedProviderThreadIds),
    fetchActivities(company.id),
  ]);

  const { internalEmails, internalPhones, internalNameKeys, companyAddresses } =
    deriveInternalSets(company, users, connections);
  const companyAddressKeys = new Set(
    companyAddresses
      .map((address) => normalizeAddressKey(address))
      .filter((address): address is string => Boolean(address))
  );

  const threadsByOpp = new Map<string, EmailThreadRow[]>();
  const threadByProviderId = new Map<string, EmailThreadRow>();
  const connectionByThread = new Map<string, EmailConnectionRow>();
  const connectionsById = new Map(
    connections.map((connection) => [connection.id, connection])
  );
  const opportunityIdSet = new Set(opportunityIds);
  const oppIdsByProviderThreadId = new Map<string, Set<string>>();
  for (const thread of threads) {
    threadByProviderId.set(thread.provider_thread_id, thread);
    if (thread.opportunity_id) {
      const list = threadsByOpp.get(thread.opportunity_id) ?? [];
      list.push(thread);
      threadsByOpp.set(thread.opportunity_id, list);
    }
    const connection = connectionsById.get(thread.connection_id);
    if (connection) connectionByThread.set(thread.id, connection);
  }
  for (const link of threadLinks) {
    const thread = threadByProviderId.get(link.thread_id);
    if (!thread) continue;
    const list = threadsByOpp.get(link.opportunity_id) ?? [];
    if (!list.some((existing) => existing.id === thread.id)) list.push(thread);
    threadsByOpp.set(link.opportunity_id, list);
  }

  const activitiesByOpp = new Map<string, ActivityRow[]>();
  const providerThreadIdsByOpp = new Map<string, Set<string>>();
  for (const [oppId, oppThreads] of threadsByOpp) {
    const providerIds = new Set(
      oppThreads.map((thread) => thread.provider_thread_id)
    );
    providerThreadIdsByOpp.set(oppId, providerIds);
    for (const providerId of providerIds) {
      const set = oppIdsByProviderThreadId.get(providerId) ?? new Set<string>();
      set.add(oppId);
      oppIdsByProviderThreadId.set(providerId, set);
    }
  }

  for (const activity of activities) {
    if (
      activity.opportunity_id &&
      opportunityIdSet.has(activity.opportunity_id)
    ) {
      const list = activitiesByOpp.get(activity.opportunity_id) ?? [];
      list.push(activity);
      activitiesByOpp.set(activity.opportunity_id, list);
    }
    if (activity.email_thread_id) {
      for (const oppId of oppIdsByProviderThreadId.get(
        activity.email_thread_id
      ) ?? []) {
        const list = activitiesByOpp.get(oppId) ?? [];
        if (!list.some((existing) => existing.id === activity.id)) {
          list.push(activity);
        }
        activitiesByOpp.set(oppId, list);
      }
    }
  }

  const duplicateGroupsByOpp = buildDuplicateGroups(
    opportunities,
    clientsById,
    internalEmails,
    internalPhones
  );

  const candidates = opportunities
    .map((opp) =>
      analyzeOpportunity({
        opp,
        client: opp.client_id ? (clientsById.get(opp.client_id) ?? null) : null,
        threads: threadsByOpp.get(opp.id) ?? [],
        activities: activitiesByOpp.get(opp.id) ?? [],
        duplicateGroups: duplicateGroupsByOpp.get(opp.id) ?? [],
        internalEmails,
        internalPhones,
        internalNameKeys,
        companyAddressKeys,
      })
    )
    .filter(
      (candidate) =>
        OPPORTUNITY_ID_SET.size === 0 ||
        OPPORTUNITY_ID_SET.has(candidate.opportunity.id)
    )
    .filter(
      (candidate) =>
        candidate.targetHit ||
        candidate.plans.length > 0 ||
        candidate.duplicateGroups.length > 0 ||
        candidate.suspiciousReasons.length > 0
    )
    .sort((left, right) => {
      const leftScore =
        (left.targetHit ? 100 : 0) +
        left.plans.length * 10 +
        (left.terminalLikelyWon ? 20 : 0) +
        left.duplicateGroups.length;
      const rightScore =
        (right.targetHit ? 100 : 0) +
        right.plans.length * 10 +
        (right.terminalLikelyWon ? 20 : 0) +
        right.duplicateGroups.length;
      return rightScore - leftScore;
    });

  if (APPLY) {
    for (const candidate of candidates) {
      if (candidate.plans.length === 0) continue;
      await applyCandidate(candidate, connectionByThread, company);
    }
  }

  const artifact = renderReport({
    company,
    users,
    connections,
    opportunityCount: opportunities.length,
    activityCount: activities.length,
    candidates,
    duplicateOnlyCount: candidates.filter(
      (candidate) =>
        candidate.plans.length === 0 && candidate.duplicateGroups.length > 0
    ).length,
  });

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, artifact);

  console.log(`Candidates: ${candidates.length}`);
  console.log(
    `Plans: ${candidates.reduce((sum, candidate) => sum + candidate.plans.length, 0)}`
  );
  console.log(
    `Apply errors: ${candidates.reduce((sum, candidate) => sum + candidate.applyErrors.length, 0)}`
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
