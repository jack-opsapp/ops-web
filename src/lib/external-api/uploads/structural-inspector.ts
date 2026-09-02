import "server-only";

import CFB from "cfb";
import convertHeic from "heic-convert";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export type ExternalIntakeFileKind =
  | "jpeg"
  | "png"
  | "webp"
  | "heic"
  | "heif"
  | "pdf"
  | "text"
  | "csv"
  | "doc"
  | "docx"
  | "xls"
  | "xlsx"
  | "dwg"
  | "dxf";

export type ExternalIntakeStructuralResult =
  | {
      accepted: true;
      kind: ExternalIntakeFileKind;
    }
  | {
      accepted: false;
      safeCode: string;
    };

const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_PDF_PAGES = 500;
const MAX_PDF_OBJECTS = 100_000;
const MAX_ZIP_ENTRIES = 1_024;
const MAX_ZIP_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_RATIO = 100;
const MAX_XML_INSPECTION_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LINES = 100_000;
const MAX_CSV_ROWS = 25_000;
const MAX_CSV_COLUMNS = 256;
const MAX_TEXT_CELL_BYTES = 10_000;

const ACTIVE_PDF_NAMES =
  /\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData)\b/;
const ACTIVE_TEXT_PREFIX =
  /^\s*(?:<!doctype\s+html|<html\b|<script\b|<svg\b|<\?xml\b|#!|@echo\s+off|powershell\b)/i;
const OOXML_MACRO_PATH =
  /(?:^|\/)(?:vbaProject\.bin|macros?|_vba_project_cur)(?:\/|$)/i;
const OOXML_ACTIVE_PATH =
  /(?:^|\/)(?:activeX|embeddings|customUI|oleObject|signatures?)(?:\/|$)/i;
const CFB_MACRO_PATH = /(?:^|\/)(?:vba|macros?|_vba_project_cur)(?:\/|$)/i;
const CFB_ENCRYPTED_PATH =
  /(?:^|\/)(?:EncryptionInfo|EncryptedPackage|DataSpaces)(?:\/|$)/i;
const CFB_ACTIVE_PATH = /(?:^|\/)(?:Ole10Native|Package|ObjectPool)(?:\/|$)/i;

interface InspectInput {
  bytes: Buffer;
  kind: ExternalIntakeFileKind;
}

function rejected(safeCode: string): ExternalIntakeStructuralResult {
  return { accepted: false, safeCode };
}

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function inspectImage(
  bytes: Buffer,
  kind: ExternalIntakeFileKind
): Promise<ExternalIntakeStructuralResult> {
  try {
    if (kind === "jpeg") {
      if (
        bytes.length < 4 ||
        bytes.subarray(bytes.length - 2).toString("hex") !== "ffd9"
      ) {
        return rejected("file_corrupt");
      }
    } else if (kind === "png") {
      const iend = Buffer.from("0000000049454e44ae426082", "hex");
      if (
        bytes.length < iend.length ||
        !bytes.subarray(bytes.length - iend.length).equals(iend)
      ) {
        return rejected("file_corrupt");
      }
    } else if (kind === "webp") {
      if (
        bytes.length < 12 ||
        bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
        bytes.subarray(8, 12).toString("ascii") !== "WEBP" ||
        bytes.readUInt32LE(4) + 8 !== bytes.length
      ) {
        return rejected("file_corrupt");
      }
    }

    const decoded =
      kind === "heic" || kind === "heif"
        ? Buffer.from(
            await convertHeic({
              buffer: bytes,
              format: "JPEG",
              quality: 1,
            })
          )
        : bytes;
    const image = sharp(decoded, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_IMAGE_DIMENSION ||
      metadata.height > MAX_IMAGE_DIMENSION ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      return rejected("image_limits_exceeded");
    }
    await image.clone().raw().toBuffer();
    return { accepted: true, kind };
  } catch {
    return rejected("file_corrupt");
  }
}

async function inspectPdf(
  bytes: Buffer
): Promise<ExternalIntakeStructuralResult> {
  if (!bytes.subarray(0, 8).toString("latin1").startsWith("%PDF-")) {
    return rejected("file_corrupt");
  }
  const latin = bytes.toString("latin1");
  if (/\/Encrypt\b/.test(latin)) {
    return rejected("encrypted_file_not_allowed");
  }
  const eof = latin.lastIndexOf("%%EOF");
  if (eof < 0 || latin.slice(eof + 5).trim().length > 0) {
    return rejected(
      /<(?:html|script|svg)\b/i.test(latin.slice(Math.max(eof + 5, 0)))
        ? "active_content_not_allowed"
        : "file_corrupt"
    );
  }
  try {
    const document = await PDFDocument.load(new Uint8Array(bytes), {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    if (document.getPageCount() > MAX_PDF_PAGES) {
      return rejected("document_limits_exceeded");
    }
    const objects = document.context.enumerateIndirectObjects();
    if (objects.length > MAX_PDF_OBJECTS) {
      return rejected("document_limits_exceeded");
    }
    const serialized = [
      document.catalog.toString(),
      ...objects.map(([, object]) => object.toString()),
    ].join("\n");
    if (ACTIVE_PDF_NAMES.test(serialized)) {
      return rejected("active_content_not_allowed");
    }
    return { accepted: true, kind: "pdf" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (/encrypt/i.test(`${name} ${message}`)) {
      return rejected("encrypted_file_not_allowed");
    }
    return rejected("file_corrupt");
  }
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      {
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
        decodeStrings: true,
      },
      (error, zipFile) => {
        if (error) reject(error);
        else resolve(zipFile);
      }
    );
  });
}

function readZipEntry(zipFile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (openError, stream) => {
      if (openError) {
        reject(openError);
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_XML_INSPECTION_BYTES) {
          stream.destroy(new Error("zip_entry_inspection_limit"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      stream.once("error", reject);
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

interface ZipSnapshot {
  entries: Entry[];
  textByName: Map<string, string>;
}

async function snapshotZip(bytes: Buffer): Promise<ZipSnapshot> {
  const zipFile = await openZip(bytes);
  const entries: Entry[] = [];
  const textByName = new Map<string, string>();
  const seenNames = new Set<string>();
  let totalUncompressed = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };
    zipFile.once("error", fail);
    zipFile.once("end", () => {
      if (settled) return;
      settled = true;
      resolve({ entries, textByName });
    });
    zipFile.on("entry", async (entry: Entry) => {
      try {
        entries.push(entry);
        totalUncompressed += entry.uncompressedSize;
        const path = entry.fileName;
        const normalizedPath = path.toLowerCase();
        const segments = path.split("/");
        const invalidPath =
          path.startsWith("/") ||
          path.includes("\\") ||
          segments.some(
            (segment, index) =>
              segment === "." ||
              segment === ".." ||
              (segment === "" && index !== segments.length - 1)
          );
        const ratio =
          entry.compressedSize === 0
            ? entry.uncompressedSize === 0
              ? 1
              : Number.POSITIVE_INFINITY
            : entry.uncompressedSize / entry.compressedSize;
        if (
          entries.length > MAX_ZIP_ENTRIES ||
          entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES ||
          totalUncompressed > MAX_ZIP_TOTAL_BYTES ||
          ratio > MAX_ZIP_RATIO ||
          entry.isEncrypted() ||
          ![0, 8].includes(entry.compressionMethod) ||
          seenNames.has(normalizedPath) ||
          invalidPath
        ) {
          throw new Error("archive_limits_exceeded");
        }
        seenNames.add(normalizedPath);
        if (
          entry.uncompressedSize > 0 &&
          entry.uncompressedSize <= MAX_XML_INSPECTION_BYTES &&
          (path.toLowerCase().endsWith(".xml") ||
            path.toLowerCase().endsWith(".rels"))
        ) {
          const value = await readZipEntry(zipFile, entry);
          const text = decodeUtf8(value);
          if (text === null) throw new Error("file_corrupt");
          textByName.set(path, text);
        }
        zipFile.readEntry();
      } catch (error) {
        fail(error instanceof Error ? error : new Error("file_corrupt"));
      }
    });
    zipFile.readEntry();
  });
}

async function inspectOoxml(
  bytes: Buffer,
  kind: "docx" | "xlsx"
): Promise<ExternalIntakeStructuralResult> {
  let snapshot: ZipSnapshot;
  try {
    snapshot = await snapshotZip(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return rejected(
      message === "archive_limits_exceeded"
        ? "archive_limits_exceeded"
        : message === "file_corrupt"
          ? "file_corrupt"
          : "file_corrupt"
    );
  }

  const names = snapshot.entries.map((entry) => entry.fileName);
  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  if (lowerNames.has("encryptioninfo") || lowerNames.has("encryptedpackage")) {
    return rejected("encrypted_file_not_allowed");
  }
  if (
    !lowerNames.has("[content_types].xml") ||
    (kind === "docx" && !lowerNames.has("word/document.xml")) ||
    (kind === "xlsx" && !lowerNames.has("xl/workbook.xml"))
  ) {
    return rejected("file_type_mismatch");
  }
  const contentTypes = snapshot.textByName.get("[Content_Types].xml");
  const requiredMainType =
    kind === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  if (
    !contentTypes ||
    !contentTypes.includes(requiredMainType) ||
    /<!DOCTYPE|<!ENTITY/i.test(contentTypes)
  ) {
    return rejected("file_type_mismatch");
  }
  if (names.some((name) => OOXML_MACRO_PATH.test(name))) {
    return rejected("macro_not_allowed");
  }
  if (names.some((name) => OOXML_ACTIVE_PATH.test(name))) {
    return rejected("active_content_not_allowed");
  }
  for (const [name, text] of snapshot.textByName) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
      return rejected("active_content_not_allowed");
    }
    if (
      name.toLowerCase().endsWith(".rels") &&
      /TargetMode\s*=\s*["']External["']/i.test(text)
    ) {
      return rejected("active_content_not_allowed");
    }
    if (
      /application\/vnd\.ms-office\.vbaProject/i.test(text) ||
      /macroEnabled/i.test(text)
    ) {
      return rejected("macro_not_allowed");
    }
  }
  return { accepted: true, kind };
}

function inspectCfb(
  bytes: Buffer,
  kind: "doc" | "xls"
): ExternalIntakeStructuralResult {
  try {
    const document = CFB.read(Buffer.from(bytes), { type: "buffer" });
    const paths = document.FullPaths.map((path) => path.replace(/\\/g, "/"));
    if (paths.length > MAX_ZIP_ENTRIES) {
      return rejected("document_limits_exceeded");
    }
    if (paths.some((path) => CFB_MACRO_PATH.test(path))) {
      return rejected("macro_not_allowed");
    }
    if (paths.some((path) => CFB_ENCRYPTED_PATH.test(path))) {
      return rejected("encrypted_file_not_allowed");
    }
    if (paths.some((path) => CFB_ACTIVE_PATH.test(path))) {
      return rejected("active_content_not_allowed");
    }
    const streamNames = paths.map((path) =>
      path.split("/").filter(Boolean).at(-1)?.toLowerCase()
    );
    const required =
      kind === "doc"
        ? streamNames.includes("worddocument")
        : streamNames.includes("workbook") || streamNames.includes("book");
    if (!required) return rejected("file_type_mismatch");
    return { accepted: true, kind };
  } catch {
    return rejected("file_corrupt");
  }
}

function inspectText(
  bytes: Buffer,
  kind: "text" | "csv"
): ExternalIntakeStructuralResult {
  const text = decodeUtf8(bytes);
  if (
    text === null ||
    text.includes("\u0000") ||
    /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) {
    return rejected("file_corrupt");
  }
  if (ACTIVE_TEXT_PREFIX.test(text)) {
    return rejected("active_content_not_allowed");
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_TEXT_LINES) {
    return rejected("document_limits_exceeded");
  }
  if (kind === "csv") {
    if (lines.length > MAX_CSV_ROWS) {
      return rejected("document_limits_exceeded");
    }
    for (const line of lines) {
      const cells = line.split(",");
      if (
        cells.length > MAX_CSV_COLUMNS ||
        cells.some(
          (cell) => Buffer.byteLength(cell, "utf8") > MAX_TEXT_CELL_BYTES
        )
      ) {
        return rejected("document_limits_exceeded");
      }
      if (cells.some((cell) => /^\s*(?:[=+@]|-[A-Za-z])/.test(cell))) {
        return rejected("active_content_not_allowed");
      }
    }
  }
  return { accepted: true, kind };
}

function inspectDxf(bytes: Buffer): ExternalIntakeStructuralResult {
  const binaryHeader = "AutoCAD Binary DXF\r\n\u001a\u0000";
  const latin = bytes.subarray(0, binaryHeader.length).toString("latin1");
  if (latin === binaryHeader) {
    return bytes.length <= 25 * 1024 * 1024
      ? { accepted: true, kind: "dxf" }
      : rejected("document_limits_exceeded");
  }
  const text = decodeUtf8(bytes);
  if (
    text === null ||
    !/^\s*0\s*\r?\nSECTION\b/i.test(text) ||
    !/\r?\n0\s*\r?\nEOF\s*$/i.test(text)
  ) {
    return rejected("file_corrupt");
  }
  if (text.split(/\r?\n/).length > MAX_TEXT_LINES) {
    return rejected("document_limits_exceeded");
  }
  return { accepted: true, kind: "dxf" };
}

function inspectDwg(bytes: Buffer): ExternalIntakeStructuralResult {
  return /^AC10\d{2}/.test(bytes.subarray(0, 6).toString("latin1"))
    ? { accepted: true, kind: "dwg" }
    : rejected("file_corrupt");
}

export async function inspectExternalIntakeStructure(
  input: Readonly<InspectInput>
): Promise<ExternalIntakeStructuralResult> {
  switch (input.kind) {
    case "jpeg":
    case "png":
    case "webp":
    case "heic":
    case "heif":
      return inspectImage(input.bytes, input.kind);
    case "pdf":
      return inspectPdf(input.bytes);
    case "docx":
    case "xlsx":
      return inspectOoxml(input.bytes, input.kind);
    case "doc":
    case "xls":
      return inspectCfb(input.bytes, input.kind);
    case "text":
    case "csv":
      return inspectText(input.bytes, input.kind);
    case "dxf":
      return inspectDxf(input.bytes);
    case "dwg":
      return inspectDwg(input.bytes);
  }
}
