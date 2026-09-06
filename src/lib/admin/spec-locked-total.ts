/**
 * SPEC-03 locked total — parsing, the lock gate, and the scope-doc projection.
 *
 * SPEC-03 · PROPRIETARY is the only variable-total tier (10_TIER_MODEL_V2 § 2):
 * P1 is fixed at a quarter of the $25,000 floor and P2–P4 split the locked
 * remainder. The operator locks the total on the CURRENT scope-doc draft from
 * the Scope Doc tab; the figure is written into the doc's `content_json` (so
 * the customer's countersign hash covers the price) and copied to
 * `spec_projects.locked_total_cents` (what the Milestones tab invoices from).
 * Re-locks are refused once the doc is sent, signed, or P2 is invoiced —
 * from then on a change order carries any change.
 *
 * Pure. No I/O. The server action (`lock-total.ts`) and the data layer
 * (`spec-queries.ts` → Tab 4) both derive their answers from here, so the
 * control and the write path can never disagree.
 */

import { createHash } from "node:crypto";
import { readLockedTotalCents } from "./spec-milestones";
import { SPEC_TIER_MILESTONE_SHAPE, SPEC_TIER_TOTAL_CENTS, type SpecTier } from "./spec-tiers";
import type { LockBlockedReason, SpecProjectStatus, SpecScopeLockedTotal } from "./spec-types";

// ─── Constants ───────────────────────────────────────────────────────────────

/** `spec_projects.locked_total_cents` is `integer` (int4) — refuse what it cannot hold. */
export const SPEC03_LOCKED_TOTAL_MAX_CENTS = 2_147_483_647;

/** The key the figure lives under inside `spec_scope_documents.content_json`. */
export const SCOPE_DOC_LOCKED_TOTAL_KEY = "locked_total_cents";

/** Engagements past the point where a total can still be locked. */
const CLOSED_STATUSES: ReadonlySet<SpecProjectStatus> = new Set(["completed", "cancelled", "refunded"]);

// ─── Input parsing ───────────────────────────────────────────────────────────

export type LockedTotalParseFailure =
  | "empty"
  | "not_a_number"
  | "fractional_cents"
  | "below_floor"
  | "above_max";

export type ParsedLockedTotal =
  | { ok: true; cents: number }
  | { ok: false; reason: LockedTotalParseFailure };

/** `$31,000.50` / `31,000` / `31000` — a dollar figure with at most two decimals. */
const MONEY_RE = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

/**
 * Parse the operator's dollar figure into integer cents. Never goes through a
 * float: whole dollars and the cent digits are combined as integers.
 */
export function parseLockedTotalInput(
  raw: unknown,
  floorCents: number = SPEC_TIER_TOTAL_CENTS.spec03,
): ParsedLockedTotal {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  const match = MONEY_RE.exec(trimmed.replace(/\s+/g, ""));
  if (!match) return { ok: false, reason: "not_a_number" };

  const whole = match[1].replace(/,/g, "");
  const fraction = match[2] ?? "";
  if (fraction.length > 2) return { ok: false, reason: "fractional_cents" };

  // A figure the int4 column cannot hold is at most 10 digits of dollars
  // (21,474,836.47) — anything longer is above_max before we even multiply,
  // which keeps the arithmetic inside Number's safe integer range.
  if (whole.length > 10) return { ok: false, reason: "above_max" };

  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < floorCents) return { ok: false, reason: "below_floor" };
  if (cents > SPEC03_LOCKED_TOTAL_MAX_CENTS) return { ok: false, reason: "above_max" };
  return { ok: true, cents };
}

// ─── Lock gate ───────────────────────────────────────────────────────────────

export interface LockedTotalGateInput {
  tier: SpecTier;
  status: SpecProjectStatus;
  /** The current scope doc (latest unsuperseded version), or null when none exists. */
  currentDoc: { sentAt: string | null } | null;
  /** A `scope_signoff` acceptance event exists for the engagement. */
  hasScopeSignoff: boolean;
  /** A `scope_signoff` (P2) payment row exists — money already moved on a figure. */
  hasP2Payment: boolean;
}

export type LockedTotalGate = { allowed: true } | { allowed: false; reason: LockBlockedReason };

/**
 * May the operator lock (or re-lock) the total right now? Reasons are reported
 * in order of decisiveness so the UI and the action name the same blocker.
 */
export function lockedTotalGate(input: LockedTotalGateInput): LockedTotalGate {
  if (SPEC_TIER_MILESTONE_SHAPE[input.tier] !== "floor_quarters") {
    return { allowed: false, reason: "not_variable_tier" };
  }
  if (CLOSED_STATUSES.has(input.status)) return { allowed: false, reason: "engagement_closed" };
  if (input.hasScopeSignoff) return { allowed: false, reason: "signed" };
  if (input.hasP2Payment) return { allowed: false, reason: "p2_invoiced" };
  if (!input.currentDoc) return { allowed: false, reason: "no_scope_doc" };
  if (input.currentDoc.sentAt) return { allowed: false, reason: "doc_sent" };
  return { allowed: true };
}

