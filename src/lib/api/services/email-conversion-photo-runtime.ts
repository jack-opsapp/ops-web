import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import {
  runEmailConversionPhotoWorker,
  type ClaimedEmailConversionPhotoCleanup,
  type ClaimedEmailConversionPhotoJob,
  type EmailConversionPhotoWorkerDependencies,
  type EmailConversionPhotoWorkerOptions,
  type EmailConversionPhotoWorkerResult,
  type EligibleEmailConversionPhotoSource,
  type NormalizedEmailConversionPhoto,
} from "./email-conversion-photo-worker";

const EMAIL_ATTACHMENTS_BUCKET = "email-attachments";
const PROJECT_PHOTOS_BUCKET = "project-photos";
const PROJECT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const MAX_HEIC_DIMENSION = 32_768;

interface JobRow {
  id: string;
  company_id: string;
  conversion_event_id: string;
  email_attachment_id: string;
  opportunity_id: string;
  project_id: string;
  source_content_sha256: string;
  source_verified_size_bytes: number | string;
  operation: string;
  generation: number | string;
  attempts: number | string;
  lease_token: string;
}

interface CleanupRow {
  id: string;
  job_id: string;
  company_id: string;
  conversion_event_id: string;
  email_attachment_id: string;
  project_id: string;
  generation: number | string;
  object_path: string;
  attempts: number | string;
  lease_token: string;
}

interface AttachmentRow {
  id: string;
  company_id: string;
  connection_id: string;
  activity_id: string | null;
  message_id: string;
  opportunity_id: string | null;
  detected_mime_type: string | null;
  filename: string | null;
  is_inline: boolean;
  occurred_at: string | null;
  storage_backend: string | null;
  storage_path: string | null;
  content_sha256: string | null;
  verified_size_bytes: number | string | null;
  ingest_status: string;
  attribution_status: string;
}

function mapJob(row: JobRow): ClaimedEmailConversionPhotoJob {
  if (row.operation !== "materialize" && row.operation !== "revoke") {
    throw new Error("Unknown email conversion photo operation");
  }
  if (!row.lease_token) {
    throw new Error("Claimed email conversion photo job has no lease token");
  }
  return {
    id: row.id,
    companyId: row.company_id,
    conversionEventId: row.conversion_event_id,
    emailAttachmentId: row.email_attachment_id,
    opportunityId: row.opportunity_id,
    projectId: row.project_id,
    sourceContentSha256: row.source_content_sha256,
    sourceVerifiedSizeBytes: Number(row.source_verified_size_bytes),
    operation: row.operation,
    generation: Number(row.generation),
    attempts: Number(row.attempts),
    leaseToken: row.lease_token,
  };
}

function mapCleanup(row: CleanupRow): ClaimedEmailConversionPhotoCleanup {
  if (!row.lease_token) {
    throw new Error("Claimed email conversion photo cleanup has no lease token");
  }
  return {
    id: row.id,
    jobId: row.job_id,
    companyId: row.company_id,
    conversionEventId: row.conversion_event_id,
    emailAttachmentId: row.email_attachment_id,
    projectId: row.project_id,
    generation: Number(row.generation),
    objectPath: row.object_path,
    attempts: Number(row.attempts),
    leaseToken: row.lease_token,
  };
}

function firstBoolean(data: unknown): boolean {
  if (typeof data === "boolean") return data;
  if (Array.isArray(data)) return data[0] === true;
  return false;
}

function looksLikeHeic(source: EligibleEmailConversionPhotoSource): boolean {
  const mimeType = source.detectedMimeType.trim().toLowerCase();
  const filename = (source.filename ?? "").trim().toLowerCase();
  return (
    mimeType === "image/heic" ||
    mimeType === "image/heif" ||
    mimeType === "image/heic-sequence" ||
    mimeType === "image/heif-sequence" ||
    filename.endsWith(".heic") ||
    filename.endsWith(".heif")
  );
}

function heicDimensionsAreSafe(bytes: Buffer): boolean {
  let foundSpatialExtent = false;

  for (let offset = 4; offset + 16 <= bytes.byteLength; offset += 1) {
    if (bytes.toString("ascii", offset, offset + 4) !== "ispe") continue;

    const boxStart = offset - 4;
    const boxSize = bytes.readUInt32BE(boxStart);
    if (boxSize < 20 || boxStart + boxSize > bytes.byteLength) continue;

    const width = bytes.readUInt32BE(offset + 8);
    const height = bytes.readUInt32BE(offset + 12);
    if (
      width === 0 ||
      height === 0 ||
      width > MAX_HEIC_DIMENSION ||
      height > MAX_HEIC_DIMENSION ||
      width * height > MAX_INPUT_PIXELS
    ) {
      return false;
    }
    foundSpatialExtent = true;
  }

  return foundSpatialExtent;
}

