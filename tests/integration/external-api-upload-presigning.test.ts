// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { issueExternalUploadCapability } from "@/lib/external-api/uploads/upload-capability";

const CHECKSUM_SHA256 = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

beforeAll(() => {
  vi.stubEnv("EXTERNAL_INTAKE_AWS_REGION", "us-west-2");
  vi.stubEnv("EXTERNAL_INTAKE_S3_BUCKET", "ops-external-intake-test");
  vi.stubEnv("EXTERNAL_INTAKE_UPLOAD_AWS_ACCESS_KEY_ID", "TESTKEY");
  vi.stubEnv("EXTERNAL_INTAKE_UPLOAD_AWS_SECRET_ACCESS_KEY", "TESTSECRET");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("external intake SigV4 upload request", () => {
  it("cryptographically binds every capability header without network access", async () => {
    const capability = await issueExternalUploadCapability({
      companyId: "0c942ee0-7da9-4f1a-92aa-b727eb808066",
      sourceId: "6012d920-b320-496d-8728-406dfbabcfbd",
      intentId: "6132981d-a70e-4296-8f9d-e4d137c476c1",
      fileId: "f9836477-5ad6-4853-afb3-cc37277779a6",
      contentLength: 4_096,
      contentType: "image/jpeg",
      checksumSha256: CHECKSUM_SHA256,
      expiresInSeconds: 120,
    });

    const signedUrl = new URL(capability.url);
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host;if-none-match;x-amz-checksum-sha256"
    );
    expect(signedUrl.searchParams.has("x-amz-checksum-sha256")).toBe(false);
    expect(capability.headers).toEqual({
      "content-length": "4096",
      "content-type": "image/jpeg",
      "if-none-match": "*",
      "x-amz-checksum-sha256": CHECKSUM_SHA256,
    });
  });
});
