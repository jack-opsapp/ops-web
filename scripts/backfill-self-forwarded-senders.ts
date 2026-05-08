/* ── scripts/backfill-self-forwarded-senders.ts ── */
/*
 * Recovers `email_threads.latest_sender_email` / `latest_sender_name` /
 * `latest_snippet` for threads where those fields currently point at the
 * operator's own connection mailbox.
 *
 * Two pathological patterns are known to produce this state:
 *
 *   1. Forwarded leads — operator forwards a customer email from one of
 *      their own mailboxes (victoria@…) into the connected mailbox
 *      (canprojack@…). The outer From: header is the operator's address;
 *      the upstream customer is buried inside a "---------- Forwarded
 *      message ---------" block in the body.
 *
 *   2. Phantom-inbound drafts — Gmail surfaces draft autosaves and
 *      occasionally sent-mail copies under the INBOX label. The sync
 *      engine ingests them with direction='inbound' and from=<operator>,
 *      and `upsertFromEmail` then clobbers `latest_sender_email` to the
 *      operator's own address. Observed on Canpro: ~100% of recently
 *      affected threads, none of which carry a Fwd: marker — the bodies
 *      are progressive 4-second-apart draft autosaves.
 *
 * Recovery strategy:
 *   - Per thread, walk activities (most-recent first) until we find one
 *     whose effective sender is NOT the connection's own email.
 *   - "Effective sender" = upstream From: line when the activity body
 *     looks like a forward (extractForwardedSender), else the from_email
 *     column. This handles both pathologies in one pass.
 *   - Update the thread row's latest_sender_email / latest_sender_name /
 *     latest_snippet with the recovered values, and re-run the directory
 *     lookup to get the canonical name.
 *
 * Dry-run by default. Pass --apply to write. Pass --max <n> to cap the
 * number of threads processed. Pass --company-id <uuid> to scope.
 *
 *   npx tsx scripts/backfill-self-forwarded-senders.ts --company-id <uuid>
 *   npx tsx scripts/backfill-self-forwarded-senders.ts --company-id <uuid> --apply
 *   npx tsx scripts/backfill-self-forwarded-senders.ts --company-id <uuid> --apply --max 25
 *
 * The script is idempotent: a thread whose latest_sender_email is no
 * longer in the connection-emails set is filtered out before processing,
 * so re-running after a successful pass is a no-op.
 *
 * After this lands, re-run scripts/backfill-phase-c-drafts.ts for the
 * same company — threads that were silently dropped by the self-forward
 * filter (sender == operator) will now be eligible candidates.
 */

import { createClient } from "@supabase/supabase-js";
import { extractForwardedSender } from "../src/lib/utils/email-parsing";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const companyIdArgIdx = process.argv.indexOf("--company-id");
const COMPANY_ID =
  companyIdArgIdx >= 0 ? process.argv[companyIdArgIdx + 1] : null;
const maxArgIdx = process.argv.indexOf("--max");
const MAX_THREADS =
  maxArgIdx >= 0 ? parseInt(process.argv[maxArgIdx + 1], 10) : 100;

