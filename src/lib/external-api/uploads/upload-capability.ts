import "server-only";

import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getExternalIntakeS3Client,
  readExternalIntakeStorageConfig,
} from "@/lib/external-api/uploads/s3-client";

export const UPLOAD_CAPABILITY_MAX_SECONDS = 300;
export const UPLOAD_CAPABILITY_CLOCK_SKEW_SECONDS = 60;
export const UPLOAD_CAPABILITY_MAX_BYTES = 25 * 1024 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=?$/;

export interface ExternalUploadCapabilityInput {
  companyId: string;
  sourceId: string;
  intentId: string;
  fileId: string;
  contentLength: number;
  contentType: string;
  checksumSha256?: string;
  expiresInSeconds: number;
}

export interface ExternalUploadCapability {
  key: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
  deleteNotBefore: string;
}

interface CapabilityDependencies {
  now?: () => Date;
}

function assertValidInput(input: ExternalUploadCapabilityInput): void {
  const identifiers = [
    input.companyId,
    input.sourceId,
    input.intentId,
    input.fileId,
  ];

  if (
    identifiers.some((identifier) => !UUID_PATTERN.test(identifier)) ||
    !Number.isSafeInteger(input.contentLength) ||
    input.contentLength <= 0 ||
    input.contentLength > UPLOAD_CAPABILITY_MAX_BYTES ||
    !Number.isSafeInteger(input.expiresInSeconds) ||
    input.expiresInSeconds <= 0 ||
    input.expiresInSeconds > UPLOAD_CAPABILITY_MAX_SECONDS ||
    !CONTENT_TYPE_PATTERN.test(input.contentType) ||
    (input.checksumSha256 !== undefined &&
      !SHA256_BASE64_PATTERN.test(input.checksumSha256))
  ) {
    throw new Error("invalid_upload_capability");
  }
}

export async function issueExternalUploadCapability(
  input: ExternalUploadCapabilityInput,
  dependencies: CapabilityDependencies = {}
): Promise<ExternalUploadCapability> {
  assertValidInput(input);

  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("invalid_upload_capability");
  }

  const config = readExternalIntakeStorageConfig();
  const key = [
    "quarantine",
    input.companyId,
    input.sourceId,
    input.intentId,
    input.fileId,
    randomUUID(),
  ].join("/");

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentLength: input.contentLength,
    ContentType: input.contentType,
    ChecksumSHA256: input.checksumSha256,
    IfNoneMatch: "*",
  });
  const url = await getSignedUrl(getExternalIntakeS3Client(), command, {
    expiresIn: input.expiresInSeconds,
    signableHeaders: new Set(["content-type"]),
    unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
  });

  const headers: Record<string, string> = {
    "content-length": String(input.contentLength),
    "content-type": input.contentType,
    "if-none-match": "*",
  };
  if (input.checksumSha256) {
    headers["x-amz-checksum-sha256"] = input.checksumSha256;
  }

  return {
    key,
    method: "PUT",
    url,
    headers,
    expiresAt: new Date(
      now.getTime() + input.expiresInSeconds * 1_000
    ).toISOString(),
    deleteNotBefore: new Date(
      now.getTime() +
        (input.expiresInSeconds + UPLOAD_CAPABILITY_CLOCK_SKEW_SECONDS) * 1_000
    ).toISOString(),
  };
}
