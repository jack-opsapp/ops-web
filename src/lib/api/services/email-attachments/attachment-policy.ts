import { createHash } from "node:crypto";

export type AttachmentAttributionStatus =
  | "pending"
  | "attributed"
  | "needs_review";

export interface AttachmentAttributionDecision {
  status: AttachmentAttributionStatus;
  opportunityId: string | null;
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  bmp: "image/bmp",
  csv: "text/csv",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ics: "text/calendar",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  txt: "text/plain",
  vcf: "text/vcard",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const INLINE_RASTER_MIME_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pathSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  return normalized || sha256(value).slice(0, 32);
}

export function buildAttachmentStoragePath(args: {
  companyId: string;
  connectionId: string;
  messageId: string;
  attachmentId: string;
}): string {
  return [
    pathSegment(args.companyId),
    pathSegment(args.connectionId),
    sha256(`${args.connectionId}\u0000${args.messageId}`),
    sha256(`${args.messageId}\u0000${args.attachmentId}`),
    "content",
  ].join("/");
}

export function safeAttachmentFilename(
  filename: string | null | undefined
): string {
  const withoutControls = (filename ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\\/g, "/");
  const basename = withoutControls.split("/").pop()?.trim() ?? "";
  const safe = basename
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .slice(0, 180);
  return safe || "attachment";
}

export function detectAttachmentMimeType(
  providerMimeType: string | null | undefined,
  filename: string | null | undefined
): string {
  const normalized = (providerMimeType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }

  const extension = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (
    (extension && EXTENSION_MIME_TYPES[extension]) || "application/octet-stream"
  );
}

function startsWith(bytes: Buffer, signature: number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

export function detectAttachmentMimeFromBytes(
  bytes: Buffer,
  providerMimeType: string | null | undefined,
  filename: string | null | undefined
): string {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
    bytes.subarray(0, 6).toString("ascii") === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "image/tiff";
  }
  return detectAttachmentMimeType(providerMimeType, filename);
}

export function canRenderAttachmentInline(mimeType: string): boolean {
  return INLINE_RASTER_MIME_TYPES.has(mimeType.toLowerCase());
}

function normalizeEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const angle = trimmed.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (angle?.[1] ?? trimmed).replace(/^mailto:/, "").trim();
}

export function decideAttachmentAttribution(args: {
  opportunityId: string | null;
  direction: "inbound" | "outbound";
  fromEmail: string;
  toEmails: string[];
  knownContactEmails: ReadonlySet<string>;
  matchNeedsReview: boolean;
}): AttachmentAttributionDecision {
  if (!args.opportunityId) {
    return { status: "pending", opportunityId: null };
  }
  if (args.matchNeedsReview) {
    return { status: "needs_review", opportunityId: null };
  }

  const known = new Set(
    Array.from(args.knownContactEmails, normalizeEmail).filter(Boolean)
  );
  const participants =
    args.direction === "inbound"
      ? [normalizeEmail(args.fromEmail)]
      : args.toEmails.map(normalizeEmail);
  const matches = participants.some((email) => email && known.has(email));

  return matches
    ? { status: "attributed", opportunityId: args.opportunityId }
    : { status: "needs_review", opportunityId: null };
}
