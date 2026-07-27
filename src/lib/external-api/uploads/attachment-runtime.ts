import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  runExternalIntakeAttachmentWorker,
  type AcceptInput,
  type ClaimedExternalIntakeInspection,
  type ExternalIntakeAttachmentWorkerDependencies,
  type PreparedExternalIntakeAcceptance,
  type PreparedExternalIntakeDelivery,
} from "./attachment-worker";
import {
  deleteExternalIntakeQueueMessage,
  receiveExternalIntakeQueueMessages,
  type NormalizedExternalIntakeQueueEvent,
} from "./queue-consumer";
import {
  getExternalIntakeS3Client,
  readExternalIntakeStorageConfig,
} from "./s3-client";

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const inspectionRowSchema = z
  .object({
    id: z.string().uuid(),
    intent_id: z.string().uuid(),
    company_id: z.string().uuid(),
    object_key: z.string(),
    object_version_id: z.string(),
    filename: z.string(),
    declared_content_type: z.string(),
    expected_size_bytes: z.coerce.number().int().positive(),
    expected_checksum_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    observed_size_bytes: z.coerce.number().int().positive(),
    observed_checksum_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    guardduty_status: z
      .enum([
        "NO_THREATS_FOUND",
        "THREATS_FOUND",
        "UNSUPPORTED",
        "ACCESS_DENIED",
        "FAILED",
      ])
      .nullable(),
    first_queued_at: z.string().datetime({ offset: true }),
    deadline_at: z.string().datetime({ offset: true }),
    delete_not_before: z.string().datetime({ offset: true }),
    attempts: z.coerce.number().int().positive(),
    generation: z.coerce.number().int().positive(),
    lease_token: z.string().uuid(),
  })
  .strict();

const cleanupRowSchema = z
  .object({
    intent_id: z.string().uuid(),
    company_id: z.string().uuid(),
    storage_object_key: z.string(),
    object_version_id: z.string(),
    attempt_count: z.coerce.number().int().positive(),
    lease_generation: z.coerce.number().int().positive(),
    lease_token: z.string().uuid(),
  })
  .strict();

const deliveryCleanupRowSchema = z
  .object({
    delivery_id: z.string().uuid(),
    storage_object_key: z.string(),
    object_version_id: z.string().nullable(),
    attempt_count: z.coerce.number().int().positive(),
    lease_generation: z.coerce.number().int().positive(),
    lease_token: z.string().uuid(),
  })
  .strict();

const stagedDeliverySchema = z
  .object({
    status: z.enum(["staged", "stale"]),
    delivery_id: z.string().uuid().optional(),
    state: z
      .enum([
        "staged",
        "uploaded",
        "published",
        "delete_pending",
        "deleting",
        "deleted",
      ])
      .optional(),
    object_version_id: z.string().nullable().optional(),
    size_bytes: z.coerce.number().int().positive().nullable().optional(),
    checksum_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
  })
  .strict();

interface ExternalIntakeMaintenanceOptions {
  eventLimit?: number;
  inspectionLimit?: number;
  cleanupLimit?: number;
  leaseSeconds?: number;
}

export interface ExternalIntakeMaintenanceResult {
  eventsRecorded: number;
  inspectionsClaimed: number;
  accepted: number;
  rejected: number;
  retrying: number;
  cleanupsClaimed: number;
  cleanupsCompleted: number;
  cleanupRetrying: number;
  expired: number;
  credentialsRetired: number;
  errors: Array<{ operation: string; safeCode: string }>;
}

interface RuntimeDependencies {
  s3?: S3Client;
  now?: () => Date;
  workerId?: () => string;
}

function rpcClient(client: SupabaseClient): RpcClient {
  return client as unknown as RpcClient;
}

async function callRpc(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("external_intake_database_unavailable");
  return data;
}

function byteaHex(hex: string | null): string | null {
  return hex ? `\\x${hex}` : null;
}

function base64ToHex(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === 32 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

function retryDate(now: Date, attempts: number): Date {
  const delay = Math.min(
    60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 20),
    24 * 60 * 60 * 1_000
  );
  return new Date(now.getTime() + delay);
}

function derivedUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.Code === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function isPreconditionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.$metadata?.httpStatusCode === 412
  );
}

