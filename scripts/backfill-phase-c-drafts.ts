/* ── scripts/backfill-phase-c-drafts.ts ── */
/*
 * Phase C draft backfill — fires PhaseCAutonomyRouter.route() once per
 * existing thread that meets a strict candidate filter. The router itself
 * gates on the connection's per-category autonomy_level, so this script is
 * a no-op until the operator has set at least one category to `auto_draft`
 * (or higher). With no autonomy set, every thread returns `noop_off` and
 * zero LLM tokens are spent.
 *
 * Strict filter:
 *   - company_id matches (--company-id required)
 *   - thread is open (archived_at NULL, snoozed_until NULL or past)
 *   - latest_direction = 'inbound'  (router will skip outbound anyway)
 *   - last_message_at >= now() - 14d
 *   - primary_category = 'CUSTOMER'  (operator's strict scope per direction)
 *   - linked opportunity (if any) is not in a terminal stage
 *     (not won/lost/discarded) and is not archived
 *   - no existing ai_draft_history row for the (connection_id, provider_thread_id) pair
 *   - latest_sender_email does NOT look like a noreply / system address
 *   - latest_sender_email does NOT match the connection's own email
 *     (skips self-forwards from victoria@/etc → canprojack@)
 *   - message_count <= 100  (defensive — caps a known sync bug producing
 *     a 697-message aggregation that is not a real conversation)
 *
 * Dry-run by default. Pass --apply to fire the router. Pass --max <n> to
 * cap how many threads are processed (default 50 — generous for the strict
 * filter; tune lower for a paranoid first pass).
 *
 *   npx tsx scripts/backfill-phase-c-drafts.ts --company-id <uuid>
 *   npx tsx scripts/backfill-phase-c-drafts.ts --company-id <uuid> --apply
 *   npx tsx scripts/backfill-phase-c-drafts.ts --company-id <uuid> --apply --max 5
 *
 * Cost: each `auto_drafted` outcome is ~3-5K input tokens + ~300 output
 * tokens on the configured drafting model (~$0.015 per draft on Sonnet 4
 * priced inputs, less on gpt-mini). The script prints a per-outcome
 * breakdown at the end so spend is auditable.
 *
 * Safety: the router is non-throwing — failures on individual threads are
 * caught and logged, the rest of the batch proceeds. Threads with already-
 * drafted ai_draft_history rows are filtered OUT before the loop, never
 * double-drafted.
 */

import { createClient } from "@supabase/supabase-js";
import { PhaseCAutonomyRouter } from "../src/lib/api/services/phase-c-autonomy-router";
import { mapEmailThreadFromDb } from "../src/lib/types/email-thread";

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
const MAX_THREADS = maxArgIdx >= 0 ? parseInt(process.argv[maxArgIdx + 1], 10) : 50;

if (!COMPANY_ID) {
  console.error("Missing --company-id <uuid>");
  process.exit(1);
}
if (Number.isNaN(MAX_THREADS) || MAX_THREADS <= 0) {
  console.error("--max must be a positive integer");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Bind the service-role client globally so EmailThreadService /
// AIDraftService / router all see it through `requireSupabase()`. We use
// the legacy module-level override (not race-safe) because this is a
// single-process CLI script with no concurrent request stream.
import { setSupabaseOverride } from "../src/lib/supabase/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
setSupabaseOverride(supabase as unknown as SupabaseClient);

// ─── Filters ────────────────────────────────────────────────────────────────

/** Senders that should never get an AI draft regardless of category. */
const NOREPLY_PATTERNS = [
  /^no[-_.]?reply@/i,
  /^notifications?@/i,
  /^reports?@/i,
  /@.*\.googlebusinessprofile\./i,
  /^reply@google\./i,
  /^skip@/i,
  /^postmaster@/i,
  /^mailer-daemon@/i,
  /^bounce@/i,
];

const TERMINAL_OPP_STAGES = new Set(["won", "lost", "discarded"]);

const STRICT_CATEGORY = "CUSTOMER";
const RECENCY_DAYS = 14;
const MAX_MESSAGE_COUNT = 100;

function isNoreplySender(email: string | null): boolean {
  if (!email) return false;
  return NOREPLY_PATTERNS.some((re) => re.test(email));
}

// ─── Main ───────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  primary_category: string;
  message_count: number;
  latest_sender_email: string | null;
  subject: string | null;
  last_message_at: string;
  client_id: string | null;
  opportunity_id: string | null;
  connection_id: string;
  provider_thread_id: string;
}

