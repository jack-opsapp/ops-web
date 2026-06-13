// Real QuickBooks Online `Item` entity JSON shapes, captured from the QBO
// Accounting API v3 `query` endpoint (`SELECT * FROM Item`). Field casing and
// nesting mirror Intuit's responses exactly so the mapper is exercised against
// production-faithful input (spec §8 "structured pull", Task 5.3).
//
// QBO `Item.Type` values used in production:
//   - "Service"      → labor / non-stocked service
//   - "NonInventory" → a part sold but not stock-tracked
//   - "Inventory"    → a stock-tracked part (carries QtyOnHand)
//   - "Group"        → a bundle (ItemGroupDetail.ItemGroupLine[])
//   - "Category"     → a non-sellable folder (must be dropped, not carded)
//
// Pure data — no imports, no logic.

import type { QboRawRecord } from "@/lib/types/qbo-import";

/** Service item: flat-priced labor. Taxable explicitly false; no description. */
export const serviceItem: QboRawRecord = {
  Id: "42",
  Name: "Roof inspection",
  Sku: "INSP-01",
  Description: null,
  Active: true,
  FullyQualifiedName: "Roof inspection",
  Taxable: false,
  UnitPrice: 150,
  Type: "Service",
  IncomeAccountRef: { value: "79", name: "Services" },
  PurchaseDesc: null,
  PurchaseCost: 0,
  TrackQtyOnHand: false,
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
  MetaData: { CreateTime: "2026-05-01T09:00:00-07:00", LastUpdatedTime: "2026-05-01T09:00:00-07:00" },
};

/** NonInventory item: a sold part, not stock-tracked. Carries PurchaseCost. */
export const nonInventoryItem: QboRawRecord = {
  Id: "55",
  Name: "Pipe fitting",
  Sku: "PF-3-4",
  Description: "3/4 inch copper pipe fitting",
  Active: true,
  FullyQualifiedName: "Pipe fitting",
  Taxable: true,
  UnitPrice: 4.5,
  Type: "NonInventory",
  IncomeAccountRef: { value: "79", name: "Sales of Product Income" },
  ExpenseAccountRef: { value: "80", name: "Cost of Goods Sold" },
  PurchaseDesc: "3/4 inch copper pipe fitting",
  PurchaseCost: 1.85,
  TrackQtyOnHand: false,
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
  MetaData: { CreateTime: "2026-05-02T10:00:00-07:00", LastUpdatedTime: "2026-05-02T10:00:00-07:00" },
};

/** Inventory item: stock-tracked. QtyOnHand present; TrackQtyOnHand true. */
export const inventoryItem: QboRawRecord = {
  Id: "60",
  Name: "Asphalt shingle bundle",
  Sku: "SHNG-AR",
  Description: "Architectural asphalt shingle, per bundle",
  Active: true,
  FullyQualifiedName: "Asphalt shingle bundle",
  Taxable: true,
  UnitPrice: 38,
  Type: "Inventory",
  IncomeAccountRef: { value: "79", name: "Sales of Product Income" },
  AssetAccountRef: { value: "81", name: "Inventory Asset" },
  ExpenseAccountRef: { value: "80", name: "Cost of Goods Sold" },
  PurchaseDesc: "Architectural asphalt shingle, per bundle",
  PurchaseCost: 24.75,
  TrackQtyOnHand: true,
  QtyOnHand: 320,
  InvStartDate: "2026-01-01",
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
  MetaData: { CreateTime: "2026-05-03T11:00:00-07:00", LastUpdatedTime: "2026-05-03T11:00:00-07:00" },
};

/** Group (bundle) item: two component lines via ItemGroupDetail.ItemGroupLine[]. */
export const groupItem: QboRawRecord = {
  Id: "70",
  Name: "Bathroom rough-in kit",
  Sku: "KIT-BRI",
  Description: "Standard bathroom rough-in package",
  Active: true,
  FullyQualifiedName: "Bathroom rough-in kit",
  Taxable: true,
  Type: "Group",
  ItemGroupDetail: {
    ItemGroupLine: [
      { ItemRef: { value: "55", name: "Pipe fitting" }, Qty: 6 },
      { ItemRef: { value: "60", name: "Asphalt shingle bundle" }, Qty: 2 },
    ],
  },
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
  MetaData: { CreateTime: "2026-05-04T12:00:00-07:00", LastUpdatedTime: "2026-05-04T12:00:00-07:00" },
};

/** Category-type item: a non-sellable folder. Must be dropped (kind: null). */
export const categoryItem: QboRawRecord = {
  Id: "90",
  Name: "Plumbing",
  Active: true,
  FullyQualifiedName: "Plumbing",
  Type: "Category",
  SubItem: false,
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
  MetaData: { CreateTime: "2026-05-05T13:00:00-07:00", LastUpdatedTime: "2026-05-05T13:00:00-07:00" },
};

/** Service item missing Name — a commit blocker (cannot card without a name). */
export const namelessItem: QboRawRecord = {
  Id: "99",
  Sku: "NO-NAME",
  Type: "Service",
  UnitPrice: 10,
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
};

/** Item with an unrecognized Type — safe default + needsReview flag. */
export const unknownTypeItem: QboRawRecord = {
  Id: "101",
  Name: "Mystery line",
  Type: "Assembly", // not in the known set
  UnitPrice: 22,
  Taxable: true,
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
};

/**
 * Service item with NO Taxable field and NO UnitPrice — exercises the column
 * defaults: Taxable absent → is_taxable true; UnitPrice absent → base_price 0.
 */
export const sparseDefaultsItem: QboRawRecord = {
  Id: "110",
  Name: "Bare service",
  Type: "Service",
  domain: "QBO",
  sparse: true,
  SyncToken: "0",
};

/** Inventory item with QtyOnHand absent — on-hand defaults to 0 when tracked. */
export const inventoryNoQtyItem: QboRawRecord = {
  Id: "120",
  Name: "Loose fastener",
  Sku: "FAST-01",
  Type: "Inventory",
  Taxable: true,
  UnitPrice: 0.25,
  PurchaseCost: 0.08,
  TrackQtyOnHand: true,
  domain: "QBO",
  sparse: false,
  SyncToken: "0",
};

/** A mixed catalog pull (every shape) for the batch-wrapper test. */
export const mixedItems: QboRawRecord[] = [
  serviceItem,
  nonInventoryItem,
  inventoryItem,
  groupItem,
  categoryItem, // dropped
  namelessItem, // blocker
  unknownTypeItem, // needsReview
];
