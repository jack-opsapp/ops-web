// @vitest-environment node

import CFB from "cfb";
import { PDFDocument, PDFName } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  inspectExternalIntakeStructure,
  type ExternalIntakeFileKind,
} from "@/lib/external-api/uploads/structural-inspector";
import { LIBHEIF_EXAMPLE_HEIC_BASE64 } from "../../fixtures/email/libheif-example-heic";

function zip(entries: Record<string, Buffer | string>): Buffer {
  const container = CFB.utils.cfb_new();
  for (const [name, value] of Object.entries(entries)) {
    CFB.utils.cfb_add(
      container,
      name,
      Buffer.isBuffer(value) ? value : Buffer.from(value)
    );
  }
  return Buffer.from(
    CFB.write(container, {
      type: "buffer",
      fileType: "zip",
      compression: true,
    })
  );
}

function cfb(entries: Record<string, Buffer | string>): Buffer {
  const container = CFB.utils.cfb_new();
  for (const [name, value] of Object.entries(entries)) {
    CFB.utils.cfb_add(
      container,
      name,
      Buffer.isBuffer(value) ? value : Buffer.from(value)
    );
  }
  return Buffer.from(CFB.write(container, { type: "buffer" }));
}

async function inspect(bytes: Buffer, kind: ExternalIntakeFileKind) {
  return inspectExternalIntakeStructure({ bytes, kind });
}

describe("external intake structural inspector", () => {
  it("decodes clean raster images and rejects corrupt image payloads", async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#406078",
      },
    })
      .png()
      .toBuffer();

    await expect(inspect(png, "png")).resolves.toMatchObject({
      accepted: true,
      kind: "png",
    });
    await expect(
      inspect(
        Buffer.concat([png.subarray(0, 24), Buffer.from("corrupt")]),
        "png"
      )
    ).resolves.toEqual({
      accepted: false,
      safeCode: "file_corrupt",
    });
  });

  it("decodes HEIC content through a bounded raster conversion", async () => {
    const heic = Buffer.from(LIBHEIF_EXAMPLE_HEIC_BASE64, "base64");

    await expect(inspect(heic, "heic")).resolves.toMatchObject({
      accepted: true,
      kind: "heic",
    });
  });

  it("accepts a passive PDF and rejects active actions and malformed PDFs", async () => {
    const clean = await PDFDocument.create();
    clean.addPage([100, 100]);
    const cleanBytes = Buffer.from(await clean.save());

    const active = await PDFDocument.create();
    active.addPage([100, 100]);
    active.catalog.set(
      PDFName.of("OpenAction"),
      active.context.obj({ S: "JavaScript", JS: "app.alert" })
    );
    const activeBytes = Buffer.from(await active.save());

    await expect(inspect(cleanBytes, "pdf")).resolves.toMatchObject({
      accepted: true,
      kind: "pdf",
    });
    await expect(inspect(activeBytes, "pdf")).resolves.toEqual({
      accepted: false,
      safeCode: "active_content_not_allowed",
    });
    await expect(
      inspect(Buffer.from("%PDF-1.7\nnot a pdf"), "pdf")
    ).resolves.toEqual({
      accepted: false,
      safeCode: "file_corrupt",
    });
    await expect(
      inspect(
        Buffer.from("%PDF-1.7\n1 0 obj<</Encrypt 2 0 R>>endobj\n%%EOF"),
        "pdf"
      )
    ).resolves.toEqual({
      accepted: false,
      safeCode: "encrypted_file_not_allowed",
    });
    await expect(
      inspect(
        Buffer.concat([
          cleanBytes,
          Buffer.from("<script>app.alert(1)</script>"),
        ]),
        "pdf"
      )
    ).resolves.toEqual({
      accepted: false,
      safeCode: "active_content_not_allowed",
    });
  });

  it("validates OOXML shape and rejects macros, external relationships, and bombs", async () => {
    const types =
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    const clean = zip({
      "[Content_Types].xml": types,
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      "word/document.xml": "<w:document></w:document>",
    });
    const macro = zip({
      "[Content_Types].xml": types,
      "word/document.xml": "<w:document></w:document>",
      "word/vbaProject.bin": Buffer.from("macro"),
    });
    const external = zip({
      "[Content_Types].xml": types,
      "word/document.xml": "<w:document></w:document>",
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship TargetMode="External" Target="https://bad.example"/></Relationships>',
    });
    const encrypted = zip({
      EncryptionInfo: Buffer.from("encrypted"),
      EncryptedPackage: Buffer.from("package"),
    });
    const bomb = zip({
      "[Content_Types].xml": types,
      "word/document.xml": "A".repeat(2 * 1024 * 1024),
    });

    await expect(inspect(clean, "docx")).resolves.toMatchObject({
      accepted: true,
      kind: "docx",
    });
    await expect(inspect(macro, "docx")).resolves.toEqual({
      accepted: false,
      safeCode: "macro_not_allowed",
    });
    await expect(inspect(external, "docx")).resolves.toEqual({
      accepted: false,
      safeCode: "active_content_not_allowed",
    });
    await expect(inspect(encrypted, "docx")).resolves.toEqual({
      accepted: false,
      safeCode: "encrypted_file_not_allowed",
    });
    await expect(inspect(bomb, "docx")).resolves.toEqual({
      accepted: false,
      safeCode: "archive_limits_exceeded",
    });
  });

  it("validates legacy Office compound files and rejects macro/encryption streams", async () => {
    const cleanDoc = cfb({ WordDocument: Buffer.from("passive document") });
    const macroDoc = cfb({
      WordDocument: Buffer.from("document"),
      "Macros/VBA/Module1": Buffer.from("macro"),
    });
    const encryptedXls = cfb({
      Workbook: Buffer.from("workbook"),
      EncryptionInfo: Buffer.from("encrypted"),
    });

    await expect(inspect(cleanDoc, "doc")).resolves.toMatchObject({
      accepted: true,
      kind: "doc",
    });
    await expect(inspect(macroDoc, "doc")).resolves.toEqual({
      accepted: false,
      safeCode: "macro_not_allowed",
    });
    await expect(inspect(encryptedXls, "xls")).resolves.toEqual({
      accepted: false,
      safeCode: "encrypted_file_not_allowed",
    });
  });

  it("bounds text, CSV, and DXF while rejecting active text content", async () => {
    await expect(
      inspect(Buffer.from("name,length\nDeck,12\n"), "csv")
    ).resolves.toMatchObject({ accepted: true, kind: "csv" });
    await expect(
      inspect(
        Buffer.from("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"),
        "dxf"
      )
    ).resolves.toMatchObject({ accepted: true, kind: "dxf" });
    await expect(
      inspect(Buffer.from("<html><script>run()</script></html>"), "text")
    ).resolves.toEqual({
      accepted: false,
      safeCode: "active_content_not_allowed",
    });
    await expect(
      inspect(Buffer.from("column\n" + "a,".repeat(300) + "\n"), "csv")
    ).resolves.toEqual({
      accepted: false,
      safeCode: "document_limits_exceeded",
    });
    await expect(
      inspect(Buffer.from("name,value\npayload,=WEBSERVICE(A1)\n"), "csv")
    ).resolves.toEqual({
      accepted: false,
      safeCode: "active_content_not_allowed",
    });
  });
});
