/* ── scripts/renormalize-delivery-sources.ts ── */
/*
 * Re-normalization of rejected provider-delivery evidence (bug 8db73af6).
 *
 * The v1 correspondence normalizer treated constructs that appear in almost
 * every real HTML email — Outlook conditional comments, linked stylesheets,
 * `a:hover` rules, floated images — as reasons to refuse the whole message.
 * The result: `private.agent_provider_delivery_sources` stored
 * `[CONTENT OMITTED: UNSAFE SOURCE]` in place of correspondence the operator
 * reads perfectly well in their own mailbox, and every MCP evidence read of
 * those messages came back empty.
 *
 * The normalizer is repaired. The exact source bytes were never discarded, so
 * this script re-reads them and writes the repaired reading back over the
 * placeholder. Nothing is fetched from any provider and no message is
 * re-delivered — the bytes never leave the row they already live in.
 *
 *   npx tsx --conditions=react-server scripts/renormalize-delivery-sources.ts
 *   npx tsx --conditions=react-server scripts/renormalize-delivery-sources.ts --execute
 *
 * `--conditions=react-server` is required: the normalizer is a server-only
 * module, and that condition resolves the `server-only` marker to its empty
 * shim instead of the module that throws on import.
 *
 * Flags:
 *   --execute        Write. WITHOUT IT NOTHING IS WRITTEN — dry run is the
 *                    default and the only thing it does is print.
 *   --limit <n>      Rows per page (default 100, server caps at 500).
 *   --max <n>        Stop after this many rows (default 1000).
 *   --verbose        Print the first line of each re-projected body, so the
 *                    dry run can be eyeballed against the real mailbox.
 *
 * Ordering: newest first. The newest rejected mail is what an agent is most
 * likely to be asked about, so a run that is stopped early has still repaired
 * the rows that matter most.
 *
 * Cost: zero. The normalizer is deterministic local code — no LLM calls, no
 * provider calls, no egress. The only spend is Supabase RPC time.
 *
 * Safety:
 *   - `--execute` moves ONLY the derived text projection
 *     (normalized_subject / normalized_plain_text / normalization_revision /
 *     normalization_status). The retained source bytes and the capture-time
 *     `source_sha256` — the tenant hash key immutable job conversation turns
 *     reference — are untouchable, enforced by the ledger's mutation guard,
 *     not by this script.
 *   - A row whose bytes STILL fail the repaired normalizer keeps its
 *     placeholders and is reported as `still-rejected`; the script never
 *     invents content.
 *   - Re-runs are idempotent: a row already carrying the current projection
 *     reports `unchanged` and is not written.
 */

import { createClient } from "@supabase/supabase-js";

import {
  CORRESPONDENCE_NORMALIZATION_REJECTED_SUBJECT,
  CORRESPONDENCE_NORMALIZATION_REJECTED_TEXT,
  CORRESPONDENCE_NORMALIZATION_REVISION,
  normalizeCorrespondence,
} from "../src/lib/agent-control-plane/evidence/normalize-correspondence";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const EXECUTE = process.argv.includes("--execute");
const VERBOSE = process.argv.includes("--verbose");

function numericFlag(name: string, fallback: number, cap: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const parsed = Number.parseInt(process.argv[index + 1] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`${name} needs a positive integer`);
    process.exit(1);
  }
  return Math.min(parsed, cap);
}

const PAGE_SIZE = numericFlag("--limit", 100, 500);
const MAX_ROWS = numericFlag("--max", 1_000, 100_000);

interface RejectedDeliverySourceRow {
  readonly source_id: string;
  readonly company_id: string;
  readonly connection_id: string;
  readonly provider: string;
  readonly provider_message_id: string;
  readonly delivered_at: string;
  readonly subject: string;
  readonly normalized_subject: string | null;
  readonly normalized_plain_text: string;
  readonly normalization_revision: string;
  readonly normalization_status: string;
  readonly content_media_type: "text/plain" | "text/html";
  readonly content_value: string;
}

interface Projection {
  readonly status: "normalized" | "rejected";
  readonly subject: string | null;
  readonly plainText: string;
  readonly reason: string | null;
}

/**
 * The same call `ProviderDeliverySourceService` makes at capture time, on the
 * same inputs. Keeping the identifiers identical is what makes this a
 * re-projection of the original capture rather than a new reading of it.
 */
