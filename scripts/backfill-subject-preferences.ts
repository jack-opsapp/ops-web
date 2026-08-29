#!/usr/bin/env tsx

/**
 * Seed `agent_writing_profiles.subject_preferences` from mail the operator has
 * already sent (bug 4da75e71).
 *
 * The subject learner only sees sends that happen after it ships, and the read
 * side needs a pattern to recur three times before it will speak for the
 * operator. Without a backfill, a mailbox with years of history would still
 * draft new-lead outreach under the server constant for weeks. This walks the
 * recent thread-opening sends and merges them through the SAME RPC the live
 * learner uses, so the backfilled shapes are identical to the learned ones.
 *
 * Thread-opening = the send that started its thread (nothing precedes it), or a
 * send with no inbound before it in that thread. Replies are not evidence of
 * how the operator names a NEW conversation.
 *
 * DRY RUN BY DEFAULT — nothing is written without --execute. The dry run calls
 * the merge with `p_dry_run`, so the previewed pattern is computed by the same
 * SQL that would store it, not by a lookalike in this file.
 *
 *   npx tsx scripts/backfill-subject-preferences.ts --company-id <uuid>
 *   npx tsx scripts/backfill-subject-preferences.ts --company-id <uuid> --execute
 *
 * Flags:
 *   --company-id <uuid>     Scope to one company (default: every active connection)
 *   --connection-id <uuid>  Scope to one mailbox
 *   --user-id <uuid>        Force the profile owner (default: resolved per connection)
 *   --profile-type <text>   Profile to teach (default: general)
 *   --days <n>              Lookback window in days (default: 120)
 *   --limit <n>             Max thread-opening sends to process (default: 500)
 *   --execute               Perform the merge. Without it the script writes nothing.
 */

import { createClient } from "@supabase/supabase-js";

import { normalizeLearnedSubjectExample } from "../src/lib/email/email-subject-policy";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CliArgs {
  companyId: string | null;
  connectionId: string | null;
  userId: string | null;
  profileType: string;
  days: number;
  limit: number;
  execute: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    companyId: null,
    connectionId: null,
    userId: null,
    profileType: "general",
    days: 120,
    limit: 500,
    execute: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const requireValue = () => {
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      index += 1;
      return value;
    };
    const requireUuid = () => {
      const uuid = requireValue();
      if (!UUID_PATTERN.test(uuid)) throw new Error(`${flag} must be a uuid`);
      return uuid;
    };
    const requirePositiveInt = (max: number) => {
      const parsed = Number.parseInt(requireValue(), 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) {
        throw new Error(`${flag} must be between 1 and ${max}`);
      }
      return parsed;
    };

    switch (flag) {
      case "--company-id":
        args.companyId = requireUuid();
        break;
      case "--connection-id":
        args.connectionId = requireUuid();
        break;
      case "--user-id":
        args.userId = requireUuid();
        break;
      case "--profile-type":
        args.profileType = requireValue().slice(0, 64);
        break;
      case "--days":
        args.days = requirePositiveInt(730);
        break;
      case "--limit":
        args.limit = requirePositiveInt(5000);
        break;
      case "--execute":
        args.execute = true;
        break;
      case "--dry-run":
        args.execute = false;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  return args;
}

interface ConnectionRow {
  id: string;
  company_id: string;
  email: string;
  type: string;
  user_id: string | null;
  default_intake_owner_id: string | null;
}

interface ActivityRow {
  id: string;
  company_id: string;
  email_thread_id: string | null;
  opportunity_id: string | null;
  direction: string | null;
  subject: string;
  created_at: string;
}

interface OpportunityRow {
  id: string;
  title: string | null;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  client_id: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * The profile the mailbox teaches. A personal connection carries its owner; a
 * shared company mailbox names its intake owner. Neither is guessed — a
 * connection that can prove neither is skipped and reported.
 */
function resolveProfileOwner(
  connection: ConnectionRow,
  override: string | null
): string | null {
  if (override) return override;
  if (connection.user_id) return connection.user_id;
  return connection.default_intake_owner_id;
}

async function loadConnections(args: CliArgs): Promise<ConnectionRow[]> {
  let query = sb
    .from("email_connections")
    .select("id, company_id, email, type, user_id, default_intake_owner_id")
    .eq("status", "active");

  if (args.companyId) query = query.eq("company_id", args.companyId);
  if (args.connectionId) query = query.eq("id", args.connectionId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load connections: ${error.message}`);
  return (data ?? []) as ConnectionRow[];
}

async function loadWindowActivities(
  connection: ConnectionRow,
  since: string,
  limit: number
): Promise<ActivityRow[]> {
  const { data, error } = await sb
    .from("activities")
    .select(
      "id, company_id, email_thread_id, opportunity_id, direction, subject, created_at"
    )
    .eq("company_id", connection.company_id)
    .eq("email_connection_id", connection.id)
    .eq("type", "email")
    .eq("direction", "outbound")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(
      `Failed to load outbound activities for ${connection.email}: ${error.message}`
    );
  }
  return (data ?? []) as ActivityRow[];
}

/**
 * Every message in the candidate threads, window or not. A send that looks like
 * the first message of its thread only because the window clipped the thread's
 * history is a reply, and must not train the profile.
 */
async function loadThreadHistories(
  connection: ConnectionRow,
  threadIds: string[]
): Promise<Map<string, ActivityRow[]>> {
  const histories = new Map<string, ActivityRow[]>();

  for (const ids of chunk(threadIds, 100)) {
    const { data, error } = await sb
      .from("activities")
      .select(
        "id, company_id, email_thread_id, opportunity_id, direction, subject, created_at"
      )
      .eq("company_id", connection.company_id)
      .eq("email_connection_id", connection.id)
      .eq("type", "email")
      .in("email_thread_id", ids)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to load thread history: ${error.message}`);
    }

    for (const row of (data ?? []) as ActivityRow[]) {
      if (!row.email_thread_id) continue;
      const bucket = histories.get(row.email_thread_id);
      if (bucket) bucket.push(row);
      else histories.set(row.email_thread_id, [row]);
    }
  }

  return histories;
}

