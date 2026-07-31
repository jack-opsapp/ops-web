import { describe, expect, it } from "vitest";
import {
  GUIDED_SOURCE_MAX_FILE_BYTES,
  GuidedCatalogSourceDocumentError,
  isGuidedCatalogSourceDocument,
  readGuidedCatalogSourceFile,
} from "../source-document";

describe("guided catalog source documents", () => {
  it("turns a CSV price sheet into bounded agent evidence", async () => {
    const file = new File(
      [
        [
          "Product,SKU,Price",
          "Vinyl membrane installation 68mil,DS68,11.73",
          "Vinyl membrane installation 60mil,DS60,12.73",
        ].join("\n"),
      ],
      "vinyl-prices.csv",
      { type: "text/csv" },
    );

    const document = await readGuidedCatalogSourceFile(file);

    expect(document).toEqual({
      kind: "catalog_source_document",
      filename: "vinyl-prices.csv",
      format: "csv",
      headers: ["Product", "SKU", "Price"],
      rows: [
        {
          Product: "Vinyl membrane installation 68mil",
          SKU: "DS68",
          Price: "11.73",
        },
        {
          Product: "Vinyl membrane installation 60mil",
          SKU: "DS60",
          Price: "12.73",
        },
      ],
      rowCount: 2,
    });
    expect(isGuidedCatalogSourceDocument(document)).toBe(true);
  });

  it("rejects unsupported, empty, and oversized files before a turn", async () => {
    await expect(
      readGuidedCatalogSourceFile(
        new File(["not a sheet"], "prices.pdf", {
          type: "application/pdf",
        }),
      ),
    ).rejects.toMatchObject({ code: "unsupported_type" });

    await expect(
      readGuidedCatalogSourceFile(
        new File(["Product,Price\n"], "empty.csv", {
          type: "text/csv",
        }),
      ),
    ).rejects.toMatchObject({ code: "empty" });

    const oversized = new File(
      [new Uint8Array(GUIDED_SOURCE_MAX_FILE_BYTES + 1)],
      "large.csv",
      { type: "text/csv" },
    );
    await expect(
      readGuidedCatalogSourceFile(oversized),
    ).rejects.toBeInstanceOf(GuidedCatalogSourceDocumentError);
    await expect(
      readGuidedCatalogSourceFile(oversized),
    ).rejects.toMatchObject({ code: "too_large" });
  });
});
