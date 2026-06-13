## Phase 2: Deterministic Sources — Source Picker, Manual Entry, CSV/XLSX Mapper, Trade Templates

**Goal.** Stand up the four deterministic source lanes that feed the Phase-1 staging canvas: the source picker, manual entry, the CSV/XLSX deterministic mapper (a faithful port of the iOS `CatalogCSVMapper` + `ProductsCSVMapper`), and per-trade template seeds. Every mapper is a **pure function** producing Phase-1 `StagingCard[]` — built test-first against real fixture rows. The agent and QuickBooks lanes appear in the picker but are stubbed hand-offs to Phases 3–4. **This phase writes zero DB rows and adds zero schema.**

**Skills.** `interface-design` + `frontend-design` (the source picker, upload step, column-map step, manual + template forms), `ops-copywriter` (every user-facing string — the source-picker labels, upload prompts, validation errors, template trade names), `elite-animations` / `animation-architect` (card-stage-in micro-motion handed to the canvas), `audit-design-system` (done-gate on every UI task). Pure-logic tasks (mappers, parsers, router, templates) invoke **no** UI skills — they are TDD-only.

**Design tokens (UI tasks only).** Canvas `#000`; lane cards + dropzone use `.glass` (`rgba(18,18,20,0.58)` + `backdrop-blur(28px) saturate(1.3)` + `1px solid rgba(255,255,255,0.09)`); inner dialogs `.glass-dense` (0.78 alpha). Titles/labels/buttons `font-cakemono font-light` UPPERCASE; body `font-mohave` sentence case; all numbers/counts `font-mono` with `tnum`/`zero`. Accent `#6F94B0` on the **single** primary CTA + focus ring only — never on lane cards, the stepper, toggles, or the column-map selects. Radius: `panel:10` / `modal:12` / `btn:5` / `chip:4`. Earth-tone borders for state: olive `#9DB582` (added/valid), tan `#C4A868` (needs attention), rose `#B58289` (cost/error). Icons `lucide-react` (`Upload`, `FileSpreadsheet`, `PlusCircle`, `LayoutTemplate`, `Plug`, `MessageSquare`). Motion: one curve `cubic-bezier(0.22,1,0.36,1)`, honor `prefers-reduced-motion`. Empty/zero = `—` or `$0`. No `text-align: center`.

---

### Task 2.0: Add SheetJS dependency + scaffold the catalog-setup lib folder

**Skills:** none (tooling).
**Files:**
- Modify `package.json` (add `"xlsx"` to dependencies)
- Create `src/lib/catalog-setup/.gitkeep` (folder anchor; removed once first module lands)

Steps:
1. Install the community SheetJS build (Apache-2.0, client-side only, no runtime/DB cost): run `npm i xlsx@^0.18.5 --save-exact` from the worktree root. Expected: `package.json` gains `"xlsx": "0.18.5"`; lockfile updates. **Do not** stage other lockfile churn from sibling sessions.
2. Verify import resolves: run `npx tsc --noEmit --esModuleInterop --skipLibCheck -e "import * as XLSX from 'xlsx'; void XLSX;"` is not valid for tsc; instead create a throwaway `src/lib/catalog-setup/_probe.ts` containing `import * as XLSX from "xlsx"; export const ok = typeof XLSX.read === "function";` and run `npx vitest run --root . -t "nonexistent" 2>&1 | head -1` — expected: vitest boots without a module-resolution error for `xlsx`. Delete `_probe.ts`.
3. Commit: `chore(catalog-setup): add SheetJS (xlsx) for client-side spreadsheet parse`. Stage `package.json` + lockfile by name only.

---

### Task 2.1: `parse-number.ts` — shared permissive numeric parse (TDD)

Ports the identical `parseNumber` from both iOS mappers: tolerates `$`, `,`, surrounding whitespace; blank → `null` (no error); negative → error; non-numeric → error.

**Skills:** none (pure logic, TDD).
**Files:**
- Create `tests/unit/catalog-setup/parse-number.test.ts`
- Create `src/lib/catalog-setup/parse-number.ts`

Steps:
1. **Write the failing test.** Create `tests/unit/catalog-setup/parse-number.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseNumber } from "@/lib/catalog-setup/parse-number";

describe("parseNumber", () => {
  it("returns null for blank/whitespace/undefined (no error)", () => {
    expect(parseNumber(undefined)).toEqual({ value: null });
    expect(parseNumber("")).toEqual({ value: null });
    expect(parseNumber("   ")).toEqual({ value: null });
  });
  it("strips $ , and whitespace", () => {
    expect(parseNumber(" $1,250.50 ")).toEqual({ value: 1250.5 });
    expect(parseNumber("42")).toEqual({ value: 42 });
  });
  it("errors on negative", () => {
    const r = parseNumber("-5");
    expect(r.value).toBeNull();
    expect(r.error).toBe("negative");
  });
  it("errors on non-numeric", () => {
    const r = parseNumber("abc");
    expect(r.value).toBeNull();
    expect(r.error).toBe("not_a_number");
  });
});
```
2. **Run it, see it fail:** `npx vitest run tests/unit/catalog-setup/parse-number.test.ts` → expected: "Cannot find module '@/lib/catalog-setup/parse-number'".
3. **Minimal impl.** Create `src/lib/catalog-setup/parse-number.ts`:
```ts
export type ParseNumberResult = {
  value: number | null;
  error?: "negative" | "not_a_number";
};

/** Permissive numeric parse — tolerates `$`, `,`, surrounding whitespace.
 *  Blank/undefined → { value: null } with no error (mirrors iOS parseNumber,
 *  which stays silent on blanks). Negative or unparseable → value null + error. */
export function parseNumber(raw: string | undefined | null): ParseNumberResult {
  if (raw == null) return { value: null };
  const cleaned = raw.trim().replace(/\$/g, "").replace(/,/g, "");
  if (cleaned === "") return { value: null };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, error: "not_a_number" };
  if (n < 0) return { value: null, error: "negative" };
  return { value: n };
}
```
4. **Run, see it pass:** `npx vitest run tests/unit/catalog-setup/parse-number.test.ts` → expected: 4 passed.
5. Commit: `feat(catalog-setup): permissive numeric parse for spreadsheet import`.

