import { describe, expect, it } from "vitest";
import {
  buildBulkVariantExpansionRequest,
  buildBulkVariantFamilyRecords,
  familyStructureIssue,
  normalizeBulkVariantText,
  planBulkVariantExpansion,
  type BulkVariantFamilySnapshot,
} from "@/lib/catalog/bulk-variant-expansion";

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function family(
  overrides: Partial<BulkVariantFamilySnapshot> = {}
): BulkVariantFamilySnapshot {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Classic rail",
    options: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Color",
        sortOrder: 0,
        values: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            value: "Black",
            sortOrder: 0,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            value: "White",
            sortOrder: 1,
          },
        ],
      },
    ],
    variants: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        sku: "RAIL-BLK",
        quantity: 8,
        priceOverride: 32,
        unitCostOverride: 14,
        warningThreshold: 3,
        criticalThreshold: 1,
        unitId: "66666666-6666-4666-8666-666666666666",
        isActive: true,
        optionValueIds: ["33333333-3333-4333-8333-333333333333"],
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        quantity: 3,
        isActive: true,
        optionValueIds: ["44444444-4444-4444-8444-444444444444"],
      },
    ],
    ...overrides,
  };
}

describe("bulk variant expansion planner", () => {
  it("normalizes case and all whitespace without changing the authored display text", () => {
    expect(normalizeBulkVariantText("  Top\n\t PROFILE  ")).toBe("top profile");
  });

  it("adds a new axis to existing variants and clones every other-axis combination", () => {
    const preview = planBulkVariantExpansion({
      axisName: " Top   profile ",
      existingValue: " Round top ",
      newValues: [" Flat  top "],
      families: [family()],
    });

    expect(preview.blockers).toEqual([]);
    expect(preview.axisName).toBe("Top profile");
    expect(preview.existingValue).toBe("Round top");
    expect(preview.newValues).toEqual(["Flat top"]);
    expect(preview.familyCount).toBe(1);
    expect(preview.existingVariantAssignmentCount).toBe(2);
    expect(preview.newVariantCount).toBe(2);

    const plan = preview.familyPlans[0];
    expect(
      plan.existingAssignments.map((assignment) => assignment.variantId)
    ).toEqual([
      "55555555-5555-4555-8555-555555555555",
      "77777777-7777-4777-8777-777777777777",
    ]);
    expect(plan.newVariants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceVariantId: "55555555-5555-4555-8555-555555555555",
          sku: null,
          quantity: 0,
          priceOverride: 32,
          unitCostOverride: 14,
          warningThreshold: 3,
          criticalThreshold: 1,
          unitId: "66666666-6666-4666-8666-666666666666",
          optionSelections: [
            { optionName: "Color", value: "Black" },
            { optionName: "Top profile", value: "Flat top" },
          ],
        }),
      ])
    );
    expect(plan.combinationChanges[0]).toEqual(
      expect.objectContaining({
        before: [{ optionName: "Color", value: "Black" }],
        after: [
          [
            { optionName: "Color", value: "Black" },
            { optionName: "Top profile", value: "Flat top" },
          ],
        ],
      })
    );
  });

  it("expands only the selected source value on an existing axis and skips existing signatures", () => {
    const topOption = {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Top profile",
      sortOrder: 1,
      values: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          value: "Round top",
          sortOrder: 0,
        },
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          value: "Flat top",
          sortOrder: 1,
        },
      ],
    };
    const source = family({
      options: [...family().options, topOption],
      variants: [
        {
          ...family().variants[0],
          optionValueIds: [
            "33333333-3333-4333-8333-333333333333",
            "99999999-9999-4999-8999-999999999999",
          ],
        },
        {
          ...family().variants[1],
          optionValueIds: [
            "44444444-4444-4444-8444-444444444444",
            "99999999-9999-4999-8999-999999999999",
          ],
        },
        {
          id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
          quantity: 0,
          isActive: true,
          optionValueIds: [
            "33333333-3333-4333-8333-333333333333",
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          ],
        },
      ],
    });

    const preview = planBulkVariantExpansion({
      axisName: "top profile",
      existingValue: "round top",
      newValues: ["flat top"],
      families: [source],
    });

    expect(preview.blockers).toEqual([]);
    expect(preview.existingVariantAssignmentCount).toBe(0);
    expect(preview.newVariantCount).toBe(1);
    expect(preview.skippedExistingCombinationCount).toBe(1);
    expect(preview.familyPlans[0].newVariants[0].sourceVariantId).toBe(
      "77777777-7777-4777-8777-777777777777"
    );
  });

  it("blocks duplicate/no-op new values and enforces the 20-value ceiling", () => {
    expect(
      planBulkVariantExpansion({
        axisName: "Top profile",
        existingValue: "Round top",
        newValues: ["Flat top", " flat   TOP "],
        families: [family()],
      }).blockers[0]?.code
    ).toBe("duplicate_new_value");

    expect(
      planBulkVariantExpansion({
        axisName: "Top profile",
        existingValue: "Round top",
        newValues: [" round   TOP "],
        families: [family()],
      }).blockers[0]?.code
    ).toBe("new_value_matches_existing");

    expect(
      planBulkVariantExpansion({
        axisName: "Top profile",
        existingValue: "Round top",
        newValues: Array.from({ length: 21 }, (_, index) => `Value ${index}`),
        families: [family()],
      }).blockers[0]?.code
    ).toBe("too_many_new_values");
  });

  it("gives exact structural reasons before a family can be selected", () => {
    expect(familyStructureIssue(family({ variants: [] }))?.code).toBe(
      "no_active_variants"
    );

    expect(
      familyStructureIssue(
        family({
          options: [
            ...family().options,
            {
              ...family().options[0],
              id: "bbbbbbbb-1111-4111-8111-111111111111",
              name: " color ",
            },
          ],
        })
      )?.code
    ).toBe("duplicate_option_axis");

    expect(
      familyStructureIssue(
        family({
          variants: [{ ...family().variants[0], optionValueIds: [] }],
        })
      )?.code
    ).toBe("incomplete_variant_options");

    expect(
      familyStructureIssue(
        family({
          variants: [
            family().variants[0],
            { ...family().variants[0], id: REQUEST_ID },
          ],
        })
      )?.code
    ).toBe("duplicate_variant_signature");
  });

  it("blocks an existing axis when no active variant carries the source value", () => {
    const top = {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Top profile",
      sortOrder: 1,
      values: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          value: "Round top",
          sortOrder: 0,
        },
      ],
    };
    const source = family({
      options: [...family().options, top],
      variants: family().variants.map((variant) => ({
        ...variant,
        optionValueIds: [
          ...variant.optionValueIds,
          "99999999-9999-4999-8999-999999999999",
        ],
      })),
    });

    expect(
      planBulkVariantExpansion({
        axisName: "Top profile",
        existingValue: "Square top",
        newValues: ["Flat top"],
        families: [source],
      }).blockers[0]?.code
    ).toBe("existing_value_missing");
  });

  it("builds active company family records and retains unsafe unknown joins for validation", () => {
    const records = buildBulkVariantFamilyRecords({
      companyId: COMPANY_ID,
      items: [
        {
          id: family().id,
          companyId: COMPANY_ID,
          categoryId: "cat-1",
          name: "Classic rail",
          isActive: true,
        },
        {
          id: "inactive",
          companyId: COMPANY_ID,
          categoryId: null,
          name: "Inactive",
          isActive: false,
        },
        {
          id: "other",
          companyId: REQUEST_ID,
          categoryId: null,
          name: "Other company",
          isActive: true,
        },
      ],
      categories: [{ id: "cat-1", name: "Rail" }],
      options: family().options.map((option) => ({
        id: option.id,
        catalogItemId: family().id,
        name: option.name,
        sortOrder: option.sortOrder,
      })),
      values: family().options.flatMap((option) =>
        option.values.map((value) => ({ ...value, optionId: option.id }))
      ),
      variants: family().variants.map((variant) => ({
        ...variant,
        companyId: COMPANY_ID,
        catalogItemId: family().id,
      })),
      joins: [
        ...family().variants.map((variant) => ({
          variantId: variant.id,
          optionValueId: variant.optionValueIds[0],
        })),
        { variantId: family().variants[0].id, optionValueId: "unknown-value" },
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0].categoryName).toBe("Rail");
    expect(records[0].snapshot.variants[0].optionValueIds).toContain(
      "unknown-value"
    );
    expect(records[0].issue?.code).toBe("unknown_option_value");
  });

  it("constructs a replay-safe request with exact source snapshots and no UI-only fields", () => {
    const preview = planBulkVariantExpansion({
      axisName: "Top profile",
      existingValue: "Round top",
      newValues: ["Flat top"],
      families: [family()],
    });
    const request = buildBulkVariantExpansionRequest({
      companyId: COMPANY_ID,
      idempotencyKey: REQUEST_ID,
      preview,
    });

    expect(request.companyId).toBe(COMPANY_ID);
    expect(request.idempotencyKey).toBe(REQUEST_ID);
    expect(request.payload.families[0].source_fingerprint).toBe(
      "991f606960790c3513ef956c355759b6e5e6b12d3e4d05481694c9c0533630e2"
    );
    expect(request.payload.families[0].source).toEqual(family());
    expect(JSON.stringify(request.payload.families[0].source)).not.toContain(
      '"sku":null'
    );
  });
});
