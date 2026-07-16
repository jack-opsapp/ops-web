import { createHash } from "node:crypto";

export type EmailConversionPhotoOperation = "materialize" | "revoke";

export interface ClaimedEmailConversionPhotoJob {
  id: string;
  companyId: string;
  conversionEventId: string;
  emailAttachmentId: string;
  opportunityId: string;
  projectId: string;
  sourceContentSha256: string;
  sourceVerifiedSizeBytes: number;
  operation: EmailConversionPhotoOperation;
  generation: number;
  attempts: number;
  leaseToken: string;
}

export interface ClaimedEmailConversionPhotoCleanup {
  id: string;
  jobId: string;
  companyId: string;
  conversionEventId: string;
  emailAttachmentId: string;
  projectId: string;
  generation: number;
  objectPath: string;
  attempts: number;
  leaseToken: string;
}

export interface EligibleEmailConversionPhotoSource {
  storagePath: string;
  detectedMimeType: string;
  filename: string | null;
  isInline: boolean;
  occurredAt: string | null;
  verifiedSizeBytes: number;
}

export interface NormalizedEmailConversionPhoto {
  bytes: Buffer;
  mimeType: "image/jpeg";
}

export interface UploadedEmailConversionPhoto {
  objectPath: string;
  publicUrl: string;
  verifiedSizeBytes: number;
  contentSha256: string;
}

export interface EmailConversionPhotoWorkerDependencies {
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailConversionPhotoJob[]>;
  claimCleanups(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
    jobId: string | null;
  }): Promise<ClaimedEmailConversionPhotoCleanup[]>;
  loadSource(
    job: ClaimedEmailConversionPhotoJob
  ): Promise<EligibleEmailConversionPhotoSource | null>;
  downloadPrivate(storagePath: string): Promise<Buffer>;
  normalizeImage(
    bytes: Buffer,
    source: EligibleEmailConversionPhotoSource
  ): Promise<NormalizedEmailConversionPhoto | null>;
  stageObject(input: {
    job: ClaimedEmailConversionPhotoJob;
    objectPath: string;
  }): Promise<boolean>;
  uploadProjectPhoto(input: {
    objectPath: string;
    bytes: Buffer;
    contentType: "image/jpeg";
  }): Promise<UploadedEmailConversionPhoto>;
  markObjectCleanup(input: {
    job: ClaimedEmailConversionPhotoJob;
    objectPath: string;
    reason: string;
  }): Promise<boolean>;
  deleteProjectPhoto(objectPath: string): Promise<void>;
  finishObjectCleanup(input: {
    cleanup: ClaimedEmailConversionPhotoCleanup;
    outcome: "deleted" | "retrying";
    error: string | null;
    availableAt: Date | null;
  }): Promise<boolean>;
  complete(input: {
    job: ClaimedEmailConversionPhotoJob;
    filename: string | null;
    occurredAt: string | null;
    projectObjectPath: string;
    projectPhotoUrl: string;
    projectContentSha256: string;
    projectVerifiedSizeBytes: number;
  }): Promise<boolean>;
  completeRevocation(input: {
    job: ClaimedEmailConversionPhotoJob;
  }): Promise<boolean>;
  finish(input: {
    job: ClaimedEmailConversionPhotoJob;
    outcome: "retrying" | "failed" | "skipped";
    error: string;
    availableAt: Date | null;
  }): Promise<boolean>;
  now(): Date;
  workerId(): string;
}

export interface EmailConversionPhotoWorkerOptions {
  limit?: number;
  leaseSeconds?: number;
}

export interface EmailConversionPhotoWorkerResult {
  claimed: number;
  completed: number;
  retrying: number;
  skipped: number;
  failed: number;
  staleCompletions: number;
  cleanupClaimed: number;
  cleanupCompleted: number;
  cleanupRetrying: number;
  errors: Array<{ jobId?: string; objectId?: string; error: string }>;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_LEASE_SECONDS = 360;
const MAX_ATTEMPTS = 8;
const BASE_RETRY_MS = 60_000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

function requirePathSegment(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`Invalid ${field} for project photo path`);
  }
  return normalized;
}

