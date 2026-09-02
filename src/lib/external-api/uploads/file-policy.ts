import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { extname } from "node:path";

import { fileTypeFromBuffer } from "file-type";

import type { ExternalIntakeFileKind } from "./structural-inspector";

export const EXTERNAL_INTAKE_MAX_FILE_BYTES = 25 * 1024 * 1024;

export type ExternalIntakeGuardDutyStatus =
  | "NO_THREATS_FOUND"
  | "THREATS_FOUND"
  | "UNSUPPORTED"
  | "ACCESS_DENIED"
  | "FAILED"
  | null;

export type ExternalIntakeFilePolicyResult =
  | {
      accepted: true;
      kind: ExternalIntakeFileKind;
      detectedContentType: string;
    }
  | {
      accepted: false;
      safeCode: string;
    };

interface ClassificationInput {
  bytes: Buffer;
  filename: string;
  declaredContentType: string;
  expectedSizeBytes: number;
  expectedChecksumSha256: string | null;
}

interface AllowedIdentity {
  kind: ExternalIntakeFileKind;
  contentTypes: readonly string[];
  extensions: readonly string[];
  detectedContentType: string;
}

const IDENTITIES: readonly AllowedIdentity[] = [
  {
    kind: "jpeg",
    contentTypes: ["image/jpeg"],
    extensions: [".jpg", ".jpeg"],
    detectedContentType: "image/jpeg",
  },
  {
    kind: "png",
    contentTypes: ["image/png"],
    extensions: [".png"],
    detectedContentType: "image/png",
  },
  {
    kind: "webp",
    contentTypes: ["image/webp"],
    extensions: [".webp"],
    detectedContentType: "image/webp",
  },
  {
    kind: "heic",
    contentTypes: ["image/heic"],
    extensions: [".heic"],
    detectedContentType: "image/heic",
  },
  {
    kind: "heif",
    contentTypes: ["image/heif"],
    extensions: [".heif"],
    detectedContentType: "image/heif",
  },
  {
    kind: "pdf",
    contentTypes: ["application/pdf"],
    extensions: [".pdf"],
    detectedContentType: "application/pdf",
  },
  {
    kind: "text",
    contentTypes: ["text/plain"],
    extensions: [".txt"],
    detectedContentType: "text/plain",
  },
  {
    kind: "csv",
    contentTypes: ["text/csv"],
    extensions: [".csv"],
    detectedContentType: "text/csv",
  },
  {
    kind: "doc",
    contentTypes: ["application/msword"],
    extensions: [".doc"],
    detectedContentType: "application/msword",
  },
  {
    kind: "docx",
    contentTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    extensions: [".docx"],
    detectedContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    kind: "xls",
    contentTypes: ["application/vnd.ms-excel"],
    extensions: [".xls"],
    detectedContentType: "application/vnd.ms-excel",
  },
  {
    kind: "xlsx",
    contentTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    extensions: [".xlsx"],
    detectedContentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    kind: "dwg",
    contentTypes: ["image/vnd.dwg"],
    extensions: [".dwg"],
    detectedContentType: "image/vnd.dwg",
  },
  {
    kind: "dxf",
    contentTypes: ["image/vnd.dxf", "application/acad", "application/dxf"],
    extensions: [".dxf"],
    detectedContentType: "image/vnd.dxf",
  },
] as const;

const DETECTED_TYPE_TO_KIND = new Map<string, ExternalIntakeFileKind>([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/pdf", "pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/msword", "doc"],
  ["application/vnd.ms-excel", "xls"],
  ["image/vnd.dwg", "dwg"],
  ["application/acad", "dwg"],
  ["image/vnd.dxf", "dxf"],
  ["application/dxf", "dxf"],
]);

const FORBIDDEN_TEXT_PREFIX =
  /^\s*(?:<!doctype\s+html|<html\b|<script\b|<svg\b|<\?xml\b|#!|@echo\s+off|powershell\b)/i;
const CFB_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex");
const ZIP_SIGNATURES = new Set(["504b0304", "504b0506", "504b0708"]);

function sameHash(actualHex: string, expectedHex: string): boolean {
  if (
    !/^[a-f0-9]{64}$/i.test(actualHex) ||
    !/^[a-f0-9]{64}$/i.test(expectedHex)
  ) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(actualHex, "hex"),
    Buffer.from(expectedHex, "hex")
  );
}

