import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fingerprintEmailImportPayload } from "@/lib/email/email-import-approval";
import type { AnalysisResult, ImportPayload } from "@/lib/types/email-import";

type ConnectionType = "company" | "individual";

export interface EmailImportSource {
  sourceScanJobId: string;
  companyId: string;
  connectionId: string;
  connectionEmail: string;
  connectionOwnerUserId: string | null;
  connectionType: ConnectionType;
  result: NonNullable<AnalysisResult["result"]>;
}

export interface EmailImportJobDispatch {
  jobId: string;
  shouldDispatch: boolean;
  resumed: boolean;
}

export interface AuthorizedEmailImportJob {
  jobId: string;
  sourceScanJobId: string;
  actorUserId: string;
  companyId: string;
  connectionId: string;
  connectionOwnerUserId: string | null;
  connectionType: ConnectionType;
  approvalFingerprint: string;
  approvedPayload: ImportPayload;
}

export interface CompleteEmailImportJobInput {
  supabase: SupabaseClient;
  jobId: string;
  result: Record<string, unknown>;
  progress: Record<string, unknown>;
}

export class EmailImportJobAccessError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "rpc_failed"
      | "invalid_response"
      | "fingerprint_mismatch",
    readonly databaseCode: string | null = null
  ) {
    super(message);
    this.name = "EmailImportJobAccessError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

function requiredString(
  row: Record<string, unknown>,
  key: string
): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableString(
  row: Record<string, unknown>,
  key: string
): string | null | undefined {
  const value = row[key];
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function connectionType(value: unknown): ConnectionType | null {
  return value === "company" || value === "individual" ? value : null;
}

function invalidResponse(message: string): never {
  throw new EmailImportJobAccessError(message, "invalid_response");
}

function rpcFailure(
  operation: string,
  error: { message?: string; code?: string }
): never {
  throw new EmailImportJobAccessError(
    `${operation} failed: ${error.message ?? "unknown error"}`,
    "rpc_failed",
    typeof error.code === "string" ? error.code : null
  );
}

/**
 * Resolve the latest completed scan through the immutable requester and exact
 * mailbox snapshot. The browser's company and mailbox values are never used
 * as authorization inputs.
 */
export async function loadEmailImportSourceForActor({
  supabase,
  actorUserId,
  connectionId,
}: {
  supabase: SupabaseClient;
  actorUserId: string;
  connectionId: string;
}): Promise<EmailImportSource> {
  const { data, error } = await supabase.rpc(
    "get_email_import_source_as_system",
    {
      p_actor_user_id: actorUserId,
      p_connection_id: connectionId,
    }
  );
  if (error) rpcFailure("Email import source authorization", error);

  const row = record(data);
  const sourceScanJobId = row && requiredString(row, "sourceScanJobId");
  const companyId = row && requiredString(row, "companyId");
  const resolvedConnectionId = row && requiredString(row, "connectionId");
  const connectionEmail = row && requiredString(row, "connectionEmail");
  const owner = row && nullableString(row, "connectionOwnerUserId");
  const type = row && connectionType(row.connectionType);
  const result = row?.result;
  if (
    !row ||
    !sourceScanJobId ||
    !companyId ||
    !resolvedConnectionId ||
    !connectionEmail ||
    owner === undefined ||
    !type ||
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !Array.isArray((result as { leads?: unknown }).leads)
  ) {
    invalidResponse("Email import source authorization returned invalid data");
  }

  return {
    sourceScanJobId,
    companyId,
    connectionId: resolvedConnectionId,
    connectionEmail,
    connectionOwnerUserId: owner,
    connectionType: type,
    result: result as NonNullable<AnalysisResult["result"]>,
  };
}

/** Persist the approved payload before any background work can start. */
export async function createOrResumeEmailImportJob({
  supabase,
  actorUserId,
  sourceScanJobId,
  approvedPayload,
  approvalFingerprint,
}: {
  supabase: SupabaseClient;
  actorUserId: string;
  sourceScanJobId: string;
  approvedPayload: ImportPayload;
  approvalFingerprint: string;
}): Promise<EmailImportJobDispatch> {
  const { data, error } = await supabase.rpc(
    "create_email_import_job_as_system",
    {
      p_actor_user_id: actorUserId,
      p_source_scan_job_id: sourceScanJobId,
      p_approved_payload: approvedPayload,
      p_approval_fingerprint: approvalFingerprint,
    }
  );
  if (error) rpcFailure("Email import job creation", error);

  const row = record(data);
  const jobId = row && requiredString(row, "jobId");
  if (
    !row ||
    !jobId ||
    typeof row.shouldDispatch !== "boolean" ||
    typeof row.resumed !== "boolean"
  ) {
    invalidResponse("Email import job creation returned invalid data");
  }
  return {
    jobId,
    shouldDispatch: row.shouldDispatch,
    resumed: row.resumed,
  };
}

/**
 * Re-authorize a durable import job and verify that its stored JSON still
 * matches the immutable approval fingerprint before each worker attempt.
 */
export async function loadAuthorizedEmailImportJob({
  supabase,
  jobId,
}: {
  supabase: SupabaseClient;
  jobId: string;
}): Promise<AuthorizedEmailImportJob> {
  const { data, error } = await supabase.rpc(
    "authorize_email_import_job_as_system",
    { p_job_id: jobId }
  );
  if (error) rpcFailure("Email import job authorization", error);

  const row = record(data);
  const resolvedJobId = row && requiredString(row, "jobId");
  const sourceScanJobId = row && requiredString(row, "sourceScanJobId");
  const actorUserId = row && requiredString(row, "actorUserId");
  const companyId = row && requiredString(row, "companyId");
  const connectionId = row && requiredString(row, "connectionId");
  const owner = row && nullableString(row, "connectionOwnerUserId");
  const type = row && connectionType(row.connectionType);
  const approvalFingerprint = row && requiredString(row, "approvalFingerprint");
  const approvedPayload = row?.approvedPayload;
  if (
    !row ||
    !resolvedJobId ||
    !sourceScanJobId ||
    !actorUserId ||
    !companyId ||
    !connectionId ||
    owner === undefined ||
    !type ||
    !approvalFingerprint ||
    !approvedPayload ||
    typeof approvedPayload !== "object" ||
    Array.isArray(approvedPayload)
  ) {
    invalidResponse("Email import job authorization returned invalid data");
  }

  const payload = approvedPayload as ImportPayload;
  if (
    payload.companyId !== companyId ||
    payload.connectionId !== connectionId ||
    !Array.isArray(payload.leads) ||
    payload.leads.length < 1
  ) {
    invalidResponse("Email import job payload identity is invalid");
  }

  if (fingerprintEmailImportPayload(payload) !== approvalFingerprint) {
    throw new EmailImportJobAccessError(
      "Email import approval fingerprint changed",
      "fingerprint_mismatch"
    );
  }

  return {
    jobId: resolvedJobId,
    sourceScanJobId,
    actorUserId,
    companyId,
    connectionId,
    connectionOwnerUserId: owner,
    connectionType: type,
    approvalFingerprint,
    approvedPayload: payload,
  };
}

/** Atomically commit the job result and the mailbox wizard checkpoint. */
export async function completeEmailImportJob({
  supabase,
  jobId,
  result,
  progress,
}: CompleteEmailImportJobInput): Promise<void> {
  const { data, error } = await supabase.rpc(
    "complete_email_import_job_as_system",
    {
      p_job_id: jobId,
      p_result: result,
      p_progress: progress,
    }
  );
  if (error) rpcFailure("Email import completion", error);
  if (data !== true) {
    invalidResponse("Email import completion returned invalid data");
  }
}
