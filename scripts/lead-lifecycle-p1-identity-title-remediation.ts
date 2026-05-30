/*
 * Lead Lifecycle P1 — Identity / Title remediation (DW3 identity-title workstream).
 *
 * Scope (CONFIRMED LIVE against prod ijeekuhbatykdomumfjx, company Canpro a612edc0-...):
 *  - opportunities whose title carries operator / company-self / platform-sender identity
 *    instead of the real customer identity.
 *  - clients that are the company itself (self-owned) or a platform sender, contaminating
 *    customer-facing identity.
 *
 * Classification:
 *  - CONFIDENT-FIX: re-derive an opportunity title from its real (non-self, non-platform)
 *    client identity using the SAME production helper buildEmailOpportunityTitle. The rewrite
 *    is deterministic, reversible, and reads only existing client fields — it never invents a
 *    customer. Only emitted when the re-derived identity is a real name (NOT the "New Lead"
 *    fallback), i.e. the title genuinely changes to a real customer.
 *  - QUARANTINE (operator-reviewed, never auto-written here):
 *      (a) opportunities whose ONLY identity is a self/platform client (re-derivation collapses
 *          to "New Lead" — there is no recoverable customer; relabeling needs the underlying
 *          lead re-pointed to its true customer, which is the matching problem, not a relabel).
 *      (b) the self-owned client and any platform-sender client that OWNS opportunities/activities
 *          — nulling/relabeling identity that owns real rows requires re-pointing first.
 *  - FLAG (operator classification): platform-sender clients that own nothing but still must be
 *    manually classified before any relabel (their sender pattern may not be in known-platforms).
 *
 * Apply allow-list (apply mode NEVER run by this dry-run): opportunities, clients ONLY (title/name fields).
 *
 * Emails sent: no. Provider drafts created: no. Opportunity stage/business state changed: no.
 * Schema migrations: no. iOS-synced hard constraints: none touched.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-p1-identity-title-remediation.ts            # dry-run
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-p1-identity-title-remediation.ts --apply    # GATED, not run here
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  buildEmailOpportunityTitle,
  type EmailOpportunityUnsafeIdentity,
} from "../src/lib/email/opportunity-title";
import { matchPlatform } from "../src/lib/api/services/known-platforms";

const ENV_DIR = process.env.OPS_WEB_ENV_DIR || process.cwd();
loadEnvConfig(ENV_DIR);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const APPLY = process.argv.includes("--apply");
const outputArgIdx = process.argv.indexOf("--output");
const DEFAULT_DRY_RUN_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-identity-title-dry-run-2026-05-29.md";
const DEFAULT_APPLY_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-identity-title-apply-2026-05-29.md";
const OUTPUT_PATH =
  outputArgIdx >= 0
    ? process.argv[outputArgIdx + 1]
    : APPLY
      ? DEFAULT_APPLY_OUTPUT
      : DEFAULT_DRY_RUN_OUTPUT;

// Apply mode is restricted to these tables. This script only ever rewrites:
//   opportunities.title  and  clients.name / clients.email
// No other table or column is touched in either mode.
const APPLY_TABLE_ALLOW_LIST = ["opportunities", "clients"] as const;

// Company under remediation (Canpro Deck and Rail) — confirmed live.
const CANPRO_COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const CANPRO_DOMAIN = "canprodeckandrail.com";

// The aggregate "New Lead — Email Inquiry" opportunity is owned by DW1, not this workstream.
const DW1_AGGREGATE_OPP_ID = "a760f45f-d772-4cbf-9e34-03a113aabef2";

// Broad platform-sender heuristic (Postgres regex equivalent) used in addition to
// known-platforms.ts matchPlatform, to surface senders not yet in the registry.
const PLATFORM_HEURISTIC_RE = /(notification|noreply|no-reply|mailer|@com[0-9])/i;
const PLATFORM_DOMAIN_SUFFIXES = [
  ".smartbidnet.com",
  ".buildertrend.com",
];

interface OpportunityRow {
  id: string;
  title: string | null;
  stage: string | null;
  source: string | null;
  archived_at: string | null;
  client_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
}

interface ClientRow {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  deleted_at: string | null;
}

type Classification = "confident-fix" | "quarantine" | "flag";

interface TitlePlanRow {
  oppId: string;
  stage: string | null;
  archived: boolean;
  clientId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  currentTitle: string | null;
  proposedTitle: string;
  classification: Classification;
  reason: string;
}

interface ClientPlanRow {
  clientId: string;
  name: string | null;
  email: string | null;
  contamination: "self" | "platform";
  ownsOpps: number;
  ownsActivities: number;
  currentName: string | null;
  proposedName: string | null; // null = no auto change proposed (quarantine/flag)
  currentEmail: string | null;
  proposedEmail: string | null; // null = no auto change proposed
  classification: Classification;
  reason: string;
}

function md(value: unknown): string {
  const text = value == null || value === "" ? "—" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function isCompanySelfEmail(email: string | null): boolean {
  if (!email) return false;
  return email.toLowerCase().trim().endsWith(`@${CANPRO_DOMAIN}`);
}

function isPlatformEmail(email: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  if (matchPlatform(lower) !== null) return true;
  if (PLATFORM_HEURISTIC_RE.test(lower)) return true;
  const domain = lower.split("@")[1] ?? "";
  return PLATFORM_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

/**
 * Build the unsafe-identity set used by buildEmailOpportunityTitle, fully populated
 * from the live operator/team roster + company identity + the known contaminating
 * platform senders. Sourced from prod (users table for Canpro) on 2026-05-29.
 */
