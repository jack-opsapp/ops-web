import "server-only";

import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  invalidateExternalAttachmentDeliveryPaths,
  verifyExternalAttachmentDeliveryDenied,
} from "./cloudfront-delivery";
import {
  getExternalIntakeWorkerS3Client,
  readExternalIntakeStorageConfig,
} from "./s3-client";

const storageObjectSchema = z
  .object({
    object_key: z.string().min(1),
    object_version_id: z.string().min(1),
  })
  .strict();

const claimedErasureSchema = z
  .object({
    id: z.string().uuid(),
    submission_id: z.string().uuid(),
    company_id: z.string().uuid(),
    opportunity_id: z.string().uuid(),
    attempt_count: z.coerce.number().int().positive(),
    lease_generation: z.coerce.number().int().positive(),
    lease_token: z.string().uuid(),
    invalidation_reference: z.string().min(1).nullable(),
    storage_objects: z.array(storageObjectSchema),
    invalidation_paths: z.array(z.string().startsWith("/")),
  })
  .strict();

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

interface ErasureWorkerOptions {
  limit?: number;
  leaseSeconds?: number;
  workerId?: string;
}

interface ErasureWorkerDependencies {
  deleteExactObject?: (
    objectKey: string,
    objectVersionId: string
  ) => Promise<void>;
  invalidatePaths?: (paths: string[]) => Promise<string>;
  verifyDeliveryDenied?: (objectKeys: string[]) => Promise<boolean>;
  now?: () => Date;
  s3?: S3Client;
}

export interface ExternalIntakeErasureWorkerResult {
  claimed: number;
  completed: number;
  requeued: number;
  stale: number;
  objectsDeleted: number;
  invalidationsCreated: number;
  errors: number;
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

function retryAt(now: Date, attempt: number): string {
  const delay = Math.min(
    60_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 20),
    24 * 60 * 60 * 1_000
  );
  return new Date(now.getTime() + delay).toISOString();
}

async function callRpc(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("external_intake_erasure_database_retry");
  return data;
}

function createExactDeleter(s3: S3Client, bucket: string) {
  return async (objectKey: string, objectVersionId: string): Promise<void> => {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        VersionId: objectVersionId,
      })
    );
    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          VersionId: objectVersionId,
          ChecksumMode: "ENABLED",
        })
      );
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    throw new Error("external_intake_erasure_delete_unconfirmed");
  };
}

export async function processExternalIntakeErasureBatch(
  supabase: SupabaseClient,
  options: ErasureWorkerOptions = {},
  dependencies: ErasureWorkerDependencies = {}
): Promise<ExternalIntakeErasureWorkerResult> {
  const client = supabase as unknown as RpcClient;
  const workerId = options.workerId ?? `erasure-${randomUUID()}`;
  const limit = bounded(options.limit, 5, 1, 25);
  const leaseSeconds = bounded(options.leaseSeconds, 360, 30, 900);
  const now = dependencies.now ?? (() => new Date());
  const s3 = dependencies.s3 ?? getExternalIntakeWorkerS3Client();
  const bucket = readExternalIntakeStorageConfig().bucket;
  const deleteExactObject =
    dependencies.deleteExactObject ?? createExactDeleter(s3, bucket);
  const invalidatePaths =
    dependencies.invalidatePaths ?? invalidateExternalAttachmentDeliveryPaths;
  const verifyDeliveryDenied =
    dependencies.verifyDeliveryDenied ?? verifyExternalAttachmentDeliveryDenied;
  const claimed = z.array(claimedErasureSchema).parse(
    (await callRpc(client, "claim_external_intake_erasures_as_system", {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    })) ?? []
  );
  const result: ExternalIntakeErasureWorkerResult = {
    claimed: claimed.length,
    completed: 0,
    requeued: 0,
    stale: 0,
    objectsDeleted: 0,
    invalidationsCreated: 0,
    errors: 0,
  };

  for (const request of claimed) {
    let invalidationReference = request.invalidation_reference;
    const lease = {
      p_erasure_id: request.id,
      p_worker_id: workerId,
      p_generation: request.lease_generation,
      p_lease_token: request.lease_token,
    };
    try {
      for (const object of request.storage_objects) {
        await deleteExactObject(object.object_key, object.object_version_id);
        result.objectsDeleted += 1;
      }

      if (request.invalidation_paths.length > 0) {
        if (!invalidationReference) {
          invalidationReference = await invalidatePaths(
            request.invalidation_paths
          );
          result.invalidationsCreated += 1;
        }
        const denied = await verifyDeliveryDenied(
          request.invalidation_paths.map((path) => path.slice(1))
        );
        if (!denied) {
          throw new Error("external_intake_erasure_delivery_still_available");
        }
      } else {
        invalidationReference ??= "no_delivery_paths";
      }

      const finished = await callRpc(
        client,
        "finish_external_intake_erasure_as_system",
        {
          ...lease,
          p_outcome: "deleted",
          p_invalidation_reference: invalidationReference,
          p_safe_code: null,
          p_available_at: null,
        }
      );
      if (finished === true) result.completed += 1;
      else result.stale += 1;
    } catch {
      result.errors += 1;
      try {
        const requeued = await callRpc(
          client,
          "finish_external_intake_erasure_as_system",
          {
            ...lease,
            p_outcome: "retry",
            p_invalidation_reference: invalidationReference,
            p_safe_code: "erasure_retry",
            p_available_at: retryAt(now(), request.attempt_count),
          }
        );
        if (requeued === true) result.requeued += 1;
        else result.stale += 1;
      } catch {
        // The durable lease expires and makes the request claimable again.
      }
    }
  }
  return result;
}