---

### Task 2.2: `staging-card.ts` — Phase-1 placeholder card contract

The mappers output Phase-1 `StagingCard[]`. Phase 1 owns the canonical type; until it lands, define a minimal local contract so the mappers are testable now. **Type-only** — at execution, after Phase 1 lands, re-point imports at Phase 1's type (see Confirmations).

**Skills:** none (types).
**Files:**
- Create `src/lib/catalog-setup/staging-card.ts`

Steps:
1. Create `src/lib/catalog-setup/staging-card.ts`:
```ts
/**
 * PHASE-1 PLACEHOLDER. The canonical StagingCard model is owned by Phase 1
 * (the shared canvas). These types mirror the catalog_setup_save payload
 * families so the deterministic mappers can be built + tested before Phase 1
 * lands. When Phase 1 ships its model, replace these with `import type` from
 * the Phase-1 module — mapper LOGIC does not change, only the output binding.
 *
 * `source` is stamped so the canvas can show provenance and so re-imports
 * dedupe (Phase: dedupe). `clientId` is a stable per-card id the canvas keys on.
 */
export type CardSource = "manual" | "csv" | "xlsx" | "template" | "quickbooks" | "agent";

export interface SellCard {
  module: "SELL";
  clientId: string;
  source: CardSource;
  /** 1-based source line in the uploaded file, when applicable. */
  sourceLine?: number;
  name: string;
  description: string | null;
  basePrice: number | null;
  unitCost: number | null;
  categoryId: string | null;
  categoryText: string | null;
  unitId: string | null;
  unitText: string | null;
  pricingUnit: string | null;
  sku: string | null;
  kind: "service" | "good" | null;
  type: "LABOR" | "MATERIAL" | "OTHER" | null;
  isTaxable: boolean | null;
}

export interface StockVariantDraft {
  clientId: string;
  sourceLine?: number;
  sku: string | null;
  quantity: number;
  priceOverride: number | null;
  unitCostOverride: number | null;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  unitId: string | null;
  unitText: string | null;
}

export interface StockCard {
  module: "STOCK";
  clientId: string;
  source: CardSource;
  sourceLine?: number;
  familyName: string;
  description: string | null;
  categoryId: string | null;
  categoryText: string | null;
  defaultUnitId: string | null;
  defaultUnitText: string | null;
  defaultPrice: number | null;
  defaultUnitCost: number | null;
  variants: StockVariantDraft[];
}

export interface TypesCard {
  module: "TYPES";
  clientId: string;
  source: CardSource;
  /** task_type display name. */
  name: string;
  tags: string[];
  estimatedHoursMin: number | null;
  estimatedHoursMax: number | null;
  colorHex: string | null;
}

export type StagingCard = SellCard | StockCard | TypesCard;

/** A local validation error surfaced before commit. Mirrors the iOS
 *  CatalogImportError mapping shape so the canvas renders uniformly. */
export interface MapError {
  scope: "mapping";
  /** 0-based row index into the parsed rows; -1 = file-level. */
  rowIndex: number;
  field: string;
  reason: string;
}
```
2. No test (type-only module). Verify it type-checks: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep staging-card` → expected: no output.
3. Commit: `feat(catalog-setup): placeholder staging-card contract (Phase-1 owned)`.

---

### Task 2.3: `csv-parse.ts` — CSV text → headers/rows/lineNumbers (TDD)

The iOS mapper receives already-parsed `[[String:String]]`. On web we parse the raw file first. Pure function: handles quoted fields, embedded commas/quotes, CRLF, and emits 1-based source line numbers parallel to rows (header is line 1; first data row is line 2).

**Skills:** none (pure logic, TDD).
**Files:**
- Create `tests/unit/catalog-setup/csv-parse.test.ts`
- Create `src/lib/catalog-setup/csv-parse.ts`

Steps:
1. **Failing test:**
```ts
import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";

