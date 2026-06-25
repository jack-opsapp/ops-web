## Phase 5: QuickBooks Import — reconcile the read-only pull engine, map QB Items to the catalog, connect-detect entry, plaintext-token gate

**Goal.** Stand up the wizard's structured-pull source: reconcile the existing GET-only QB engine onto the wizard base, add a pure QB `Item`→catalog mapper, a read-only pull-items step that produces Phase-1 staging cards (cross-referencing Phase-3 dedupe), one connect-detect entry (not side-by-side provider cards), and the plaintext-token remediation gate. Read-only is sacrosanct: every QB call is a GET; the push `sync-orchestrator.ts` is never imported. The accepted set commits through the existing `catalog_setup_save` RPC (Phases 1/3), never the create-only `catalog_import_apply`.

**Skills.** `interface-design` + `frontend-design` + `ui-ux-pro-max` (connect-detect entry, live badge, switch/disconnect modal); `ops-copywriter` (every user-facing string — connect prompt, badge, dup-match, track-inventory prompt, errors); `audit-design-system` (done-gate on every UI task); `elite-animations` / `animation-architect` + `web-animations` (badge state, card-arrival on import — one curve, reduced-motion); `vercel:ai-sdk` is NOT used in this phase (Setup Agent re-clustering is Phase 4). Pure-logic tasks (mapper, pull adapter, connect-detect resolver) need no UI skill but MUST be TDD-first.

**Design tokens (UI tasks only — never hardcode; trace to `.interface-design/system.md` + `ops-design-system/project/DESIGN.md`).** Surfaces: `.glass-surface` (rgba(18,18,20,0.58), blur 28px, radius 10px) for the canvas/source panel; `.glass-dense` (0.78 alpha, radius 12px) for the switch/disconnect modal + toasts. Accent `#6F94B0` ONLY on the single primary CTA (`PULL ITEMS` / `BUILD IT`) and focus rings — never on the badge, the connect entry, toggles, or tags. Live badge uses `olive #9DB582` (connected/positive) border-only; attention/dup state `tan #C4A868`; cost figures `rose #B58289`. Text ladder `#EDEDED`/`#B5B5B5`/`#8A8A8A`/`#6A6A6A`. Titles/badges/buttons Cake Mono Light UPPERCASE; body Mohave sentence-case; all numbers/prices JetBrains Mono tabular-lining slashed-zero. Controls min-h 36px / radius 5 (`btn`); chips radius 4; NO touch targets. Icons `lucide-react` only. Empty/zero = `—` or `$0`, never "N/A". Motion: single curve `cubic-bezier(0.22,1,0.36,1)`, no spring/bounce, honor `prefers-reduced-motion`.

**TDD cadence (every task).** Write a failing test → run it, paste the red output → minimal impl → run it, paste green → commit (conventional `feat(catalog-wizard)…` / `refactor…`, no AI attribution, stage by name). Test command base: `npm run test -- <path>` (vitest; `vitest.config.ts` present). Keep each step 2–5 min.

---

### Task 5.0: Additive QB-import schema (external identity + completion-flag confirm)

Land the re-import identity columns this phase's dedupe persistence depends on. Verified 2026-06-13: `products.external_source`/`external_id` and `catalog_items.external_source`/`external_id` are ABSENT on prod. Additive-only (nullable columns) → iOS-safe.

**Skills:** none (migration + types). Confirm with `supabase` skill conventions.
**Files:**
- Create: `supabase/migrations/20260613090000_catalog_external_identity.sql`
- Modify: `src/lib/types/models.ts` (add optional `externalSource?: string | null; externalId?: string | null` to the Product + CatalogItem types where they live — grep first)
**Design tokens:** n/a.

1. Write the migration (idempotent, nullable, indexed for dedupe lookup):
```sql
-- 20260613090000_catalog_external_identity.sql
-- Re-import identity for the Catalog Setup Wizard QB/CSV import (additive, iOS-safe).
alter table public.products
  add column if not exists external_source text,
  add column if not exists external_id text;
alter table public.catalog_items
  add column if not exists external_source text,
  add column if not exists external_id text;
-- Re-import re-sync lookup (company-scoped). Partial: only rows that carry an external id.
create index if not exists products_external_id_idx
  on public.products (company_id, external_source, external_id)
  where external_id is not null;
create index if not exists catalog_items_external_id_idx
  on public.catalog_items (company_id, external_source, external_id)
  where external_id is not null;
```
2. Apply to a sentinel first: run `mcp__plugin_supabase_supabase__execute_sql` with the `alter…add column if not exists` block, then re-query `information_schema.columns` for the four columns and confirm they now exist. Expected: 4 rows. (Direct prod migrations authorized per memory `project_ops_prod_low_tenant_direct_migrations`; recon read-only first, then explicit go-ahead — flag at execution.)
3. Add a unit test asserting the Product type carries the optional fields (compile-level guard): `src/lib/types/__tests__/product-external-identity.test.ts` — a `const p: Product = {…, externalSource: 'quickbooks', externalId: '42'}` that fails to typecheck if the fields are absent. Run `npm run test -- src/lib/types/__tests__/product-external-identity.test.ts`. Red first (fields missing), then add fields, green.
4. Commit: `feat(catalog-wizard): add external_source/external_id for QB re-import identity`.

