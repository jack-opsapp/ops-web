/**
 * OPS Web - Phase C Learning Service (Inbox v2)
 *
 * When a user recategorizes a thread, EmailThreadService.recategorize() creates
 * a row in `email_thread_category_corrections`. This service takes over from
 * there — it finds similar threads (same sender_domain OR same participants_hash)
 * that were classified with low confidence AND not manually set, and reclassifies
 * them with the new correction weighted in as a learned-rule prior.
 *
 * Called asynchronously from the /api/inbox/threads/[id] PATCH handler for
 * action=recategorize — never blocks the user-facing response.
 *
 * Also writes a summary row to `agent_memories` so the knowledge graph reflects
 * user preferences (a domain-level rule becomes a fact Phase C can retrieve at
 * draft time — e.g., "marks.com is marketing for this company").
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import {
  EmailThreadService,
  hashParticipants,
} from "./email-thread-service";
import {
  mapCategoryCorrectionFromDb,
  mapEmailThreadFromDb,
  type CategoryCorrection,
  type EmailThread,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";

// ─── Similar-thread discovery ────────────────────────────────────────────────

const SIMILAR_CAP = 50; // upper bound on threads we'll reclassify per correction
const CONFIDENCE_CEILING = 0.85; // only revisit threads below this confidence

/**
 * Apply a recent correction to similar threads in the inbox. Similarity is
 * defined as:
 *
 *   1) Same sender_domain AND category_manually_set = false AND
 *      category_confidence < CONFIDENCE_CEILING
 *
 *   OR
 *
 *   2) Same participants_hash AND category_manually_set = false AND
 *      category_confidence < CONFIDENCE_CEILING
 *
 * Threads matching either condition get reclassified. The new correction is
 * implicit — on reclassify, the classifier loads all existing corrections
 * (including this one) as learned-rule priors, so it naturally votes for
 * the corrected category.
 *
 * Updates the correction's applied_to_similar + similar_count on completion.
 */
async function applyCorrectionToSimilar(
  correctionId: string
): Promise<{ reclassified: number }> {
  const supabase = requireSupabase();

  // Load the correction
  const { data: corrRow, error: corrError } = await supabase
    .from("email_thread_category_corrections")
    .select("*")
    .eq("id", correctionId)
    .single();

  if (corrError || !corrRow) {
    console.error("[phase-c-learning] correction not found:", correctionId);
    return { reclassified: 0 };
  }

  const correction = mapCategoryCorrectionFromDb(corrRow);

  // Find similar threads — domain match first, then participants hash
  const similar: EmailThread[] = [];
  const seen = new Set<string>([correction.threadId]); // skip the source thread

  if (correction.senderDomain) {
    const { data: domainMatches } = await supabase
      .from("email_threads")
      .select("*")
      .eq("company_id", correction.companyId)
      .eq("latest_sender_email", correction.senderEmail ?? "__never_match__")
      .eq("category_manually_set", false)
      .lt("category_confidence", CONFIDENCE_CEILING)
      .limit(SIMILAR_CAP);

    for (const row of domainMatches ?? []) {
      const thread = mapEmailThreadFromDb(row);
      if (!seen.has(thread.id)) {
        similar.push(thread);
        seen.add(thread.id);
      }
    }

    // Also look by domain (latest_sender_email might not match but domain does)
    if (similar.length < SIMILAR_CAP) {
      const { data: domainFallback } = await supabase
        .from("email_threads")
        .select("*")
        .eq("company_id", correction.companyId)
        .ilike("latest_sender_email", `%@${correction.senderDomain}`)
        .eq("category_manually_set", false)
        .lt("category_confidence", CONFIDENCE_CEILING)
        .limit(SIMILAR_CAP - similar.length);

      for (const row of domainFallback ?? []) {
        const thread = mapEmailThreadFromDb(row);
        if (!seen.has(thread.id)) {
          similar.push(thread);
          seen.add(thread.id);
        }
      }
    }
  }

  // Participants-hash match — same set of people, different domain
  if (correction.participantsHash && similar.length < SIMILAR_CAP) {
    const { data: allCandidates } = await supabase
      .from("email_threads")
      .select("*")
      .eq("company_id", correction.companyId)
      .eq("category_manually_set", false)
      .lt("category_confidence", CONFIDENCE_CEILING)
      .limit(200);

    for (const row of allCandidates ?? []) {
      const thread = mapEmailThreadFromDb(row);
      if (seen.has(thread.id)) continue;
      if (hashParticipants(thread.participants) === correction.participantsHash) {
        similar.push(thread);
        seen.add(thread.id);
        if (similar.length >= SIMILAR_CAP) break;
      }
    }
  }

  // Reclassify — serial + small delay to avoid rate-limit spike
  let reclassified = 0;
  for (const thread of similar) {
    try {
      await EmailThreadService.classifyAndUpdate(thread);
      reclassified += 1;
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error(
        "[phase-c-learning] reclassify failed for thread",
        thread.id,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Mark correction applied + record to agent_memories for knowledge graph
  await supabase
    .from("email_thread_category_corrections")
    .update({ applied_to_similar: true, similar_count: reclassified })
    .eq("id", correctionId);

  if (correction.senderDomain && reclassified > 0) {
    await writeMemoryFact(correction, reclassified);
  }

  return { reclassified };
}

/**
 * Write a one-liner to agent_memories so draft-time context includes the
 * user's categorization preferences. Consumed by ai-draft-service when
 * Phase C is enabled.
 */
async function writeMemoryFact(
  correction: CategoryCorrection,
  similarCount: number
): Promise<void> {
  if (!correction.senderDomain) return;
  const supabase = requireSupabase();

  const content = `Emails from ${correction.senderDomain} are ${toPhrase(
    correction.toCategory
  )} (user-confirmed preference${
    similarCount > 0 ? `, ${similarCount} similar threads also recategorized` : ""
  }).`;

  try {
    await supabase.from("agent_memories").insert({
      company_id: correction.companyId,
      user_id: correction.userId,
      memory_type: "preference",
      category: `inbox.category.${correction.toCategory.toLowerCase()}`,
      content,
      confidence: 0.9,
      source: "inbox_correction",
      source_id: correction.id,
    });
  } catch (err) {
    // Non-fatal — memory write failure doesn't block the user's action
    console.error("[phase-c-learning] memory write failed:", err);
  }
}

function toPhrase(category: EmailThreadCategory): string {
  const phrases: Record<EmailThreadCategory, string> = {
    CUSTOMER: "customer correspondence — inquiries, quotes, active work, follow-ups",
    VENDOR: "supplier / vendor communications",
    SUBTRADE: "subcontractor coordination",
    PLATFORM_BID: "construction platform bid invitations",
    LEGAL: "legal or dispute correspondence",
    JOB_SEEKER: "employment inquiries",
    COLLECTIONS: "collections or AR correspondence",
    MARKETING: "marketing / promotional email",
    RECEIPT: "transactional receipts",
    PERSONAL: "personal correspondence",
    INTERNAL: "internal team messages",
    OTHER: "uncategorized",
  };
  return phrases[category];
}

// ─── Service export ──────────────────────────────────────────────────────────

export const PhaseCLearningService = {
  applyCorrectionToSimilar,
};
