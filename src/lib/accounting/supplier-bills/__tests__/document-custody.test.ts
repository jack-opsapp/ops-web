import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import {
  SupplierBillDocumentError,
  removeSupplierBillPdf,
  storeSupplierBillPdf,
} from "../document-custody";

describe("supplier bill PDF custody", () => {
  it("stores verified PDF bytes under a tenant and request scoped immutable key", async () => {
    const send = vi.fn().mockResolvedValue({});
    const result = await storeSupplierBillPdf({
      companyId: "10000000-0000-4000-8000-000000000001",
      requestId: "10000000-0000-4000-8000-000000000002",
      filename: "../Invoice 42.pdf",
      bytes: Buffer.from("%PDF-1.7 fixture\n%%EOF"),
      client: { send } as never,
    });

    expect(result.uploaded).toBe(true);
    expect(result.descriptor.objectKey).toContain(
      "10000000-0000-4000-8000-000000000001/supplier-bills/10000000-0000-4000-8000-000000000002/"
    );
    expect(result.descriptor.objectKey).toMatch(/\/Invoice-42\.pdf$/);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      ContentType: "application/pdf",
      ServerSideEncryption: "AES256",
      IfNoneMatch: "*",
    });
  });

  it("rejects disguised files before storage", async () => {
    await expect(
      storeSupplierBillPdf({
        companyId: "10000000-0000-4000-8000-000000000001",
        requestId: "10000000-0000-4000-8000-000000000002",
        filename: "invoice.pdf",
        bytes: Buffer.from("not a pdf"),
        client: { send: vi.fn() } as never,
      })
    ).rejects.toEqual(
      new SupplierBillDocumentError(
        "invalid_pdf",
        "Attach the original supplier invoice as a PDF up to 20 MB."
      )
    );
  });

  it("only removes objects created by the failed attempt", async () => {
    const send = vi.fn().mockResolvedValue({});
    await removeSupplierBillPdf(
      {
        uploaded: true,
        descriptor: {
          bucket: "bucket",
          objectKey: "company/supplier-bills/key.pdf",
          publicUrl: "https://example.test/key.pdf",
          originalFilename: "key.pdf",
          mimeType: "application/pdf",
          sizeBytes: 20,
          sha256: "a".repeat(64),
        },
      },
      { send } as never
    );
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });
});
