import { describe, it, expect, vi } from "vitest";
import {
  catalogCommitToastMessage,
  catalogReadyNotificationBody,
  commitCountPhrase,
  insertCatalogReadyNotification,
  stampCatalogSetupCompleted,
} from "../completion-notification";

describe("commit count phrasing", () => {
  it("joins non-zero counts", () => {
    expect(commitCountPhrase({ products: 24, stock: 12 })).toBe(
      "24 products, 12 in stock",
    );
  });
  it("omits zero clauses + singularizes", () => {
    expect(commitCountPhrase({ products: 1, stock: 0 })).toBe("1 product");
    expect(commitCountPhrase({ products: 0, stock: 5 })).toBe("5 in stock");
    expect(commitCountPhrase({ products: 0, stock: 0 })).toBe("");
  });
  it("toast + body read in OPS voice (no exclamation)", () => {
    expect(catalogCommitToastMessage({ products: 24, stock: 12 })).toBe(
      "Catalog ready — 24 products, 12 in stock",
    );
    expect(catalogCommitToastMessage({ products: 0, stock: 0 })).toBe(
      "Catalog ready",
    );
    expect(catalogReadyNotificationBody({ products: 24, stock: 0 })).toBe(
      "Your price book is live. 24 products.",
    );
    expect(catalogCommitToastMessage({ products: 1, stock: 0 })).not.toContain(
      "!",
    );
  });
});

describe("stampCatalogSetupCompleted", () => {
  it("updates company_settings by text company_id (no uuid cast)", async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const db = { from: vi.fn(() => ({ update })) } as never;
    await stampCatalogSetupCompleted(db, "co-text-1", "2026-06-14T00:00:00.000Z");
    expect(update).toHaveBeenCalledWith({
      catalog_setup_completed_at: "2026-06-14T00:00:00.000Z",
    });
    expect(eq).toHaveBeenCalledWith("company_id", "co-text-1");
  });
});

describe("insertCatalogReadyNotification", () => {
  it("inserts an operator-scoped rail notification", async () => {
    const insert = vi.fn((_row: Record<string, unknown>) =>
      Promise.resolve({ error: null }),
    );
    const db = { from: vi.fn(() => ({ insert })) } as never;
    await insertCatalogReadyNotification(db, {
      userId: "u-1",
      companyId: "co-1",
      productCount: 24,
      stockCount: 12,
    });
    const row = insert.mock.calls[0][0];
    expect(row.user_id).toBe("u-1");
    expect(row.company_id).toBe("co-1");
    expect(row.is_read).toBe(false);
    expect(row.persistent).toBe(false);
    expect(row.action_url).toBe("/catalog");
    expect(row.action_label).toMatch(/OPEN CATALOG/i);
    expect(row.body).toMatch(/24 products/);
  });
});