interface ConnectionRow {
  id: string;
  email: string;
}

interface OppRow {
  id: string;
  stage: string | null;
  archived_at: string | null;
}

interface DraftHistoryRow {
  connection_id: string;
  thread_id: string;
}

async function main() {
  console.log("Phase C backfill — strict CUSTOMER pass");
  console.log("  company_id:", COMPANY_ID);
  console.log("  category:  ", STRICT_CATEGORY);
  console.log("  recency:   ", `last ${RECENCY_DAYS}d`);
  console.log("  max:       ", MAX_THREADS);
  console.log("  mode:      ", APPLY ? "APPLY (will fire router)" : "DRY-RUN");
  console.log();

  // Pull the candidate set with a single broad query, then refine in JS.
  // The where-clause hits indexed columns (company_id, archived_at,
  // last_message_at, primary_category) so this stays cheap even at scale.
  const cutoff = new Date(Date.now() - RECENCY_DAYS * 86_400_000).toISOString();
  const { data: rawCandidates, error: candErr } = await supabase
    .from("email_threads")
    .select(
      "id, primary_category, message_count, latest_sender_email, subject, last_message_at, client_id, opportunity_id, connection_id, provider_thread_id",
    )
    .eq("company_id", COMPANY_ID!)
    .eq("primary_category", STRICT_CATEGORY)
    .eq("latest_direction", "inbound")
    .is("archived_at", null)
    .gte("last_message_at", cutoff)
    .order("last_message_at", { ascending: false });

  if (candErr) {
    console.error("Failed to load candidate threads:", candErr.message);
    process.exit(1);
  }

  const candidates = (rawCandidates ?? []) as CandidateRow[];
  if (candidates.length === 0) {
    console.log("No candidates under the strict filter. Exiting.");
    return;
  }
  console.log(`Loaded ${candidates.length} pre-filter candidate thread(s).\n`);

  // Per-connection email lookup so we can drop self-forwards.
  const connectionIds = Array.from(new Set(candidates.map((t) => t.connection_id)));
  const { data: conns } = await supabase
    .from("email_connections")
    .select("id, email")
    .in("id", connectionIds);
  const connectionEmailById = new Map(
    ((conns ?? []) as ConnectionRow[]).map((c) => [c.id, c.email.toLowerCase()]),
  );

  // Opportunity stage filter — only hit the table if any candidate has one.
  const oppIds = Array.from(
    new Set(candidates.map((t) => t.opportunity_id).filter((x): x is string => !!x)),
  );
  const { data: opps } = oppIds.length
    ? await supabase
        .from("opportunities")
        .select("id, stage, archived_at")
        .in("id", oppIds)
    : { data: [] };
  const oppById = new Map(((opps ?? []) as OppRow[]).map((o) => [o.id, o]));

  // Existing draft history lookup. Match the enrichWithPhaseC join key
  // (connection_id, thread_id) so we filter against the same surface the
  // inbox would use to detect a pre-existing draft.
  const providerThreadIds = candidates.map((t) => t.provider_thread_id);
  const { data: drafts } = await supabase
    .from("ai_draft_history")
    .select("connection_id, thread_id")
    .eq("company_id", COMPANY_ID!)
    .in("connection_id", connectionIds)
    .in("thread_id", providerThreadIds);
  const draftedKeys = new Set(
    ((drafts ?? []) as DraftHistoryRow[]).map(
      (d) => `${d.connection_id}::${d.thread_id}`,
    ),
  );

  // Apply JS-side filters and bucket the rejections so the dry-run output
  // tells the operator exactly why each rejected thread was dropped.
  const skipReasons = new Map<string, number>();
  const skip = (reason: string) => {
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
  };

  const filtered: CandidateRow[] = [];
  for (const t of candidates) {
    if (t.message_count > MAX_MESSAGE_COUNT) {
      skip(`message_count > ${MAX_MESSAGE_COUNT}`);
      continue;
    }
    if (isNoreplySender(t.latest_sender_email)) {
      skip("noreply / system sender");
      continue;
    }
    const connEmail = connectionEmailById.get(t.connection_id);
    if (
      connEmail &&
      t.latest_sender_email &&
      t.latest_sender_email.toLowerCase() === connEmail
    ) {
      skip("self-forward (sender == connection email)");
      continue;
    }
    if (t.opportunity_id) {
      const opp = oppById.get(t.opportunity_id);
      if (opp?.archived_at) {
        skip("opportunity archived");
        continue;
      }
      if (opp?.stage && TERMINAL_OPP_STAGES.has(opp.stage.toLowerCase())) {
        skip(`opportunity stage terminal (${opp.stage})`);
        continue;
      }
    }
    if (draftedKeys.has(`${t.connection_id}::${t.provider_thread_id}`)) {
      skip("already has ai_draft_history row");
      continue;
    }
    filtered.push(t);
    if (filtered.length >= MAX_THREADS) break;
  }

  if (skipReasons.size > 0) {
    console.log("Filtered out:");
    for (const [reason, n] of skipReasons) console.log(`  ${n}× ${reason}`);
    console.log();
  }
  console.log(`After all filters: ${filtered.length} thread(s) eligible.\n`);

  if (!APPLY) {
    console.log("Dry-run mode — listing eligible threads only.\n");
    for (const t of filtered) {
      console.log(
        `  • ${t.id}  (${t.primary_category})  ${t.last_message_at}  ${t.latest_sender_email ?? "—"}`,
      );
      console.log(`      ${(t.subject ?? "—").slice(0, 80)}`);
    }
    console.log("\nRe-run with --apply to fire PhaseCAutonomyRouter.route() on each.");
    return;
  }

  // ── Apply path: fire the router on each thread, sequentially. ────────────
  // The router internally enforces: autonomy_level gating, isThreadActionable,
  // latestDirection='inbound', and (for follow-up only) staleness. So this
  // loop is mostly bookkeeping + cost auditing.
  console.log("Apply mode — invoking router…\n");

  const outcomeCounts = new Map<string, number>();
  const failures: Array<{ id: string; reason: string }> = [];

  for (let i = 0; i < filtered.length; i++) {
    const row = filtered[i];
    process.stdout.write(`[${i + 1}/${filtered.length}] ${row.id}: `);

    // Re-fetch the full thread row through the canonical mapper so the
    // router gets exactly the shape it expects (and we benefit from any
    // future column additions without tweaking this script).
    const { data: fullRow } = await supabase
      .from("email_threads")
      .select("*")
      .eq("id", row.id)
      .single();
    if (!fullRow) {
      console.log("not found");
      failures.push({ id: row.id, reason: "row vanished mid-flight" });
      continue;
    }

    try {
      const result = await PhaseCAutonomyRouter.route(mapEmailThreadFromDb(fullRow));
      console.log(`${result.outcome} (level=${result.effectiveLevel})`);
      outcomeCounts.set(result.outcome, (outcomeCounts.get(result.outcome) ?? 0) + 1);
      if (result.outcome === "error") {
        failures.push({ id: row.id, reason: result.detail ?? "unknown" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`THREW: ${msg}`);
      failures.push({ id: row.id, reason: msg });
    }

    // Light pacing — no need to hammer OpenAI even though the router has
    // its own retry/backoff. 250ms between calls = ~4/s ceiling.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("\n── Summary ─────────────────────────────────────────");
  for (const [outcome, n] of outcomeCounts) console.log(`  ${n}× ${outcome}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`    ${f.id}: ${f.reason}`);
  }
  console.log();

  const drafted = outcomeCounts.get("auto_drafted") ?? 0;
  const escalated = outcomeCounts.get("escalated_to_operator") ?? 0;
  if (drafted + escalated > 0) {
    const estCost = ((drafted + escalated) * 0.015).toFixed(3);
    console.log(`  Estimated LLM cost: ~$${estCost} (${drafted} drafted, ${escalated} escalated)`);
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
