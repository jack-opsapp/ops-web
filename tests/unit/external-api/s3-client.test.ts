import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getExternalIntakeUploadSignerCredentials,
  getExternalIntakeWorkerCredentials,
  readExternalIntakeStorageConfig,
} from "@/lib/external-api/uploads/s3-client";

const DEDICATED_ENVIRONMENT = {
  EXTERNAL_INTAKE_AWS_REGION: "us-west-2",
  EXTERNAL_INTAKE_S3_BUCKET: "ops-external-intake-test",
  EXTERNAL_INTAKE_UPLOAD_AWS_ACCESS_KEY_ID: "upload-key-id",
  EXTERNAL_INTAKE_UPLOAD_AWS_SECRET_ACCESS_KEY: "upload-secret",
  EXTERNAL_INTAKE_WORKER_AWS_ACCESS_KEY_ID: "worker-key-id",
  EXTERNAL_INTAKE_WORKER_AWS_SECRET_ACCESS_KEY: "worker-secret",
};

beforeEach(() => {
  for (const [name, value] of Object.entries(DEDICATED_ENVIRONMENT)) {
    vi.stubEnv(name, value);
  }
  vi.stubEnv("AWS_ACCESS_KEY_ID", "shared-key-must-not-be-used");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "shared-secret-must-not-be-used");
  vi.stubEnv("AWS_S3_BUCKET", "shared-bucket-must-not-be-used");
  vi.stubEnv("AWS_REGION", "us-east-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("external intake S3 client configuration", () => {
  it("keeps create-only upload credentials separate from worker credentials", () => {
    expect(readExternalIntakeStorageConfig()).toEqual({
      region: "us-west-2",
      bucket: "ops-external-intake-test",
    });
    expect(getExternalIntakeUploadSignerCredentials()).toEqual({
      accessKeyId: "upload-key-id",
      secretAccessKey: "upload-secret",
    });
    expect(getExternalIntakeWorkerCredentials()).toEqual({
      accessKeyId: "worker-key-id",
      secretAccessKey: "worker-secret",
    });
  });

  it.each([
    ["EXTERNAL_INTAKE_AWS_REGION", readExternalIntakeStorageConfig],
    ["EXTERNAL_INTAKE_S3_BUCKET", readExternalIntakeStorageConfig],
    [
      "EXTERNAL_INTAKE_UPLOAD_AWS_ACCESS_KEY_ID",
      getExternalIntakeUploadSignerCredentials,
    ],
    [
      "EXTERNAL_INTAKE_UPLOAD_AWS_SECRET_ACCESS_KEY",
      getExternalIntakeUploadSignerCredentials,
    ],
    [
      "EXTERNAL_INTAKE_WORKER_AWS_ACCESS_KEY_ID",
      getExternalIntakeWorkerCredentials,
    ],
    [
      "EXTERNAL_INTAKE_WORKER_AWS_SECRET_ACCESS_KEY",
      getExternalIntakeWorkerCredentials,
    ],
  ] as const)("fails closed when %s is missing", (name, read) => {
    vi.stubEnv(name, "");

    expect(() => read()).toThrow("external_intake_storage_unavailable");
  });
});