describe("parseCsv", () => {
  it("parses headers + rows keyed by header", () => {
    const r = parseCsv("Name,Price\nWidget,10\nGadget,20");
    expect(r.headers).toEqual(["Name", "Price"]);
    expect(r.rows).toEqual([
      { Name: "Widget", Price: "10" },
      { Name: "Gadget", Price: "20" },
    ]);
    expect(r.lineNumbers).toEqual([2, 3]);
  });
  it("handles quoted fields with commas + CRLF", () => {
    const r = parseCsv('Name,Desc\r\n"Bolt, hex","1/2\"\"-13"\r\n');
    expect(r.rows[0]).toEqual({ Name: "Bolt, hex", Desc: '1/2"-13' });
  });
  it("skips fully-blank lines but keeps line numbers honest", () => {
    const r = parseCsv("Name,Price\nWidget,10\n\nGadget,20");
    expect(r.rows.map((x) => x.Name)).toEqual(["Widget", "Gadget"]);
    expect(r.lineNumbers).toEqual([2, 4]);
  });
  it("returns empty rows for header-only file", () => {
    const r = parseCsv("Name,Price");
    expect(r.rows).toEqual([]);
    expect(r.lineNumbers).toEqual([]);
  });
});
```
2. **Run, fail:** `npx vitest run tests/unit/catalog-setup/csv-parse.test.ts` → module-not-found.
3. **Impl** `src/lib/catalog-setup/csv-parse.ts` — a small RFC-4180-ish state-machine tokenizer (quote/escape/newline aware), returning `{ headers: string[]; rows: Record<string,string>[]; lineNumbers: number[] }`. Trim header names; map each cell to its header; track physical line numbers, skipping rows where every cell is empty. (Do NOT pull in PapaParse — keep the parse pure + dependency-light; SheetJS is only for XLSX binary.)
4. **Run, pass:** `npx vitest run tests/unit/catalog-setup/csv-parse.test.ts` → expected: 4 passed.
5. Commit: `feat(catalog-setup): pure CSV tokenizer (quotes, CRLF, blank-line line numbers)`.

---

### Task 2.4: `xlsx-parse.ts` — File/ArrayBuffer → same shape via SheetJS (TDD)

Parses the first worksheet into the **identical** `{ headers, rows, lineNumbers }` shape `csv-parse` emits, so the mapper is source-agnostic. Numbers/dates from cells are stringified (the mapper re-parses permissively).

**Skills:** none (pure logic, TDD).
**Files:**
- Create `tests/fixtures/catalog-setup/make-fixtures.mjs` (one-off generator, committed)
- Create `tests/fixtures/catalog-setup/stock.xlsx` (generated)
- Create `tests/unit/catalog-setup/xlsx-parse.test.ts`
- Create `src/lib/catalog-setup/xlsx-parse.ts`

Steps:
1. **Generate the binary fixture deterministically.** Create `tests/fixtures/catalog-setup/make-fixtures.mjs`:
```js
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ["Family Name", "SKU", "Qty", "Unit Cost"],
  ["Copper Pipe", "CP-12", 40, 3.5],
  ["Copper Pipe", "CP-34", 25, 5.0],
  ["PVC Elbow", "PVC-E", 100, 0.4],
]);
XLSX.utils.book_append_sheet(wb, ws, "Stock");
writeFileSync(new URL("./stock.xlsx", import.meta.url), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("wrote stock.xlsx");
```
Run: `node tests/fixtures/catalog-setup/make-fixtures.mjs` → expected: "wrote stock.xlsx".
2. **Failing test** `tests/unit/catalog-setup/xlsx-parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseXlsx } from "@/lib/catalog-setup/xlsx-parse";

describe("parseXlsx", () => {
  it("parses the first sheet into csv-parse shape", async () => {
    const buf = readFileSync(new URL("../../fixtures/catalog-setup/stock.xlsx", import.meta.url));
    const r = await parseXlsx(buf);
    expect(r.headers).toEqual(["Family Name", "SKU", "Qty", "Unit Cost"]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ "Family Name": "Copper Pipe", SKU: "CP-12", Qty: "40", "Unit Cost": "3.5" });
    expect(r.lineNumbers).toEqual([2, 3, 4]);
  });
});
```
3. **Run, fail:** `npx vitest run tests/unit/catalog-setup/xlsx-parse.test.ts` → module-not-found.
4. **Impl** `src/lib/catalog-setup/xlsx-parse.ts`: accept `ArrayBuffer | Uint8Array | Buffer`, `XLSX.read(data, { type: "array" })`, take `workbook.SheetNames[0]`, `XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })` to get rows-as-arrays with stringified cells, then map row 0 → headers and subsequent non-empty rows → `Record<string,string>` with parallel `lineNumbers` (rowIdx+1, 1-based, header=1). Skip fully-empty rows like csv-parse. Return the same `ParsedSheet` type (export a shared `ParsedSheet` interface from `csv-parse.ts` and import it here).
5. **Run, pass:** `npx vitest run tests/unit/catalog-setup/xlsx-parse.test.ts` → expected: 1 passed.
6. Commit (two atomic): (a) `test(catalog-setup): xlsx fixture + generator`; (b) `feat(catalog-setup): SheetJS xlsx parse to shared sheet shape`.

---

### Task 2.5: `column-mapping.ts` — header alias auto-map (TDD)

Ports `ProductsImportColumnMapping.suggest` + `CatalogImportColumnMapping.suggest`: case-insensitive `_`/`-`→space normalize, exact-alias hit first, then substring fallback.

**Skills:** none (pure logic, TDD).
**Files:**
- Create `tests/unit/catalog-setup/column-mapping.test.ts`
- Create `src/lib/catalog-setup/column-mapping.ts`

Steps:
1. **Failing test** asserting the exact iOS alias behavior:
```ts
import { describe, it, expect } from "vitest";
import { suggestProductsMapping, suggestStockMapping, normalizeHeader } from "@/lib/catalog-setup/column-mapping";

