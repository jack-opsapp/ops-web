/**
 * OPS Web — Deterministic Internal Thread Classification (Track B)
 *
 * When every participant of an email thread is a known company user, we can
 * classify the thread as INTERNAL without consulting the LLM. This file
 * exports the pure rule and its types only — the DB reads that feed it live
 * in `deterministic-internal-reads.ts` so the rule stays independently
 * testable (no Supabase/Firebase imports pulled in by these types).
 *
 * The rule bails (returns null) when:
 *   1. The participants list is empty
 *   2. The user has manually set the category
 *   3. The thread is a forward (subject "Fwd:"/body markers)
 *   4. The thread matches the known-forwarder + form-subject pattern
 *      (e.g. Jared forwards a website inquiry — already handled as a lead
 *      by sync-engine's existing logic; we must not hide it as INTERNAL)
 *   5. Any participant's email isn't in the companyUsers map
 *
 * When the rule fires, the thread is written with:
 *   - primary_category            = "INTERNAL"
 *   - category_confidence         = 1
 *   - category_classifier_version = "deterministic-v1"
 *   - ai_summary                  = "Internal thread between X, Y about Z."
 * and the classifier call is skipped entirely.
 *
 * Spec: docs/superpowers/specs/2026-04-21-track-b-deterministic-internal-and-thread-summary-design.md
 */

import {
  extractEmailAddress,
  isForwardMarker,
} from "@/lib/utils/email-parsing";
import { isLikelyForwardedInquiry } from "./known-platforms";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompanyUser {
  email: string;        // lowercase, trimmed
  displayName: string;  // e.g. "Jared Reed" or email local-part as fallback
}

export interface DeterministicInternalInput {
  subject: string;
  firstMessageBody: string;
  participants: string[];
  senderEmail: string | null;
  categoryManuallySet: boolean;
  companyUsers: Map<string, CompanyUser>;
  teamForwarders: string[];
  /** Falls back to this when the connection owner's users row is missing. */
  connectionEmail?: string;
}

export interface DeterministicInternalResult {
  category: "INTERNAL";
  summary: string;
  classifierVersion: "deterministic-v1";
  confidence: 1;
}

// ─── Rule ────────────────────────────────────────────────────────────────────

export function tryDeterministicInternal(
  input: DeterministicInternalInput
): DeterministicInternalResult | null {
  // Guard 1: empty participants (Array.every returns true on []; explicit guard)
  if (input.participants.length === 0) return null;

  // Guard 2: user has already chosen a category — respect their choice
  if (input.categoryManuallySet) return null;

  // Guard 3: forwarded thread — semantic content isn't from participants
  if (isForwardMarker(input.subject, input.firstMessageBody)) return null;

  // Guard 4: known-forwarder forwarding a form submission — this is a lead,
  // not an internal thread. sync-engine handles the lead creation; we just
  // need to NOT hide it under INTERNAL.
  if (
    isLikelyForwardedInquiry(
      input.senderEmail,
      input.subject,
      input.teamForwarders
    )
  ) {
    return null;
  }

  // Guard 5: every participant must resolve to a company user
  const resolvedNames: string[] = [];
  for (const participant of input.participants) {
    const email = extractEmailAddress(participant).toLowerCase().trim();
    if (!email) return null;

    const user =
      input.companyUsers.get(email) ??
      (input.connectionEmail?.toLowerCase().trim() === email
        ? {
            email,
            displayName: email.split("@")[0] ?? email,
          }
        : null);
    if (!user) return null;

    resolvedNames.push(user.displayName);
  }

  const summary = buildSummary(resolvedNames, input.subject);

  return {
    category: "INTERNAL",
    summary,
    classifierVersion: "deterministic-v1",
    confidence: 1,
  };
}

// ─── Summary template ────────────────────────────────────────────────────────

function buildSummary(resolvedNames: string[], subject: string): string {
  const shown = resolvedNames.slice(0, 3);
  const extra = Math.max(0, resolvedNames.length - shown.length);
  const who = shown.join(", ") + (extra > 0 ? ` +${extra}` : "");
  const topic = subject.trim() || "(no subject)";
  return `Internal thread between ${who} about ${topic}.`;
}
