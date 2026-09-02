import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

export interface ExternalIntakeStorageConfig {
  region: string;
  bucket: string;
}

export interface ExternalIntakeAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

let externalIntakeUploadSignerS3Client: S3Client | null = null;
let externalIntakeWorkerS3Client: S3Client | null = null;

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error("external_intake_storage_unavailable");
  }
  return value;
}

export function readExternalIntakeStorageConfig(): ExternalIntakeStorageConfig {
  return {
    region: requireEnvironmentValue("EXTERNAL_INTAKE_AWS_REGION"),
    bucket: requireEnvironmentValue("EXTERNAL_INTAKE_S3_BUCKET"),
  };
}

/**
 * Only this identity signs browser PUT capabilities. Its IAM policy permits
 * one conditional create operation and has no read, list, or delete access.
 */
export function getExternalIntakeUploadSignerCredentials(): ExternalIntakeAwsCredentials {
  return {
    accessKeyId: requireEnvironmentValue(
      "EXTERNAL_INTAKE_UPLOAD_AWS_ACCESS_KEY_ID"
    ),
    secretAccessKey: requireEnvironmentValue(
      "EXTERNAL_INTAKE_UPLOAD_AWS_SECRET_ACCESS_KEY"
    ),
  };
}

/**
 * The private maintenance identity consumes queues, inspects files, projects
 * accepted copies, and deletes exact versions during privacy erasure.
 */
export function getExternalIntakeWorkerCredentials(): ExternalIntakeAwsCredentials {
  return {
    accessKeyId: requireEnvironmentValue(
      "EXTERNAL_INTAKE_WORKER_AWS_ACCESS_KEY_ID"
    ),
    secretAccessKey: requireEnvironmentValue(
      "EXTERNAL_INTAKE_WORKER_AWS_SECRET_ACCESS_KEY"
    ),
  };
}

export function getExternalIntakeUploadSignerS3Client(): S3Client {
  if (externalIntakeUploadSignerS3Client) {
    return externalIntakeUploadSignerS3Client;
  }

  const config = readExternalIntakeStorageConfig();
  externalIntakeUploadSignerS3Client = new S3Client({
    region: config.region,
    credentials: getExternalIntakeUploadSignerCredentials(),
  });
  return externalIntakeUploadSignerS3Client;
}

export function getExternalIntakeWorkerS3Client(): S3Client {
  if (externalIntakeWorkerS3Client) {
    return externalIntakeWorkerS3Client;
  }

  const config = readExternalIntakeStorageConfig();
  externalIntakeWorkerS3Client = new S3Client({
    region: config.region,
    credentials: getExternalIntakeWorkerCredentials(),
  });
  return externalIntakeWorkerS3Client;
}
