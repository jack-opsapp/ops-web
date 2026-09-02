import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import {
  classifyExternalIntakeFile,
  reconcileGuardDutyResult,
  type ExternalIntakeGuardDutyStatus,
} from "./file-policy";
import {
  sanitizeExternalIntakeImage,
  type SanitizedExternalIntakeImage,
} from "./image-sanitizer";
import { inspectExternalIntakeStructure } from "./structural-inspector";

export interface ClaimedExternalIntakeInspection {
  id: string;
  intentId: string;
  companyId: string;
  objectKey: string;
  objectVersionId: string;
  filename: string;
  declaredContentType: string;
  expectedSizeBytes: number;
  expectedChecksumSha256: string | null;
  observedSizeBytes: number;
  observedChecksumSha256: string | null;
  guardDutyStatus: ExternalIntakeGuardDutyStatus;
  firstQueuedAt: string;
  deadlineAt: string;
  deleteNotBefore: string;
  attempts: number;
  generation: number;
  leaseToken: string;
}

export interface ExactExternalIntakeObject {
  bytes: Buffer;
  versionId: string;
  contentLength: number;
  checksumSha256: string | null;
}

export interface InspectionIdentity {
  inspection: ClaimedExternalIntakeInspection;
  workerId: string;
}

export interface RejectInput extends InspectionIdentity {
  safeCode: string;
}

export interface RetryInput extends InspectionIdentity {
  safeCode: string;
  availableAt: Date;
}

export interface AcceptInput extends InspectionIdentity {
  detectedContentType: string;
  sanitizedImage: SanitizedExternalIntakeImage | null;
  sourceBytes: Buffer;
  prepared?: PreparedExternalIntakeAcceptance;
}

export interface PreparedExternalIntakeDelivery {
  deliveryId: string;
  deliveryMode: "attachment" | "inline_image";
  objectKey: string;
  objectVersionId: string;
  contentLength: number;
  checksumSha256: string;
}

export interface PreparedExternalIntakeAcceptance extends PreparedExternalIntakeDelivery {
  deliveries: PreparedExternalIntakeDelivery[];
}

export interface CleanupInput extends InspectionIdentity {
  reason: string;
  deleteNotBefore: Date;
}

export interface ExternalIntakeAttachmentWorkerDependencies {
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedExternalIntakeInspection[]>;
  readExactObject(
    inspection: ClaimedExternalIntakeInspection
  ): Promise<ExactExternalIntakeObject>;
  tagAccepted(
    input: AcceptInput
  ): Promise<PreparedExternalIntakeAcceptance | void>;
  removeAcceptedTag?(input: AcceptInput): Promise<void>;
  accept(input: AcceptInput): Promise<boolean>;
  reject(input: RejectInput): Promise<boolean>;
  retry(input: RetryInput): Promise<boolean>;
  cleanup(input: CleanupInput): Promise<boolean>;
  now(): Date;
  workerId(): string;
}

export interface ExternalIntakeAttachmentWorkerOptions {
  limit?: number;
  leaseSeconds?: number;
}

