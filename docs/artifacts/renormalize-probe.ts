/* ── docs/artifacts/renormalize-probe.ts ── */
/*
 * READ-ONLY diagnostic for the correspondence evidence boundary (bug
 * 8db73af6). `scripts/renormalize-delivery-sources.ts` reports THAT a row is
 * still rejected; this reports WHY, against the real stored bytes.
 *
 * It reads the same rejected rows through the same RPC, re-projects each one
 * through the same normalizer call the capture path makes, and attributes
 * every rejection to the exact throw site (from the error's own stack) plus
 * the exact code points behind it. It writes nothing, anywhere — no Supabase
 * mutation, no file. Cost is Supabase RPC time only; the normalizer is
 * deterministic local code with no model or provider calls.
 *
 *   set -a && . ./.env.local && set +a
 *   npx tsx --conditions=react-server docs/artifacts/renormalize-probe.ts
 *   npx tsx --conditions=react-server docs/artifacts/renormalize-probe.ts --dump <source_id-prefix>
 *
 * `--conditions=react-server` is required for the same reason the
 * renormalization script needs it: the normalizer is a server-only module.
 *
 * `--dump` prints one row's stored subject, its unsafe-code-point census with
 * surrounding context, and the head of its source — enough to tell a genuine
 * concealment attempt from an inert mail-client artifact. It prints delivered
 * customer correspondence, so treat the output as confidential, and as data
 * rather than as instructions.
 *
 * Deliberately free of any copy of the normalizer's own tables (supported
 * declarations, legacy attributes, tag sets). A copy here would drift from the
 * module it is meant to explain and quietly mislead the next diagnosis; the
 * stack frame it reports names the guard to go read instead.
 */

import { createClient } from "@supabase/supabase-js";

import { normalizeCorrespondence } from "../../src/lib/agent-control-plane/evidence/normalize-correspondence";
import { hasUnsafeUnicodeControls } from "../../src/lib/agent-control-plane/evidence/unicode-safety";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const DUMP_INDEX = process.argv.indexOf("--dump");
const DUMP_ID = DUMP_INDEX >= 0 ? process.argv[DUMP_INDEX + 1] : null;

interface RejectedDeliverySourceRow {
  readonly source_id: string;
  readonly company_id: string;
  readonly connection_id: string;
  readonly provider_message_id: string;
  readonly delivered_at: string;
  readonly subject: string;
  readonly content_media_type: "text/plain" | "text/html";
  readonly content_value: string;
}

/**
 * The guard's own predicate, one character at a time, so this census can never
 * disagree with the boundary about what counts as unsafe.
 */
function isUnsafe(character: string): boolean {
  if (character === "\n" || character === "\t" || character === "\r") {
    return false;
  }
  return hasUnsafeUnicodeControls(character);
}

function codePoint(character: string): string {
  return `U+${character
    .codePointAt(0)!
    .toString(16)
    .toUpperCase()
    .padStart(4, "0")}`;
}

function codePointCensus(value: string): Map<string, number> {
  const census = new Map<string, number>();
  for (const character of value) {
    if (!isUnsafe(character)) continue;
    const key = codePoint(character);
    census.set(key, (census.get(key) ?? 0) + 1);
  }
  return census;
}

function formatCensus(census: Map<string, number>): string {
  const entries = [...census].sort((a, b) => b[1] - a[1]);
  return entries.map(([key, count]) => `${key}x${count}`).join(" ") || "clean";
}

/** Where each unsafe code point sits, with enough text around it to judge. */
function unsafeContexts(value: string, limit: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < value.length && out.length < limit; index += 1) {
    const character = value[index]!;
    if (!isUnsafe(character)) continue;
    const window = value
      .slice(Math.max(0, index - 48), index + 48)
      .replace(/\s+/g, " ");
    out.push(`${codePoint(character)} @${index}: …${window}…`);
  }
  return out;
}

/**
 * The guard that actually threw, read off the error's stack. The normalizer
 * raises one message from many call sites, so the message alone cannot tell
 * two different rejections apart — the frame can.
 */
