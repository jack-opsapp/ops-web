import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NormalizedSageRecord } from "./sage-normalize";
import type { SageReconcileCandidate } from "./sage-reconcile-service";

type RpcResult = {
  ops_updated_at?: unknown;
};

function requiredTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Sage inbound apply did not return an OPS timestamp.");
  }
  return value;
}

export class SageInboundApplyService {
  // The RPC ships in the same unreleased migration as this service. Keeping
  // its call ungenerated prevents the hand-maintained database types from
  // weakening the typed boundary used everywhere else.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;

  constructor(
    supabase: SupabaseClient,
    private readonly now: () => Date = () => new Date()
  ) {
    this.db = supabase;
  }

  async apply(
    candidate: SageReconcileCandidate,
    provider: NormalizedSageRecord | null
  ): Promise<{ opsUpdatedAt: string }> {
    if (provider && provider.externalId !== candidate.externalId) {
      throw new Error("Sage inbound identity changed after reconciliation.");
    }

    const observedAt = provider?.updatedAt ?? this.now().toISOString();
    const { data, error } = await this.db.rpc("apply_sage_reconcile_entity", {
      p_company_id: candidate.companyId,
      p_connection_id: candidate.connectionId,
      p_entity_type: candidate.entityType,
      p_entity_id: candidate.entityId,
      p_external_id: candidate.externalId,
      p_expected_ops_updated_at: candidate.opsUpdatedAt,
      p_provider_updated_at: observedAt,
      p_deleted_at: provider?.deletedAt ?? (provider ? null : observedAt),
      p_payload: provider?.payload ?? {},
    });
    if (error) throw error;

    const result = Array.isArray(data)
      ? (data[0] as RpcResult | undefined)
      : (data as RpcResult | null);
    return { opsUpdatedAt: requiredTimestamp(result?.ops_updated_at) };
  }
}