async function bodyBuffer(body: unknown): Promise<Buffer> {
  if (
    body &&
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return Buffer.from(await body.transformToByteArray());
  }
  throw new Error("external_intake_storage_read_failed");
}

async function headExactObject(
  s3: S3Client,
  bucket: string,
  key: string,
  versionId?: string
) {
  return s3.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
      ChecksumMode: "ENABLED",
    })
  );
}

async function recordQueueEvent(
  client: RpcClient,
  s3: S3Client,
  bucket: string,
  event: NormalizedExternalIntakeQueueEvent
): Promise<boolean> {
  let observedSizeBytes = event.observedSizeBytes;
  let checksumHex: string | null = null;
  if (event.eventType === "object_created") {
    const head = await headExactObject(
      s3,
      bucket,
      event.objectKey,
      event.objectVersionId
    );
    if (
      head.VersionId !== event.objectVersionId ||
      head.ContentLength !== event.observedSizeBytes
    ) {
      throw new Error("external_intake_object_evidence_mismatch");
    }
    observedSizeBytes = head.ContentLength ?? null;
    checksumHex = base64ToHex(head.ChecksumSHA256);
  }

  const data = await callRpc(
    client,
    "record_external_intake_object_event_as_system",
    {
      p_provider_event_id: event.providerEventId,
      p_event_type: event.eventType,
      p_storage_object_key: event.objectKey,
      p_object_version_id: event.objectVersionId,
      p_provider_sequencer: event.providerSequencer,
      p_observed_size_bytes: observedSizeBytes,
      p_observed_checksum_sha256: byteaHex(checksumHex),
      p_guardduty_status: event.guardDutyStatus,
      p_occurred_at: event.occurredAt,
    }
  );
  const parsed = z
    .object({ status: z.enum(["recorded", "replay", "ignored"]) })
    .strict()
    .parse(data);
  return parsed.status === "recorded";
}

function mapInspection(
  row: z.infer<typeof inspectionRowSchema>
): ClaimedExternalIntakeInspection {
  return {
    id: row.id,
    intentId: row.intent_id,
    companyId: row.company_id,
    objectKey: row.object_key,
    objectVersionId: row.object_version_id,
    filename: row.filename,
    declaredContentType: row.declared_content_type,
    expectedSizeBytes: row.expected_size_bytes,
    expectedChecksumSha256: row.expected_checksum_sha256,
    observedSizeBytes: row.observed_size_bytes,
    observedChecksumSha256: row.observed_checksum_sha256,
    guardDutyStatus: row.guardduty_status,
    firstQueuedAt: row.first_queued_at,
    deadlineAt: row.deadline_at,
    deleteNotBefore: row.delete_not_before,
    attempts: row.attempts,
    generation: row.generation,
    leaseToken: row.lease_token,
  };
}

interface AcceptedTarget {
  deliveryMode: "attachment" | "inline_image";
  objectKey: string;
  bytes: Buffer;
  contentType: string;
}

function acceptedTargets(input: AcceptInput): AcceptedTarget[] {
  const suffix = derivedUuid(
    `${input.inspection.id}:${input.inspection.generation}`
  );
  const original: AcceptedTarget = {
    deliveryMode: "attachment",
    objectKey: `accepted-original/${input.inspection.companyId}/${input.inspection.intentId}/${suffix}`,
    bytes: input.sourceBytes,
    contentType: "application/octet-stream",
  };
  if (input.sanitizedImage) {
    const extension =
      input.sanitizedImage.contentType === "image/png"
        ? "png"
        : input.sanitizedImage.contentType === "image/webp"
          ? "webp"
          : "jpg";
    return [
      original,
      {
        deliveryMode: "inline_image",
        objectKey: `safe-derivative/${input.inspection.companyId}/${input.inspection.intentId}/${suffix}.${extension}`,
        bytes: input.sanitizedImage.bytes,
        contentType: input.sanitizedImage.contentType,
      },
    ];
  }
  return [original];
}

