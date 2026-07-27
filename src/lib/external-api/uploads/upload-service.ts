import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import type { ExternalApiRequestActor } from "../auth/credential-auth";
import {
  ExternalApiSafeError,
  type ExternalApiErrorCode,
} from "../contracts/errors";
import {
  type uploadBatchRequestSchema,
  uploadBatchResultSchema,
} from "../contracts/intake";
import { decodeOpaqueUuid, encodeOpaqueUuid } from "../contracts/opaque-id";
import { commitExternalApiAuditBase } from "../security/audit";
import {
  issueExternalUploadCapability,
  type ExternalUploadCapability,
  type ExternalUploadCapabilityInput,
} from "./upload-capability";

export { ExternalApiSafeError };

const UPLOAD_CAPABILITY_SECONDS = 120;
const UPLOAD_DELETE_GRACE_SECONDS = 60;
const UPLOAD_BATCH_SECONDS = 900;

type UploadBatchRequest = z.infer<typeof uploadBatchRequestSchema>;

interface UploadRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
}

interface UploadServiceDependencies {
  client?: UploadRpcClient;
  issueCapability?: (
    input: ExternalUploadCapabilityInput
  ) => Promise<ExternalUploadCapability>;
}

const reservedUploadSchema = z
  .object({
    public_upload_id: z.string().uuid(),
    caller_file_id: z.string(),
    state: z.enum([
      "issued",
      "uploaded",
      "claimed",
      "pending_inspection",
      "accepted",
      "rejected",
      "closed_missing",
      "expired",
    ]),
    capability_expires_at: z.string().datetime({ offset: true }),
    delete_not_before: z.string().datetime({ offset: true }),
    safe_code: z.string().nullable(),
  })
  .strict();

const reservationResultSchema = z
  .object({
    status: z.enum([
      "new",
      "replay",
      "conflict",
      "expired",
      "source_not_allowed",
      "form_not_allowed",
      "quota_exceeded",
    ]),
    batch_id: z.string().uuid().nullable(),
    audit_request_id: z.string().uuid(),
    uploads: z.array(reservedUploadSchema),
  })
  .strict();

function byteaHex(value: Buffer): string {
  return `\\x${value.toString("hex")}`;
}

function sha256Hex(value: string): string {
  return byteaHex(createHash("sha256").update(value).digest());
}

function addSeconds(timestamp: string, seconds: number): string {
  const milliseconds = new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new ExternalApiSafeError("invalid_request");
  }
  return new Date(milliseconds + seconds * 1_000).toISOString();
}

function checksumBase64(checksumHex: string | null): string | undefined {
  return checksumHex
    ? Buffer.from(checksumHex, "hex").toString("base64")
    : undefined;
}

export function hashCanonicalUploadManifest(
  files: UploadBatchRequest["files"]
): string {
  const canonical = files
    .map((file) => ({
      callerFileId: file.callerFileId,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType,
      sha256: file.sha256?.toLowerCase() ?? null,
    }))
    .sort((left, right) =>
      left.callerFileId.localeCompare(right.callerFileId, "en")
    );
  return sha256Hex(JSON.stringify(canonical));
}

function normalizedManifest(
  files: UploadBatchRequest["files"]
): UploadBatchRequest["files"] {
  return [...files]
    .map((file) => ({
      ...file,
      sha256: file.sha256?.toLowerCase(),
    }))
    .sort((left, right) =>
      left.callerFileId.localeCompare(right.callerFileId, "en")
    );
}

function actorArguments(actor: ExternalApiRequestActor) {
  return {
    p_principal_id: actor.principalId,
    p_credential_id: actor.credentialId,
    p_company_id: actor.companyId,
    p_digest_version: actor.digestVersion,
    p_credential_digest: actor.credentialDigest,
    p_visible_prefix: actor.visiblePrefix,
    p_authorization_epoch: actor.authorizationEpoch,
  };
}

function statusError(
  status: z.infer<typeof reservationResultSchema>["status"]
) {
  const codes: Partial<Record<typeof status, ExternalApiErrorCode>> = {
    conflict: "idempotency_conflict",
    expired: "upload_batch_expired",
    source_not_allowed: "source_not_allowed",
    form_not_allowed: "form_not_allowed",
    quota_exceeded: "rate_limited",
  };
  const code = codes[status];
  if (code) throw new ExternalApiSafeError(code);
}

async function releaseReservation(input: {
  client: UploadRpcClient;
  actor: ExternalApiRequestActor;
  batchId: string;
}): Promise<void> {
  try {
    await input.client.rpc("release_external_intake_upload_batch_as_system", {
      p_batch_id: input.batchId,
      ...actorArguments(input.actor),
    });
  } catch {
    // The safe caller response never depends on private compensation detail.
  }
}

