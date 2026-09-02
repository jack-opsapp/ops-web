import { z } from "zod";

interface ProjectionBackfillRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const runSchema = z
  .object({
    id: z.string().uuid(),
    company_id: z.string().uuid().nullable(),
    status: z.enum(["pending", "running", "complete", "verified", "failed"]),
    checkpoint_opportunity_id: z.string().uuid().nullable(),
    processed_count: z.coerce.number().int().nonnegative(),
    projected_count: z.coerce.number().int().nonnegative(),
    lease_token: z.string().uuid().nullable(),
    lease_generation: z.coerce.number().int().nonnegative(),
    lease_expires_at: z.string().nullable(),
  })
  .passthrough();

const inspectionSchema = z
  .object({
    company_id: z.string().uuid().nullable(),
    canonical_lead_count: z.coerce.number().int().nonnegative(),
    merged_lead_count: z.coerce.number().int().nonnegative(),
    deleted_lead_count: z.coerce.number().int().nonnegative(),
    missing_handle_count: z.coerce.number().int().nonnegative(),
    missing_baseline_count: z.coerce.number().int().nonnegative(),
    source_evidence_count: z.coerce.number().int().nonnegative(),
    expected_write_count: z.coerce.number().int().nonnegative(),
    business_row_checksum: z.string().length(32),
    current_checkpoint: z.unknown().nullable(),
  })
  .strict();

const verificationSchema = z
  .object({
    run_id: z.string().uuid(),
    status: z.literal("verified"),
    stable_public_handle: z.literal(true),
    current_baseline_complete: z.literal(true),
    company_monotonic_sequence: z.literal(true),
    tombstones_valid: z.literal(true),
    business_rows_unchanged: z.literal(true),
    processed_count: z.coerce.number().int().nonnegative(),
    verified_at: z.string(),
  })
  .strict();

export class ExternalLeadProjectionBackfillError extends Error {
  constructor(
    readonly command: string,
    cause?: unknown
  ) {
    super(`External lead projection backfill command failed: ${command}`, {
      cause,
    });
    this.name = "ExternalLeadProjectionBackfillError";
  }
}

async function rpc<T>(
  client: ProjectionBackfillRpcClient,
  command: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>
): Promise<T> {
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc(command, args);
  } catch (error) {
    throw new ExternalLeadProjectionBackfillError(command, error);
  }
  if (response.error) {
    throw new ExternalLeadProjectionBackfillError(command, response.error);
  }
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    throw new ExternalLeadProjectionBackfillError(command, parsed.error);
  }
  return parsed.data;
}

export function inspectExternalLeadProjectionBackfill(
  client: ProjectionBackfillRpcClient,
  companyId: string | null
) {
  return rpc(
    client,
    "inspect_external_lead_projection_backfill_as_system",
    { p_company_id: companyId },
    inspectionSchema
  );
}

export function startExternalLeadProjectionBackfill(
  client: ProjectionBackfillRpcClient,
  companyId: string | null
) {
  return rpc(
    client,
    "start_external_lead_projection_backfill_as_system",
    { p_company_id: companyId },
    runSchema
  );
}

export function claimExternalLeadProjectionBackfill(
  client: ProjectionBackfillRpcClient,
  runId: string,
  leaseSeconds = 60
) {
  return rpc(
    client,
    "claim_external_lead_projection_backfill_as_system",
    {
      p_run_id: runId,
      p_lease_seconds: leaseSeconds,
    },
    runSchema
  );
}

export function processExternalLeadProjectionBackfillBatch(
  client: ProjectionBackfillRpcClient,
  input: Readonly<{
    runId: string;
    leaseToken: string;
    leaseGeneration: number;
    batchSize?: number;
  }>
) {
  return rpc(
    client,
    "process_external_lead_projection_backfill_as_system",
    {
      p_run_id: input.runId,
      p_lease_token: input.leaseToken,
      p_lease_generation: input.leaseGeneration,
      p_batch_size: input.batchSize ?? 100,
    },
    runSchema
  );
}

export function verifyExternalLeadProjectionBackfill(
  client: ProjectionBackfillRpcClient,
  runId: string
) {
  return rpc(
    client,
    "verify_external_lead_projection_backfill_as_system",
    { p_run_id: runId },
    verificationSchema
  );
}

export async function executeExternalLeadProjectionBackfill(
  client: ProjectionBackfillRpcClient,
  input: Readonly<{
    companyId: string | null;
    batchSize?: number;
    leaseSeconds?: number;
  }>
) {
  let run = await startExternalLeadProjectionBackfill(client, input.companyId);
  if (run.status === "verified" || run.status === "complete") {
    return run;
  }

  run = await claimExternalLeadProjectionBackfill(
    client,
    run.id,
    input.leaseSeconds
  );
  if (!run.lease_token) {
    throw new ExternalLeadProjectionBackfillError("claim");
  }
  const leaseToken = run.lease_token;
  const leaseGeneration = run.lease_generation;

  while (run.status === "running") {
    run = await processExternalLeadProjectionBackfillBatch(client, {
      runId: run.id,
      leaseToken,
      leaseGeneration,
      batchSize: input.batchSize,
    });
  }
  if (run.status !== "complete" && run.status !== "verified") {
    throw new ExternalLeadProjectionBackfillError("process");
  }
  return run;
}

export type ExternalLeadProjectionBackfillRun = z.infer<typeof runSchema>;
export type ExternalLeadProjectionBackfillInspection = z.infer<
  typeof inspectionSchema
>;