function buildUnsafeIdentity(): EmailOpportunityUnsafeIdentity {
  return {
    names: [
      "Jackson Sweet",
      "jacky sweet",
      "Michael Truong",
      "Jake Strickler",
      "Charlie Gatenby",
      "Matthew Schure",
      "Harrison Sweet",
      "Jason Zavarella",
      "Test User",
      "Owen Works",
      "Office Victoria",
      "Canpro Deck and Rail",
      "Canpro",
    ],
    emails: [
      "canprojack@gmail.com",
      "michael.truong1231@gmail.com",
      "jacobjstrickler@gmail.com",
      "charliejesse.gatenby@gmail.com",
      "jackjack2000@email.com",
      "mattyschure@yahoo.ca",
      "h4rrison.sweet@gmail.com",
      "fourseasonscontracting705@gmail.com",
      "j4ckson.sweet@gmail.com",
      "test010202@email.com",
      "oworks@playdopa.co",
      `victoria@${CANPRO_DOMAIN}`,
    ],
    domains: [CANPRO_DOMAIN],
    platformEmails: [
      "notifications@com2.smartbidnet.com",
      "lidahomes@buildertrend.com",
    ],
  };
}

async function fetchActiveOpportunities(): Promise<OpportunityRow[]> {
  const { data, error } = await sb
    .from("opportunities")
    .select(
      "id, title, stage, source, archived_at, client_id, contact_name, contact_email"
    )
    .eq("company_id", CANPRO_COMPANY_ID)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as OpportunityRow[];
}

async function fetchClientsById(ids: string[]): Promise<Map<string, ClientRow>> {
  const map = new Map<string, ClientRow>();
  if (ids.length === 0) return map;
  const { data, error } = await sb
    .from("clients")
    .select("id, name, email, created_at, deleted_at")
    .in("id", ids);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ClientRow[]) map.set(row.id, row);
  return map;
}

async function countOwnership(clientId: string): Promise<{ opps: number; activities: number }> {
  const { count: oppCount, error: oppErr } = await sb
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (oppErr) throw new Error(oppErr.message);
  const { count: actCount, error: actErr } = await sb
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (actErr) throw new Error(actErr.message);
  return { opps: oppCount ?? 0, activities: actCount ?? 0 };
}

/**
 * Determine whether an opportunity's title is contaminated and, if so, what the
 * correct title would be after re-derivation from its real client identity.
 */