async function loadOpportunityContext(
  companyId: string,
  opportunityIds: string[]
): Promise<Map<string, Record<string, string>>> {
  const contexts = new Map<string, Record<string, string>>();
  if (opportunityIds.length === 0) return contexts;

  const clientIds = new Set<string>();
  const opportunities: OpportunityRow[] = [];

  for (const ids of chunk(opportunityIds, 100)) {
    const { data, error } = await sb
      .from("opportunities")
      .select("id, title, address, contact_name, contact_email, client_id")
      .eq("company_id", companyId)
      .in("id", ids);
    if (error) {
      throw new Error(`Failed to load opportunities: ${error.message}`);
    }
    for (const row of (data ?? []) as OpportunityRow[]) {
      opportunities.push(row);
      if (row.client_id) clientIds.add(row.client_id);
    }
  }

  const clientNames = new Map<string, string>();
  for (const ids of chunk([...clientIds], 100)) {
    const { data, error } = await sb
      .from("clients")
      .select("id, name")
      .eq("company_id", companyId)
      .in("id", ids);
    if (error) throw new Error(`Failed to load clients: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; name: string | null }>) {
      if (row.name) clientNames.set(row.id, row.name);
    }
  }

  for (const opportunity of opportunities) {
    const context: Record<string, string> = {};
    if (opportunity.contact_name) context.contact = opportunity.contact_name;
    if (opportunity.address) context.address = opportunity.address;
    if (opportunity.title) context.project = opportunity.title;
    if (opportunity.contact_email) context.email = opportunity.contact_email;
    const company = opportunity.client_id
      ? clientNames.get(opportunity.client_id)
      : undefined;
    if (company) context.company = company;
    contexts.set(opportunity.id, context);
  }

  return contexts;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(
    Date.now() - args.days * 24 * 60 * 60 * 1000
  ).toISOString();

  console.log(
    `[subject-backfill] mode=${args.execute ? "EXECUTE" : "DRY RUN"} window=${args.days}d profile=${args.profileType} limit=${args.limit}`
  );

  const connections = await loadConnections(args);
  if (connections.length === 0) {
    console.log("[subject-backfill] no active connections matched");
    return;
  }

  let totalMerged = 0;
  let totalSkipped = 0;

  for (const connection of connections) {
    const owner = resolveProfileOwner(connection, args.userId);
    if (!owner) {
      console.log(
        `[subject-backfill] ${connection.email}: SKIPPED — no profile owner (pass --user-id to name one)`
      );
      continue;
    }

    const outbound = await loadWindowActivities(connection, since, args.limit);
    const threadIds = [
      ...new Set(
        outbound
          .map((row) => row.email_thread_id)
          .filter((value): value is string => Boolean(value))
      ),
    ];
    const histories = await loadThreadHistories(connection, threadIds);

    const openers = outbound.filter((row) => {
      if (!row.email_thread_id) return false;
      if (!normalizeLearnedSubjectExample(row.subject)) return false;
      const history = histories.get(row.email_thread_id) ?? [];
      const earlier = history.filter(
        (message) => message.created_at < row.created_at
      );
      // Opened the thread, or spoke before any customer did.
      return (
        earlier.length === 0 ||
        !earlier.some((message) => message.direction === "inbound")
      );
    });

    const contexts = await loadOpportunityContext(
      connection.company_id,
      [
        ...new Set(
          openers
            .map((row) => row.opportunity_id)
            .filter((value): value is string => Boolean(value))
        ),
      ]
    );

    const tally = new Map<string, number>();
    let merged = 0;
    let skipped = 0;

    for (const opener of openers) {
      const context = opener.opportunity_id
        ? (contexts.get(opener.opportunity_id) ?? {})
        : {};

      const { data, error } = await sb.rpc(
        "merge_agent_writing_profile_subject_preferences",
        {
          p_company_id: connection.company_id,
          p_user_id: owner,
          p_profile_type: args.profileType,
          p_subject: opener.subject,
          p_context: context,
          p_is_thread_opening: true,
          p_dry_run: !args.execute,
        }
      );

      if (error) {
        console.error(
          `[subject-backfill] ${connection.email}: merge failed for activity ${opener.id}: ${error.message}`
        );
        skipped += 1;
        continue;
      }

      const result = (data ?? {}) as Record<string, unknown>;
      const pattern =
        typeof result.pattern === "string" ? result.pattern : null;
      if (!pattern) {
        skipped += 1;
        continue;
      }
      if (result.reason === "profile_missing") {
        console.log(
          `[subject-backfill] ${connection.email}: no ${args.profileType} profile for owner ${owner} — nothing to teach`
        );
        skipped += 1;
        continue;
      }

      tally.set(pattern, (tally.get(pattern) ?? 0) + 1);
      merged += 1;
    }

    const ranked = [...tally.entries()].sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    });

    console.log(
      `\n[subject-backfill] ${connection.email} (${connection.type}) owner=${owner}`
    );
    console.log(
      `  outbound in window: ${outbound.length}  thread-opening: ${openers.length}  ${args.execute ? "merged" : "would merge"}: ${merged}  skipped: ${skipped}`
    );
    for (const [pattern, count] of ranked.slice(0, 20)) {
      const usable = count >= 3 ? "usable" : "below the 3-send bar";
      console.log(`    ${String(count).padStart(4)}x  ${pattern}   [${usable}]`);
    }

    totalMerged += merged;
    totalSkipped += skipped;
  }

  console.log(
    `\n[subject-backfill] done — ${args.execute ? "merged" : "would merge"} ${totalMerged}, skipped ${totalSkipped}`
  );
  if (!args.execute) {
    console.log("[subject-backfill] DRY RUN: nothing was written.");
  }
}

main().catch((error) => {
  console.error("[subject-backfill] fatal:", error);
  process.exit(1);
});
