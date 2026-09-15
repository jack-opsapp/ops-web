import { describe, expect, it } from "vitest";
import {
  mapLineItemFromDb,
  mapLineItemToDb,
} from "@/lib/api/services/estimate-service";

describe("configured estimate-line persistence", () => {
  it("hydrates the signed product configuration and task linkage snapshot", () => {
    const line = mapLineItemFromDb({
      id: "line-1",
      company_id: "company-1",
      estimate_id: "estimate-1",
      invoice_id: null,
      product_id: "product-1",
      parent_line_item_id: null,
      type: "LABOR",
      task_type_id: "legacy-task-label",
      task_type_ref: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
      name: "Vinyl membrane installation",
      description: null,
      quantity: 100,
      unit: "sqft",
      unit_id: "unit-sqft",
      unit_price: 11.73,
      resolved_unit_price: 11.73,
      minimum_charge_snapshot: 1500,
      unit_cost: 2,
      discount_percent: 0,
      is_taxable: true,
      tax_rate_id: "gst",
      line_total: 1500,
      is_optional: false,
      is_selected: true,
      configured_options: { color: "cobblestone" },
      resolved_options_label: "Color: Cobblestone",
      estimated_hours: null,
      sort_order: 0,
      category: "Decking",
      service_date: null,
      created_at: "2026-07-24T00:00:00.000Z",
    });

    expect(line.configuredOptions).toEqual({ color: "cobblestone" });
    expect(line.resolvedUnitPrice).toBe(11.73);
    expect(line.minimumChargeSnapshot).toBe(1500);
    expect(line.resolvedOptionsLabel).toBe("Color: Cobblestone");
    expect(line.taskTypeRef).toBe(
      "a53dd13d-dc0c-4df0-88d6-118404b161ce",
    );
    expect(line.unitId).toBe("unit-sqft");
  });

  it("writes the same snapshot fields back without recomputing them from Product", () => {
    const row = mapLineItemToDb({
      companyId: "company-1",
      estimateId: "estimate-1",
      invoiceId: null,
      productId: "product-1",
      parentLineItemId: null,
      type: "LABOR",
      taskTypeId: "legacy-task-label",
      taskTypeRef: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
      name: "Vinyl membrane installation",
      description: null,
      quantity: 100,
      unit: "sqft",
      unitId: "unit-sqft",
      unitPrice: 11.73,
      resolvedUnitPrice: 11.73,
      minimumChargeSnapshot: 1500,
      unitCost: 2,
      discountPercent: 0,
      isTaxable: true,
      taxRateId: "gst",
      isOptional: false,
      isSelected: true,
      configuredOptions: { color: "cobblestone" },
      resolvedOptionsLabel: "Color: Cobblestone",
      estimatedHours: null,
      sortOrder: 0,
      category: "Decking",
      serviceDate: null,
    });

    expect(row.configured_options).toEqual({ color: "cobblestone" });
    expect(row.resolved_unit_price).toBe(11.73);
    expect(row.minimum_charge_snapshot).toBe(1500);
    expect(row.resolved_options_label).toBe("Color: Cobblestone");
    expect(row.task_type_ref).toBe(
      "a53dd13d-dc0c-4df0-88d6-118404b161ce",
    );
    expect(row.unit_id).toBe("unit-sqft");
  });
  it("round-trips typed option values: select ids, integer counts and booleans stay typed", () => {
    const configuredOptions = {
      "opt-color": "val-black",
      "opt-left": 1,
      "opt-corners": 0,
      "opt-lights": true,
      "opt-caps": false,
    };
    const row = mapLineItemToDb({
      companyId: "company-1",
      estimateId: "estimate-1",
      productId: "product-1",
      name: "Aluminum railing",
      quantity: 20,
      unitPrice: 95,
      configuredOptions,
      resolvedOptionsLabel: "Color: Black · Left ends: 1 · Corners: 0 · Post lights: Yes · Post caps: No",
    });

    expect(row.configured_options).toStrictEqual(configuredOptions);
    const wire = JSON.parse(JSON.stringify(row.configured_options));
    expect(wire).toStrictEqual(configuredOptions);
    expect(typeof wire["opt-left"]).toBe("number");
    expect(typeof wire["opt-lights"]).toBe("boolean");

    const line = mapLineItemFromDb({
      id: "line-2",
      company_id: "company-1",
      estimate_id: "estimate-1",
      invoice_id: null,
      product_id: "product-1",
      name: "Aluminum railing",
      quantity: 20,
      unit_price: 95,
      line_total: 1900,
      configured_options: wire,
      resolved_options_label: row.resolved_options_label,
      created_at: "2026-09-15T00:00:00.000Z",
    });
    expect(line.configuredOptions).toStrictEqual(configuredOptions);
  });
});
