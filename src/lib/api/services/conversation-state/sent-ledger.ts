// src/lib/api/services/conversation-state/sent-ledger.ts
//
// The "already sent" ledger. The drafter consumes SentLedgerEntry[] so it
// NEVER re-quotes a price the operator already stated (fixes the bug where a
// draft restated a price already sent — spec docs/inbox/clean-state-layer-spec.md,
// "Bad draft: repeated price").
//
// TWO sources feed the ledger:
//   1. agent_memories rows with category='commitment' — the structured facts the
//      memory-service extracted from outbound owner replies ("Quoted $3,200 for
//      40ft cedar fence", "Owner promised revised quote to John by Friday").
//      See memory-service.ts (FACT_CATEGORIES, extractEntitiesAndFacts) and
//      app/api/inbox/commitments/[id]/route.ts (commitment = agent_memories
//      category='commitment').
//   2. Operator OUTBOUND cleanBody — scanned deterministically for stated
//      currency amounts ($3,200 / "3200 dollars") the memory extractor may have
//      missed. These become kind='price' entries with a parsed amount.
//
// DESIGN: the logic is a PURE function (`buildSentLedger`) over already-fetched
// plain data — no DB, no model. A thin SEPARATE `fetchCommitments` wrapper reads
// agent_memories; the pure core never calls it. Unit tests exercise the core
// with inline fixtures.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type {
  CleanMessage,
  SentLedgerEntry,
  SentLedgerKind,
} from "@/lib/api/services/conversation-state/types";

// ── Plain commitment shape (already-fetched agent_memories row) ──────────────
//
// Mirrors the columns the memory-service writes for category='commitment'
// (memory-service.ts:459 insert + the extraction `content`/`due_date` shape).
// Kept structural so the pure core takes plain data and never touches the DB.
export interface CommitmentRecord {
  content: string;
  due_date?: string | null;
  created_at?: string | null;
}

export interface BuildSentLedgerInput {
  commitments: CommitmentRecord[];
  outboundMessages: CleanMessage[];
}

// ─── Currency parsing (deterministic, no model) ──────────────────────────────
//
// Match either a `$`-prefixed amount ($3,200 / $3,200.00 / $4500) or an explicit
// "N dollars" phrasing (3200 dollars / 3,200 dollars). We deliberately do NOT
// treat bare numbers as money — a price must be marked with `$` or "dollars" to
// avoid pulling in quantities ("40ft", "9am", "2 gates").
const CURRENCY_PATTERN =
  /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*dollars\b/gi;

/** Parse a numeric amount from a matched currency token ("3,200" → 3200). */
function toAmount(rawDigits: string): number | null {
  const cleaned = rawDigits.replace(/,/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** All distinct currency amounts named in a string, in order of appearance. */
function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(CURRENCY_PATTERN)) {
    // Group 1 = `$`-prefixed; group 2 = "N dollars" form. One is always set.
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const amount = toAmount(raw);
    if (amount != null) amounts.push(amount);
  }
  return amounts;
}

/** First currency amount in a string, or null. */
function firstAmount(text: string): number | null {
  const all = extractAmounts(text);
  return all.length > 0 ? all[0] : null;
}

// ─── Kind inference for commitment content ───────────────────────────────────
//
// A commitment is one of price/quote/commitment/promise. We infer:
//   - "quote"   → content quotes/estimates a price ("Quoted $3,200 for ...").
//   - "promise" → content promises a deliverable/timing ("promised the revised
//                 quote by Friday", "will send", "will be onsite").
//   - "commitment" → neutral fallback (a stated commitment with neither a price
//                 quote nor explicit promise language).
const QUOTE_RE = /\b(quote[d]?|estimate[d]?|priced?\b)/i;
const PROMISE_RE = /\b(promis(?:e|ed|ing)|will\s|we'll|i'll|by\s+(?:mon|tue|wed|thu|fri|sat|sun|end|next|tomorrow))/i;

