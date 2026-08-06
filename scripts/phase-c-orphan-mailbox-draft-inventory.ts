/* ── scripts/phase-c-orphan-mailbox-draft-inventory.ts ── */
/*
 * Read-only inventory of orphaned Phase C mailbox drafts.
 *
 * An orphan is an `ai_draft_history` row that has already reached a terminal
 * state off the back of a real send, whose `mailbox_draft_id` STILL resolves to
 * a live draft in the operator's mailbox. It looks like an unsent reply; if the
 * operator opens and sends it, the customer receives the same message twice.
 *
 * Two ways a row gets there:
 *   - `sent_from_mailbox` — the send was recognized as ours, but the operator
 *     had lifted the wording into a fresh compose, leaving the API draft behind.
 *   - `superseded` — the same lift, filed as a rewrite before commit cca1120e
 *     taught the classifier to read the sent body. Re-running the derivation
 *     check now separates those misfilings from genuine from-scratch replies.
 *
 * NO WRITES. Not to the database, not to the mailbox. This script exists to
 * size and prove the backlog before any bulk provider mutation is authorized.
 *
 * Usage:
 *   npx tsx scripts/phase-c-orphan-mailbox-draft-inventory.ts
 *   npx tsx scripts/phase-c-orphan-mailbox-draft-inventory.ts --company-id <uuid>
 *   npx tsx scripts/phase-c-orphan-mailbox-draft-inventory.ts --no-probe
 *   OPS_WEB_ENV_DIR=/path/to/ops-web npx tsx scripts/…
 *
 * `--no-probe` skips the provider reads and reports derivation evidence only.
 * With probing on (the default) each distinct mailbox draft id costs one
 * Gmail `drafts.get` (5 quota units against a 1B/day budget — no real spend).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ENV_DIR = process.env.OPS_WEB_ENV_DIR || process.cwd();
loadEnvConfig(ENV_DIR);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Bind the service-role client before importing anything that reaches for
// `requireSupabase()` at call time (connection load → provider construction).
import { setSupabaseOverride } from "../src/lib/supabase/helpers";
setSupabaseOverride(supabase as unknown as SupabaseClient);

import { outboundBodyDerivedFromDraft } from "../src/lib/api/services/draft-reconciliation";
import { EmailService } from "../src/lib/api/services/email-service";

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const COMPANY_ID = argValue("--company-id");
const PROBE = !process.argv.includes("--no-probe");

/**
 * Terminal states a row can hold while its provider draft is still live.
 * `discarded_in_mailbox` is excluded: reaching it required proving the draft
 * was already gone. `discarded` is the in-app discard, which deletes the
 * mailbox object on the way out.
 */
const TERMINAL_STATUSES = ["sent_from_mailbox", "superseded"] as const;

interface HistoryRow {
  id: string;
  company_id: string;
  connection_id: string | null;
  thread_id: string | null;
  mailbox_draft_id: string;
  status: string;
  created_at: string;
  original_draft: string;
  sent_provider_message_id: string | null;
}

interface ActivityRow {
  email_message_id: string | null;
  body_text: string | null;
  subject: string | null;
  created_at: string;
  direction: string;
}

interface Finding {
  draftHistoryId: string;
  status: string;
  createdAt: string;
  threadId: string | null;
  mailboxDraftId: string;
  connectionId: string | null;
  hasOutboundAfter: boolean;
  derivedFromDraft: boolean;
  sentProviderMessageId: string | null;
  outboundMessageId: string | null;
  draftLiveInMailbox: boolean | null;
  probeError: string | null;
  /** What the durable sweep would do with this row. */
  verdict:
    | "orphan_delete"
    | "already_gone"
    | "leave_no_derivation_proof"
    | "leave_no_send"
    | "probe_failed"
    | "not_probed";
}