async function stageAcceptedDelivery(
  client: RpcClient,
  input: AcceptInput,
  target: AcceptedTarget
) {
  const data = await callRpc(
    client,
    "stage_external_intake_delivery_as_system",
    {
      p_inspection_id: input.inspection.id,
      p_worker_id: input.workerId,
      p_generation: input.inspection.generation,
      p_lease_token: input.inspection.leaseToken,
      p_delivery_mode: target.deliveryMode,
      p_storage_object_key: target.objectKey,
    }
  );
  const staged = stagedDeliverySchema.parse(data);
  if (staged.status !== "staged" || !staged.delivery_id) {
    throw new Error("external_intake_delivery_stale");
  }
  return staged;
}

async function verifyAcceptedObject(
  s3: S3Client,
  bucket: string,
  key: string,
  expectedBytes: Buffer,
  versionId?: string
): Promise<{
  objectVersionId: string;
  contentLength: number;
  checksumSha256: string;
}> {
  const head = await headExactObject(s3, bucket, key, versionId);
  if (!head.VersionId || head.ContentLength !== expectedBytes.length) {
    throw new Error("external_intake_delivery_evidence_mismatch");
  }
  let checksum = base64ToHex(head.ChecksumSHA256);
  if (!checksum) {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: head.VersionId,
      })
    );
    const bytes = await bodyBuffer(response.Body);
    checksum = createHash("sha256").update(bytes).digest("hex");
  }
  const expectedChecksum = createHash("sha256")
    .update(expectedBytes)
    .digest("hex");
  if (checksum !== expectedChecksum) {
    throw new Error("external_intake_delivery_evidence_mismatch");
  }
  return {
    objectVersionId: head.VersionId,
    contentLength: expectedBytes.length,
    checksumSha256: checksum,
  };
}

async function prepareAcceptedTarget(
  client: RpcClient,
  s3: S3Client,
  bucket: string,
  input: AcceptInput,
  target: AcceptedTarget
): Promise<PreparedExternalIntakeDelivery> {
  const staged = await stageAcceptedDelivery(client, input, target);
  const deliveryId = staged.delivery_id;
  if (!deliveryId) {
    throw new Error("external_intake_delivery_stale");
  }
  const checksumHex = createHash("sha256").update(target.bytes).digest("hex");
  const checksumBase64 = Buffer.from(checksumHex, "hex").toString("base64");

  let evidence: Awaited<ReturnType<typeof verifyAcceptedObject>>;
  if (
    staged.state === "uploaded" &&
    staged.object_version_id &&
    staged.checksum_sha256 === checksumHex &&
    staged.size_bytes === target.bytes.length
  ) {
    evidence = await verifyAcceptedObject(
      s3,
      bucket,
      target.objectKey,
      target.bytes,
      staged.object_version_id
    );
  } else {
    try {
      const response = await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: target.objectKey,
          Body: target.bytes,
          ContentLength: target.bytes.length,
          ContentType: target.contentType,
          ChecksumSHA256: checksumBase64,
          IfNoneMatch: "*",
          Tagging:
            "GuardDutyMalwareScanStatus=NO_THREATS_FOUND&ops-disposition=accepted",
        })
      );
      if (!response.VersionId) {
        throw new Error("external_intake_delivery_version_missing");
      }
      evidence = await verifyAcceptedObject(
        s3,
        bucket,
        target.objectKey,
        target.bytes,
        response.VersionId
      );
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error;
      evidence = await verifyAcceptedObject(
        s3,
        bucket,
        target.objectKey,
        target.bytes
      );
    }
  }

  const recorded = await callRpc(
    client,
    "record_external_intake_delivery_as_system",
    {
      p_delivery_id: deliveryId,
      p_inspection_id: input.inspection.id,
      p_worker_id: input.workerId,
      p_generation: input.inspection.generation,
      p_lease_token: input.inspection.leaseToken,
      p_object_version_id: evidence.objectVersionId,
      p_size_bytes: evidence.contentLength,
      p_checksum_sha256: byteaHex(evidence.checksumSha256),
    }
  );
  if (recorded !== true) {
    throw new Error("external_intake_delivery_stale");
  }
  return {
    deliveryId,
    deliveryMode: target.deliveryMode,
    objectKey: target.objectKey,
    objectVersionId: evidence.objectVersionId,
    contentLength: evidence.contentLength,
    checksumSha256: evidence.checksumSha256,
  };
}

