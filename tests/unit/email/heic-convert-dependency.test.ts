// @vitest-environment node

import { createHash } from "node:crypto";

import convert from "heic-convert";
import { describe, expect, it } from "vitest";

import { LIBHEIF_EXAMPLE_HEIC_BASE64 } from "../../fixtures/email/libheif-example-heic";

describe("heic-convert dependency", () => {
  it("decodes the real HEVC-backed HEIC fixture to JPEG", async () => {
    const source = Buffer.from(LIBHEIF_EXAMPLE_HEIC_BASE64, "base64");

    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "975094780b2e7fce0e088ef718f357e75d0b0d799685c3a49e984389b04fac5c"
    );
    expect(source.subarray(4, 12).toString("ascii")).toBe("ftypheic");

    const result = Buffer.from(
      await convert({ buffer: source, format: "JPEG", quality: 0.8 })
    );

    expect(result.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(result.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(result.length).toBeGreaterThan(100);
  });
});