async function main(): Promise<void> {
  let historyQuery = supabase
    .from("ai_draft_history")
    .select(
      "id, company_id, connection_id, thread_id, mailbox_draft_id, status, created_at, original_draft, sent_provider_message_id"
    )
    .not("mailbox_draft_id", "is", null)
    .in("status", TERMINAL_STATUSES as unknown as string[])
    .order("created_at", { ascending: true });
  if (COMPANY_ID) historyQuery = historyQuery.eq("company_id", COMPANY_ID);

  const { data: historyData, error: historyError } = await historyQuery;
  if (historyError) {
    console.error(`history query failed: ${historyError.message}`);
    process.exit(1);
  }
  const rows = (historyData ?? []) as HistoryRow[];
  console.log(`\nterminal rows carrying a mailbox draft id: ${rows.length}`);

  // ── Evidence pass: does the send actually reuse this draft's wording? ──
  const findings: Finding[] = [];
  for (const row of rows) {
    let latestOutbound: ActivityRow | null = null;
    if (row.thread_id && row.connection_id) {
      const { data: activityData, error: activityError } = await supabase
        .from("activities")
        .select("email_message_id, body_text, subject, created_at, direction")
        .eq("company_id", row.company_id)
        .eq("email_connection_id", row.connection_id)
        .eq("email_thread_id", row.thread_id)
        .eq("direction", "outbound")
        .gt("created_at", row.created_at)
        .not("email_message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (activityError) {
        console.error(`activity query failed for ${row.id}: ${activityError.message}`);
        process.exit(1);
      }
      latestOutbound = ((activityData ?? [])[0] as ActivityRow | undefined) ?? null;
    }

    const derived = latestOutbound
      ? outboundBodyDerivedFromDraft({
          draftBody: row.original_draft,
          sentBody: latestOutbound.body_text,
          subject: latestOutbound.subject,
        })
      : false;

    findings.push({
      draftHistoryId: row.id,
      status: row.status,
      createdAt: row.created_at,
      threadId: row.thread_id,
      mailboxDraftId: row.mailbox_draft_id,
      connectionId: row.connection_id,
      hasOutboundAfter: latestOutbound !== null,
      derivedFromDraft: derived,
      sentProviderMessageId: row.sent_provider_message_id,
      outboundMessageId: latestOutbound?.email_message_id ?? null,
      draftLiveInMailbox: null,
      probeError: null,
      verdict: "not_probed",
    });
  }

  // ── Provider pass: which of those draft objects are still sitting there? ──
  if (PROBE) {
    const byConnection = new Map<string, Set<string>>();
    for (const finding of findings) {
      if (!finding.connectionId) continue;
      const ids = byConnection.get(finding.connectionId) ?? new Set<string>();
      ids.add(finding.mailboxDraftId);
      byConnection.set(finding.connectionId, ids);
    }

    const presence = new Map<string, boolean>();
    const probeErrors = new Map<string, string>();
    for (const [connectionId, draftIds] of byConnection) {
      const connection = await EmailService.getConnection(connectionId);
      if (!connection) {
        for (const draftId of draftIds) {
          probeErrors.set(draftId, `connection ${connectionId} not found`);
        }
        continue;
      }
      const provider = EmailService.getProvider(connection);
      console.log(
        `probing ${draftIds.size} distinct draft ids on ${connection.email} (${connection.provider})…`
      );
      for (const draftId of draftIds) {
        try {
          const draft = await provider.getDraft(draftId, {
            deadlineAt: Date.now() + 60_000,
            context: "orphan mailbox draft inventory",
          });
          presence.set(draftId, draft !== null);
        } catch (error) {
          probeErrors.set(
            draftId,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    for (const finding of findings) {
      const probeError = probeErrors.get(finding.mailboxDraftId) ?? null;
      finding.probeError = probeError;
      finding.draftLiveInMailbox = probeError
        ? null
        : (presence.get(finding.mailboxDraftId) ?? null);
    }
  }

  for (const finding of findings) {
    if (finding.probeError) finding.verdict = "probe_failed";
    else if (finding.draftLiveInMailbox === null) finding.verdict = "not_probed";
    else if (!finding.draftLiveInMailbox) finding.verdict = "already_gone";
    else if (!finding.hasOutboundAfter) finding.verdict = "leave_no_send";
    else if (!finding.derivedFromDraft)
      finding.verdict = "leave_no_derivation_proof";
    else finding.verdict = "orphan_delete";
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const tally = new Map<string, number>();
  for (const finding of findings) {
    const key = `${finding.status} / ${finding.verdict}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log("\n── verdicts ──");
  for (const [key, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }

  const toDelete = findings.filter((f) => f.verdict === "orphan_delete");
  console.log(`\n── orphans that would be deleted: ${toDelete.length} ──`);
  for (const finding of toDelete) {
    console.log(
      `  ${finding.createdAt.slice(0, 10)}  ${finding.status.padEnd(18)}  history=${finding.draftHistoryId}  draft=${finding.mailboxDraftId}  thread=${finding.threadId}`
    );
  }

  const distinctOrphanDraftIds = new Set(toDelete.map((f) => f.mailboxDraftId));
  console.log(
    `\ndistinct provider draft objects to delete: ${distinctOrphanDraftIds.size}`
  );

  const outDir = path.join(process.cwd(), "docs", "artifacts");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "phase-c-orphan-mailbox-draft-inventory.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        probed: PROBE,
        totals: Object.fromEntries(tally),
        findings,
      },
      null,
      2
    )
  );
  console.log(`\nwrote ${outPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