function planTitle(
  opp: OpportunityRow,
  client: ClientRow | null,
  unsafe: EmailOpportunityUnsafeIdentity
): TitlePlanRow | null {
  const currentTitle = opp.title;
  if (!currentTitle) return null;

  const clientName = client?.name ?? null;
  const clientEmail = client?.email ?? null;

  const clientIsSelf = isCompanySelfEmail(clientEmail);
  const clientIsPlatform = isPlatformEmail(clientEmail);

  // Title contamination signals:
  //  - operator/company prefix in the title itself, OR
  //  - the owning client is self/platform (title was minted from a contaminated sender).
  const titleLooksContaminated =
    /^jackson sweet/i.test(currentTitle) ||
    /^office victoria/i.test(currentTitle) ||
    clientIsSelf ||
    clientIsPlatform;

  if (!titleLooksContaminated) return null;

  // Re-derive using the production helper from the real client identity.
  const proposedTitle = buildEmailOpportunityTitle({
    kind: "email_inquiry",
    candidates: [
      { source: "client", name: clientName, email: clientEmail },
      // contact_* on the opp can supply a fallback identity if present.
      { source: "contact", name: opp.contact_name, email: opp.contact_email },
    ],
    unsafe,
  });

  const archived = opp.archived_at !== null;
  const rederivedToFallback = proposedTitle === "New Lead — Email Inquiry";

  // CONFIDENT-FIX: re-derivation produced a real (non-fallback) customer identity AND
  // it differs from the current title. The client is itself NOT self/platform (otherwise
  // there is no real customer to fill from).
  if (
    !rederivedToFallback &&
    proposedTitle !== currentTitle &&
    !clientIsSelf &&
    !clientIsPlatform
  ) {
    return {
      oppId: opp.id,
      stage: opp.stage,
      archived,
      clientId: opp.client_id,
      clientName,
      clientEmail,
      currentTitle,
      proposedTitle,
      classification: "confident-fix",
      reason: "re-derived from real client identity (deterministic, reversible)",
    };
  }

  // QUARANTINE: the only identity is a self/platform client (re-derivation collapses to
  // "New Lead"), or the client itself is contaminated. The underlying lead must be
  // re-pointed to its true customer (matching problem) before any relabel — do NOT auto-write.
  if (clientIsSelf || clientIsPlatform || rederivedToFallback) {
    return {
      oppId: opp.id,
      stage: opp.stage,
      archived,
      clientId: opp.client_id,
      clientName,
      clientEmail,
      currentTitle,
      proposedTitle,
      classification: "quarantine",
      reason: clientIsSelf
        ? "owning client is the company itself (self) — no recoverable customer identity"
        : clientIsPlatform
          ? "owning client is a platform sender — true customer lives in correspondence, needs re-point"
          : "re-derivation collapses to New Lead fallback — no recoverable customer identity",
    };
  }

  // Title looked contaminated by prefix but re-derivation == current (no change). Skip.
  return null;
}

