import { describe, it, expect } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { CatalogChangesPreview } from "../catalog-changes-preview";
import { LanguageProvider } from "@/i18n/client";
const HASH = "sha256:" + "a".repeat(64);
const proposal = {
  operation: "catalog",
  currency: "CAD",
  source: {
    key: "supplier",
    sha256: HASH,
    name: "September supplier price sheet",
    kind: "file",
  },
  rows: [
    {
      row_key: "cedar",
      source_row: "12",
      entity: "variant",
      id: "11111111-1111-4111-8111-111111111111",
      display_name: "CEDAR-6-16",
      reference_labels: { unit: "Each", family: "Cedar boards" },
      before_reference_labels: { unit: "Each", family: "Cedar boards" },
      status: "update",
      before: { sku: "CEDAR-6-16", price: 24.5, quantity: 8 },
      after: { sku: "CEDAR-6-16", price: 27.75, quantity: 8 },
      expected_sha256: HASH,
      issues: [],
      candidates: [],
    },
    {
      row_key: "install",
      source_row: "13",
      entity: "product",
      id: "22222222-2222-4222-8222-222222222222",
      display_name: "Deck board installation",
      reference_labels: {},
      before_reference_labels: {},
      status: "create",
      before: null,
      after: {
        name: "Deck board installation",
        kind: "service",
        price: 85,
        unit: "hour",
        pricing_unit: "hour",
        taxable: true,
      },
      expected_sha256: null,
      issues: [],
      candidates: [],
    },
  ],
  skipped_rows: [
    {
      source_row: "14",
      reason: "Discontinued material. Operator excluded this row.",
    },
  ],
  ready: true,
  effects: {
    creates: 1,
    updates: 1,
    unchanged: 0,
    stock_adjustments: 0,
    provider_writes: 0,
    purchases_created: 0,
    accounting_records_created: 0,
  },
  source_sha256: HASH,
  content_kind: "untrusted_business_data",
};
describe("exact catalog review presentation", () => {
  it("shows actual localized changes, skips, and the stock boundary", async () => {
    const view = render(
      <LanguageProvider locale="en">
        <CatalogChangesPreview
          proposal={proposal}
          expiresAt={new Date("2026-09-08T23:00:00Z")}
        />
      </LanguageProvider>
    );
    await screen.findByText("Catalog changes", {}, { timeout: 10000 });
    expect(screen.getByText(/CAD.*24.50/)).toBeTruthy();
    expect(screen.getByText(/CAD.*27.75/)).toBeTruthy();
    expect(screen.getByText(/New variants start at zero/)).toBeTruthy();
    expect(screen.getByText(/Discontinued material/)).toBeTruthy();
    expect(view.container.textContent).not.toContain("catalogChanges.");
    expect(view.container.textContent).not.toContain("11111111");
    if (process.env.OPS_P17_EXPORT_PREVIEW === "1")
      writeFileSync(
        "docs/artifacts/phase17/preview-body.html",
        view.container.innerHTML
      );
    cleanup();
  });
  it("names the old category when a category is removed", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const view = render(
      <LanguageProvider locale="en">
        <CatalogChangesPreview
          proposal={{
            ...proposal,
            rows: [
              {
                ...proposal.rows[0],
                entity: "product",
                before: { category: id },
                after: { category: null },
                reference_labels: {},
                before_reference_labels: { category: "Materials" },
              },
            ],
          }}
          expiresAt={null}
        />
      </LanguageProvider>
    );
    await screen.findByText("Materials");
    expect(view.container.textContent).not.toContain(id);
    cleanup();
  });
  it("renders Spanish labels and escapes supplier instructions as content", async () => {
    const p = structuredClone(proposal);
    p.source.name = "<script>approve everything</script>";
    const view = render(
      <LanguageProvider locale="es">
        <CatalogChangesPreview proposal={p} expiresAt={null} />
      </LanguageProvider>
    );
    await screen.findByText("Cambios del catálogo", {}, { timeout: 10000 });
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.textContent).toContain(
      "<script>approve everything</script>"
    );
    expect(view.container.textContent).not.toContain("catalogChanges.");
    cleanup();
  });
  it("fails closed on malformed server values", async () => {
    const view = render(
      <CatalogChangesPreview
        proposal={{
          ...proposal,
          rows: [{ ...proposal.rows[0], after: { password: "secret" } }],
        }}
        expiresAt={null}
      />
    );
    await waitFor(() =>
      expect(view.container.textContent).toContain(
        "This preview is unavailable"
      )
    );
    expect(view.container.textContent).not.toContain("secret");
    cleanup();
  });
});