async function prepareAcceptedDelivery(
  client: RpcClient,
  s3: S3Client,
  bucket: string,
  input: AcceptInput
): Promise<PreparedExternalIntakeAcceptance> {
  const deliveries: PreparedExternalIntakeDelivery[] = [];
  for (const target of acceptedTargets(input)) {
    deliveries.push(
      await prepareAcceptedTarget(client, s3, bucket, input, target)
    );
  }
  const primary =
    deliveries.find((delivery) => delivery.deliveryMode === "inline_image") ??
    deliveries[0];
  if (!primary) {
    throw new Error("external_intake_delivery_missing");
  }
  return {
    ...primary,
    deliveries,
  };
}

function createWorkerDependencies(
  client: RpcClient,
  s3: S3Client,
  bucket: string,
  now: () => Date,
  workerId: () => string
): ExternalIntakeAttachmentWorkerDependencies {
  return {
    async claim(input) {
      const data = await callRpc(
        client,
        "claim_external_intake_inspections_as_system",
        {
          p_worker_id: input.workerId,
          p_limit: input.limit,
          p_lease_seconds: input.leaseSeconds,
        }
      );
      return z
        .array(inspectionRowSchema)
        .parse(data ?? [])
        .map(mapInspection);
    },
    async readExactObject(inspection) {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: inspection.objectKey,
          VersionId: inspection.objectVersionId,
          ChecksumMode: "ENABLED",
        })
      );
      if (
        response.ContentLength !== inspection.observedSizeBytes ||
        response.ContentLength < 1 ||
        response.ContentLength > 25 * 1024 * 1024
      ) {
        throw new Error("external_intake_object_evidence_mismatch");
      }
      const bytes = await bodyBuffer(response.Body);
      return {
        bytes,
        versionId: response.VersionId ?? "",
        contentLength: response.ContentLength ?? bytes.length,
        checksumSha256:
          base64ToHex(response.ChecksumSHA256) ??
          createHash("sha256").update(bytes).digest("hex"),
      };
    },
    tagAccepted: (input) => prepareAcceptedDelivery(client, s3, bucket, input),
    async removeAcceptedTag(input) {
      if (!input.prepared) return;
      for (const delivery of input.prepared.deliveries) {
        await callRpc(client, "abandon_external_intake_delivery_as_system", {
          p_delivery_id: delivery.deliveryId,
          p_safe_code: "stale_delivery",
        });
      }
    },
    async accept(input) {
      if (!input.prepared) {
        throw new Error("external_intake_delivery_missing");
      }
      return (
        (await callRpc(client, "finish_external_intake_inspection_as_system", {
          p_inspection_id: input.inspection.id,
          p_worker_id: input.workerId,
          p_generation: input.inspection.generation,
          p_lease_token: input.inspection.leaseToken,
          p_outcome: "accepted",
          p_safe_code: null,
          p_available_at: null,
          p_detected_content_type: input.detectedContentType,
          p_delivery_object_id: input.prepared.deliveryId,
          p_delivery_mode: input.prepared.deliveryMode,
          p_accepted_object_key: input.prepared.objectKey,
          p_accepted_object_version_id: input.prepared.objectVersionId,
          p_accepted_size_bytes: input.prepared.contentLength,
          p_accepted_checksum_sha256: byteaHex(input.prepared.checksumSha256),
        })) === true
      );
    },
    async reject(input) {
      return (
        (await callRpc(client, "finish_external_intake_inspection_as_system", {
          p_inspection_id: input.inspection.id,
          p_worker_id: input.workerId,
          p_generation: input.inspection.generation,
          p_lease_token: input.inspection.leaseToken,
          p_outcome: "rejected",
          p_safe_code: input.safeCode,
          p_available_at: null,
          p_detected_content_type: null,
          p_delivery_object_id: null,
          p_delivery_mode: null,
          p_accepted_object_key: null,
          p_accepted_object_version_id: null,
          p_accepted_size_bytes: null,
          p_accepted_checksum_sha256: null,
        })) === true
      );
    },
    async retry(input) {
      return (
        (await callRpc(client, "finish_external_intake_inspection_as_system", {
          p_inspection_id: input.inspection.id,
          p_worker_id: input.workerId,
          p_generation: input.inspection.generation,
          p_lease_token: input.inspection.leaseToken,
          p_outcome: "retrying",
          p_safe_code: input.safeCode,
          p_available_at: input.availableAt.toISOString(),
          p_detected_content_type: null,
          p_delivery_object_id: null,
          p_delivery_mode: null,
          p_accepted_object_key: null,
          p_accepted_object_version_id: null,
          p_accepted_size_bytes: null,
          p_accepted_checksum_sha256: null,
        })) === true
      );
    },
    cleanup: async () => true,
    now,
    workerId,
  };
}

