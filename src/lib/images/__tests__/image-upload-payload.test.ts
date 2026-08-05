import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_UPLOAD_BYTES,
  decodeImageUploadPayload,
} from "@/lib/images/image-upload-payload";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];

function base64(bytes: number[], padTo = 0): string {
  const buffer = Buffer.concat([
    Buffer.from(bytes),
    Buffer.alloc(Math.max(0, padTo - bytes.length)),
  ]);
  return buffer.toString("base64");
}

function png(padTo = 32): string {
  return base64(PNG_HEADER, padTo);
}

function webp(padTo = 32): string {
  const bytes = [
    ...Buffer.from("RIFF"),
    0x00,
    0x00,
    0x00,
    0x00,
    ...Buffer.from("WEBP"),
  ];
  return base64(bytes, padTo);
}

describe("decodeImageUploadPayload", () => {
  it("accepts a PNG and reports its extension", () => {
    const result = decodeImageUploadPayload({
      data: png(),
      contentType: "image/png",
    });

    expect(result).toMatchObject({
      ok: true,
      contentType: "image/png",
      extension: "png",
    });
    if (result.ok) expect(result.buffer.length).toBe(32);
  });

  it("accepts JPEG and WebP", () => {
    expect(
      decodeImageUploadPayload({
        data: base64(JPEG_HEADER, 32),
        contentType: "image/jpeg",
      })
    ).toMatchObject({ ok: true, extension: "jpg" });
    expect(
      decodeImageUploadPayload({ data: webp(), contentType: "image/webp" })
    ).toMatchObject({ ok: true, extension: "webp" });
  });

  it("takes the payload with its data-url wrapper still attached", () => {
    const result = decodeImageUploadPayload({
      data: `data:image/png;base64,${png()}`,
      contentType: "image/png",
    });

    expect(result.ok).toBe(true);
  });

  it("refuses a type it does not store", () => {
    expect(
      decodeImageUploadPayload({
        data: png(),
        contentType: "image/svg+xml",
      })
    ).toEqual({ ok: false, error: "Use a PNG, JPG, or WebP image" });
    expect(
      decodeImageUploadPayload({ data: png(), contentType: undefined })
    ).toEqual({ ok: false, error: "Use a PNG, JPG, or WebP image" });
  });

  it("refuses bytes that are not the format they claim to be", () => {
    // The whole point of sniffing: a declared content type is a claim, and
    // this file ends up as an <img src> in somebody's outbound mail.
    const result = decodeImageUploadPayload({
      data: Buffer.from("<svg onload=alert(1)></svg>").toString("base64"),
      contentType: "image/png",
    });

    expect(result).toEqual({
      ok: false,
      error: "That file is not a PNG image",
    });
  });

  it("refuses anything that is not base64 at all", () => {
    expect(
      decodeImageUploadPayload({ data: "not base 64!!", contentType: "image/png" })
    ).toEqual({ ok: false, error: "That image could not be read" });
    expect(
      decodeImageUploadPayload({ data: "", contentType: "image/png" })
    ).toEqual({ ok: false, error: "That image could not be read" });
    expect(
      decodeImageUploadPayload({ data: 42, contentType: "image/png" })
    ).toEqual({ ok: false, error: "That image could not be read" });
  });

  it("refuses a payload past the size cap", () => {
    const oversized = base64(PNG_HEADER, MAX_IMAGE_UPLOAD_BYTES + 4);

    expect(
      decodeImageUploadPayload({ data: oversized, contentType: "image/png" })
    ).toEqual({ ok: false, error: "Keep the logo under 1 MB" });
  });

  it("holds the cap at one megabyte exactly", () => {
    const exact = base64(PNG_HEADER, MAX_IMAGE_UPLOAD_BYTES);

    expect(
      decodeImageUploadPayload({ data: exact, contentType: "image/png" })
    ).toMatchObject({ ok: true });
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(1024 * 1024);
  });
});