function project(row: RejectedDeliverySourceRow): Projection {
  try {
    const normalized = normalizeCorrespondence({
      evidenceId: `provider_delivery_source:${row.connection_id}:${row.provider_message_id}`,
      companyId: row.company_id,
      sourceDomain: "email",
      sourceType: "provider_message",
      sourceId: `${row.connection_id}:${row.provider_message_id}`,
      occurredAt: new Date(row.delivered_at).toISOString(),
      subject: row.subject,
      content: {
        mediaType: row.content_media_type,
        value: row.content_value,
      },
      attachments: [],
    });
    return {
      status: "normalized",
      subject: normalized.subject,
      plainText: normalized.normalizedPlainText,
      reason: null,
    };
  } catch (error) {
    return {
      status: "rejected",
      subject: CORRESPONDENCE_NORMALIZATION_REJECTED_SUBJECT,
      plainText: CORRESPONDENCE_NORMALIZATION_REJECTED_TEXT,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
  return line.length > 96 ? `${line.slice(0, 93)}...` : line;
}

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false },
  });

  console.log(
    EXECUTE
      ? `[renormalize] EXECUTE — writing the repaired projection (revision ${CORRESPONDENCE_NORMALIZATION_REVISION})`
      : `[renormalize] DRY RUN — nothing will be written. Pass --execute to write.`
  );
  console.log(
    `[renormalize] page size ${PAGE_SIZE}, ceiling ${MAX_ROWS} rows, newest first\n`
  );

  let cursorDeliveredAt: string | null = null;
  let cursorId: string | null = null;
  let scanned = 0;
  let recoverable = 0;
  let stillRejected = 0;
  let written = 0;
  let unchanged = 0;

  for (;;) {
    const remaining = MAX_ROWS - scanned;
    if (remaining <= 0) break;

    const { data, error } = await supabase.rpc(
      "list_agent_provider_delivery_sources_for_renormalization_as_system",
      {
        p_limit: Math.min(PAGE_SIZE, remaining),
        p_before_delivered_at: cursorDeliveredAt,
        p_before_id: cursorId,
      }
    );
    if (error) {
      throw new Error(
        `RENORMALIZE_LIST_FAILED: ${error.message ?? "unknown error"}`
      );
    }

    const rows = (data ?? []) as RejectedDeliverySourceRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const projection = project(row);
      const textLength = projection.plainText.length;

      if (projection.status === "normalized") {
        recoverable += 1;
      } else {
        stillRejected += 1;
      }

      const verdict =
        projection.status === "normalized"
          ? `normalized  chars=${String(textLength).padStart(6)}`
          : `still-rejected            reason=${projection.reason ?? "unknown"}`;
      console.log(
        `${row.source_id}  ${row.delivered_at}  ${row.content_media_type.padEnd(10)}  ${verdict}`
      );
      if (VERBOSE && projection.status === "normalized") {
        console.log(`    subject: ${projection.subject ?? "—"}`);
        console.log(`    body[0]: ${firstLine(projection.plainText)}`);
      }

      if (!EXECUTE || projection.status !== "normalized") continue;

      const { data: moved, error: writeError } = await supabase.rpc(
        "reproject_agent_provider_delivery_source_as_system",
        {
          p_company_id: row.company_id,
          p_source_id: row.source_id,
          p_normalized_subject: projection.subject,
          p_normalized_plain_text: projection.plainText,
          p_normalization_revision: CORRESPONDENCE_NORMALIZATION_REVISION,
          p_normalization_status: projection.status,
        }
      );
      if (writeError) {
        throw new Error(
          `RENORMALIZE_WRITE_FAILED ${row.source_id}: ${writeError.message ?? "unknown error"}`
        );
      }
      if (moved === true) {
        written += 1;
      } else {
        unchanged += 1;
      }
    }

    const last = rows[rows.length - 1];
    // A page that repaired rows shrinks the rejected set the reader offers, so
    // the cursor — not an offset — is what keeps the walk from skipping rows.
    cursorDeliveredAt = last.delivered_at;
    cursorId = last.source_id;

    if (rows.length < Math.min(PAGE_SIZE, remaining)) break;
  }

  console.log("");
  console.log(`[renormalize] scanned          ${scanned}`);
  console.log(`[renormalize] readable now     ${recoverable}`);
  console.log(`[renormalize] still rejected   ${stillRejected}`);
  if (EXECUTE) {
    console.log(`[renormalize] written          ${written}`);
    console.log(`[renormalize] already current  ${unchanged}`);
  } else {
    console.log(
      `[renormalize] nothing written — re-run with --execute to repair ${recoverable} row(s)`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