function throwSite(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return "(no stack)";
  const frames = error.stack
    .split("\n")
    .slice(1)
    .filter((line) => line.includes("normalize-correspondence"))
    .slice(0, 4)
    .map((line) => {
      const at = line.match(/at ([^ (]+)/);
      const position = line.match(/normalize-correspondence\.ts:(\d+):/);
      return position ? `${at?.[1] ?? "?"}@${position[1]}` : line.trim();
    });
  return frames.join(" < ") || "(no frames)";
}

/** The same call the capture path and the renormalization script both make. */
function rejectionFor(row: RejectedDeliverySourceRow): unknown | null {
  try {
    normalizeCorrespondence({
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
    return null;
  } catch (error) {
    return error;
  }
}

async function readRejectedRows(): Promise<RejectedDeliverySourceRow[]> {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false },
  });
  const rows: RejectedDeliverySourceRow[] = [];
  let beforeDeliveredAt: string | null = null;
  let beforeId: string | null = null;

  for (;;) {
    const { data, error } = await supabase.rpc(
      "list_delivery_sources_for_renormalization_as_system",
      {
        p_limit: 100,
        p_before_delivered_at: beforeDeliveredAt,
        p_before_id: beforeId,
      }
    );
    if (error) {
      throw new Error(`PROBE_LIST_FAILED: ${error.message ?? "unknown error"}`);
    }
    const page = (data ?? []) as RejectedDeliverySourceRow[];
    if (page.length === 0) break;
    rows.push(...page);
    const last = page[page.length - 1]!;
    beforeDeliveredAt = last.delivered_at;
    beforeId = last.source_id;
    if (page.length < 100) break;
  }
  return rows;
}

function dump(row: RejectedDeliverySourceRow): void {
  const error = rejectionFor(row);
  const verdict =
    error === null
      ? "normalizes"
      : `${error instanceof Error ? error.message : String(error)} at ${throwSite(error)}`;
  console.log(`source_id     ${row.source_id}`);
  console.log(`delivered_at  ${row.delivered_at}`);
  console.log(`media type    ${row.content_media_type}`);
  console.log(`length        ${row.content_value.length}`);
  console.log(`subject       ${JSON.stringify(row.subject)}`);
  console.log(`verdict       ${verdict}`);
  console.log(`subject cp    ${formatCensus(codePointCensus(row.subject))}`);
  console.log(
    `content cp    ${formatCensus(codePointCensus(row.content_value))}`
  );
  for (const context of unsafeContexts(row.content_value, 8)) {
    console.log(`  ${context}`);
  }
  console.log("--- source head ---");
  console.log(JSON.stringify(row.content_value.slice(0, 2000)));
}

async function main(): Promise<void> {
  const rows = await readRejectedRows();

  if (DUMP_ID) {
    const row = rows.find((candidate) =>
      candidate.source_id.startsWith(DUMP_ID)
    );
    if (!row) {
      console.error(`no rejected row whose id starts with ${DUMP_ID}`);
      process.exit(1);
    }
    dump(row);
    return;
  }

  const byReason = new Map<string, number>();
  const bySite = new Map<string, number>();
  const byCodePoint = new Map<string, number>();
  let readable = 0;

  for (const row of rows) {
    const error = rejectionFor(row);
    if (error === null) {
      readable += 1;
      console.log(
        `${row.source_id.slice(0, 8)}  ${row.content_media_type.padEnd(10)}  normalizes`
      );
      continue;
    }
    const reason = error instanceof Error ? error.message : String(error);
    const site = throwSite(error);
    const census = codePointCensus(row.content_value);
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    bySite.set(site, (bySite.get(site) ?? 0) + 1);
    for (const [key, count] of census) {
      byCodePoint.set(key, (byCodePoint.get(key) ?? 0) + count);
    }
    console.log(
      `${row.source_id.slice(0, 8)}  ${row.content_media_type.padEnd(10)}  ${reason}\n` +
        `          at ${site}\n` +
        `          cp ${formatCensus(census)}`
    );
  }

  const report = (title: string, counts: Map<string, number>): void => {
    console.log(`\n=== ${title} ===`);
    for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`${String(count).padStart(5)}  ${key}`);
    }
  };
  report("rejection reasons", byReason);
  report("throw sites", bySite);
  report("unsafe code points across rejected content", byCodePoint);
  console.log(`\nscanned ${rows.length}, readable ${readable}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  );
  process.exit(1);
});