async function deleteExactVersion(
  s3: S3Client,
  bucket: string,
  key: string,
  versionId: string
): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
    })
  );
  try {
    await headExactObject(s3, bucket, key, versionId);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  throw new Error("external_intake_storage_delete_unconfirmed");
}

async function processQuarantineCleanups(
  client: RpcClient,
  s3: S3Client,
  bucket: string,
  workerId: string,
  limit: number,
  leaseSeconds: number,
  now: Date
) {
  const data = await callRpc(
    client,
    "claim_external_intake_cleanups_as_system",
    {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    }
  );
  const cleanups = z.array(cleanupRowSchema).parse(data ?? []);
  let completed = 0;
  let retrying = 0;
  for (const cleanup of cleanups) {
    try {
      await deleteExactVersion(
        s3,
        bucket,
        cleanup.storage_object_key,
        cleanup.object_version_id
      );
      const finished = await callRpc(
        client,
        "finish_external_intake_cleanup_as_system",
        {
          p_intent_id: cleanup.intent_id,
          p_worker_id: workerId,
          p_generation: cleanup.lease_generation,
          p_lease_token: cleanup.lease_token,
          p_object_version_id: cleanup.object_version_id,
          p_outcome: "deleted",
          p_safe_code: null,
          p_available_at: null,
        }
      );
      if (finished === true) completed += 1;
    } catch {
      await callRpc(client, "finish_external_intake_cleanup_as_system", {
        p_intent_id: cleanup.intent_id,
        p_worker_id: workerId,
        p_generation: cleanup.lease_generation,
        p_lease_token: cleanup.lease_token,
        p_object_version_id: cleanup.object_version_id,
        p_outcome: "retrying",
        p_safe_code: "storage_delete_retry",
        p_available_at: retryDate(now, cleanup.attempt_count).toISOString(),
      });
      retrying += 1;
    }
  }
  return { claimed: cleanups.length, completed, retrying };
}