export function buildEmailConversionProjectPhotoPath(
  job: ClaimedEmailConversionPhotoJob
): string {
  const companyId = requirePathSegment(job.companyId, "company id");
  const projectId = requirePathSegment(job.projectId, "project id");
  const conversionEventId = requirePathSegment(
    job.conversionEventId,
    "conversion event id"
  );
  const attachmentId = requirePathSegment(
    job.emailAttachmentId,
    "attachment id"
  );
  const sourceHash = job.sourceContentSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sourceHash)) {
    throw new Error("Invalid source hash for project photo path");
  }
  if (!Number.isSafeInteger(job.generation) || job.generation < 1) {
    throw new Error("Invalid generation for project photo path");
  }
  return `${companyId}/${projectId}/email/${conversionEventId}/${attachmentId}-${sourceHash.slice(0, 32)}-g${job.generation}.jpg`;
}

function retryAt(now: Date, attempts: number): Date {
  const exponent = Math.min(Math.max(attempts, 0), 30);
  const delayMs = Math.min(BASE_RETRY_MS * 2 ** exponent, MAX_RETRY_MS);
  return new Date(now.getTime() + delayMs);
}

function emptyResult(): EmailConversionPhotoWorkerResult {
  return {
    claimed: 0,
    completed: 0,
    retrying: 0,
    skipped: 0,
    failed: 0,
    staleCompletions: 0,
    cleanupClaimed: 0,
    cleanupCompleted: 0,
    cleanupRetrying: 0,
    errors: [],
  };
}

async function recordFinish(
  dependencies: EmailConversionPhotoWorkerDependencies,
  result: EmailConversionPhotoWorkerResult,
  input: Parameters<EmailConversionPhotoWorkerDependencies["finish"]>[0]
): Promise<void> {
  const updated = await dependencies.finish(input);
  if (!updated) {
    result.staleCompletions += 1;
    return;
  }
  result[input.outcome] += 1;
}

async function processCleanupBatch(
  dependencies: EmailConversionPhotoWorkerDependencies,
  result: EmailConversionPhotoWorkerResult,
  cleanups: ClaimedEmailConversionPhotoCleanup[]
): Promise<void> {
  result.cleanupClaimed += cleanups.length;

  for (const cleanup of cleanups) {
    try {
      await dependencies.deleteProjectPhoto(cleanup.objectPath);
      const completed = await dependencies.finishObjectCleanup({
        cleanup,
        outcome: "deleted",
        error: null,
        availableAt: null,
      });
      if (completed) result.cleanupCompleted += 1;
      else result.staleCompletions += 1;
    } catch (error) {
      const cleanupError = message(error);
      try {
        const updated = await dependencies.finishObjectCleanup({
          cleanup,
          outcome: "retrying",
          error: cleanupError,
          availableAt: retryAt(dependencies.now(), cleanup.attempts),
        });
        if (updated) result.cleanupRetrying += 1;
        else result.staleCompletions += 1;
      } catch (finishError) {
        result.errors.push({
          objectId: cleanup.id,
          error: `${cleanupError}; cleanup queue update failed: ${message(finishError)}`,
        });
      }
    }
  }
}

function sourceBytesMatch(
  job: ClaimedEmailConversionPhotoJob,
  source: EligibleEmailConversionPhotoSource,
  bytes: Buffer
): boolean {
  if (
    !Number.isSafeInteger(job.sourceVerifiedSizeBytes) ||
    job.sourceVerifiedSizeBytes < 0 ||
    source.verifiedSizeBytes !== job.sourceVerifiedSizeBytes ||
    bytes.byteLength !== job.sourceVerifiedSizeBytes
  ) {
    return false;
  }
  return (
    createHash("sha256").update(bytes).digest("hex") ===
    job.sourceContentSha256
  );
}