**Acceptance:** four nullable columns + two partial indexes live on prod; Product/CatalogItem types carry the optional fields; no rename/retype anywhere (iOS-safe).

---

### Task 5.1: Reconcile the read-only QB pull engine onto the wizard base

The ONLY existing GET-only QBO Item fetch + staging/normalize/match plumbing lives on `feat/quickbooks-readonly-sync` (worktree `/Users/jacksonsweet/Projects/OPS/ops-web-qb-readonly-sync`, ~272 behind main). This is a **merge/reconcile** task, not a rewrite. Files to carry over (read them first; they are correct and tested): `src/lib/api/services/quickbooks-pull-service.ts` (GET-only client, `pullItems()`, `qbWriteCalls` invariant), `quickbooks-import-service.ts` (`startImportRun`/`pullAndStage` — but its `pullAndStage` currently also stages customers/invoices/estimates/payments; the wizard needs an **items-only** path, added in 5.5), `qbo-normalize.ts` (`buildItemTypeMap`, `flattenSalesLines`, field accessors — reuse `str`/`num`/`cents`), `quickbooks-config.ts` (`getQuickBooksEnvironment`), `src/lib/types/qbo-import.ts` (`QboRawRecord`, `QboPullResult`), the QB OAuth routes under `src/app/api/integrations/quickbooks/`, the staging migrations (`20260602000000_qbo_readonly_sync_a0_schema.sql`, `20260602100000_qbo_match_customer_candidates_rpc.sql`, `20260602200000_qbo_qb_id_unique_indexes.sql`).