async function normalizeSharpCompatibleImage(
  bytes: Buffer
): Promise<NormalizedEmailConversionPhoto | null> {
  const candidates: Array<{ edge: number; quality: number }> = [
    { edge: 4096, quality: 88 },
    { edge: 4096, quality: 80 },
    { edge: 3584, quality: 76 },
    { edge: 3072, quality: 72 },
    { edge: 2560, quality: 68 },
    { edge: 2048, quality: 64 },
    { edge: 1600, quality: 58 },
    { edge: 1280, quality: 52 },
    { edge: 1024, quality: 48 },
  ];

  try {
    for (const candidate of candidates) {
      const normalized = await sharp(bytes, {
        animated: false,
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize({
          width: candidate.edge,
          height: candidate.edge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: candidate.quality, mozjpeg: true })
        .toBuffer();
      if (normalized.byteLength <= PROJECT_PHOTO_MAX_BYTES) {
        return { bytes: normalized, mimeType: "image/jpeg" };
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function normalizeEmailConversionProjectPhoto(
  bytes: Buffer,
  source: EligibleEmailConversionPhotoSource
): Promise<NormalizedEmailConversionPhoto | null> {
  const normalized = await normalizeSharpCompatibleImage(bytes);
  if (normalized || !looksLikeHeic(source) || !heicDimensionsAreSafe(bytes)) {
    return normalized;
  }

  try {
    const heicConvertModule = await import("heic-convert");
    const convert = heicConvertModule.default;
    const jpegBytes = Buffer.from(
      await convert({ buffer: bytes, format: "JPEG", quality: 0.9 })
    );
    return normalizeSharpCompatibleImage(jpegBytes);
  } catch {
    return null;
  }
}

export function createSupabaseEmailConversionPhotoDependencies(
  supabase: SupabaseClient
): EmailConversionPhotoWorkerDependencies {
  return {
    async claim(input) {
      const { data, error } = await supabase.rpc(
        "claim_email_conversion_photo_jobs",
        {
          p_worker_id: input.workerId,
          p_limit: input.limit,
          p_lease_seconds: input.leaseSeconds,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion photo claim failed: ${error.message}`
        );
      }
      return ((data ?? []) as JobRow[]).map(mapJob);
    },

    async claimCleanups(input) {
      const { data, error } = await supabase.rpc(
        "claim_email_conversion_photo_object_cleanups",
        {
          p_worker_id: input.workerId,
          p_limit: input.limit,
          p_lease_seconds: input.leaseSeconds,
          p_job_id: input.jobId,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion photo cleanup claim failed: ${error.message}`
        );
      }
      return ((data ?? []) as CleanupRow[]).map(mapCleanup);
    },

    async loadSource(job) {
      const { data, error } = await supabase
        .from("email_attachments")
        .select(
          "id,company_id,connection_id,activity_id,message_id,opportunity_id,detected_mime_type,filename,is_inline,occurred_at,storage_backend,storage_path,content_sha256,verified_size_bytes,ingest_status,attribution_status"
        )
        .eq("id", job.emailAttachmentId)
        .eq("company_id", job.companyId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `Email conversion photo source lookup failed: ${error.message}`
        );
      }
      const attachment = data as AttachmentRow | null;
      if (
        !attachment ||
        attachment.opportunity_id !== job.opportunityId ||
        attachment.ingest_status !== "stored" ||
        attachment.attribution_status !== "attributed" ||
        attachment.storage_backend !== "supabase" ||
        !attachment.storage_path ||
        attachment.content_sha256 !== job.sourceContentSha256 ||
        Number(attachment.verified_size_bytes) !==
          job.sourceVerifiedSizeBytes ||
        !attachment.detected_mime_type?.toLowerCase().startsWith("image/") ||
        !attachment.activity_id
      ) {
        return null;
      }

      const { data: activity, error: activityError } = await supabase
        .from("activities")
        .select(
          "id,type,company_id,email_connection_id,email_message_id,opportunity_id,direction,match_needs_review"
        )
        .eq("id", attachment.activity_id)
        .eq("company_id", job.companyId)
        .eq("email_connection_id", attachment.connection_id)
        .eq("email_message_id", attachment.message_id)
        .eq("opportunity_id", job.opportunityId)
        .eq("type", "email")
        .maybeSingle();
      if (activityError) {
        throw new Error(
          `Email conversion photo activity lookup failed: ${activityError.message}`
        );
      }
      if (
        !activity ||
        activity.type !== "email" ||
        activity.direction !== "inbound" ||
        activity.match_needs_review === true
      ) {
        return null;
      }

      return {
        storagePath: attachment.storage_path,
        detectedMimeType: attachment.detected_mime_type,
        filename: attachment.filename,
        isInline: attachment.is_inline,
        occurredAt: attachment.occurred_at,
        verifiedSizeBytes: Number(attachment.verified_size_bytes),
      } satisfies EligibleEmailConversionPhotoSource;
    },

    async downloadPrivate(storagePath) {
      const { data, error } = await supabase.storage
        .from(EMAIL_ATTACHMENTS_BUCKET)
        .download(storagePath);
      if (error || !data) {
        throw new Error(
          `Email conversion photo private read failed: ${error?.message ?? "no bytes"}`
        );
      }
      return Buffer.from(await data.arrayBuffer());
    },

    async normalizeImage(bytes, source) {
      return normalizeEmailConversionProjectPhoto(bytes, source);
    },

    async stageObject(input) {
      const { data, error } = await supabase.rpc(
        "stage_email_conversion_photo_object",
        {
          p_job_id: input.job.id,
          p_generation: input.job.generation,
          p_lease_token: input.job.leaseToken,
          p_object_path: input.objectPath,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion photo object staging failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    async uploadProjectPhoto(input) {
      if (input.bytes.byteLength > PROJECT_PHOTO_MAX_BYTES) {
        throw new Error("Normalized project photo exceeds storage limit");
      }
      const bucket = supabase.storage.from(PROJECT_PHOTOS_BUCKET);
      const { error: uploadError } = await bucket.upload(
        input.objectPath,
        new Uint8Array(input.bytes),
        {
          contentType: input.contentType,
          cacheControl: "31536000",
          upsert: true,
        }
      );
      if (uploadError) {
        throw new Error(
          `Email conversion project photo upload failed: ${uploadError.message}`
        );
      }

      const { data: verifiedObject, error: verifyError } =
        await bucket.download(input.objectPath);
      if (verifyError || !verifiedObject) {
        throw new Error(
          `Email conversion project photo verification failed: ${verifyError?.message ?? "no bytes"}`
        );
      }
      const verifiedBytes = Buffer.from(await verifiedObject.arrayBuffer());
      const expectedHash = createHash("sha256")
        .update(input.bytes)
        .digest("hex");
      const verifiedHash = createHash("sha256")
        .update(verifiedBytes)
        .digest("hex");
      if (
        verifiedBytes.byteLength !== input.bytes.byteLength ||
        verifiedHash !== expectedHash
      ) {
        throw new Error("Email conversion project photo verification mismatch");
      }

      const { data: publicUrl } = bucket.getPublicUrl(input.objectPath);
      if (!publicUrl.publicUrl) {
        throw new Error("Email conversion project photo URL missing");
      }
      return {
        objectPath: input.objectPath,
        publicUrl: publicUrl.publicUrl,
        verifiedSizeBytes: verifiedBytes.byteLength,
        contentSha256: verifiedHash,
      };
    },

    async markObjectCleanup(input) {
      const { data, error } = await supabase.rpc(
        "mark_email_conversion_photo_object_cleanup",
        {
          p_job_id: input.job.id,
          p_generation: input.job.generation,
          p_object_path: input.objectPath,
          p_reason: input.reason,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion photo cleanup reservation failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    async deleteProjectPhoto(objectPath) {
      const { error } = await supabase.storage
        .from(PROJECT_PHOTOS_BUCKET)
        .remove([objectPath]);
      if (error) {
        throw new Error(
          `Email conversion project photo removal failed: ${error.message}`
        );
      }
    },

    async finishObjectCleanup(input) {
      const { data, error } = await supabase.rpc(
        "finish_email_conversion_photo_object_cleanup",
        {
          p_object_id: input.cleanup.id,
          p_lease_token: input.cleanup.leaseToken,
          p_outcome: input.outcome,
          p_error: input.error,
          p_available_at: input.availableAt?.toISOString() ?? null,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion photo cleanup completion failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    async complete(input) {
      const { data, error } = await supabase.rpc(
        "complete_email_conversion_photo_job",
        {
          p_job_id: input.job.id,
          p_generation: input.job.generation,
          p_lease_token: input.job.leaseToken,
          p_project_storage_path: input.projectObjectPath,
          p_project_photo_url: input.projectPhotoUrl,
          p_project_content_sha256: input.projectContentSha256,
          p_project_verified_size_bytes: input.projectVerifiedSizeBytes,
          p_filename: input.filename,
          p_occurred_at: input.occurredAt,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion project photo completion failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    async completeRevocation(input) {
      const { data, error } = await supabase.rpc(
        "complete_email_conversion_photo_revocation",
        {
          p_job_id: input.job.id,
          p_generation: input.job.generation,
          p_lease_token: input.job.leaseToken,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion project photo revocation failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    async finish(input) {
      const { data, error } = await supabase.rpc(
        "finish_email_conversion_photo_job",
        {
          p_job_id: input.job.id,
          p_generation: input.job.generation,
          p_lease_token: input.job.leaseToken,
          p_outcome: input.outcome,
          p_error: input.error,
          p_available_at: input.availableAt?.toISOString() ?? null,
        }
      );
      if (error) {
        throw new Error(
          `Email conversion photo queue update failed: ${error.message}`
        );
      }
      return firstBoolean(data);
    },

    now: () => new Date(),
    workerId: () => randomUUID(),
  };
}

export async function runSupabaseEmailConversionPhotoWorker(
  supabase: SupabaseClient,
  options: EmailConversionPhotoWorkerOptions = {}
): Promise<EmailConversionPhotoWorkerResult> {
  return runEmailConversionPhotoWorker(
    createSupabaseEmailConversionPhotoDependencies(supabase),
    options
  );
}