function declaredIdentity(
  filename: string,
  declaredContentType: string
): AllowedIdentity | null {
  const extension = extname(filename).toLowerCase();
  return (
    IDENTITIES.find(
      (identity) =>
        identity.contentTypes.includes(declaredContentType) &&
        identity.extensions.includes(extension)
    ) ?? null
  );
}

function hasPrefix(bytes: Buffer, prefix: Buffer): boolean {
  return (
    bytes.length >= prefix.length &&
    bytes.subarray(0, prefix.length).equals(prefix)
  );
}

function isTextCandidate(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !FORBIDDEN_TEXT_PREFIX.test(text);
  } catch {
    return false;
  }
}

function kindFromContainerSignature(
  bytes: Buffer,
  declared: AllowedIdentity
): ExternalIntakeFileKind | null {
  const firstFour = bytes.subarray(0, 4).toString("hex");
  if (
    ZIP_SIGNATURES.has(firstFour) &&
    (declared.kind === "docx" || declared.kind === "xlsx")
  ) {
    return declared.kind;
  }
  if (
    hasPrefix(bytes, CFB_SIGNATURE) &&
    (declared.kind === "doc" || declared.kind === "xls")
  ) {
    return declared.kind;
  }
  return null;
}

function kindFromTextSignature(
  bytes: Buffer,
  declared: AllowedIdentity
): ExternalIntakeFileKind | null {
  if (!isTextCandidate(bytes)) return null;
  const prefix = bytes.subarray(0, 32).toString("latin1");
  if (declared.kind === "dwg" && /^AC10\d{2}/.test(prefix)) {
    return "dwg";
  }
  if (
    declared.kind === "dxf" &&
    (/^\s*0\s*\r?\nSECTION\b/i.test(prefix) ||
      prefix.startsWith("AutoCAD Binary DXF\r\n\u001a\u0000"))
  ) {
    return "dxf";
  }
  if (declared.kind === "text" || declared.kind === "csv") {
    return declared.kind;
  }
  return null;
}

export async function classifyExternalIntakeFile(
  input: Readonly<ClassificationInput>
): Promise<ExternalIntakeFilePolicyResult> {
  if (
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes < 1 ||
    input.expectedSizeBytes > EXTERNAL_INTAKE_MAX_FILE_BYTES ||
    input.bytes.length < 1 ||
    input.bytes.length > EXTERNAL_INTAKE_MAX_FILE_BYTES
  ) {
    return { accepted: false, safeCode: "file_size_not_allowed" };
  }
  if (input.bytes.length !== input.expectedSizeBytes) {
    return { accepted: false, safeCode: "file_size_mismatch" };
  }

  const actualChecksum = createHash("sha256").update(input.bytes).digest("hex");
  if (
    input.expectedChecksumSha256 &&
    !sameHash(actualChecksum, input.expectedChecksumSha256)
  ) {
    return { accepted: false, safeCode: "file_checksum_mismatch" };
  }

  const declared = declaredIdentity(input.filename, input.declaredContentType);
  if (!declared) {
    return { accepted: false, safeCode: "file_type_mismatch" };
  }

  const detected = await fileTypeFromBuffer(new Uint8Array(input.bytes));
  if (detected) {
    const detectedKind = DETECTED_TYPE_TO_KIND.get(detected.mime);
    if (detectedKind) {
      if (detectedKind !== declared.kind) {
        return { accepted: false, safeCode: "file_type_mismatch" };
      }
      return {
        accepted: true,
        kind: detectedKind,
        detectedContentType: declared.detectedContentType,
      };
    }

    const containerKind = kindFromContainerSignature(input.bytes, declared);
    if (containerKind) {
      return {
        accepted: true,
        kind: containerKind,
        detectedContentType: declared.detectedContentType,
      };
    }
    return { accepted: false, safeCode: "file_type_not_allowed" };
  }

  const containerKind = kindFromContainerSignature(input.bytes, declared);
  const textKind = kindFromTextSignature(input.bytes, declared);
  const kind = containerKind ?? textKind;
  if (!kind) {
    return { accepted: false, safeCode: "file_type_not_allowed" };
  }
  return {
    accepted: true,
    kind,
    detectedContentType: declared.detectedContentType,
  };
}

export function reconcileGuardDutyResult(
  status: string | null
): { clean: true; safeCode: null } | { clean: false; safeCode: string } {
  if (status === "NO_THREATS_FOUND") {
    return { clean: true, safeCode: null };
  }
  return {
    clean: false,
    safeCode:
      status === "THREATS_FOUND"
        ? "malware_detected"
        : "malware_scan_unavailable",
  };
}