async function fetchContaminatedClients(): Promise<ClientRow[]> {
  const { data, error } = await sb
    .from("clients")
    .select("id, name, email, created_at, deleted_at")
    .eq("company_id", CANPRO_COMPANY_ID)
    .is("deleted_at", null)
    .not("email", "is", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClientRow[];
  return rows.filter(
    (row) =>
      (row.email ?? "").trim() !== "" &&
      (isCompanySelfEmail(row.email) || isPlatformEmail(row.email))
  );
}

async function planClients(): Promise<ClientPlanRow[]> {
  const contaminated = await fetchContaminatedClients();
  const plans: ClientPlanRow[] = [];
  for (const client of contaminated) {
    const contamination: "self" | "platform" = isCompanySelfEmail(client.email)
      ? "self"
      : "platform";
    const { opps, activities } = await countOwnership(client.id);

    // Per DW3: every contaminated client that owns real rows is QUARANTINE (relabel/null
    // requires re-pointing the owned opportunity to its true customer first). A platform
    // client that owns nothing is FLAG (operator must classify the sender pattern before
    // any relabel). No auto-write is proposed in either case — proposedName/Email = null.
    const ownsAnything = opps > 0 || activities > 0;
    const classification: Classification =
      ownsAnything || contamination === "self" ? "quarantine" : "flag";

    const reason =
      contamination === "self"
        ? "self-owned client (company's own email/domain); owns real opportunity — re-point required before relabel"
        : ownsAnything
          ? "platform-sender client owning real rows — true customer lives in correspondence; re-point required before relabel"
          : "platform-sender client owning nothing — operator must confirm classification (sender may be outside known-platforms registry)";

    plans.push({
      clientId: client.id,
      name: client.name,
      email: client.email,
      contamination,
      ownsOpps: opps,
      ownsActivities: activities,
      currentName: client.name,
      proposedName: null,
      currentEmail: client.email,
      proposedEmail: null,
      classification,
      reason,
    });
  }
  return plans;
}

async function applyTitlePlans(plans: TitlePlanRow[]) {
  // GATED: only confident-fix title rewrites are eligible. Allow-list: opportunities.title.
  for (const plan of plans) {
    if (plan.classification !== "confident-fix") continue;
    if (plan.oppId === DW1_AGGREGATE_OPP_ID) continue; // owned by DW1
    const { error } = await sb
      .from("opportunities")
      .update({ title: plan.proposedTitle })
      .eq("id", plan.oppId)
      .eq("company_id", CANPRO_COMPANY_ID); // defensive: never touch another company
    if (error) throw new Error(error.message);
  }
  // Client plans are NEVER auto-applied (all quarantine/flag). No clients write occurs.
}

function hardStopProof(apply: boolean): string {
  return [
    "## Hard-Stop Proof",
    "",
    `- Mode: ${apply ? "apply" : "dry-run"}.`,
    "- Writes performed by this dry-run run: NONE (read-only SELECT + count only).",
    "- Emails sent: no.",
    "- Provider drafts created: no.",
    "- Opportunity stage / pipeline / business state changed: no.",
    "- Client rows created, merged, deleted, or relabeled: no.",
    "- Schema migrations / CHECK / unique-index added: no.",
    "- iOS-synced hard constraints touched: none.",
    `- Apply-mode table allow-list (only these would ever be written): ${APPLY_TABLE_ALLOW_LIST.join(", ")}.`,
    "- Apply-mode writes are restricted to: opportunities.title (confident-fix only) — clients are never auto-written (all quarantine/flag).",
    `- DW1 aggregate opportunity ${DW1_AGGREGATE_OPP_ID} is excluded (owned by DW1).`,
    "- No customer identity is fabricated: titles are re-derived only from existing client fields via the production buildEmailOpportunityTitle helper.",
  ].join("\n");
}

function renderArtifact(
  titlePlans: TitlePlanRow[],
  clientPlans: ClientPlanRow[],
  apply: boolean
): string {
  const confident = titlePlans.filter((p) => p.classification === "confident-fix");
  const quarantineTitles = titlePlans.filter((p) => p.classification === "quarantine");
  const quarantineClients = clientPlans.filter((p) => p.classification === "quarantine");
  const flagClients = clientPlans.filter((p) => p.classification === "flag");

  return [
    `# Lead Lifecycle P1 — Identity / Title Remediation ${apply ? "Apply" : "Dry Run"}`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${apply ? "apply" : "dry-run"}`,
    `Company: Canpro Deck and Rail (${CANPRO_COMPANY_ID})`,
    "Workstream: DW3 identity-title-contamination",
    "",
    "## Summary — exact affected-row counts",
    "",
    `- Opportunity titles scanned (active, Canpro): see table totals below.`,
    `- CONFIDENT-FIX opportunity title rewrites: ${confident.length}`,
    `- QUARANTINE opportunity titles (operator-reviewed, NOT auto-written): ${quarantineTitles.length}`,
    `- QUARANTINE contaminated clients (own real rows; NOT auto-written): ${quarantineClients.length}`,
    `- FLAG contaminated clients (operator classification needed; NOT auto-written): ${flagClients.length}`,
    `- Total rows that apply-mode WOULD change: ${confident.length} (opportunities.title only).`,
    "",
    "## Apply-mode table allow-list",
    "",
    `\`${APPLY_TABLE_ALLOW_LIST.join("`, `")}\` — and within those, only \`opportunities.title\` (confident-fix) is auto-written. \`clients\` rows are surfaced for operator review only; no clients column is auto-written.`,
    "",
    hardStopProof(apply),
    "",
    "## CONFIDENT-FIX — opportunity title re-derivation",
    "",
    "Deterministic rewrite from the opportunity's real client identity via the production `buildEmailOpportunityTitle` helper. Reversible; reads only existing client fields; never invents a customer.",
    "",
    "| opportunity_id | stage | archived | client_id | client_name | client_email | current_title | proposed_title |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...confident.map(
      (p) =>
        `| ${md(p.oppId)} | ${md(p.stage)} | ${p.archived ? "yes" : "no"} | ${md(p.clientId)} | ${md(p.clientName)} | ${md(p.clientEmail)} | ${md(p.currentTitle)} | ${md(p.proposedTitle)} |`
    ),
    "",
    "## QUARANTINE — opportunity titles (operator-reviewed, NOT auto-written)",
    "",
    "Re-derivation cannot recover a real customer (self/platform-owned, or collapses to the New Lead fallback). The underlying lead must be re-pointed to its true customer (the matching problem, out of P1 scope) before any relabel.",
    "",
    "| opportunity_id | stage | archived | client_id | client_name | client_email | current_title | rederived_title | reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...quarantineTitles.map(
      (p) =>
        `| ${md(p.oppId)} | ${md(p.stage)} | ${p.archived ? "yes" : "no"} | ${md(p.clientId)} | ${md(p.clientName)} | ${md(p.clientEmail)} | ${md(p.currentTitle)} | ${md(p.proposedTitle)} | ${md(p.reason)} |`
    ),
    "",
    "## QUARANTINE — contaminated clients (own real rows, NOT auto-written)",
    "",
    "| client_id | contamination | name | email | owns_active_opps | owns_activities | proposed_name | proposed_email | reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...quarantineClients.map(
      (p) =>
        `| ${md(p.clientId)} | ${md(p.contamination)} | ${md(p.name)} | ${md(p.email)} | ${p.ownsOpps} | ${p.ownsActivities} | ${md(p.proposedName)} | ${md(p.proposedEmail)} | ${md(p.reason)} |`
    ),
    "",
    "## FLAG — contaminated clients (operator classification needed, NOT auto-written)",
    "",
    "| client_id | contamination | name | email | owns_active_opps | owns_activities | reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...flagClients.map(
      (p) =>
        `| ${md(p.clientId)} | ${md(p.contamination)} | ${md(p.name)} | ${md(p.email)} | ${p.ownsOpps} | ${p.ownsActivities} | ${md(p.reason)} |`
    ),
    "",
  ].join("\n");
}

