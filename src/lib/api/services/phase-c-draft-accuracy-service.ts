import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabase } from "@/lib/supabase/helpers";

const DEFAULT_SAMPLE_LIMIT = 50;
const MAX_SAMPLE_LIMIT = 200;

export interface HumanDraftAccuracy {
  sampleSize: number;
  approvedWithoutChanges: number;
  errors: number;
  approvalRate: number;
  errorRate: number;
}

interface DraftOutcomeRow {
  draft_outcome: unknown;
}

export interface GetHumanDraftAccuracyInput {
  companyId: string;
  userId: string;
  profileTypes?: string[];
  limit?: number;
  supabase?: SupabaseClient;
}

/**
 * Phase C graduates only from an operator's finalized decisions. A generated
 * draft is correct only when the operator sent it unchanged. Any edit is an
 * error signal, regardless of edit distance; autonomous sends never enter the
 * sample.
 */
export function summarizeHumanDraftOutcomes(
  rows: DraftOutcomeRow[]
): HumanDraftAccuracy {
  const outcomes = rows.flatMap((row) => {
    if (
      !row.draft_outcome ||
      typeof row.draft_outcome !== "object" ||
      Array.isArray(row.draft_outcome)
    ) {
      return [];
    }
    const sentWithoutChanges = (row.draft_outcome as Record<string, unknown>)
      .sentWithoutChanges;
    return typeof sentWithoutChanges === "boolean" ? [sentWithoutChanges] : [];
  });

  const approvedWithoutChanges = outcomes.filter(Boolean).length;
  const sampleSize = outcomes.length;
  const errors = sampleSize - approvedWithoutChanges;

  return {
    sampleSize,
    approvedWithoutChanges,
    errors,
    approvalRate: sampleSize > 0 ? approvedWithoutChanges / sampleSize : 0,
    errorRate: sampleSize > 0 ? errors / sampleSize : 0,
  };
}

/**
 * Read the durable, actor-attributed outcome ledger. This deliberately does
 * not use ai_draft_history alone: that table also contains autonomous sends,
 * which would let the agent validate its own work and inflate graduation.
 */
export async function getHumanDraftAccuracy(
  input: GetHumanDraftAccuracyInput
): Promise<HumanDraftAccuracy> {
  const supabase = input.supabase ?? requireSupabase();
  const limit = Math.min(
    MAX_SAMPLE_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_SAMPLE_LIMIT))
  );

  const profileTypes = Array.from(
    new Set(
      (input.profileTypes ?? [])
        .map((profileType) => profileType.trim())
        .filter(Boolean)
    )
  );
  const { data, error } = await supabase.rpc(
    "get_human_draft_accuracy_as_system",
    {
      p_company_id: input.companyId,
      p_actor_user_id: input.userId,
      p_profile_types: profileTypes.length > 0 ? profileTypes : null,
      p_limit: limit,
    }
  );
  if (error) throw new Error(error.message);

  return summarizeHumanDraftOutcomes(
    ((data ?? []) as Array<{ draft_outcome: unknown }>).map((row) => ({
      draft_outcome: row.draft_outcome,
    }))
  );
}