describe("normalizeHeader", () => {
  it("lowercases, trims, _ and - to space", () => {
    expect(normalizeHeader(" Unit_Cost-Override ")).toBe("unit cost override");
  });
});
describe("suggestProductsMapping", () => {
  it("maps name + base price via exact alias", () => {
    const m = suggestProductsMapping(["Product Name", "List Price", "Our Cost"]);
    expect(m.name).toBe("Product Name");
    expect(m.basePrice).toBe("List Price");
    expect(m.unitCost).toBe("Our Cost");
  });
  it("falls back to substring when no exact alias", () => {
    const m = suggestProductsMapping(["Item Title", "Rate Each"]);
    expect(m.name).toBe("Item Title"); // "title" alias
    expect(m.basePrice).toBe("Rate Each"); // "rate" alias via substring
  });
  it("isReadyToMap requires name + basePrice", () => {
    expect(suggestProductsMapping(["Name", "Price"]).isReadyToMap).toBe(true);
    expect(suggestProductsMapping(["Color"]).isReadyToMap).toBe(false);
  });
});
describe("suggestStockMapping", () => {
  it("maps family_name + quantity + thresholds", () => {
    const m = suggestStockMapping(["Family", "Qty", "On Hand", "Min"]);
    expect(m.familyName).toBe("Family");
    expect(m.quantity).toBe("Qty");
    expect(m.criticalThreshold).toBe("Min"); // "min" alias
  });
});
```
2. **Run, fail.** 3. **Impl** with the SAME alias arrays as the Swift `suggest()` for both mappers (products: name/basePrice/description/unitCost/category/unit/pricingUnit/sku/kind/type/isTaxable; stock: familyName/quantity/familyDescription/category/defaultUnit/defaultPrice/defaultUnitCost/sku/variantUnit/priceOverride/unitCostOverride/warningThreshold/criticalThreshold). Export `ProductsColumnMapping`/`StockColumnMapping` types each with an `isReadyToMap: boolean` getter-equivalent (compute and attach). 4. **Run, pass.** 5. Commit: `feat(catalog-setup): header alias auto-map (ports iOS suggest)`.

---

### Task 2.6: `products-csv-mapper.ts` — flat products → SellCard[] (TDD)

Ports `ProductsCSVMapper.map`: one row = one product; name + basePrice required; typed category/unit text → FK id via case-insensitive company-vocab match (unmatched = hard `MapError`); kind ∈ service|good; type ∈ LABOR|MATERIAL|OTHER; is_taxable truthy/falsy; permissive numbers. Output: `SellCard[]` (only when zero errors, mirroring the iOS payload-or-nil contract) + `MapError[]`.

**Skills:** none (pure logic, TDD).
**Files:**
- Create `tests/fixtures/catalog-setup/products-clean.csv`, `products-messy.csv`
- Create `tests/unit/catalog-setup/products-csv-mapper.test.ts`
- Create `src/lib/catalog-setup/products-csv-mapper.ts`

Steps:
1. **Fixtures.** `products-clean.csv`:
```
Name,Price,Cost,Category,Unit,SKU,Kind,Taxable
Service Call,95,0,Labor,each,SVC-1,service,yes
Asphalt Shingle Bundle,38.50,"$22,000",Materials,bundle,SHG-1,good,true
```
`products-messy.csv` (blank name, bad number, unknown category):
```
Name,Price,Category
,50,Labor
Tear-Off,abc,Labor
Cleanup,40,Nonexistent
```
2. **Failing test** (uses real fixtures + `parseCsv` + a vocab fixture):
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";
import { suggestProductsMapping } from "@/lib/catalog-setup/column-mapping";
import { mapProductsCsv } from "@/lib/catalog-setup/products-csv-mapper";

const cats = [{ id: "c-labor", name: "Labor" }, { id: "c-mat", name: "Materials" }];
const units = [{ id: "u-each", display: "each" }, { id: "u-bundle", display: "bundle" }];

function load(name: string) {
  const csv = readFileSync(new URL(`../../fixtures/catalog-setup/${name}`, import.meta.url), "utf8");
  const parsed = parseCsv(csv);
  return { parsed, mapping: suggestProductsMapping(parsed.headers) };
}

describe("mapProductsCsv — clean", () => {
  it("produces SellCards with resolved FK ids + permissive numbers", () => {
    const { parsed, mapping } = load("products-clean.csv");
    const r = mapProductsCsv({ rows: parsed.rows, lineNumbers: parsed.lineNumbers, mapping, categories: cats, units });
    expect(r.errors).toEqual([]);
    expect(r.cards).toHaveLength(2);
    const shingle = r.cards[1];
    expect(shingle.module).toBe("SELL");
    expect(shingle.name).toBe("Asphalt Shingle Bundle");
    expect(shingle.basePrice).toBe(38.5);
    expect(shingle.unitCost).toBe(22000); // "$22,000" stripped
    expect(shingle.categoryId).toBe("c-mat");
    expect(shingle.unitId).toBe("u-bundle");
    expect(shingle.kind).toBe("good");
    expect(shingle.isTaxable).toBe(true);
    expect(shingle.source).toBe("csv");
    expect(shingle.sourceLine).toBe(3);
  });
});
describe("mapProductsCsv — messy", () => {
  it("surfaces blank name, bad number, unknown category as MapErrors and yields no cards", () => {
    const { parsed, mapping } = load("products-messy.csv");
    const r = mapProductsCsv({ rows: parsed.rows, lineNumbers: parsed.lineNumbers, mapping, categories: cats, units });
    expect(r.cards).toEqual([]); // payload-or-nil contract
    const fields = r.errors.map((e) => e.field).sort();
    expect(fields).toContain("name");
    expect(fields).toContain("base_price");
    expect(fields).toContain("category");
  });
});
```
3. **Run, fail.** 4. **Impl** `mapProductsCsv({ rows, lineNumbers, mapping, categories, units, source = "csv" })` faithfully porting the Swift loop: build `categoryByName`/`unitByDisplay` lowercase-trim maps; per row resolve name (blank→error+skip), basePrice required (parse; blank→required error), optional unitCost/description/pricingUnit/sku, category/unit FK resolution (unmatched→error), kind/type/isTaxable enum validation. Stamp `clientId` (e.g. `crypto.randomUUID()`), `source`, `sourceLine`. Return `{ cards: errors.length ? [] : cards, errors }`. (Errors empty also requires `rows.length>0` → file-level `rows` error when empty.) 5. **Run, pass.** 6. Commit (two atomic): (a) `test(catalog-setup): product import fixtures`; (b) `feat(catalog-setup): products CSV mapper (ports iOS ProductsCSVMapper)`.

