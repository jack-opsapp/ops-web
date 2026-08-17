import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ingestDeliveredTurn } from "./ingest-delivered-turn";
import {
  createTurnRepository,
  type IngestConversationTurnResult,
  type TurnRepositoryClient,
} from "./turn-repository";

/**
 * Materialize one already-captured provider delivery into immutable job memory.
 * Callers must invoke this only after the canonical activity and, when the job
 * is an opportunity, correspondence event have been durably reconciled.
 */
export async function persistCapturedProviderDeliveryTurn(input: {
  readonly supabase: SupabaseClient;
  readonly companyId: string;
  readonly connectionId: string;
  readonly providerMessageId: string;
  readonly sourceActivityId: string;
}): Promise<IngestConversationTurnResult> {
  const repository = createTurnRepository(
    input.supabase as unknown as TurnRepositoryClient
  );
  return ingestDeliveredTurn({
    repository,
    source: {
      companyId: input.companyId,
      sourceConnectionId: input.connectionId,
      providerMessageId: input.providerMessageId,
      sourceActivityId: input.sourceActivityId,
    },
  });
}