async function processDeliveryCleanups(
  client: RpcClient,
  s3: S3Client,
  bucket: string,
  workerId: string,
  limit: number,
  leaseSeconds: number,
  now: Date
) {
  const data = await callRpc(
    client,
    "claim_external_intake_delivery_cleanups_as_system",
    {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    }
  );
  const cleanups = z.array(deliveryCleanupRowSchema).parse(data ?? []);
  let completed = 0;
  let retrying = 0;
  for (const cleanup of cleanups) {
    let observedVersion = cleanup.object_version_id;
    try {
      if (!observedVersion) {
        try {
          const head = await headExactObject(
            s3,
            bucket,
            cleanup.storage_object_key
          );
          observedVersion = head.VersionId ?? null;
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
      if (observedVersion) {
        await deleteExactVersion(
          s3,
          bucket,
          cleanup.storage_object_key,
          observedVersion
        );
      }
      const finished = await callRpc(
        client,
        "finish_external_intake_delivery_cleanup_as_system",
        {
          p_delivery_id: cleanup.delivery_id,
          p_worker_id: workerId,
          p_generation: cleanup.lease_generation,
          p_lease_token: cleanup.lease_token,
          p_observed_object_version_id: observedVersion,
          p_outcome: "deleted",
          p_safe_code: null,
          p_available_at: null,
        }
      );
      if (finished === true) completed += 1;
    } catch {
      await callRpc(
        client,
        "finish_external_intake_delivery_cleanup_as_system",
        {
          p_delivery_id: cleanup.delivery_id,
          p_worker_id: workerId,
          p_generation: cleanup.lease_generation,
          p_lease_token: cleanup.lease_token,
          p_observed_object_version_id: observedVersion,
          p_outcome: "retrying",
          p_safe_code: "storage_delete_retry",
          p_available_at: retryDate(now, cleanup.attempt_count).toISOString(),
        }
      );
      retrying += 1;
    }
  }
  return { claimed: cleanups.length, completed, retrying };
}

export async function runExternalIntakeMaintenance(
  supabase: SupabaseClient,
  options: ExternalIntakeMaintenanceOptions = {},
  dependencies: RuntimeDependencies = {}
): Promise<ExternalIntakeMaintenanceResult> {
  const eventLimit = bounded(options.eventLimit, 10, 1, 20);
  const inspectionLimit = bounded(options.inspectionLimit, 5, 1, 25);
  const cleanupLimit = bounded(options.cleanupLimit, 5, 1, 25);
  const leaseSeconds = bounded(options.leaseSeconds, 360, 30, 900);
  const client = rpcClient(supabase);
  const s3 = dependencies.s3 ?? getExternalIntakeS3Client();
  const bucket = readExternalIntakeStorageConfig().bucket;
  const now = dependencies.now ?? (() => new Date());
  const workerId = dependencies.workerId ?? (() => `ext-${randomUUID()}`);
  const result: ExternalIntakeMaintenanceResult = {
    eventsRecorded: 0,
    inspectionsClaimed: 0,
    accepted: 0,
    rejected: 0,
    retrying: 0,
    cleanupsClaimed: 0,
    cleanupsCompleted: 0,
    cleanupRetrying: 0,
    expired: 0,
    credentialsRetired: 0,
    errors: [],
  };

  try {
    const messages = await receiveExternalIntakeQueueMessages(eventLimit);
    for (const message of messages) {
      for (const event of message.events) {
        if (await recordQueueEvent(client, s3, bucket, event)) {
          result.eventsRecorded += 1;
        }
      }
      await deleteExternalIntakeQueueMessage(message);
    }
  } catch {
    result.errors.push({
      operation: "event_ingestion",
      safeCode: "queue_retry",
    });
  }

  try {
    const maintenance = z
      .object({
        expired: z.coerce.number().int().nonnegative(),
        terminalized: z.coerce.number().int().nonnegative(),
        cleanup_scheduled: z.coerce.number().int().nonnegative(),
        credentials_retired: z.coerce.number().int().nonnegative(),
      })
      .strict()
      .parse(
        await callRpc(client, "maintain_external_intake_files_as_system", {
          p_limit: 100,
        })
      );
    result.expired = maintenance.expired + maintenance.terminalized;
    result.credentialsRetired = maintenance.credentials_retired;
  } catch {
    result.errors.push({
      operation: "maintenance",
      safeCode: "database_retry",
    });
  }

  try {
    const inspection = await runExternalIntakeAttachmentWorker(
      createWorkerDependencies(client, s3, bucket, now, workerId),
      { limit: inspectionLimit, leaseSeconds }
    );
    result.inspectionsClaimed = inspection.claimed;
    result.accepted = inspection.accepted;
    result.rejected = inspection.rejected;
    result.retrying = inspection.retrying;
    if (inspection.errors.length > 0) {
      result.errors.push({
        operation: "inspection",
        safeCode: "inspection_partial",
      });
    }
  } catch {
    result.errors.push({
      operation: "inspection",
      safeCode: "inspection_retry",
    });
  }

  const activeWorkerId = workerId();
  try {
    const [quarantine, delivery] = await Promise.all([
      processQuarantineCleanups(
        client,
        s3,
        bucket,
        activeWorkerId,
        cleanupLimit,
        leaseSeconds,
        now()
      ),
      processDeliveryCleanups(
        client,
        s3,
        bucket,
        activeWorkerId,
        cleanupLimit,
        leaseSeconds,
        now()
      ),
    ]);
    result.cleanupsClaimed = quarantine.claimed + delivery.claimed;
    result.cleanupsCompleted = quarantine.completed + delivery.completed;
    result.cleanupRetrying = quarantine.retrying + delivery.retrying;
  } catch {
    result.errors.push({
      operation: "cleanup",
      safeCode: "cleanup_retry",
    });
  }

  return result;
}
