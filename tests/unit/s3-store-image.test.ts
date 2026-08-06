/**
 * Unit tests for the server-side image writer.
 *
 * This module decides the literal S3 key every route-received image lands
 * on, and the bucket grants public reads by prefix — so the key shape is
 * not cosmetic. A key composed outside a readable prefix stores fine and
 * then 403s on every read, which is exactly how the signature logo broke
 * in production. These tests pin the composed key, not just the call.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, storageBackendMock, uploadMock, getPublicUrlMock } =
  vi.hoisted(() => ({
    sendMock: vi.fn(),
    storageBackendMock: vi.fn(),
    uploadMock: vi.fn(),
    getPublicUrlMock: vi.fn(),
  }));

vi.mock("@/lib/s3/client", () => ({
  getS3Client: () => ({ send: sendMock }),
  getStorageBackend: storageBackendMock,
  buildPublicS3Url: (key: string) =>
    `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/${key}`,
  S3_BUCKET: "ops-app-files-prod",
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    storage: {
      from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }),
    },
  }),
}));

import { storeImageObject } from "@/lib/s3/store-image";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

/** The bytes are irrelevant to key composition; the shape is the subject. */
function pngInput(overrides: Record<string, unknown> = {}) {
  return {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
    extension: "png",
    folder: `company-${COMPANY_A}/logos`,
    companyId: COMPANY_A,
    ...overrides,
  };
}

function storedKey(): string {
  return sendMock.mock.calls[0][0].input.Key as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageBackendMock.mockReturnValue("s3");
  sendMock.mockResolvedValue({});
  uploadMock.mockResolvedValue({ error: null });
  getPublicUrlMock.mockImplementation((key: string) => ({
    data: { publicUrl: `https://supabase.test/storage/images/${key}` },
  }));
});

describe("storeImageObject", () => {
  it("writes a signature logo into the company logo prefix under its own filename", async () => {
    const result = await storeImageObject(
      pngInput({ filenamePrefix: "signature_" })
    );

    const expected = new RegExp(
      `^company-${COMPANY_A}/logos/signature_\\d{10,}-[a-z0-9]{6,8}\\.png$`
    );
    expect(storedKey()).toMatch(expected);
    expect(result).toEqual({
      ok: true,
      url: `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/${storedKey()}`,
    });
  });

  it("keeps the signature filename clear of the company logo's own objects", async () => {
    await storeImageObject(pngInput({ filenamePrefix: "signature_" }));

    // `logo_...` is the company mark; `signature_...` is this one. Same
    // prefix, no collision.
    const filename = storedKey().split("/").pop() ?? "";
    expect(filename.startsWith("signature_")).toBe(true);
    expect(filename.startsWith("logo_")).toBe(false);
  });

  it("composes the legacy key shape when no filename prefix is given", async () => {
    await storeImageObject(pngInput({ folder: "blog-thumbnails" }));

    expect(storedKey()).toMatch(
      new RegExp(`^blog-thumbnails/${COMPANY_A}/\\d{10,}-[a-z0-9]{6,8}\\.png$`)
    );
  });

  it("carries the filename prefix on the Supabase backend too", async () => {
    storageBackendMock.mockReturnValue("supabase");

    const result = await storeImageObject(
      pngInput({ filenamePrefix: "signature_" })
    );

    const key = uploadMock.mock.calls[0][0] as string;
    expect(key).toMatch(
      new RegExp(
        `^company-${COMPANY_A}/logos/signature_\\d{10,}-[a-z0-9]{6,8}\\.png$`
      )
    );
    expect(result).toEqual({
      ok: true,
      url: `https://supabase.test/storage/images/${key}`,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("stores nothing when the folder names another company", async () => {
    const result = await storeImageObject(
      pngInput({ folder: `company-${COMPANY_B}/logos` })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/different company/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses a filename prefix that could escape the folder", async () => {
    for (const filenamePrefix of ["../", "a/b", "sig\0", ""]) {
      const result = await storeImageObject(pngInput({ filenamePrefix }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/filename prefix/i);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });
});
