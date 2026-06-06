export interface QuickBooksEstimateAcceptanceInput {
  companyId: string;
  connectionId: string;
  estimateId: string;
  qbEstimateId: string;
  qbUpdatedAt: string | null;
}

export interface QuickBooksEstimateAcceptanceResult {
  status: "succeeded" | "needs_review" | "skipped";
  reason?: string | null;
  estimate_id?: string | null;
  project_id?: string | null;
  opportunity_id?: string | null;
  idempotent_replay?: boolean;
  response?: Record<string, unknown>;
  [key: string]: unknown;
}

type RpcError = { message: string };
type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

function asAcceptanceResult(data: unknown): QuickBooksEstimateAcceptanceResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { status: "needs_review", reason: "empty_bridge_response" };
  }

  const record = data as Record<string, unknown>;
  const rawStatus = record.status;
  const status =
    rawStatus === "succeeded" || rawStatus === "skipped" || rawStatus === "needs_review"
      ? rawStatus
      : "needs_review";

  return {
    ...record,
    status,
    reason: typeof record.reason === "string" ? record.reason : null,
  } as QuickBooksEstimateAcceptanceResult;
}

export class QuickBooksEstimateAcceptanceService {
  constructor(private readonly supabase: RpcClient) {}

  async acceptFromQuickBooks(
    input: QuickBooksEstimateAcceptanceInput
  ): Promise<QuickBooksEstimateAcceptanceResult> {
    const idempotencyKey = `qbo:estimate:accepted:${input.connectionId}:${input.qbEstimateId}`;
    const { data, error } = await this.supabase.rpc("accept_estimate_to_job_from_quickbooks", {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_estimate_id: input.estimateId,
      p_qb_estimate_id: input.qbEstimateId,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      throw new Error(`QuickBooks estimate acceptance bridge failed: ${error.message}`);
    }

    return asAcceptanceResult(data);
  }
}
