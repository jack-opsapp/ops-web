import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { buildPublicS3Url, getS3Client, S3_BUCKET } from "@/lib/s3/client";

import type { SupplierBillSourceDocumentInput } from "./contracts";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const SAFE_FILENAME_RE = /[^A-Za-z0-9._-]+/g;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupplierBillDocumentError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SupplierBillDocumentError";
  }
}

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1)?.trim() ?? "";
  const cleaned = basename
    .replace(SAFE_FILENAME_RE, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 180) || "supplier-invoice.pdf";
}

function isPreconditionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const metadata = record.$metadata as Record<string, unknown> | undefined;
  return (
    record.name === "PreconditionFailed" || metadata?.httpStatusCode === 412
  );
}

export interface StoredSupplierBillDocument {
  descriptor: SupplierBillSourceDocumentInput;
  uploaded: boolean;
}

export async function storeSupplierBillPdf(input: {
  companyId: string;
  requestId: string;
  filename: string;
  bytes: Buffer;
  client?: Pick<S3Client, "send">;
}): Promise<StoredSupplierBillDocument> {
  if (!UUID_RE.test(input.companyId) || !UUID_RE.test(input.requestId)) {
    throw new SupplierBillDocumentError(
      "invalid_document_scope",
      "Supplier bill document scope is invalid."
    );
  }
  if (
    input.bytes.length < 5 ||
    input.bytes.length > MAX_PDF_BYTES ||
    input.bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new SupplierBillDocumentError(
      "invalid_pdf",
      "Attach the original supplier invoice as a PDF up to 20 MB."
    );
  }
  if (
    !input.bytes
      .subarray(Math.max(0, input.bytes.length - 2_048))
      .includes("%%EOF")
  ) {
    throw new SupplierBillDocumentError(
      "invalid_pdf",
      "Attach the original supplier invoice as a PDF up to 20 MB."
    );
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const filename = safeFilename(input.filename);
  const objectKey = `${input.companyId}/supplier-bills/${input.requestId}/${sha256}/${filename}`;
  const client = input.client ?? getS3Client();
  let uploaded = true;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
        Body: input.bytes,
        ContentType: "application/pdf",
        ContentDisposition: `attachment; filename="${filename}"`,
        ServerSideEncryption: "AES256",
        IfNoneMatch: "*",
        Metadata: {
          company_id: input.companyId,
          request_id: input.requestId,
          sha256,
        },
      })
    );
  } catch (error) {
    if (!isPreconditionFailure(error)) throw error;
    uploaded = false;
  }

  return {
    uploaded,
    descriptor: {
      bucket: S3_BUCKET,
      objectKey,
      publicUrl: buildPublicS3Url(objectKey),
      originalFilename: filename,
      mimeType: "application/pdf",
      sizeBytes: input.bytes.length,
      sha256,
    },
  };
}

export async function removeSupplierBillPdf(
  document: StoredSupplierBillDocument,
  client: Pick<S3Client, "send"> = getS3Client()
): Promise<void> {
  if (!document.uploaded) return;
  await client.send(
    new DeleteObjectCommand({
      Bucket: document.descriptor.bucket,
      Key: document.descriptor.objectKey,
    })
  );
}