export async function runEmailConversionPhotoWorker(
  dependencies: EmailConversionPhotoWorkerDependencies,
  options: EmailConversionPhotoWorkerOptions = {}
): Promise<EmailConversionPhotoWorkerResult> {
  const workerId = dependencies.workerId();
  const limit = boundedInteger(options.limit, DEFAULT_LIMIT, 1, 20);
  const leaseSeconds = boundedInteger(
    options.leaseSeconds,
    DEFAULT_LEASE_SECONDS,
    30,
    900
  );
  const result = emptyResult();

  const abandonedCleanups = await dependencies.claimCleanups({
    workerId,
    limit,
    leaseSeconds,
    jobId: null,
  });
  await processCleanupBatch(dependencies, result, abandonedCleanups);

  const jobs = await dependencies.claim({ workerId, limit, leaseSeconds });
  result.claimed = jobs.length;

  for (const job of jobs) {
    let stagedObjectPath: string | null = null;

    try {
      if (job.operation === "revoke") {
        const revocationCleanups = await dependencies.claimCleanups({
          workerId,
          limit,
          leaseSeconds,
          jobId: job.id,
        });
        await processCleanupBatch(dependencies, result, revocationCleanups);

        const completed = await dependencies.completeRevocation({ job });
        if (completed) {
          result.completed += 1;
        } else {
          await recordFinish(dependencies, result, {
            job,
            outcome: "retrying",
            error: "PHOTO_OBJECT_CLEANUP_PENDING",
            availableAt: retryAt(dependencies.now(), job.attempts),
          });
        }
        continue;
      }

      const source = await dependencies.loadSource(job);
      if (!source) {
        await recordFinish(dependencies, result, {
          job,
          outcome: "skipped",
          error: "SOURCE_NOT_ELIGIBLE",
          availableAt: null,
        });
        continue;
      }

      const sourceBytes = await dependencies.downloadPrivate(
        source.storagePath
      );
      if (!sourceBytesMatch(job, source, sourceBytes)) {
        throw new Error("SOURCE_BYTES_IDENTITY_MISMATCH");
      }

      const normalized = await dependencies.normalizeImage(sourceBytes, source);
      if (!normalized) {
        await recordFinish(dependencies, result, {
          job,
          outcome: "skipped",
          error: "IMAGE_DECODE_UNSUPPORTED",
          availableAt: null,
        });
        continue;
      }

      const projectObjectPath = buildEmailConversionProjectPhotoPath(job);
      const staged = await dependencies.stageObject({
        job,
        objectPath: projectObjectPath,
      });
      if (!staged) {
        result.staleCompletions += 1;
        continue;
      }
      stagedObjectPath = projectObjectPath;

      const uploaded = await dependencies.uploadProjectPhoto({
        objectPath: projectObjectPath,
        bytes: normalized.bytes,
        contentType: normalized.mimeType,
      });
      if (uploaded.objectPath !== projectObjectPath) {
        throw new Error("PROJECT_PHOTO_STORAGE_IDENTITY_CONFLICT");
      }

      const completed = await dependencies.complete({
        job,
        filename: source.filename,
        occurredAt: source.occurredAt,
        projectObjectPath,
        projectPhotoUrl: uploaded.publicUrl,
        projectContentSha256: uploaded.contentSha256,
        projectVerifiedSizeBytes: uploaded.verifiedSizeBytes,
      });
      if (completed) {
        stagedObjectPath = null;
        result.completed += 1;
      } else {
        const marked = await dependencies.markObjectCleanup({
          job,
          objectPath: projectObjectPath,
          reason: "STALE_MATERIALIZATION_COMPLETION",
        });
        if (!marked) {
          result.errors.push({
            jobId: job.id,
            error: "Stale materialization cleanup could not be confirmed",
          });
        }
        stagedObjectPath = null;
        result.staleCompletions += 1;
      }
    } catch (error) {
      const errorMessage = message(error);
      let recordedError = errorMessage;

      if (stagedObjectPath) {
        try {
          await dependencies.markObjectCleanup({
            job,
            objectPath: stagedObjectPath,
            reason: `MATERIALIZATION_ERROR: ${errorMessage}`,
          });
        } catch (cleanupError) {
          recordedError = `${errorMessage}; object cleanup reservation failed: ${message(cleanupError)}`;
        }
      }

      const terminal = job.attempts >= MAX_ATTEMPTS;
      try {
        await recordFinish(dependencies, result, {
          job,
          outcome: terminal ? "failed" : "retrying",
          error: errorMessage,
          availableAt: terminal
            ? null
            : retryAt(dependencies.now(), job.attempts),
        });
        if (recordedError !== errorMessage) {
          result.errors.push({ jobId: job.id, error: recordedError });
        }
      } catch (finishError) {
        result.errors.push({
          jobId: job.id,
          error: `${recordedError}; queue update failed: ${message(finishError)}`,
        });
      }
    }
  }

  return result;
}
