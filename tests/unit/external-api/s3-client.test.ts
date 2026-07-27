import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readExternalIntakeStorageConfig } from "@/lib/external-api/uploads/s3-client";

const DEDICATED_ENVIRONMENT = {
  EXTERNAL_INTAKE_AWS_REGION: "us-west-2",
  EXTERNAL_INTAKE_S3_BUCKET: "ops-external-intake-test",
  EXTERNAL_INTAKE_AWS_ACCESS_KEY_ID: "dedicated-key-id",
  EXTERNAL_INTAKE_AWS_SECRET_ACCESS_KEY: "dedicated-secret",
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
  it("uses only the dedicated least-privilege storage configuration", () => {
    expect(readExternalIntakeStorageConfig()).toEqual({
      region: "us-west-2",
      bucket: "ops-external-intake-test",
      accessKeyId: "dedicated-key-id",
      secretAccessKey: "dedicated-secret",
    });
  });

  it.each(Object.keys(DEDICATED_ENVIRONMENT))(
    "fails closed when %s is missing",
    (name) => {
      vi.stubEnv(name, "");

      expect(() => readExternalIntakeStorageConfig()).toThrow(
        "external_intake_storage_unavailable"
      );
    }
  );
});
