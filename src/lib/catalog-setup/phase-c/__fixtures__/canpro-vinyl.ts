import type { LiveCatalogSnapshot } from "../live-catalog-context";

const FAMILY_ID = "9b30f44d-47da-4134-872d-7f9c2d6f1b44";
const COLOR_OPTION_ID = "507683da-ac06-477e-90cb-e895e7bcdd5c";
const TYPE_OPTION_ID = "eac1b169-30dd-4d58-8480-14f97b670654";
const TYPE_68_VALUE_ID = "afae091a-6f1b-4fb3-b928-ea017dbf3a2a";
const TYPE_60_VALUE_ID = "a0a25675-71dc-4c45-b01f-99c4a3409f0b";

const existingVariants = [
  ["18234bac-442f-41e8-98e7-956c051fbf21", "Sahara Beige", "68"],
  ["3df3abbd-78e7-4c06-932e-8dfe4e87d32c", "Royal Oak", "68"],
  ["50e337f0-f99e-42fe-8f1f-0f69d0af36c0", "Slate Grey", "68"],
  ["5a5e9a74-4fd8-45c8-9dce-58e7b79082c0", "Dove Grey", "60"],
  ["5db3fac5-29c1-47fe-a590-c911c93123e0", "Silver Maple", "68"],
  ["718fd762-eb08-468b-8091-4bf2431463d2", "Pebblestone", "68"],
  ["7d959e53-9a8d-492e-859c-c011aa3e60e7", "Boardwalk", "68"],
  ["a1789400-aec3-4759-81f2-26478fc4a188", "Driftwood", "68"],
  ["ab5c162a-0e5e-44d3-a296-bf56f63a39e4", "Mojave", "68"],
  ["cb882c66-a9cd-4559-a0d3-dc3a108ea536", "Dove Grey", "68"],
  ["cc1db914-6280-4b81-824b-9cd1134e8390", "Antique Beige", "68"],
  ["d08abff0-ea12-4673-927a-0d2db60adbb3", "Antique Beige", "60"],
  ["d3177089-445f-49fa-ac0f-64ebdd403ce7", "Hansberry", "68"],
  ["dabbc359-9b77-48ea-814c-036f84fb7533", "Heritage", "68"],
] as const;

const colorValueIds = {
  "Antique Beige": "3f41029a-19b7-42ff-b92e-11c386e50836",
  Boardwalk: "247c1452-41db-485e-9463-6cc7059c3bb5",
  Dove: "unused",
  "Dove Grey": "d2529282-94de-4870-bd98-f5a178595de3",
  Driftwood: "1b20e080-f747-4393-be0a-fc83500586da",
  Hansberry: "9fe060f6-4c9f-4945-afa2-ea2447c29fd1",
  Heritage: "794ceba5-b4aa-4d6e-88b2-946a8e862a16",
  Mojave: "24511924-10a8-4ecc-9cd7-2da5ce6278f5",
  Pebblestone: "c000f4f1-6c96-49b4-b03d-f97326f8667f",
  "Royal Oak": "b34427e6-b4a8-42c6-bcda-7e467bb2f555",
  "Sahara Beige": "11439a10-db6a-4fd7-89d9-d977296b7193",
  "Silver Maple": "f48f9b64-b765-488a-a24b-74d3e462288a",
  "Slate Grey": "cc33c0c7-f82b-4968-a65e-f691314713f0",
} as const;

const colorValues = Object.entries(colorValueIds)
  .filter(([color]) => color !== "Dove")
  .map(([value, id], index) => ({
    id,
    option_id: COLOR_OPTION_ID,
    value,
    sort_order: index,
    deleted_at: null,
  }));

const variantRows = existingVariants.map(([id]) => ({
  id,
  company_id: "canpro-company",
  catalog_item_id: FAMILY_ID,
  sku: null,
  quantity: 0,
  unit_cost_override: null,
  is_active: true,
  deleted_at: null,
}));

const variantOptionValues = existingVariants.flatMap(
  ([variantId, color, thickness]) => [
    {
      id: `join:${variantId}:color`,
      variant_id: variantId,
      option_value_id:
        colorValueIds[color as keyof typeof colorValueIds],
      deleted_at: null,
    },
    {
      id: `join:${variantId}:type`,
      variant_id: variantId,
      option_value_id:
        thickness === "68" ? TYPE_68_VALUE_ID : TYPE_60_VALUE_ID,
      deleted_at: null,
    },
  ],
);

export const CANPRO_VINYL_LIVE_SNAPSHOT = {
  companyId: "canpro-company",
  hash: "sha256:fixture",
  products: [],
  productOptions: [],
  productOptionValues: [],
  pricingModifiers: [],
  productMaterials: [],
  materialQuantityRules: [],
  families: [
    {
      id: FAMILY_ID,
      company_id: "canpro-company",
      name: "Vinyl",
      deleted_at: null,
    },
  ],
  catalogOptions: [
    {
      id: COLOR_OPTION_ID,
      catalog_item_id: FAMILY_ID,
      name: "Color",
      sort_order: 0,
      deleted_at: null,
    },
    {
      id: TYPE_OPTION_ID,
      catalog_item_id: FAMILY_ID,
      name: "Type",
      sort_order: 1,
      deleted_at: null,
    },
  ],
  catalogOptionValues: [
    ...colorValues,
    {
      id: TYPE_68_VALUE_ID,
      option_id: TYPE_OPTION_ID,
      value: "68mil Fuzzy",
      sort_order: 0,
      deleted_at: null,
    },
    {
      id: TYPE_60_VALUE_ID,
      option_id: TYPE_OPTION_ID,
      value: "60mil Smooth",
      sort_order: 1,
      deleted_at: null,
    },
  ],
  variants: [
    ...variantRows,
    {
      id: "d2187acd-2f4a-4ac8-bc7c-120897e07522",
      company_id: "canpro-company",
      catalog_item_id: FAMILY_ID,
      sku: null,
      quantity: 0,
      unit_cost_override: null,
      is_active: true,
      deleted_at: null,
    },
  ],
  variantOptionValues,
  productOptionMappings: [],
  stockUnits: [],
  supplierCostProfiles: [],
  capabilityBindings: [],
  units: [],
  categories: [],
  taskTypes: [
    {
      id: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
      company_id: "canpro-company",
      display: "Vinyl Install",
      deleted_at: null,
    },
  ],
  verificationItems: [],
} satisfies LiveCatalogSnapshot;