if (!COMPANY_ID) {
  console.error("Missing --company-id <uuid>");
  process.exit(1);
}
if (Number.isNaN(MAX_THREADS) || MAX_THREADS <= 0) {
  console.error("--max must be a positive integer");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

interface ThreadRow {
  id: string;
  subject: string | null;
  latest_sender_email: string | null;
  latest_sender_name: string | null;
  latest_snippet: string | null;
  connection_id: string;
  provider_thread_id: string;
  last_message_at: string;
  message_count: number;
}

interface ActivityRow {
  id: string;
  from_email: string | null;
  direction: string | null;
  subject: string | null;
  body_text: string | null;
  content: string | null;
  created_at: string;
}

/** Mirrors composeSenderName() in email-thread-service.ts but inlined so
 *  this script doesn't need the requireSupabase() wiring. */
async function resolveDirectoryName(
  senderEmail: string,
): Promise<string> {
  const lc = senderEmail.toLowerCase();
  const [clientsRes, subClientsRes, usersRes] = await Promise.all([
    sb.from("clients").select("name").eq("company_id", COMPANY_ID!).ilike("email", lc).limit(1).maybeSingle(),
    sb.from("sub_clients").select("name").eq("company_id", COMPANY_ID!).ilike("email", lc).limit(1).maybeSingle(),
    sb.from("users").select("first_name, last_name").eq("company_id", COMPANY_ID!).ilike("email", lc).limit(1).maybeSingle(),
  ]);
  if (clientsRes.data?.name) return String(clientsRes.data.name).trim();
  if (subClientsRes.data?.name) return String(subClientsRes.data.name).trim();
  if (usersRes.data) {
    const fn = (usersRes.data.first_name as string | null) ?? "";
    const ln = (usersRes.data.last_name as string | null) ?? "";
    const composed = `${fn} ${ln}`.trim();
    if (composed) return composed;
  }
  return "";
}

/**
 * Pick the most recent activity whose effective sender is NOT in the
 * operator's connection-email set. Returns null when no such activity
 * exists (extremely rare — implies the entire thread is operator-only).
 */
function pickRecoveredSender(
  activities: ActivityRow[],
  connectionEmails: Set<string>,
): { email: string; snippet: string; activity: ActivityRow } | null {
  for (const a of activities) {
    const headerEmail = (a.from_email ?? "").toLowerCase().trim();
    const body = (a.body_text || a.content || "").toString();
    const fwd = extractForwardedSender(a.subject ?? "", body);
    const candidate =
      fwd && !connectionEmails.has(fwd) ? fwd : headerEmail;
    if (!candidate || connectionEmails.has(candidate)) continue;
    const snippet = (body || "").slice(0, 400);
    return { email: candidate, snippet, activity: a };
  }
  return null;
}

async function main() {
  console.log("Self-forwarded sender backfill");
  console.log("  company_id:", COMPANY_ID);
  console.log("  max:       ", MAX_THREADS);
  console.log("  mode:      ", APPLY ? "APPLY (will write)" : "DRY-RUN");
  console.log();

  // Connection email set — used both to pick the candidate threads (where
  // latest_sender_email points at one of our own mailboxes) AND to filter
  // out activities authored by the operator when picking the recovery.
  const { data: conns, error: connsErr } = await sb
    .from("email_connections")
    .select("id, email")
    .eq("company_id", COMPANY_ID!);
  if (connsErr) {
    console.error("Failed to load connections:", connsErr.message);
    process.exit(1);
  }
  const connectionEmails = new Set(
    (conns ?? [])
      .map((c) => ((c.email as string) ?? "").toLowerCase().trim())
      .filter(Boolean),
  );
  if (connectionEmails.size === 0) {
    console.log("No email_connections found — nothing to backfill.");
    return;
  }
  console.log(
    `Connection mailboxes: ${Array.from(connectionEmails).join(", ")}`,
  );

  // Pull candidate threads — latest_sender_email matches one of our own
  // mailboxes, archived_at is null, ordered most-recent-first so urgent
  /// new-lead-stage threads land at the top of the apply pass.
  const { data: rawCandidates, error: threadErr } = await sb
    .from("email_threads")
    .select(
      "id, subject, latest_sender_email, latest_sender_name, latest_snippet, connection_id, provider_thread_id, last_message_at, message_count",
    )
    .eq("company_id", COMPANY_ID!)
    .in("latest_sender_email", Array.from(connectionEmails))
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(MAX_THREADS);

  if (threadErr) {
    console.error("Failed to load candidate threads:", threadErr.message);
    process.exit(1);
  }
  const candidates = (rawCandidates ?? []) as ThreadRow[];
  if (candidates.length === 0) {
    console.log("No candidate threads. Exiting.");
    return;
  }
  console.log(`Loaded ${candidates.length} candidate thread(s).\n`);

  let recovered = 0;
  let unchanged = 0;
  let unrecoverable = 0;
  const updates: Array<{
    id: string;
    before: string | null;
    after: string;
    name: string;
    activity: string;
  }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i];

    // Pull activities for this thread, newest first. Cap at 50 — the
    // recovery only needs the most recent non-self message; pulling more
    // would just slow the loop on degenerate threads (e.g. the 697-msg
    // aggregation we know about on Canpro).
    const { data: rawActs, error: actsErr } = await sb
      .from("activities")
      .select("id, from_email, direction, subject, body_text, content, created_at")
      .eq("company_id", COMPANY_ID!)
      .eq("type", "email")
      .eq("email_thread_id", t.provider_thread_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (actsErr) {
      console.log(`  [${t.id}] activity query failed: ${actsErr.message}`);
      continue;
    }
    const activities = (rawActs ?? []) as ActivityRow[];
    if (activities.length === 0) {
      // Nothing to recover from. The bug condition still holds but we
      // can't fix it here — likely needs a sync re-pull.
      unrecoverable++;
      continue;
    }

    const recoveredSender = pickRecoveredSender(activities, connectionEmails);
    if (!recoveredSender) {
      unrecoverable++;
      continue;
    }

    const recoveredName =
      (await resolveDirectoryName(recoveredSender.email)) || recoveredSender.email;

    if (
      recoveredSender.email === (t.latest_sender_email ?? "").toLowerCase()
    ) {
      // Sanity check — if for some reason the candidate already matched,
      // skip. Keeps the apply pass idempotent.
      unchanged++;
      continue;
    }

    updates.push({
      id: t.id,
      before: t.latest_sender_email,
      after: recoveredSender.email,
      name: recoveredName,
      activity: recoveredSender.activity.id,
    });
    recovered++;

    if (APPLY) {
      const { error: updErr } = await sb
        .from("email_threads")
        .update({
          latest_sender_email: recoveredSender.email,
          latest_sender_name: recoveredName,
          latest_snippet: recoveredSender.snippet,
        })
        .eq("id", t.id);
      if (updErr) {
        console.log(`  [${t.id}] UPDATE FAILED: ${updErr.message}`);
        continue;
      }
    }

    process.stdout.write(
      `[${i + 1}/${candidates.length}] ${t.id}: ${t.latest_sender_email} → ${recoveredSender.email} (${recoveredName})\n`,
    );
  }

  console.log("\n── Summary ─────────────────────────────────────────");
  console.log(`  recovered    : ${recovered}`);
  console.log(`  unchanged    : ${unchanged}`);
  console.log(`  unrecoverable: ${unrecoverable}  (no non-self activity in 50-newest window)`);
  console.log();

  if (!APPLY && updates.length > 0) {
    console.log("Re-run with --apply to commit the updates above.");
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