export async function createExternalUploadBatch(
  input: Readonly<{
    actor: ExternalApiRequestActor;
    auditRequestId: string;
    requestReceivedAt: string;
    idempotencyKey: string;
    requestedOrigin: string | null;
    batch: UploadBatchRequest;
  }>,
  dependencies: UploadServiceDependencies = {}
) {
  let sourceUuid: string;
  let formUuid: string;
  try {
    sourceUuid = decodeOpaqueUuid(input.batch.sourceId, "src");
    formUuid = decodeOpaqueUuid(input.batch.formId, "frm");
  } catch {
    throw new ExternalApiSafeError("invalid_request");
  }

  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as UploadRpcClient);
  const issueCapability =
    dependencies.issueCapability ?? issueExternalUploadCapability;
  const capabilityExpiresAt = addSeconds(
    input.requestReceivedAt,
    UPLOAD_CAPABILITY_SECONDS
  );
  const deleteNotBefore = addSeconds(
    capabilityExpiresAt,
    UPLOAD_DELETE_GRACE_SECONDS
  );
  const batchExpiresAt = addSeconds(
    input.requestReceivedAt,
    UPLOAD_BATCH_SECONDS
  );
  const manifest = normalizedManifest(input.batch.files);
  const manifestByCallerFileId = new Map(
    manifest.map((file) => [file.callerFileId, file] as const)
  );

  let rpcResponse: { data: unknown; error: unknown };
  try {
    rpcResponse = await client.rpc(
      "reserve_external_intake_upload_batch_as_system",
      {
        p_request_id: input.auditRequestId,
        ...actorArguments(input.actor),
        p_source_public_id: sourceUuid,
        p_form_public_id: formUuid,
        p_idempotency_digest_version: 1,
        p_idempotency_digest: sha256Hex(input.idempotencyKey),
        p_manifest_hash_version: 1,
        p_manifest_hash: hashCanonicalUploadManifest(manifest),
        p_files: manifest,
        p_requested_origin: input.requestedOrigin,
        p_capability_expires_at: capabilityExpiresAt,
        p_delete_not_before: deleteNotBefore,
        p_batch_expires_at: batchExpiresAt,
        p_route: "/v1/intake/uploads",
        p_method: "POST",
        p_request_received_at: input.requestReceivedAt,
      }
    );
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  if (rpcResponse.error) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  const parsed = reservationResultSchema.safeParse(rpcResponse.data);
  if (!parsed.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  const reservation = parsed.data;
  statusError(reservation.status);
  if (
    (reservation.status !== "new" && reservation.status !== "replay") ||
    !reservation.batch_id ||
    reservation.uploads.length < 1
  ) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  try {
    const uploads = await Promise.all(
      reservation.uploads.map(async (upload) => {
        const uploadId = encodeOpaqueUuid("upl", upload.public_upload_id);
        const file = manifestByCallerFileId.get(upload.caller_file_id);
        if (!file) {
          throw new Error("invalid_upload_reservation");
        }
        if (upload.state === "issued") {
          const expectedChecksum = checksumBase64(file.sha256 ?? null);
          const objectKey = [
            "quarantine",
            input.actor.companyId,
            sourceUuid,
            reservation.batch_id,
            upload.public_upload_id,
          ].join("/");
          const capability = await issueCapability({
            objectKey,
            contentLength: file.sizeBytes,
            contentType: file.contentType,
            checksumSha256: expectedChecksum,
            expiresInSeconds: UPLOAD_CAPABILITY_SECONDS,
          });
          if (
            capability.key !== objectKey ||
            capability.headers["content-length"] !== String(file.sizeBytes) ||
            capability.headers["content-type"] !== file.contentType ||
            capability.headers["if-none-match"] !== "*" ||
            capability.headers["x-amz-checksum-sha256"] !== expectedChecksum
          ) {
            throw new Error("invalid_upload_capability");
          }
          return {
            callerFileId: upload.caller_file_id,
            uploadId,
            state: "issued" as const,
            capability: {
              method: "PUT" as const,
              url: capability.url,
              expiresAt: capability.expiresAt,
              requiredHeaders: {
                contentType: file.contentType,
                contentLength: file.sizeBytes,
                ifNoneMatch: "*" as const,
                ...(expectedChecksum
                  ? { checksumSha256: expectedChecksum }
                  : {}),
              },
            },
          };
        }
        if (
          upload.state === "uploaded" ||
          upload.state === "claimed" ||
          upload.state === "pending_inspection" ||
          upload.state === "accepted"
        ) {
          return {
            callerFileId: upload.caller_file_id,
            uploadId,
            state: "uploaded" as const,
            capability: null,
          };
        }
        return {
          callerFileId: upload.caller_file_id,
          uploadId,
          state:
            upload.state === "rejected"
              ? ("rejected" as const)
              : ("expired" as const),
          capability: null,
          safeCode:
            upload.safe_code ??
            (upload.state === "rejected"
              ? "upload_rejected"
              : "upload_expired"),
        };
      })
    );

    return {
      result: uploadBatchResultSchema.parse({
        replayed: reservation.status === "replay",
        uploads,
      }),
      auditBase: commitExternalApiAuditBase(reservation.audit_request_id),
      idempotencyResult:
        reservation.status === "replay"
          ? ("replay" as const)
          : ("new" as const),
    };
  } catch {
    await releaseReservation({
      client,
      actor: input.actor,
      batchId: reservation.batch_id,
    });
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
}
