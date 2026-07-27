import { beforeEach, describe, expect, it, vi } from "vitest";

const { cloudFrontSignedUrlMock } = vi.hoisted(() => ({
  cloudFrontSignedUrlMock: vi.fn(),
}));

vi.mock("@aws-sdk/cloudfront-signer", () => ({
  getSignedUrl: cloudFrontSignedUrlMock,
}));

import { createExternalAttachmentDeliveryUrl } from "@/lib/external-api/uploads/cloudfront-delivery";

const FIXED_NOW = new Date("2026-07-26T22:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EXTERNAL_INTAKE_CLOUDFRONT_DOMAIN", "files-intake.example.test");
  vi.stubEnv("EXTERNAL_INTAKE_CLOUDFRONT_KEY_PAIR_ID", "KTEST123");
  vi.stubEnv(
    "EXTERNAL_INTAKE_CLOUDFRONT_PRIVATE_KEY",
    "-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----"
  );
  cloudFrontSignedUrlMock.mockReturnValue(
    "https://files-intake.example.test/safe-derivative/a.webp?Expires=1&Signature=x&Key-Pair-Id=KTEST123"
  );
});

describe("external intake CloudFront delivery", () => {
  it("signs only a metadata-stripped derivative for inline rendering", () => {
    const result = createExternalAttachmentDeliveryUrl(
      {
        objectKey:
          "safe-derivative/0c942ee0-7da9-4f1a-92aa-b727eb808066/a.webp",
        mode: "inline-image",
        expiresInSeconds: 120,
      },
      { now: () => FIXED_NOW }
    );

    expect(result.expiresAt).toBe("2026-07-26T22:02:00.000Z");
    expect(result.mode).toBe("inline-image");
    expect(cloudFrontSignedUrlMock).toHaveBeenCalledWith({
      url: "https://files-intake.example.test/safe-derivative/0c942ee0-7da9-4f1a-92aa-b727eb808066/a.webp",
      keyPairId: "KTEST123",
      privateKey:
        "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
      dateLessThan: "2026-07-26T22:02:00.000Z",
    });
  });

  it("signs accepted originals only as forced downloads", () => {
    cloudFrontSignedUrlMock.mockReturnValue(
      "https://files-intake.example.test/accepted-original/a/file?Expires=1"
    );

    const result = createExternalAttachmentDeliveryUrl(
      {
        objectKey: "accepted-original/a/file",
        mode: "attachment",
        expiresInSeconds: 60,
      },
      { now: () => FIXED_NOW }
    );

    expect(result.mode).toBe("attachment");
    expect(cloudFrontSignedUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://files-intake.example.test/accepted-original/a/file",
      })
    );
  });

  it.each([
    ["quarantine content", "quarantine/a/file", "attachment"],
    ["original content inline", "accepted-original/a/file", "inline-image"],
    ["derivative as attachment", "safe-derivative/a.webp", "attachment"],
    ["path traversal", "safe-derivative/../quarantine/a", "inline-image"],
    ["dot path segment", "safe-derivative/./a.webp", "inline-image"],
    ["query injection", "safe-derivative/a.webp?download=1", "inline-image"],
  ] as const)("rejects %s", (_label, objectKey, mode) => {
    expect(() =>
      createExternalAttachmentDeliveryUrl({
        objectKey,
        mode,
        expiresInSeconds: 120,
      })
    ).toThrow("invalid_attachment_delivery");
    expect(cloudFrontSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown delivery mode at runtime", () => {
    expect(() =>
      createExternalAttachmentDeliveryUrl({
        objectKey: "safe-derivative/a.webp",
        mode: "preview" as "inline-image",
        expiresInSeconds: 120,
      })
    ).toThrow("invalid_attachment_delivery");
    expect(cloudFrontSignedUrlMock).not.toHaveBeenCalled();
  });

  it("fails closed when signing configuration is missing", () => {
    vi.stubEnv("EXTERNAL_INTAKE_CLOUDFRONT_PRIVATE_KEY", "");

    expect(() =>
      createExternalAttachmentDeliveryUrl({
        objectKey: "accepted-original/a/file",
        mode: "attachment",
        expiresInSeconds: 120,
      })
    ).toThrow("attachment_delivery_unavailable");
  });
});