const SIGNED_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

/** Console-voice label for a blocked lock; stamps the doc version / signature date when known. */
export function lockBlockedLabel(
  reason: LockBlockedReason,
  context: { version?: number | null; signedAt?: string | null } = {},
): string {
  switch (reason) {
    case "not_variable_tier":
      return "ONLY SPEC-03 CARRIES A VARIABLE TOTAL";
    case "engagement_closed":
      return "ENGAGEMENT CLOSED";
    case "signed": {
      const stamp = formatSignedAt(context.signedAt);
      return `SIGNED${stamp ? ` · ${stamp}` : ""} — CHANGES GO THROUGH A CHANGE ORDER`;
    }
    case "p2_invoiced":
      return "P2 INVOICED — TOTAL IS BINDING";
    case "no_scope_doc":
      return "DRAFT V1 FIRST — THE TOTAL LIVES ON THE SCOPE DOC";
    case "doc_sent":
      return `${context.version != null ? `V${context.version} ` : ""}SENT — CUT A NEW REVISION TO CHANGE THE TOTAL`;
  }
}

function formatSignedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return SIGNED_DATE.format(d).toUpperCase();
}

// ─── Scope-doc content ───────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** sha256 of the JSON — the same recipe `new-scope-revision.ts` uses, so hashes line up across writers. */
export function scopeContentHash(contentJson: unknown): string {
  return createHash("sha256").update(JSON.stringify(contentJson)).digest("hex");
}

/** A copy of the doc content carrying the locked total. Never mutates its input. */
export function withLockedTotal(contentJson: unknown, cents: number): Record<string, unknown> {
  return { ...(isRecord(contentJson) ? contentJson : {}), [SCOPE_DOC_LOCKED_TOTAL_KEY]: cents };
}

/** The figure a scope doc's content carries — positive integer cents only, else null. */
export function readScopeDocTotalCents(contentJson: unknown): number | null {
  if (!isRecord(contentJson)) return null;
  const value = contentJson[SCOPE_DOC_LOCKED_TOTAL_KEY];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// ─── Current scope doc ───────────────────────────────────────────────────────

/**
 * The current scope doc — the highest version with no `superseded_at`, falling
 * back to the highest version if every row is somehow marked superseded. The
 * Scope Doc tab and the lock-total action both pick through here, so they can
 * never disagree on which doc carries the figure. Never mutates its input.
 */
export function pickCurrentScopeDocument<T extends { version: number; superseded_at: string | null }>(
  scopeDocs: readonly T[],
): T | null {
  if (scopeDocs.length === 0) return null;
  const byVersionDesc = [...scopeDocs].sort((a, b) => b.version - a.version);
  return byVersionDesc.find((d) => !d.superseded_at) ?? byVersionDesc[0];
}

// ─── Tab 4 projection ────────────────────────────────────────────────────────

export interface ScopeLockedTotalParams {
  tier: SpecTier;
  status: SpecProjectStatus;
  /** Raw `spec_projects.locked_total_cents` — validated here via `readLockedTotalCents`. */
  lockedTotalRaw: unknown;
  currentDoc: { version: number; sentAt: string | null; contentJson: unknown } | null;
  acceptanceEvents: ReadonlyArray<{ event_type: string; accepted_at: string }>;
  payments: ReadonlyArray<{ milestone: string }>;
}

/** Compose the Scope Doc tab's lock state. Null for fixed-total tiers — the control never renders. */
export function composeScopeLockedTotal(params: ScopeLockedTotalParams): SpecScopeLockedTotal | null {
  const { tier, status, lockedTotalRaw, currentDoc, acceptanceEvents, payments } = params;
  if (SPEC_TIER_MILESTONE_SHAPE[tier] !== "floor_quarters") return null;

  const signoff = acceptanceEvents.find((e) => e.event_type === "scope_signoff") ?? null;
  const gate = lockedTotalGate({
    tier,
    status,
    currentDoc: currentDoc ? { sentAt: currentDoc.sentAt } : null,
    hasScopeSignoff: signoff !== null,
    hasP2Payment: payments.some((p) => p.milestone === "scope_signoff"),
  });

  return {
    floorCents: SPEC_TIER_TOTAL_CENTS[tier],
    lockedTotalCents: readLockedTotalCents(tier, lockedTotalRaw),
    currentDocVersion: currentDoc?.version ?? null,
    currentDocTotalCents: currentDoc ? readScopeDocTotalCents(currentDoc.contentJson) : null,
    signedAt: signoff?.accepted_at ?? null,
    blockedReason: gate.allowed ? null : gate.reason,
  };
}