function inferCommitmentKind(content: string, hasAmount: boolean): SentLedgerKind {
  if (hasAmount && QUOTE_RE.test(content)) return "quote";
  if (PROMISE_RE.test(content)) return "promise";
  return "commitment";
}

// ─── Dedupe ──────────────────────────────────────────────────────────────────
//
// Two entries are "near-identical" when they name the same amount, OR (for
// amountless entries) carry the same normalized text. A commitment-quoted
// $3,200 and an outbound that restates "$3,200" must collapse to one entry so
// the drafter sees the price once. Distinct amounts stay separate.
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeKey(entry: SentLedgerEntry): string {
  if (entry.amount != null) return `amount:${entry.amount}`;
  return `text:${normalizeText(entry.text)}`;
}

/**
 * PURE CORE — build the sent ledger from already-fetched plain data.
 *
 * Maps each commitment memory to an entry (kind inferred from content, amount
 * carried when the content names one) and scans operator outbound cleanBody for
 * stated prices ($3,200 / "3200 dollars") → kind='price' entries. Dedupes
 * near-identical entries. Commitments win ties (richer text), so a commitment is
 * inserted before its restated-outbound twin is skipped.
 */
export function buildSentLedger(input: BuildSentLedgerInput): SentLedgerEntry[] {
  const entries: SentLedgerEntry[] = [];
  const seen = new Set<string>();

  const push = (entry: SentLedgerEntry) => {
    const key = dedupeKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  // 1) Commitments first — they carry the richest text ("Quoted $3,200 for 40ft
  //    cedar fence") and should be the canonical entry when a price is repeated.
  for (const commitment of input.commitments) {
    const content = (commitment.content ?? "").trim();
    if (content.length === 0) continue;

    const amount = firstAmount(content);
    const kind = inferCommitmentKind(content, amount != null);
    // No stable per-commitment message id on agent_memories; the commitment's
    // creation time is the ledger timestamp.
    const sentAt = commitment.created_at ?? commitment.due_date ?? "";

    push({
      kind,
      text: content,
      amount: amount ?? null,
      sentAt,
      sourceMessageId: "",
    });
  }

  // 2) Operator outbound stated prices. Only outbound operator mail counts —
  //    a customer's stated budget must never enter the operator's sent-ledger.
  for (const message of input.outboundMessages) {
    if (message.direction !== "outbound") continue;
    const body = (message.cleanBody ?? "").trim();
    if (body.length === 0) continue;

    for (const amount of extractAmounts(body)) {
      push({
        kind: "price",
        text: body,
        amount,
        sentAt: message.sentAt,
        sourceMessageId: message.providerMessageId,
      });
    }
  }

  return entries;
}

// ─── Thin fetch wrapper (NOT called by the pure core) ────────────────────────

/**
 * Read commitment memories for a thread (or linked client) from agent_memories.
 *
 * Commitments are `agent_memories` rows with `category='commitment'`
 * (memory-service.ts FACT_CATEGORIES; app/api/inbox/commitments/[id]/route.ts).
 * The memory-service writes `source_id = thread.threadId` on extraction
 * (memory-service.ts:467), so `threadOrClientId` matches that `source_id`.
 *
 * This is the ONLY DB-touching export; `buildSentLedger` (pure) never calls it.
 * Pass the rows it returns into `buildSentLedger({ commitments, outboundMessages })`.
 */
export async function fetchCommitments(
  companyId: string,
  threadOrClientId: string,
  client: SupabaseClient = getServiceRoleClient()
): Promise<CommitmentRecord[]> {
  const { data, error } = await client
    .from("agent_memories")
    .select("content, due_date, created_at")
    .eq("company_id", companyId)
    .eq("category", "commitment")
    .eq("source_id", threadOrClientId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[sent-ledger] fetchCommitments failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    content: (row as { content?: string }).content ?? "",
    due_date: (row as { due_date?: string | null }).due_date ?? null,
    created_at: (row as { created_at?: string | null }).created_at ?? null,
  }));
}

export const SentLedger = {
  buildSentLedger,
  fetchCommitments,
} as const;
