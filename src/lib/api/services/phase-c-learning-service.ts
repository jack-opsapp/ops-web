/**
 * OPS Web - Phase C correction finalizer
 *
 * A category correction is an actor-authored learning signal. It is retained
 * for future classifications, but it is never eagerly replayed across the
 * company inbox: a service-role fan-out cannot hold the correcting actor's
 * assignment/inbox authorization stable while it mutates other leads.
 */

import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { requireSupabase } from "@/lib/supabase/helpers";
import { mapCategoryCorrectionFromDb } from "@/lib/types/email-thread";

export interface ApplyCorrectionInput {
  correctionId: string;
  actorUserId: string;
}

/**
 * Finalize one correction without company-wide eager mutation.
 *
 * The legacy method name is retained for callers, but similar threads now pick
 * up the correction only through their normal classification path. Before the
 * correction is finalized, the persisted actor must still have the canonical
 * pipeline.edit + inbox.view intersection for the source lead/thread.
 */
async function applyCorrectionToSimilar(
  input: ApplyCorrectionInput
): Promise<{ reclassified: number }> {
  const supabase = requireSupabase();
  const { data: corrRow, error: corrError } = await supabase
    .from("email_thread_category_corrections")
    .select("*")
    .eq("id", input.correctionId)
    .single();

  if (corrError || !corrRow) {
    console.error(
      "[phase-c-learning] correction not found:",
      input.correctionId
    );
    return { reclassified: 0 };
  }

  const correction = mapCategoryCorrectionFromDb(corrRow);
  if (correction.userId !== input.actorUserId) {
    console.warn(
      "[phase-c-learning] correction actor mismatch:",
      input.correctionId
    );
    return { reclassified: 0 };
  }
  if (correction.appliedToSimilar) return { reclassified: 0 };

  const access = await resolveEmailOpportunityAccess({
    actor: {
      userId: input.actorUserId,
      companyId: correction.companyId,
    },
    operation: "edit",
    threadId: correction.threadId,
    supabase,
  });
  if (!access.allowed) {
    console.warn(
      "[phase-c-learning] correction finalization denied:",
      input.correctionId,
      access.reason
    );
    return { reclassified: 0 };
  }

  const { error: updateError } = await supabase
    .from("email_thread_category_corrections")
    .update({ applied_to_similar: true, similar_count: 0 })
    .eq("id", correction.id)
    .eq("company_id", correction.companyId)
    .eq("user_id", input.actorUserId);
  if (updateError) {
    console.error(
      "[phase-c-learning] correction finalization failed:",
      correction.id,
      updateError.message
    );
  }

  return { reclassified: 0 };
}

export const PhaseCLearningService = {
  applyCorrectionToSimilar,
};
