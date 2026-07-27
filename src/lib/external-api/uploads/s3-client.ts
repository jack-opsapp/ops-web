import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

export interface ExternalIntakeStorageConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

let externalIntakeS3Client: S3Client | null = null;

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error("external_intake_storage_unavailable");
  }
  return value;
}

/**
 * External intake uses a dedicated, create-only AWS principal. It must never
 * inherit the broader credentials used by existing OPS storage paths.
 */
export function readExternalIntakeStorageConfig(): ExternalIntakeStorageConfig {
  return {
    region: requireEnvironmentValue("EXTERNAL_INTAKE_AWS_REGION"),
    bucket: requireEnvironmentValue("EXTERNAL_INTAKE_S3_BUCKET"),
    accessKeyId: requireEnvironmentValue("EXTERNAL_INTAKE_AWS_ACCESS_KEY_ID"),
    secretAccessKey: requireEnvironmentValue(
      "EXTERNAL_INTAKE_AWS_SECRET_ACCESS_KEY"
    ),
  };
}

export function getExternalIntakeS3Client(): S3Client {
  if (externalIntakeS3Client) {
    return externalIntakeS3Client;
  }

  const config = readExternalIntakeStorageConfig();
  externalIntakeS3Client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return externalIntakeS3Client;
}