**Skills:** `code-review` (verify nothing from the push `sync-orchestrator.ts` rides along); `supabase` (staging migrations).
**Files (reconcile/merge — exact paths in the TARGET wizard worktree):**
- Carry: `src/lib/api/services/quickbooks-pull-service.ts`, `quickbooks-import-service.ts`, `qbo-normalize.ts`, `qbo-match.ts`, `qbo-reconcile.ts`, `quickbooks-config.ts`, `accounting-token-service.ts` (NOTE: superseded by 5.2's encrypted version — reconcile 5.2 on top), `src/lib/types/qbo-import.ts`, `src/lib/hooks/use-qbo-import.ts`, `src/app/api/integrations/quickbooks/{route.ts,callback/route.ts,import/route.ts,import/apply/route.ts}`
- Carry: `supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql` (+ the two siblings)
- Carry tests: `src/lib/api/services/__tests__/{qbo-match,qbo-normalize,qbo-reconcile,quickbooks-import-service}.test.ts`
- Do NOT carry: anything importing or exercising `sync-orchestrator.ts` (push) — explicitly excluded.
**Design tokens:** n/a (engine only).

1. Acceptance-criteria checklist (write as `docs/RECONCILE-QB-READONLY.md` in the worktree, then execute it):
   - [ ] `quickbooks-pull-service.ts` present with `pullItems(): Promise<QboRawRecord[]>` issuing `SELECT * FROM Item` via GET only; `qbWriteCalls` getter exists and is asserted 0 by its tests.
   - [ ] `grep -rn "sync-orchestrator" src/` returns ZERO hits in carried files (the push engine must not be reachable from any wizard code path).
   - [ ] `grep -rn "syncDirection.*bidirectional\|propagateDeletes\|pushTo\|writeTo.*QuickBooks" src/lib/api/services/quickbooks-*` returns ZERO hits in the pull/import path.
   - [ ] QB staging tables (`qbo_import_runs`, `qbo_staging_*`, `qbo_customer_matches`) exist on prod OR the migrations are queued (`mcp__plugin_supabase_supabase__list_migrations` shows them, or apply per the prod-migration authorization).
   - [ ] Carried unit tests pass green: `npm run test -- src/lib/api/services/__tests__/`.
2. Reconcile mechanically: bring the carried files in, resolve import-path drift against the wizard base (the ~272-commit gap will move shared utilities — `getServiceRoleClient`, `verifyAdminAuth`, `findUserByAuth`, `checkPermissionById`, `queryKeys`). For each unresolved import, grep the wizard base for the moved symbol and fix the path; do NOT stub.
3. Run the carried tests; paste red (path failures expected first), fix imports, paste green.
4. Read-only assertion test (carry or add): `src/lib/api/services/__tests__/quickbooks-pull-service.test.ts` must include a case that injects a `fetchImpl` spy, calls `pullItems()`, and asserts every recorded request used `method: 'GET'` and `qbWriteCalls === 0`. Run it. Green required.
5. Commit in logical batches: `refactor(catalog-wizard): reconcile read-only QB pull engine from feat/quickbooks-readonly-sync` (engine), then `test(catalog-wizard): carry QB read-only engine tests`.

**Acceptance:** the GET-only engine + staging schema live on the wizard base; the checklist passes; zero push-path reachability; carried tests green. Flag at execution: the exact merge strategy (cherry-pick the engine commits vs. a scoped manual port) and whether the QB staging migrations are already on prod (read-only verify with `list_migrations` before applying).

---

### Task 5.2: Land the plaintext-token remediation (BLOCKING pre-ship gate)

`accounting_connections` tokens are stored plaintext (open bug `7600a1a2-566b-4d11-82a9-db72e966ee85`). `feat/qb-token-encryption` (worktree `/Users/jacksonsweet/Projects/OPS/ops-web-qb-token-enc`) already implements the fix: `src/lib/api/services/token-cipher.ts` (AES-256-GCM, `enc:v1:` envelope, fail-closed `getKey()` from `QB_TOKEN_ENC_KEY`, decrypt-tolerant of legacy plaintext, `realmIdLookup()` SHA-256 routing hash) and a rewritten `accounting-token-service.ts` that encrypts on persist + decrypts on read. This is the **hard gate**: QB import MUST NOT be enabled beyond Canpro until this lands. Reconcile it ON TOP OF 5.1's carried `accounting-token-service.ts`.

**Skills:** `code-review`; `supabase` (realm_id_lookup column migration); `security-review` (verify no token reaches a client bundle / log).
**Files:**
- Create (carry): `src/lib/api/services/token-cipher.ts`
- Modify (carry, supersedes 5.1's): `src/lib/api/services/accounting-token-service.ts`
- Create: `supabase/migrations/20260613091000_accounting_realm_id_lookup.sql` (the `realm_id_lookup` column + index, if not already in the token-enc branch — verify first)
- Create (carry): `src/lib/api/services/__tests__/token-cipher.test.ts`
- Modify: `.env.example` (document `QB_TOKEN_ENC_KEY`)
**Design tokens:** n/a.

1. Failing test first — round-trip + tamper + legacy-passthrough + fail-closed. `src/lib/api/services/__tests__/token-cipher.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { encryptToken, decryptToken, isEncrypted, encryptNullable, realmIdLookup } from "../token-cipher";
const KEY = Buffer.from("0".repeat(32)).toString("base64"); // 32 bytes
describe("token-cipher", () => {
  beforeEach(() => { process.env.QB_TOKEN_ENC_KEY = KEY; });
  it("round-trips a secret", () => {
    const ct = encryptToken("refresh-abc");
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain("refresh-abc");
    expect(decryptToken(ct)).toBe("refresh-abc");
  });
  it("passes legacy plaintext through unchanged on read", () => {
    expect(decryptToken("legacy-plain")).toBe("legacy-plain");
  });
  it("throws on a tampered envelope", () => {
    const ct = encryptToken("x"); const parts = ct.split(":");
    parts[4] = Buffer.from("tampered").toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });
  it("fail-closed when the key is missing", () => {
    delete process.env.QB_TOKEN_ENC_KEY;
    expect(() => encryptToken("x")).toThrow(/QB_TOKEN_ENC_KEY/);
  });
  it("encryptNullable returns null for empty", () => {
    expect(encryptNullable("")).toBeNull(); expect(encryptNullable(null)).toBeNull();
  });
  it("realmIdLookup is deterministic", () => {
    expect(realmIdLookup("9130")).toBe(realmIdLookup("9130"));
    expect(realmIdLookup("9130")).not.toBe(realmIdLookup("9131"));
  });
});
```
2. Run `npm run test -- src/lib/api/services/__tests__/token-cipher.test.ts`. Red (module absent). Carry `token-cipher.ts`. Green.
3. Carry the encrypted `accounting-token-service.ts` over 5.1's version; run the QB import-service tests (`npm run test -- src/lib/api/services/__tests__/quickbooks-import-service.test.ts`) — they must still pass because `decryptToken` is plaintext-tolerant. Paste green.
4. Verify the gate at the edge: add a guard test that the import route refuses to enable QB import for a non-Canpro company when `QB_TOKEN_ENC_KEY` is unset OR the company is not allowlisted — see Task 5.8 for the allowlist; this step records the dependency (the route-level test lands in 5.8).
5. Provision-confirm: `QB_TOKEN_ENC_KEY` (32-byte base64) must be set in Vercel before enabling beyond Canpro — note in `.env.example`. Flag at execution.
6. Commit: `feat(catalog-wizard): encrypt accounting OAuth tokens at rest (AES-256-GCM, fail-closed)`.

**Acceptance:** `token-cipher.ts` + encrypted token service live; tamper/fail-closed/legacy-passthrough tested green; `realm_id_lookup` migration present; `QB_TOKEN_ENC_KEY` documented + provisioned. The gate is the pre-condition for 5.8 enabling import beyond Canpro. Flag: confirm the token-enc branch's exact migration filename + whether it's already applied (read-only verify).

---

### Task 5.3: Pure QB `Item` → catalog mapper (NET-NEW, heavy TDD)

The single load-bearing new logic: a side-effect-free mapper from a raw QB `Item` record to catalog draft rows. No DB, no network — pure, fixture-driven. Maps per the spec table to the VERIFIED prod CHECK enums (`kind ∈ {service,material,package}`, `type ∈ {LABOR,MATERIAL,OTHER}`, `pricing_unit ∈ {each,flat_rate,linear_foot,sqft,hour,day}`). Reuse `str`/`num`/`cents` from the carried `qbo-normalize.ts` — do NOT re-implement number parsing.

**Skills:** none (pure logic) — TDD mandatory.
**Files:**
- Create: `src/lib/catalog-wizard/import/qb-item-mapper.ts`
- Create: `src/lib/catalog-wizard/import/__tests__/qb-item-mapper.test.ts`
- Create: `src/lib/catalog-wizard/import/__fixtures__/qb-items.ts` (real QBO `Item` JSON shapes: Service, NonInventory, Inventory, Group, Category-type)
**Design tokens:** n/a.

Mapping contract (from spec §9 + verified schema):
- `Item.Name` → product `name` (required; if absent the row is a blocker).
- `Item.Sku` → `sku` (nullable); `external_source = 'quickbooks'`, `external_id = String(Item.Id)`.
- `Item.Description` → `description`.
- `Item.UnitPrice` → `base_price` AND `default_price` (both numeric, default 0).
- `Item.PurchaseCost` → `unit_cost` (nullable).
- `Item.Taxable` (boolean; default true when absent, matching the column default) → `is_taxable`.
- `Item.Type` → `kind` + `type`:
  - `Service` → `kind:'service'`, `type:'LABOR'`.
  - `NonInventory` → `kind:'material'`, `type:'MATERIAL'`.
  - `Inventory` → `kind:'material'`, `type:'MATERIAL'` (product side); **plus** a catalog_items+variant draft ONLY if `inventoryMode==='tracked'` (gated by a mapper arg).
  - `Group` (bundle) → `kind:'package'`, `type:'OTHER'`, with `bundleItems` derived from `Item.ItemGroupDetail.ItemGroupLine[]` → `product_bundle_items` drafts.
  - any other / unknown → `kind:'service'`, `type:'OTHER'` (safe default; flag as `needsReview`).
- `pricing_unit` defaults to `'each'` (QB has no native pricing-unit concept; the owner refines on the card).
- Category-type QB items (`Item.Type === 'Category'`, which are folders not sellable) → return `kind: null` sentinel so the caller drops them (not a card).

1. Failing test — Service item:
```ts
import { describe, it, expect } from "vitest";
import { mapQbItem } from "../qb-item-mapper";
import { serviceItem } from "../__fixtures__/qb-items";
describe("mapQbItem — Service", () => {
  it("maps a Service item to a flat service product", () => {
    const r = mapQbItem(serviceItem, { inventoryMode: "off" });
    expect(r).toMatchObject({
      kind: "service", type: "LABOR",
      name: "Roof inspection", sku: "INSP-01",
      basePrice: 150, defaultPrice: 150, unitCost: null,
      isTaxable: false, pricingUnit: "each",
      externalSource: "quickbooks", externalId: "42",
      catalogItem: null, bundleItems: [],
    });
  });
});
```
   `serviceItem` fixture: `{ Id:"42", Name:"Roof inspection", Sku:"INSP-01", Type:"Service", UnitPrice:150, Taxable:false, Description:null }`. Run `npm run test -- src/lib/catalog-wizard/import/__tests__/qb-item-mapper.test.ts`. Red (module absent).
2. Minimal `mapQbItem` for Service. Green.
3. Add failing test — NonInventory → material/MATERIAL with `PurchaseCost`→`unitCost`. Impl. Green.
4. Add failing test — Inventory with `inventoryMode:'tracked'` returns a `catalogItem` draft (`{ name, onHand: Item.QtyOnHand ?? 0, unitCostOverride: PurchaseCost, priceOverride: UnitPrice, sku }`) AND a product draft with `linkedCatalogItem: true`; with `inventoryMode:'off'` returns `catalogItem: null` and sets `pendingInventoryDecision: true`. Impl. Green.
5. Add failing test — Group → `kind:'package'`, `bundleItems` = `[{ componentExternalId, quantity }]` from `ItemGroupDetail.ItemGroupLine[].{ItemRef.value, Qty}`. Impl. Green.
6. Add failing test — unknown `Type` → `kind:'service'`,`type:'OTHER'`,`needsReview:true`; missing `Name` → `blocker:'missing_name'`; `Type:'Category'` → `kind:null` (dropped). Impl. Green.
7. Add failing test — `Taxable` absent defaults `isTaxable:true` (matches column default); `UnitPrice` absent → `basePrice:0` (matches NOT NULL default 0). Impl. Green.
8. Add `mapQbItems(items, opts)` batch wrapper that drops `kind:null` rows and returns `{ cards, blockers, needsReview }`. Test against a mixed fixture array. Green.
9. Commit: `feat(catalog-wizard): pure QB Item → catalog mapper with TDD fixtures`.

**Acceptance:** every mapping-table row covered by a passing fixture test; output enums are exactly the verified CHECK values; mapper is pure (no Supabase/fetch import — `grep -L "supabase\|fetch" qb-item-mapper.ts` confirms); Inventory drafts only when `tracked`; Group→bundle; Category dropped.

---

### Task 5.4: Map mapper output → `catalog_setup_save` payload shape

The mapper emits draft rows; this adapts a set of accepted draft rows into the exact `catalog_setup_save` payload (verified arrays: `products`, `catalog_options`, `variants`, `stock_units`, `product_materials`, modifiers, mappings, `bundles`, `deleted_ids`, plus `mode`). Pure transform; client-supplied ids so the merge-capable RPC UPSERTs. This is the bridge to the Phase-1 commit — keep it a leaf so it tests without DB.

**Skills:** none (pure). TDD.
**Files:**
- Create: `src/lib/catalog-wizard/import/qb-cards-to-payload.ts`
- Create: `src/lib/catalog-wizard/import/__tests__/qb-cards-to-payload.test.ts`
**Design tokens:** n/a.

1. Failing test — a service card → `{ mode:'edit', products:[{ id:<uuid>, name, base_price, default_price, unit_cost, sku, is_taxable, kind, type, pricing_unit, external_source:'quickbooks', external_id }] }`. Assert the snake_case keys match prod columns exactly (cross-check against the 5.0 verified column list). Run. Red.
2. Minimal impl: assign `crypto.randomUUID()` per card (client-supplied id → UPSERT, never double-create), map camelCase→snake_case. Green.
3. Failing test — an Inventory card (`tracked`) emits BOTH a `products` row (with `linked_catalog_item_id` referencing the generated catalog item id) and a `catalog_items`/`variants` row carrying the same id linkage. Impl. Green.
4. Failing test — a Group card emits a `package` product plus `bundles:[{ product_id, component_product_id, quantity }]`, resolving component `externalId` → the generated product id within the same batch (component must be present in the batch or recorded as an unresolved-component warning). Impl. Green.
5. Failing test — re-import: a card whose `external_id` matched an existing row (carries `existingId` from Phase-3 dedupe) reuses that id (UPSERT/merge), NOT a new uuid. Impl. Green.
6. Commit: `feat(catalog-wizard): map QB import cards to catalog_setup_save payload`.

**Acceptance:** payload keys/enums match the verified prod schema; ids are client-supplied (merge, never double-create); Inventory linkage + Group bundles resolve within the batch; matched re-imports reuse existing ids. Commit goes through `catalog_setup_save`, never `catalog_import_apply` — assert in a comment + a test that the produced payload includes `mode:'edit'`.

---

### Task 5.5: Items-only read-only pull on the import service (assert pull_only)

The carried `quickbooks-import-service.ts` `pullAndStage` pulls all entities (customers/invoices/etc.) — the wizard needs an **items-only** read-only path. Add `pullItemsOnly(companyId)` that resolves the connection, asserts `sync_direction === 'pull_only'` (or the connection is in read-only mode), gets a valid (now-decrypted) token, constructs `QuickBooksPullService`, calls `pullItems()` ONLY, asserts `qbWriteCalls === 0`, and returns the raw `Item[]` — never touching invoices/estimates/payments and never importing `sync-orchestrator.ts`.

**Skills:** `code-review` (push-path non-reachability).
**Files:**
- Modify: `src/lib/api/services/quickbooks-import-service.ts` (add `pullItemsOnly`)
- Create: `src/app/api/integrations/quickbooks/import/items/route.ts` (POST: auth → company-access → `accounting.manage_connections` → `pullItemsOnly` → return mapped cards via 5.3/5.6)
- Create: `src/lib/api/services/__tests__/quickbooks-pull-items-only.test.ts`
**Design tokens:** n/a.

1. Failing test — inject an in-memory Supabase double + a fetch spy; `pullItemsOnly` calls `SELECT * FROM Item` exactly once (one GET), records `qbWriteCalls:0`, and never queries Invoice/Estimate/Payment. Assert the fetch spy saw NO non-GET method and NO `/v3/.../invoice` write. Run. Red.
2. Minimal impl. Green.
3. Failing test — when the connection's `sync_direction` is `bidirectional` (push mode), `pullItemsOnly` STILL issues only GETs (read-only is independent of the connection's configured direction) and asserts `pull_only` semantics at the call site by hard-coding GET — add an assertion that the method literal is GET. Impl/confirm. Green.
4. Failing test — `qbWriteCalls > 0` (simulate by spying a non-GET) throws `Read-only violation`. Impl (the pull service already counts; surface the throw). Green.
5. Route test (integration, mocked service): POST without `accounting.manage_connections` → 403; with permission + connected → `{ cards, blockers }`. `npm run test -- src/app/api/integrations/quickbooks/import/items` (or the integration test path). Green.
6. Commit: `feat(catalog-wizard): items-only read-only QB pull (pull_only, zero writes)`.

**Acceptance:** `pullItemsOnly` fetches Items via GET only, asserts `qbWriteCalls===0`, never reads other entities, never imports the push orchestrator (`grep -rn "sync-orchestrator" src/lib/api/services/quickbooks-import-service.ts` → 0); route is permission-gated.

---

### Task 5.6: Pull-items step → Phase-1 staging cards (cross-ref Phase 3 dedupe)

Wire the items-only pull through the mapper into Phase-1 staging cards on the shared canvas, routing each card through the Phase-3 dedupe so a SKU/name match defaults to **show-diff** (per-field accept) rather than a create that would hard-fail the DB unique index. This is the source-lane integration, not new card UI (cards/canvas are Phase 1).

**Skills:** `interface-design` + `frontend-design` (the source-lane trigger + import progress within the existing canvas — minimal, reuses Phase-1 card components); `ops-copywriter` (progress + result strings); `audit-design-system`; `web-animations` (card arrival — staggered, one curve, reduced-motion).
**Files:**
- Create: `src/components/catalog-wizard/sources/qb-import-source.tsx` (the structured-pull lane trigger + state)
- Create: `src/lib/hooks/use-qb-item-import.ts` (TanStack mutation over `/api/integrations/quickbooks/import/items`)
- Create: `src/lib/catalog-wizard/import/__tests__/qb-import-to-cards.test.ts`
- Modify: the Phase-1 canvas store entry point (INTEGRATION POINT — read the real path from Phase 1; e.g. `src/stores/catalog-wizard-store.ts` `addCards(moduleKey, cards)`)
**Design tokens:** Primary CTA `PULL ITEMS` accent `#6F94B0` (the one accent on this lane); progress count JetBrains Mono; arrived-card confirm border `olive #9DB582`; dup cards `tan #C4A868`. `.glass-surface` panel, radius 10. Motion `cubic-bezier(0.22,1,0.36,1)`, staggered card-in ~250ms, reduced-motion = instant.

1. Failing test (pure) — `qbImportToCards(rawItems, { inventoryMode, existingCatalog })` calls the mapper + Phase-3 dedupe and returns cards tagged `{ status: 'new' | 'diff' | 'duplicate', module: 'SELL' | 'STOCK' }`, with a SKU-matched item tagged `diff` carrying per-field `existing`/`incoming` pairs. Run. Red.
2. Minimal impl composing `mapQbItems` (5.3) + the Phase-3 dedupe resolver (import it; do NOT re-implement matching). Green.
3. Failing test — Inventory items route to `module:'STOCK'` only when `inventoryMode==='tracked'`; when `'off'` they route to `SELL` as products-only AND set a single batch-level `pendingInventoryPrompt:true` (one-time "track inventory?" — surfaced once, not per-row). Impl. Green.
4. Failing test (hook, mocked fetch) — `use-qb-item-import` posts to the items route and on success calls the canvas store `addCards` with the grouped cards. Green.
5. Build `qb-import-source.tsx`: a single trigger (NOT a provider grid), an in-flight progress readout (`// PULLING ITEMS… N FOUND`), and on completion hands cards to the canvas. No new card chrome — reuse Phase-1 card components. Run `audit-design-system` against it; fix any hardcoded value.
6. Commit: `feat(catalog-wizard): QB items pull → staging cards with show-diff dedupe`.

**Acceptance:** pulled items become Phase-1 cards grouped SELL/STOCK; SKU/name matches default to show-diff; Inventory routes to STOCK only when tracked; one-time inventory prompt fires once per batch; copy via `ops-copywriter`; `audit-design-system` passes; reduced-motion honored.

---

### Task 5.7: Persist re-import identity on commit (external_source/external_id round-trip)

Ensure committed QB-sourced rows carry `external_source='quickbooks'` + `external_id` (5.0 columns) so a re-run re-syncs instead of duplicating — closing the won-conversion class of bug. The payload builder (5.4) already emits these; this task asserts the round-trip survives `catalog_setup_save` and that a second import of the same realm matches existing rows.

**Skills:** `supabase` (verify against a sentinel company).
**Files:**
- Modify: `src/lib/catalog-wizard/import/qb-cards-to-payload.ts` (confirm `external_*` always set for QB source)
- Create: `src/lib/catalog-wizard/import/__tests__/qb-reimport-dedupe.test.ts`
**Design tokens:** n/a.

1. Failing test (pure) — given a first-import payload and a simulated post-commit catalog (rows now carrying `external_id`), a second `qbImportToCards` of the SAME items tags every card `status:'duplicate'`/`'diff'` (matched by `external_id`), zero `new`. Run. Red.
2. Impl: dedupe resolver prefers `(external_source, external_id)` match over SKU/name when present. Green.
3. Live round-trip verification (sentinel, read-only-then-rollback): on a sentinel company, call `catalog_setup_save` with a tiny QB payload (1 product, `external_id:'TEST-1'`), re-query `products` for the row, confirm `external_source/external_id` persisted, then delete the test row. Use `mcp__plugin_supabase_supabase__execute_sql`. Record the row count delta (must be +1 then 0 after cleanup). Flag at execution: get explicit go-ahead before the live write (memory: live-data writes need explicit go-ahead).
4. Commit: `feat(catalog-wizard): persist QB external identity for idempotent re-import`.

**Acceptance:** re-importing the same realm produces zero duplicate creates (external-id match); the identity persists through `catalog_setup_save`; sentinel verified and cleaned up.

---

### Task 5.8: Connect-detect entry + live badge (NOT side-by-side provider cards) + beyond-Canpro gate

The design-judgment task. The current `accounting-tab.tsx` (overhaul branch) ships side-by-side `QuickBooks` + `Sage` peer `ProviderCard`s — the canonical failure (a company picks one provider, once). The wizard's import lane is ONE "import from your accounting software" entry that **detects** the existing `accounting_connection` and pulls; switch/disconnect live behind a compact live badge in a `.glass-dense` modal. This entry sits in the wizard source list (§8), NOT in settings. It is enabled beyond Canpro ONLY when the 5.2 token gate is satisfied (key present + allowlist).

**Skills:** `interface-design` + `frontend-design` + `ui-ux-pro-max` (the single entry, the live badge, the switch/disconnect modal); `ops-copywriter` (entry label, badge, switch/disconnect, gate-blocked message); `audit-design-system` (done-gate); `web-animations` (badge connect transition — one curve, reduced-motion); `wireframe` (mock the entry + badge + modal BEFORE code — no canonical wizard component exists; approve mock first per spec §13).
**Files:**
- Create: `src/components/catalog-wizard/sources/accounting-connect.tsx` (the ONE entry + detect)
- Create: `src/components/catalog-wizard/sources/accounting-badge.tsx` (compact live badge → switch/disconnect modal)
- Create: `src/lib/catalog-wizard/import/connect-detect.ts` (pure: given connections[], return `{ provider, connected, canImport }`)
- Create: `src/lib/catalog-wizard/import/__tests__/connect-detect.test.ts`
- Create: `src/lib/catalog-wizard/import/qb-import-gate.ts` (pure: `canEnableQbImport({ companyId, hasEncKey, allowlist })`)
- Create: `src/lib/catalog-wizard/import/__tests__/qb-import-gate.test.ts`
- Modify: `src/app/api/integrations/quickbooks/import/items/route.ts` (enforce the gate server-side, fail-closed)
- Create: i18n entries in `src/i18n/dictionaries/{en,es}/catalog-wizard.json` (INTEGRATION POINT — namespace from Phase 1)
**Design tokens:** Entry: `.glass-surface` row, Cake Mono Light UPPERCASE label `IMPORT FROM YOUR ACCOUNTING SOFTWARE`, lucide `Link2`/`Plug` icon `currentColor`, control min-h 36px radius 5. Live badge: compact, `olive #9DB582` border-only + JetBrains Mono `// QUICKBOOKS · CONNECTED`, NO accent. Switch/disconnect modal: `.glass-dense` radius 12; destructive disconnect uses `rose #B58289` text (never `brick` as text). The single accent `#6F94B0` is reserved for `PULL ITEMS` (5.6) — the entry and badge carry none. Gate-blocked state: `tan #C4A868` advisory, copy `[ CONNECT REQUIRES SETUP — CONTACT SUPPORT ]` (final copy via ops-copywriter).

1. Wireframe + approval (spec §13 enforcement): produce the entry + badge + switch/disconnect mock via `wireframe`; do NOT code UI until approved. (Flag the approval checkpoint at execution.)
2. Failing test (pure) — `connectDetect([{provider:'quickbooks', isConnected:true}])` → `{ provider:'quickbooks', connected:true, canImport:true }`; empty/no-connection → `{ provider:null, connected:false, canImport:false }`; a connection that is `is_connected:false` → `connected:false` (reconnect needed). Assert it NEVER returns an array of providers (no peer-card data shape). Run. Red.
3. Impl `connect-detect.ts` (returns ONE provider, never a peer list). Green.
4. Failing test — `qb-import-gate.ts`: Canpro company → `canEnableQbImport` true regardless of key (Canpro is the pilot); any other company → true ONLY when `hasEncKey===true` AND on the allowlist; key absent → false (fail-closed). Run. Red. Impl. Green.
5. Server enforcement test — the items route returns 403 `{ error: 'qb_import_not_enabled' }` for a non-Canpro, non-allowlisted company even with `accounting.manage_connections`. `npm run test` the route. Green. (This is where the 5.2 gate becomes load-bearing.)
6. Build `accounting-connect.tsx` (ONE entry; if `connectDetect` says connected → render `accounting-badge.tsx`; else render a single connect action reusing the existing `useInitiateOAuth` — do NOT duplicate the Sage card; Sage is a deferred fast-follow, absent from the wizard entirely). Build the badge + `.glass-dense` switch/disconnect modal (disconnect reuses `useDisconnectProvider`; switch = disconnect-then-connect behind a confirm).
7. Run `audit-design-system` on both components; fix every hardcoded value. Confirm the entry presents NO provider grid (the failure pattern) — a reviewer-facing assertion in the component test: it renders exactly one connect affordance.
8. Commit: `feat(catalog-wizard): single connect-detect entry + live badge (no side-by-side providers)`; `feat(catalog-wizard): gate QB import beyond Canpro on token encryption`.

**Acceptance:** ONE entry that detects the connected provider and pulls; no QuickBooks+Sage peer cards anywhere in the wizard; switch/disconnect behind a compact `olive` badge in a `.glass-dense` modal; the accent appears only on `PULL ITEMS`; import is server-side gated to Canpro until the 5.2 token gate + allowlist are satisfied (fail-closed); wireframe approved before code; `audit-design-system` passes; copy via `ops-copywriter`; reduced-motion honored. Why this presentation, for this user, at this moment: a one-provider-once choice collapses to a single entry → brief connect → compact live badge → settings behind the badge (the spec's corrected pattern), not the data-model leak.

---

### Task 5.9: Inventory-off-but-stock-arrives — one-time "track inventory?" prompt (cross-ref STOCK)

When the QB pull yields Inventory-type items but `company_inventory_settings.inventory_mode='off'`, surface a single, non-blocking "track inventory?" decision (set by 5.6's batch-level `pendingInventoryPrompt`). Decline → items down-shift to products-only with quantities surfaced (never silently dropped). Accept → flip `inventory_mode` to `tracked` and re-route Inventory cards to STOCK. This is the import-side trigger; the STOCK module owns the actual flip mechanics — cross-reference, don't duplicate.

**Skills:** `interface-design` + `frontend-design` (the one-time prompt); `ops-copywriter` (prompt copy); `audit-design-system`; `web-animations` (prompt entrance — one curve, reduced-motion).
**Files:**
- Create: `src/components/catalog-wizard/sources/track-inventory-prompt.tsx`
- Create: `src/lib/catalog-wizard/import/__tests__/inventory-prompt.test.ts`
- Modify: the canvas store / STOCK-module integration point (read real path from Phase 1/STOCK; `setInventoryMode('tracked')` + `reRouteInventoryCards()`)
**Design tokens:** `.glass-dense` prompt; `tan #C4A868` attention accent (border/indicator only); Cake Mono Light title `TRACK INVENTORY?`; Mohave body; quantities JetBrains Mono. Single primary CTA `TRACK IT` accent `#6F94B0`; secondary `KEEP AS PRODUCTS` ghost (no accent). Motion one curve, reduced-motion instant.

1. Failing test (pure) — `resolveInventoryDecision(cards, 'decline')` returns all Inventory cards re-tagged `module:'SELL'`, `trackQuantity:false`, with `onHand` preserved on the card (surfaced, not dropped). Run. Red. Impl. Green.
2. Failing test — `resolveInventoryDecision(cards, 'accept')` returns Inventory cards re-tagged `module:'STOCK'`, `trackQuantity:true`, and signals `setInventoryMode:'tracked'`. Impl. Green.
3. Failing test — the prompt renders ONCE per batch (idempotent on a `promptShownForBatch` flag); re-pulling within the same session does not re-prompt. Impl. Green.
4. Build `track-inventory-prompt.tsx` (one-time, non-blocking — the wizard proceeds either way). Run `audit-design-system`; fix hardcoded values.
5. Commit: `feat(catalog-wizard): one-time track-inventory prompt on QB inventory items`.

**Acceptance:** the prompt fires exactly once per import batch; decline preserves quantities on products-only cards (never silent drop); accept flips inventory_mode + re-routes to STOCK via the STOCK module's mechanism (not duplicated here); copy via `ops-copywriter`; `audit-design-system` passes; reduced-motion honored.

---

### Task 5.10: Phase done-gate — read-only invariant, design audit, integration smoke

Final gate before Phase 5 is "done". Proves the read-only guarantee end-to-end, the design-system compliance, and the gate enforcement.

**Skills:** `audit-design-system` (full pass on 5.6/5.8/5.9 UI); `code-review`; `verification-before-completion`.
**Files:**
- Create: `src/lib/catalog-wizard/import/__tests__/qb-import-readonly-invariant.test.ts`
- Create: `docs/PHASE-5-DONE-GATE.md` (the checklist, executed)
**Design tokens:** n/a (audit).

1. Read-only invariant test — drive `pullItemsOnly` through a fetch spy across a full mapped import; assert ZERO non-GET requests, `qbWriteCalls===0`, and that no code path imports `sync-orchestrator`. Run. Green.
2. Gate test — non-Canpro + key-absent → import route 403; Canpro → 200. Green.
3. `audit-design-system` on every Phase-5 component: zero hardcoded color/spacing/radius/font; accent only on `PULL ITEMS` + `TRACK IT`; one easing; reduced-motion fallbacks present. Record pass.
4. `grep -rn "estimate_line_items\|catalog_import_apply" src/lib/catalog-wizard/` → ZERO (commit is via `catalog_setup_save`; the create-only RPC is never used).
5. Full suite: `npm run test -- src/lib/catalog-wizard/ src/lib/api/services/__tests__/` — all green; paste output.
6. Commit: `test(catalog-wizard): Phase 5 read-only invariant + done-gate`.

**Acceptance:** read-only proven (0 writes, no push-path reachability); gate enforced; design audit passes; `catalog_setup_save`-only commit confirmed; full suite green.