export interface ExternalIntakeAttachmentWorkerResult {
  claimed: number;
  accepted: number;
  rejected: number;
  retrying: number;
  staleCompletions: number;
  errors: Array<{ inspectionId: string; safeCode: string }>;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_LEASE_SECONDS = 360;
const MAX_LIMIT = 25;
const MAX_LEASE_SECONDS = 900;
const MIN_LEASE_SECONDS = 30;
const BASE_RETRY_MS = 60_000;
const MAX_RETRY_MS = 60 * 60 * 1_000;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function retryAt(now: Date, deadline: Date, attempts: number): Date {
  const exponent = Math.min(Math.max(attempts - 1, 0), 20);
  const delay = Math.min(BASE_RETRY_MS * 2 ** exponent, MAX_RETRY_MS);
  return new Date(Math.min(now.getTime() + delay, deadline.getTime()));
}

function hashEquals(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function exactObjectMatches(
  job: ClaimedExternalIntakeInspection,
  object: ExactExternalIntakeObject
): boolean {
  const calculated = createHash("sha256").update(object.bytes).digest("hex");
  return (
    object.versionId === job.objectVersionId &&
    object.contentLength === object.bytes.length &&
    object.contentLength === job.observedSizeBytes &&
    object.contentLength === job.expectedSizeBytes &&
    hashEquals(object.checksumSha256, calculated) &&
    (job.observedChecksumSha256 === null ||
      hashEquals(job.observedChecksumSha256, calculated)) &&
    (job.expectedChecksumSha256 === null ||
      hashEquals(job.expectedChecksumSha256, calculated))
  );
}

async function cleanupRejected(
  dependencies: ExternalIntakeAttachmentWorkerDependencies,
  job: ClaimedExternalIntakeInspection,
  workerId: string,
  safeCode: string
): Promise<void> {
  const deleteNotBefore = validDate(job.deleteNotBefore) ?? dependencies.now();
  await dependencies.cleanup({
    inspection: job,
    workerId,
    reason: safeCode,
    deleteNotBefore,
  });
}

async function rejectInspection(
  dependencies: ExternalIntakeAttachmentWorkerDependencies,
  result: ExternalIntakeAttachmentWorkerResult,
  job: ClaimedExternalIntakeInspection,
  workerId: string,
  safeCode: string
): Promise<void> {
  const updated = await dependencies.reject({
    inspection: job,
    workerId,
    safeCode,
  });
  if (!updated) {
    result.staleCompletions += 1;
    return;
  }
  result.rejected += 1;
  try {
    await cleanupRejected(dependencies, job, workerId, safeCode);
  } catch {
    result.errors.push({
      inspectionId: job.id,
      safeCode: "cleanup_schedule_failed",
    });
  }
}

async function retryInspection(
  dependencies: ExternalIntakeAttachmentWorkerDependencies,
  result: ExternalIntakeAttachmentWorkerResult,
  job: ClaimedExternalIntakeInspection,
  workerId: string,
  safeCode: string,
  now: Date,
  deadline: Date
): Promise<void> {
  const updated = await dependencies.retry({
    inspection: job,
    workerId,
    safeCode,
    availableAt: retryAt(now, deadline, job.attempts),
  });
  if (updated) result.retrying += 1;
  else result.staleCompletions += 1;
}

function isImageKind(kind: string): boolean {
  return ["jpeg", "png", "webp", "heic", "heif"].includes(kind);
}

export async function runExternalIntakeAttachmentWorker(
  dependencies: ExternalIntakeAttachmentWorkerDependencies,
  options: ExternalIntakeAttachmentWorkerOptions = {}
): Promise<ExternalIntakeAttachmentWorkerResult> {
  const workerId = dependencies.workerId();
  const limit = boundedInteger(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const leaseSeconds = boundedInteger(
    options.leaseSeconds,
    DEFAULT_LEASE_SECONDS,
    MIN_LEASE_SECONDS,
    MAX_LEASE_SECONDS
  );
  const jobs = await dependencies.claim({ workerId, limit, leaseSeconds });
  const result: ExternalIntakeAttachmentWorkerResult = {
    claimed: jobs.length,
    accepted: 0,
    rejected: 0,
    retrying: 0,
    staleCompletions: 0,
    errors: [],
  };

  for (const job of jobs) {
    const now = dependencies.now();
    const deadline = validDate(job.deadlineAt);
    if (!deadline) {
      await rejectInspection(
        dependencies,
        result,
        job,
        workerId,
        "inspection_unavailable"
      );
      continue;
    }
    if (now.getTime() >= deadline.getTime()) {
      await rejectInspection(
        dependencies,
        result,
        job,
        workerId,
        "inspection_unavailable"
      );
      continue;
    }

    const malware = reconcileGuardDutyResult(job.guardDutyStatus);
    if (!malware.clean) {
      if (
        job.guardDutyStatus === "THREATS_FOUND" ||
        now.getTime() >= deadline.getTime()
      ) {
        await rejectInspection(
          dependencies,
          result,
          job,
          workerId,
          job.guardDutyStatus === "THREATS_FOUND"
            ? "malware_detected"
            : "inspection_unavailable"
        );
      } else {
        await retryInspection(
          dependencies,
          result,
          job,
          workerId,
          job.guardDutyStatus === null
            ? "malware_scan_pending"
            : malware.safeCode,
          now,
          deadline
        );
      }
      continue;
    }

    let preparedAcceptance: PreparedExternalIntakeAcceptance | undefined;
    let preparedInput: AcceptInput | undefined;
    try {
      const object = await dependencies.readExactObject(job);
      if (!exactObjectMatches(job, object)) {
        await rejectInspection(
          dependencies,
          result,
          job,
          workerId,
          "object_evidence_mismatch"
        );
        continue;
      }

      const identity = await classifyExternalIntakeFile({
        bytes: object.bytes,
        filename: job.filename,
        declaredContentType: job.declaredContentType,
        expectedSizeBytes: job.expectedSizeBytes,
        expectedChecksumSha256: job.expectedChecksumSha256,
      });
      if (!identity.accepted) {
        await rejectInspection(
          dependencies,
          result,
          job,
          workerId,
          identity.safeCode
        );
        continue;
      }

      const structural = await inspectExternalIntakeStructure({
        bytes: object.bytes,
        kind: identity.kind,
      });
      if (!structural.accepted) {
        await rejectInspection(
          dependencies,
          result,
          job,
          workerId,
          structural.safeCode
        );
        continue;
      }

      const sanitizedImage = isImageKind(identity.kind)
        ? await sanitizeExternalIntakeImage(object.bytes, identity.kind)
        : null;
      const acceptInput: AcceptInput = {
        inspection: job,
        workerId,
        detectedContentType: identity.detectedContentType,
        sanitizedImage,
        sourceBytes: object.bytes,
      };
      const prepared = await dependencies.tagAccepted(acceptInput);
      preparedAcceptance = prepared ?? undefined;
      preparedInput = {
        ...acceptInput,
        prepared: preparedAcceptance,
      };
      const updated = await dependencies.accept({
        ...preparedInput,
      });
      if (updated) {
        result.accepted += 1;
      } else {
        result.staleCompletions += 1;
        await dependencies.removeAcceptedTag?.(preparedInput);
      }
    } catch {
      if (preparedInput) {
        try {
          await dependencies.removeAcceptedTag?.(preparedInput);
        } catch {
          result.errors.push({
            inspectionId: job.id,
            safeCode: "delivery_cleanup_schedule_failed",
          });
        }
      }
      if (now.getTime() >= deadline.getTime()) {
        await rejectInspection(
          dependencies,
          result,
          job,
          workerId,
          "inspection_unavailable"
        );
      } else {
        await retryInspection(
          dependencies,
          result,
          job,
          workerId,
          "inspection_retry",
          now,
          deadline
        );
      }
    }
  }

  return result;
}