---

### Task 2.7: `stock-csv-mapper.ts` — family-grouped stock → StockCard[] (TDD)

Ports `CatalogCSVMapper.map`: family_name + quantity required; **family grouping by case-insensitive trimmed family_name** (first occurrence carries family-level fields, later rows add variants); category/defaultUnit/variantUnit text → FK id (unmatched=error); permissive numbers; one CSV row = one variant. Output: `StockCard[]` (one per family, with nested `variants[]`) + `MapError[]`, same payload-or-nil contract.

**Skills:** none (pure logic, TDD).
**Files:**
- Create `tests/fixtures/catalog-setup/stock-families.csv`
- Create `tests/unit/catalog-setup/stock-csv-mapper.test.ts`
- Create `src/lib/catalog-setup/stock-csv-mapper.ts`

Steps:
1. **Fixture** `stock-families.csv` (two families, the first with two variants — proves grouping + first-row-wins family fields):
```
Family Name,SKU,Quantity,Unit,Category,Unit Cost
Copper Pipe,CP-12,40,ft,Pipe,3.50
Copper Pipe,CP-34,25,ft,Pipe,5.00
PVC Elbow,PVC-E,100,each,Fittings,0.40
```
2. **Failing test:**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";
import { suggestStockMapping } from "@/lib/catalog-setup/column-mapping";
import { mapStockCsv } from "@/lib/catalog-setup/stock-csv-mapper";

const cats = [{ id: "c-pipe", name: "Pipe" }, { id: "c-fit", name: "Fittings" }];
const units = [{ id: "u-ft", display: "ft" }, { id: "u-each", display: "each" }];

describe("mapStockCsv — family grouping", () => {
  it("groups variants under one family (first row wins family fields)", () => {
    const csv = readFileSync(new URL("../../fixtures/catalog-setup/stock-families.csv", import.meta.url), "utf8");
    const p = parseCsv(csv);
    const r = mapStockCsv({ rows: p.rows, lineNumbers: p.lineNumbers, mapping: suggestStockMapping(p.headers), categories: cats, units });
    expect(r.errors).toEqual([]);
    expect(r.cards).toHaveLength(2); // 2 families
    const copper = r.cards[0];
    expect(copper.module).toBe("STOCK");
    expect(copper.familyName).toBe("Copper Pipe");
    expect(copper.categoryId).toBe("c-pipe");
    expect(copper.variants).toHaveLength(2);
    expect(copper.variants.map((v) => v.sku)).toEqual(["CP-12", "CP-34"]);
    expect(copper.variants[0].quantity).toBe(40);
    expect(copper.variants[1].unitCostOverride).toBe(5);
  });
  it("is case-insensitive on family name", () => {
    const p = parseCsv("Family Name,Quantity\nWidget,1\nwidget,2");
    const r = mapStockCsv({ rows: p.rows, lineNumbers: p.lineNumbers, mapping: suggestStockMapping(p.headers), categories: cats, units });
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].variants).toHaveLength(2);
  });
  it("errors on blank family name and unknown unit", () => {
    const p = parseCsv("Family Name,Quantity,Unit\n,5,ft\nBolt,3,furlong");
    const r = mapStockCsv({ rows: p.rows, lineNumbers: p.lineNumbers, mapping: suggestStockMapping(p.headers), categories: cats, units });
    expect(r.cards).toEqual([]);
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["family_name", "variant_unit"]));
  });
});
```
3. **Run, fail.** 4. **Impl** `mapStockCsv(...)` faithfully porting the Swift loop: maintain `familyIndexByKey` keyed on `familyName.toLowerCase()`; first occurrence builds the `StockCard` (description/categoryId/defaultUnitId/defaultPrice/defaultUnitCost from that row, with FK resolution + errors); every row appends a `StockVariantDraft` (sku/quantity/priceOverride/unitCostOverride/warning/critical/variantUnit FK). Stamp `clientId`/`source`/`sourceLine` per family and per variant. Empty rows → file-level `rows` error. Return `{ cards: errors.length ? [] : cards, errors }`. 5. **Run, pass.** 6. Commit (two atomic): (a) `test(catalog-setup): stock family fixture`; (b) `feat(catalog-setup): stock CSV mapper with family grouping (ports iOS CatalogCSVMapper)`.

---

### Task 2.8: `upload-router.ts` — clean→deterministic / messy→agent (TDD)

Pure decision: a parseable CSV/XLSX whose headers alias-map the required columns (name+price OR family_name+quantity) → `deterministic`; everything else (PDF/image/unparseable/no mappable required columns) → `agent`. Phase 4 owns the agent side; this only routes.

**Skills:** none (pure logic, TDD).
**Files:**
- Create `tests/unit/catalog-setup/upload-router.test.ts`
- Create `src/lib/catalog-setup/upload-router.ts`

Steps:
1. **Failing test:**
```ts
import { describe, it, expect } from "vitest";
import { routeUpload } from "@/lib/catalog-setup/upload-router";