async function writeArtifact(markdown: string) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);
}

async function main() {
  const unsafe = buildUnsafeIdentity();

  const opportunities = await fetchActiveOpportunities();
  const clientIds = Array.from(
    new Set(opportunities.map((o) => o.client_id).filter(Boolean))
  ) as string[];
  const clientsById = await fetchClientsById(clientIds);

  const titlePlans: TitlePlanRow[] = [];
  for (const opp of opportunities) {
    if (opp.id === DW1_AGGREGATE_OPP_ID) continue; // owned by DW1
    const client = opp.client_id ? clientsById.get(opp.client_id) ?? null : null;
    const plan = planTitle(opp, client, unsafe);
    if (plan) titlePlans.push(plan);
  }
  titlePlans.sort((a, b) => {
    if (a.classification !== b.classification)
      return a.classification.localeCompare(b.classification);
    return a.oppId.localeCompare(b.oppId);
  });

  const clientPlans = await planClients();
  clientPlans.sort((a, b) => {
    if (a.classification !== b.classification)
      return a.classification.localeCompare(b.classification);
    return a.clientId.localeCompare(b.clientId);
  });

  if (APPLY) {
    await applyTitlePlans(titlePlans);
  }

  await writeArtifact(renderArtifact(titlePlans, clientPlans, APPLY));

  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);
  console.log(
    `confident-fix titles=${titlePlans.filter((p) => p.classification === "confident-fix").length} ` +
      `quarantine titles=${titlePlans.filter((p) => p.classification === "quarantine").length} ` +
      `quarantine clients=${clientPlans.filter((p) => p.classification === "quarantine").length} ` +
      `flag clients=${clientPlans.filter((p) => p.classification === "flag").length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
