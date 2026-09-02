import { z } from "zod";

interface ProjectionRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export type ExternalLeadProjectionRefreshReason =
  | "opportunity_changed"
  | "lifecycle_changed"
  | "source_changed"
  | "project_changed"
  | "financial_changed"
  | "backfill";

const projectionResultSchema = z
  .object({
    public_lead_id: z.string(),
    change_sequence: z.coerce.number().int().positive(),
    operation: z.enum(["upsert", "merge", "deletion"]),
  })
  .strict();

export class ExternalLeadProjectionError extends Error {
  constructor() {
    super("External lead projection refresh failed");
    this.name = "ExternalLeadProjectionError";
  }
}

export async function refreshExternalLeadProjection(
  client: ProjectionRpcClient,
  input: Readonly<{
    companyId: string;
    opportunityId: string;
    reason: ExternalLeadProjectionRefreshReason;
  }>
) {
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc("refresh_external_lead_projection_as_system", {
      p_company_id: input.companyId,
      p_opportunity_id: input.opportunityId,
      p_reason: input.reason,
    });
  } catch {
    throw new ExternalLeadProjectionError();
  }
  if (response.error) {
    throw new ExternalLeadProjectionError();
  }

  const candidate = Array.isArray(response.data)
    ? response.data[0]
    : response.data;
  const parsed = projectionResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ExternalLeadProjectionError();
  }

  return {
    publicLeadId: parsed.data.public_lead_id,
    changeSequence: parsed.data.change_sequence,
    operation: parsed.data.operation,
  };
}
