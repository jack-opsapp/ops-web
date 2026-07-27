import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSignedUrlMock, getClientMock } = vi.hoisted(() => ({
  getSignedUrlMock: vi.fn(),
  getClientMock: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.mock("@/lib/external-api/uploads/s3-client", () => ({
  getExternalIntakeS3Client: getClientMock,
  readExternalIntakeStorageConfig: () => ({
    region: "us-west-2",
    bucket: "ops-external-intake-test",
  }),
}));

import {
  issueExternalUploadCapability,
  UPLOAD_CAPABILITY_CLOCK_SKEW_SECONDS,
  UPLOAD_CAPABILITY_MAX_SECONDS,
} from "@/lib/external-api/uploads/upload-capability";

const FIXED_NOW = new Date("2026-07-26T22:00:00.000Z");
const CHECKSUM_SHA256 = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const IDS = {
  companyId: "0c942ee0-7da9-4f1a-92aa-b727eb808066",
  sourceId: "6012d920-b320-496d-8728-406dfbabcfbd",
  intentId: "6132981d-a70e-4296-8f9d-e4d137c476c1",
  fileId: "f9836477-5ad6-4853-afb3-cc37277779a6",
};

beforeEach(() => {
  vi.clearAllMocks();
  getClientMock.mockReturnValue({ marker: "dedicated-client" });
  getSignedUrlMock.mockResolvedValue(
    "https://ops-external-intake-test.s3.us-west-2.amazonaws.com/signed"
  );
});

describe("external intake upload capability", () => {
  it("signs one exact create-only PUT with bounded size and checksum", async () => {
    const capability = await issueExternalUploadCapability(
      {
        ...IDS,
        contentLength: 4_096,
        contentType: "image/jpeg",
        checksumSha256: CHECKSUM_SHA256,
        expiresInSeconds: 120,
      },
      { now: () => FIXED_NOW }
    );

    expect(capability.key).toMatch(
      new RegExp(
        `^quarantine/${IDS.companyId}/${IDS.sourceId}/${IDS.intentId}/${IDS.fileId}/[0-9a-f-]{36}$`
      )
    );
    expect(capability.method).toBe("PUT");
    expect(capability.expiresAt).toBe("2026-07-26T22:02:00.000Z");
    expect(capability.deleteNotBefore).toBe(
      new Date(
        FIXED_NOW.getTime() +
          (120 + UPLOAD_CAPABILITY_CLOCK_SKEW_SECONDS) * 1_000
      ).toISOString()
    );
    expect(capability.headers).toEqual({
      "content-length": "4096",
      "content-type": "image/jpeg",
      "if-none-match": "*",
      "x-amz-checksum-sha256": CHECKSUM_SHA256,
    });

    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [client, command, options] = getSignedUrlMock.mock.calls[0];
    expect(client).toEqual({ marker: "dedicated-client" });
    expect(command.input).toMatchObject({
      Bucket: "ops-external-intake-test",
      Key: capability.key,
      ContentLength: 4_096,
      ContentType: "image/jpeg",
      ChecksumSHA256: CHECKSUM_SHA256,
      IfNoneMatch: "*",
    });
    expect(options).toEqual({
      expiresIn: 120,
      signableHeaders: new Set(["content-type"]),
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    });
  });

  it("omits only the optional checksum header", async () => {
    const capability = await issueExternalUploadCapability(
      {
        ...IDS,
        contentLength: 16,
        contentType: "application/pdf",
        expiresInSeconds: 60,
      },
      { now: () => FIXED_NOW }
    );

    expect(capability.headers).toEqual({
      "content-length": "16",
      "content-type": "application/pdf",
      "if-none-match": "*",
    });
    expect(
      getSignedUrlMock.mock.calls[0][1].input.ChecksumSHA256
    ).toBeUndefined();
  });

  it.each([
    ["zero bytes", { contentLength: 0 }],
    ["fractional bytes", { contentLength: 1.5 }],
    [
      "expiry above the hard maximum",
      {
        contentLength: 1,
        expiresInSeconds: UPLOAD_CAPABILITY_MAX_SECONDS + 1,
      },
    ],
    [
      "unsafe content type",
      {
        contentLength: 1,
        contentType: "text/html\r\nx-unsafe: yes",
      },
    ],
    [
      "malformed checksum",
      {
        contentLength: 1,
        checksumSha256: "not-base64",
      },
    ],
  ])("rejects %s before signing", async (_label, override) => {
    const normalizedOverride: Partial<
      Parameters<typeof issueExternalUploadCapability>[0]
    > = override;
    const input = {
      ...IDS,
      contentLength: 1,
      contentType: "image/png",
      expiresInSeconds: 120,
      ...normalizedOverride,
    };

    await expect(issueExternalUploadCapability(input)).rejects.toThrow(
      "invalid_upload_capability"
    );
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});
