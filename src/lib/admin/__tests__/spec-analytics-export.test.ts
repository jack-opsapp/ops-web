import { describe, expect, it } from "vitest";
import {
  buildExportManifest,
  buildZipArchive,
  redactEmail,
  redactPhone,
  toCsv,
} from "../spec-analytics-export";

const textDecoder = new TextDecoder();

function readStoredZip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: Record<string, string> = {};
  let offset = 0;

  while (offset < bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    expect(signature).toBe(0x04034b50);
    expect(view.getUint16(offset + 8, true)).toBe(0);

    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = textDecoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));

    files[name] = textDecoder.decode(bytes.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }

  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  return files;
}

describe("spec analytics export helpers", () => {
  it("hashes email in default export mode", () => {
    expect(redactEmail("JACK@OPSAPP.CO")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes phone in default export mode", () => {
    expect(redactPhone("+1 (778) 535-7941")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("marks sensitive manifests", () => {
    expect(
      buildExportManifest({
        mode: "sensitive",
        from: "2026-06-07",
        to: "2026-06-20",
        rowCounts: { spec_projects: 1 },
      }).sensitive,
    ).toBe(true);
  });

  it("builds a real zip archive", () => {
    const bytes = buildZipArchive({
      "manifest.json": JSON.stringify({ ok: true }),
      "events.csv": "id,event\n1,stripe_checkout_completed\n",
    });

    const files = readStoredZip(bytes);
    expect(Object.keys(files).sort()).toEqual(["events.csv", "manifest.json"]);
    expect(files["events.csv"]).toBe("id,event\n1,stripe_checkout_completed\n");
    expect(JSON.parse(files["manifest.json"])).toEqual({ ok: true });
  });

  it("escapes csv cells", () => {
    expect(toCsv([{ id: 1, note: "one, two", payload: { ok: true } }])).toBe(
      'id,note,payload\n1,"one, two","{""ok"":true}"',
    );
  });
});