describe("routeUpload", () => {
  it("routes a clean products spreadsheet to deterministic", () => {
    expect(routeUpload({ filename: "items.csv", mime: "text/csv", headers: ["Name", "Price"] }).lane).toBe("deterministic");
  });
  it("routes a clean stock spreadsheet to deterministic", () => {
    expect(routeUpload({ filename: "stock.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: ["Family Name", "Quantity"] }).lane).toBe("deterministic");
  });
  it("routes a PDF to the agent", () => {
    expect(routeUpload({ filename: "pricelist.pdf", mime: "application/pdf", headers: null }).lane).toBe("agent");
  });
  it("routes an image to the agent", () => {
    expect(routeUpload({ filename: "parts.jpg", mime: "image/jpeg", headers: null }).lane).toBe("agent");
  });
  it("routes a spreadsheet with no mappable required columns to the agent", () => {
    expect(routeUpload({ filename: "weird.csv", mime: "text/csv", headers: ["Foo", "Bar"] }).lane).toBe("agent");
    // and explains why
    expect(routeUpload({ filename: "weird.csv", mime: "text/csv", headers: ["Foo", "Bar"] }).reason).toBe("no_required_columns");
  });
});
```
2. **Run, fail.** 3. **Impl** `routeUpload({ filename, mime, headers })`: derive extension; if not csv/xlsx/xls (by mime or extension) → `{ lane: "agent", reason: "unsupported_for_deterministic" }`; if `headers` null/empty → `{ lane: "agent", reason: "unparseable" }`; reuse `suggestProductsMapping`/`suggestStockMapping` — if either `isReadyToMap` → `{ lane: "deterministic", kind: products?|stock? }`; else `{ lane: "agent", reason: "no_required_columns" }`. 4. **Run, pass.** 5. Commit: `feat(catalog-setup): upload auto-router (clean→mapper, messy→agent)`.

---

### Task 2.9: `trade-list.ts` + `trade-templates.ts` — per-trade starter cards (TDD)

`trade-list.ts` is the single source for the picker AND the (Phase-1-owned) `projects.trade` CHECK widening. `trade-templates.ts` mirrors the `industry-presets.ts` shape (keyed by trade) but produces editable **starter StagingCards** — a small set of TYPES cards (task types, in dependency order, colors via `autoAssignColors`/`curated-colors`) plus a couple of seed SELL cards per trade. The floor for offline/declined/failure.

**Skills:** `ops-copywriter` (the human-facing trade labels + the seed product names must be OPS-voice and trade-accurate — invoke before finalizing the strings); no other UI skills (data module).
**Files:**
- Create `src/lib/catalog-setup/trade-list.ts`
- Create `src/lib/catalog-setup/trade-templates.ts`
- Create `tests/unit/catalog-setup/trade-templates.test.ts`

Steps:
1. **`trade-list.ts`** — export `WIZARD_TRADES` as the §9 locked list. **CONFIRM enum string values with Jackson before the CHECK migration** (iOS-shared, unrenameable). Shape: `{ id: "roofing" | "hvac" | ...; label: string; presetKey: keyof typeof INDUSTRY_PRESETS | null }`. Map each wizard trade to its closest `industry-presets` key (e.g. `flooring`→"Flooring", `windows-doors`→"Windows", `cleaning`→"House Cleaning", `general`→"General Contracting") and `null` only if no preset exists. Include the existing enum values (`roofing`/`hvac`/`plumbing`) first so the CHECK widening is purely additive.
2. **Failing test** `trade-templates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { WIZARD_TRADES } from "@/lib/catalog-setup/trade-list";
import { selectTradeTemplate } from "@/lib/catalog-setup/trade-templates";

describe("selectTradeTemplate", () => {
  it("returns editable TYPES + SELL starter cards for roofing", () => {
    const cards = selectTradeTemplate("roofing");
    const types = cards.filter((c) => c.module === "TYPES");
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((c) => c.source === "template")).toBe(true);
    expect(types.every((c) => typeof c.colorHex === "string")).toBe(true); // autoAssignColors
    expect(cards.some((c) => c.module === "SELL")).toBe(true);
  });
  it("every wizard trade resolves to a non-empty template (no dead picker option)", () => {
    for (const t of WIZARD_TRADES) {
      expect(selectTradeTemplate(t.id).length).toBeGreaterThan(0);
    }
  });
  it("stamps unique clientIds", () => {
    const ids = selectTradeTemplate("roofing").map((c) => c.clientId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```
3. **Run, fail.** 4. **Impl** `trade-templates.ts`: `selectTradeTemplate(tradeId)` → look up the trade's `presetKey`, pull `INDUSTRY_PRESETS[presetKey].taskTypes`, run `autoAssignColors` to assign `colorHex`, map each to a `TypesCard` (name/tags/estimatedHours min+max/colorHex, source `"template"`, fresh `clientId`); add a minimal `SELL` seed set per trade (a small hardcoded `TRADE_SEED_PRODUCTS: Record<tradeId, {name; kind; type}[]>` — e.g. roofing: "Roof inspection" (service/LABOR), "Asphalt shingle install" (service/LABOR)). For a trade whose `presetKey` is null, fall back to the General Contracting preset's task types so **no picker option is ever empty**. Invoke `ops-copywriter` to finalize the seed product names + the human trade labels. 5. **Run, pass.** 6. Commit: `feat(catalog-setup): per-trade template seeds + wizard trade list`.

---

### Task 2.10: `source-picker.tsx` — "How do you want to start?" (UI)

The opening lane selector. Six sources (§8): Connect QuickBooks (stub→Phase 3), Upload a spreadsheet, Upload a doc/photo (stub→Phase 4 agent), Describe it to the agent (stub→Phase 4), Start from a template, Add manually. Renders in the Phase-1 left "driver" pane; selecting a lane mounts the corresponding sub-source. QB option shows a compact detected-provider affordance when an `accounting_connection` exists (read-only check passed in as a prop — no side-by-side QB/Sage cards, per the canonical design-judgment rule).

**Skills:** `interface-design`, `frontend-design`, `ops-copywriter` (every label/sub-line), `audit-design-system` (done-gate).
**Design tokens:** lane rows as `.glass` cards, radius `panel:10`, hairline `rgba(255,255,255,0.09)`; lane title `font-cakemono font-light` UPPERCASE, sub-line `font-mohave text-text-2`; lucide icons `Plug`/`FileSpreadsheet`/`MessageSquare`/`LayoutTemplate`/`PlusCircle` at 20px `currentColor`; **no accent** on lanes (accent reserved for the canvas's BUILD IT CTA); hover `bg-surface-hover`; focus ring accent `#6F94B0`; one easing curve; `prefers-reduced-motion` honored.

Steps:
1. **Wireframe + copy first.** Invoke `interface-design`/`frontend-design` + `ops-copywriter`; produce the 6 lane labels + sub-lines (seed from spec §14: `How do you want to start?`; lanes voiced terse/tactical, sentence-case content + UPPERCASE authority). Add to `src/i18n/dictionaries/{en,es}/catalog-setup.json`.
2. **Failing render test** `tests/unit/catalog-setup/source-picker.test.tsx` (Testing Library): renders 6 lanes; clicking "Upload a spreadsheet" calls `onSelectLane("upload")`; the QB lane shows the "connected" badge only when `qbConnected` prop is true. Run → fail.
3. **Impl** `source-picker.tsx` as a controlled list (`onSelectLane(lane: SourceLane)`), each lane a button-row `.glass` card. QB + agent + doc lanes are present but dispatch lanes Phases 3/4 own (the picker just emits the lane id). Pass `qbConnected: boolean` through for the detected-provider badge; no provider-choice UI.
4. **Run, pass.** Then **`audit-design-system`** over the file → expected: zero hardcoded color/radius/font violations (all token-traced).
5. Commit: `feat(catalog-setup): source picker (six lanes, QB detected-provider badge)`.

---

### Task 2.11: `upload-source.tsx` + `column-map-step.tsx` — upload → route → map → stage (UI)

Drag/drop or browse → read file → parse (csv/xlsx) → `routeUpload`: deterministic shows the `column-map-step` (confirm/override the auto-mapping, then run the mapper and push cards to the canvas); agent hands the raw file to the Phase-4 callback. Mapper errors render inline (uniform `MapError` list); only error-free results stage.

**Skills:** `interface-design`, `frontend-design`, `ops-copywriter`, `animation-architect`/`elite-animations` (the stage-in count-up handoff), `audit-design-system`.
**Design tokens:** dropzone `.glass` dashed hairline `rgba(255,255,255,0.09)`, radius `panel:10`; column-map selects 36px height radius `btn:5`, `font-mohave`; error rows rose border `#B58289`; the "stage N cards" affordance is NOT the accent primary (the canvas BUILD IT is) — use `variant="secondary"`; counts `font-mono`; one easing curve; `prefers-reduced-motion`.

Steps:
1. **Wireframe + copy.** Invoke the UI + copy skills. Strings: dropzone prompt, "we read N rows", per-error `// N ROWS NEED A PRICE` (spec §14), the deterministic-vs-agent handoff line. Add to dictionary.
2. **Failing test** `tests/unit/catalog-setup/upload-source.test.tsx`: feeding a `File` built from `products-clean.csv` content → renders the column-map step with `Name`/`Price` pre-mapped; clicking "stage" calls the Phase-1 `addCards` (mocked) with 2 SELL cards. Feeding a `pricelist.pdf` → calls the agent-handoff callback (mocked), not the mapper. Run → fail.
3. **Impl** `upload-source.tsx`: `<input type=file>` + drop handler → `file.text()` for csv / `file.arrayBuffer()` for xlsx → `parseCsv`/`parseXlsx` → `routeUpload`. Deterministic → render `column-map-step` (props: parsed sheet + suggested mapping + vocab arrays). On confirm, run `mapProductsCsv`/`mapStockCsv` (chosen by the router's `kind`), render `errors` inline, and on zero-error push `cards` via the Phase-1 store action (`addCards`) — **the single hand-off point**. Agent route → call `onAgentHandoff(file)` (Phase-4 boundary; here a prop). `column-map-step.tsx`: per-logical-column `<select>` over headers, defaulting to the suggested mapping; "stage" disabled until `isReadyToMap`.
4. **Run, pass.** Then `audit-design-system` over both files → zero violations.
5. Commit (two atomic): (a) `feat(catalog-setup): column-map step`; (b) `feat(catalog-setup): upload source (parse, auto-route, stage)`.

---

### Task 2.12: `manual-source.tsx` — wizard-local manual entry → cards (UI)

Reuses the **patterns** of P3-2 `ProductQuickAdd` / `AddStockDialog` / `InlineCreate{Category,Unit}Dialog`, but — critically — produces **StagingCards** (it does NOT call `useCreateProduct`/`useCreateFamily`; nothing is written until the Phase-1 commit). A product mini-form and a stock mini-form; inline category/unit create still hits the existing `catalog-category-service`/`catalog-unit-service` (vocabulary is created up front so cards resolve at commit — spec §11 vocabulary prerequisite).

**Skills:** `interface-design`, `frontend-design`, `ops-copywriter`, `audit-design-system`.
**Design tokens:** mirror `ProductQuickAdd` exactly — `labelCls = font-mono text-[11px] uppercase tracking-[0.14em] text-text-3`; inputs radius `btn:5` 36px; kind toggle radius `chip:4`/`sidebar:6` like the reference; "add to canvas" is `variant="secondary"` (not accent); `font-cakemono font-light` title.

Steps:
1. **Copy.** Invoke `ops-copywriter`: form labels reuse the P3-2 keys where identical; add manual-source-specific strings (`Add to canvas`, the product/stock toggle).
2. **Failing test** `tests/unit/catalog-setup/manual-source.test.tsx`: filling name+price and clicking "add to canvas" calls `addCards` (mocked) with one SELL card carrying `source:"manual"`; the stock sub-form produces a STOCK card with one variant. Run → fail.
3. **Impl** `manual-source.tsx`: a product/stock segmented control; the product form (name/price/unit/kind + optional cost/sku/category) builds a `SellCard`; the stock form (family name/qty/unit/sku/cost/category) builds a `StockCard` with a single variant. Category/unit pickers reuse the inline-create services to ensure the vocabulary exists (so the card's `categoryId`/`unitId` resolve at commit). "Add to canvas" emits via `addCards` and resets the form for rapid entry. No DB write of products/variants here.
4. **Run, pass.** `audit-design-system` → zero violations.
5. Commit: `feat(catalog-setup): manual entry source (cards, reuses catalog vocab services)`.

---

### Task 2.13: `template-source.tsx` — trade picker → editable starter cards (UI)

Trade picker over `WIZARD_TRADES`; selecting a trade runs `selectTradeTemplate(tradeId)` and pushes the editable starter cards to the canvas (the owner trims on the canvas — no separate edit grid here). The offline/declined floor.

**Skills:** `interface-design`, `frontend-design`, `ops-copywriter`, `audit-design-system`.
**Design tokens:** trade grid as `.glass` chips radius `chip:4`; selected state olive border `#9DB582` (positive), not accent; trade label `font-cakemono font-light` UPPERCASE; "use this starter" `variant="secondary"`; one easing curve.

Steps:
1. **Copy.** `ops-copywriter`: the picker prompt + the "this is a starting point you can trim" reassurance (offline/floor framing, never "AI").
2. **Failing test** `tests/unit/catalog-setup/template-source.test.tsx`: selecting "roofing" + confirm calls `addCards` (mocked) with the roofing starter set (TYPES + SELL, all `source:"template"`). Run → fail.
3. **Impl** `template-source.tsx`: grid of `WIZARD_TRADES`; on confirm, `addCards(selectTradeTemplate(selected))`. Selection is single (either/or — collapses to one entry point per the design-judgment rule). Show a count preview (`N task types · M services`, `font-mono`).
4. **Run, pass.** `audit-design-system` → zero violations.
5. Commit: `feat(catalog-setup): template source (trade picker → starter cards)`.

---

### Task 2.14: Full-suite green + lint gate + phase wrap

**Skills:** `audit-design-system` (final sweep across all Phase-2 UI files).
**Files:** none new (verification + any fixups).

Steps:
1. Run the full Phase-2 unit suite: `npx vitest run tests/unit/catalog-setup` → expected: all suites pass (parse-number, csv-parse, xlsx-parse, column-mapping, products-csv-mapper, stock-csv-mapper, upload-router, trade-templates, source-picker, upload-source, manual-source, template-source).
2. Typecheck: `npx tsc --noEmit` → expected: no new errors in `src/lib/catalog-setup` or `src/components/catalog-setup`. (Note: repo-wide `next lint` may be pre-existing red on main — do NOT claim "CI passed"; verify only that Phase-2 files introduce no new lint errors via `npx next lint --file src/lib/catalog-setup --file src/components/catalog-setup` if supported, else eslint on the globs.)
3. Final `audit-design-system` sweep across all `src/components/catalog-setup/**` → expected: zero hardcoded color/radius/font/spacing values; every value token-traced; accent appears on zero Phase-2 surfaces (it belongs to the canvas BUILD IT, Phase 1).
4. **Execution-time reconciliation checklist** (flag, do not silently resolve): (a) swap the `staging-card.ts` placeholder type-only imports for Phase-1's real `StagingCard` and re-run the mapper suites unchanged; (b) confirm the Phase-1 `addCards` action name/signature and update the 4 source components; (c) confirm the `catalog-setup` i18n namespace name; (d) confirm `WIZARD_TRADES` enum string values with Jackson before the (Phase-1-owned) `projects.trade` CHECK migration; (e) confirm the upload-router clean/messy heuristic with the Phase-4 agent-lane owner.
5. Commit: `test(catalog-setup): phase-2 deterministic-sources suite green`.
