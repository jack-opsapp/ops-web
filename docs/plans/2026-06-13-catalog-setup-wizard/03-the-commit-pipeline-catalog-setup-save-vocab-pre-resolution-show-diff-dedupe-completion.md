## Phase 3: The Commit Pipeline — `catalog_setup_save`, vocab pre-resolution, show-diff dedupe, completion

**Goal.** Stand up the server-side path that commits the accepted staging-card set into real catalog rows: a PURE payload builder (cards → the exact `catalog_setup_save` payload), vocabulary pre-resolution (auto-create missing categories/units before commit), a PURE show-diff dedupe matcher (SKU/name match → per-field diff + `external_*` stamping), and the API route that wires `token → verifyAuthToken → findUserByAuth → accessToken-bearing client → catalog_setup_save (stable idempotency key)`, then stamps company-scoped completion and fires a Sonner toast + a direct-insert header-rail notification. Nothing here renders product UI — this is the engine room. Most logic is pure and gets heavy TDD; the route is integration-tested with mocked auth/clients.

**Skills.** This phase is almost entirely backend/logic: no `interface-design`/`frontend-design`/`elite-animations` work except the count-up/toast integration point (Task 3.6), which only cites tokens and defers the UI build to the canvas phase. `ops-copywriter` applies to the completion notification + toast strings (Task 3.5). `audit-design-system` not applicable to pure libs.

**Design tokens (Task 3.6 only).** Completion success = olive `#9DB582` (token `olive`, 7.8:1) for the +delta / "added" treatment; hero-number count-up 800ms quadratic ease-out per DESIGN.md motion table; accent `#6F94B0` (`ops-accent`) reserved for the single primary CTA — NEVER on the completion stats. Numbers in JetBrains Mono tabular-lining slashed-zero. Empty/zero = `—` / `$0`, never "N/A".

**Verified contract (do not re-derive — these are read from the live RPC body and prod schema):**
- `catalog_setup_save(p_company_id uuid, p_idempotency_key text, p_payload jsonb) → jsonb`. Top-level payload keys: `mode` (`'create'|'edit'`, default `'create'`), `family` (single object — NOT an array), `catalog_options`, `variants`, `stock_units`, `stock_unit_events`, `products` (array), `product_materials` (top-level array), `deleted_ids` (object). Response: `{ ok, mode, id_map, counts{...}, validated_counts{...}, blockers[], warnings[], saved_at }`.
- It is **SECURITY INVOKER** and guards `p_company_id is distinct from private.get_user_company_id()` where `get_user_company_id() = SELECT company_id FROM users WHERE email = auth.jwt()->>'email'`. → must be called with a JWT-bearing client, NOT service-role.
- Per-`product` doc fields (verified): `client_id`, `id`, `name`, `description`, `default_price`/`base_price`/`price` (any), `unit`/`pricing_unit`, `category`, `category_id` (uuid), `unit_id` (uuid), `is_taxable`, `is_active`, `type` (LABOR|MATERIAL|OTHER), `kind` (service|material|package), `sku`, `minimum_charge`, `minimum_quantity`, `linked_catalog_item_id`, `bundle_pricing_mode`, nested `options[]`, `pricing_modifiers[]`, `product_materials[]`, `catalog_option_mappings[]`, `bundle_items[]`. UPSERT is `on conflict (id) do update`.
- `options[]`: `client_id`, `name`, `kind` (`'select'`), `affects_price`, `affects_recipe`, `required`, `sort_order`, nested `values[]` (`client_id`, `label`/`value`, `sort_order`).
- `pricing_modifiers[]`: `client_id`, `option_client_id` (refs an option in the SAME product), `option_value_client_id`/`trigger_value_client_id`, `modifier_kind` (`'add_flat'`), `amount`. **Tiers are add_flat only — NEVER `tiered_pricing`.**
- `product_materials[]`: `client_id`, `quantity_per_unit`/`quantity`, `notes`, `catalog_variant_id` (concrete pin) OR `variant_selector` (object), `catalog_item_id`, `scaled_by_option_id`/`scaled_by_option_client_id`, `unit_id`.
- `bundle_items[]`: `client_id`, `child_product_id`/`child_product_client_id`, `quantity`, `display_order`, `relationship_kind` (default `'required'`).
- `family`: `name` (required in create), `id` (edit), `category_id`, `unit_id`/`default_unit_id`, thresholds, `notes`. `variants[]`: `client_id`, `sku`, `quantity`, `price`/`price_override`, `warning_threshold`, `critical_threshold`, `unit_id`, `option_value_client_ids[]`.

---

### Task 3.0: Lock the StagingCard input contract + scaffold the commit module

**Skills:** none (type-only scaffolding).

**Files:**
- Create `src/lib/catalog-wizard/commit/payload-builder.types.ts`
- Create `src/lib/catalog-wizard/commit/dedupe-matcher.types.ts`

**Design tokens:** n/a.

**Steps:**
1. Read Phase 2's staging-card export if it exists (`src/lib/catalog-wizard/staging/*` or the Phase 2 plan). If absent, define the locked input interface here and flag for reconciliation. Create `payload-builder.types.ts` with the OUTPUT types mirroring the verified RPC contract exactly:
   ```ts
   export type SetupMode = "create" | "edit";

   export interface OptionValueDoc { client_id: string; id?: string; label: string; sort_order?: number; }
   export interface ProductOptionDoc {
     client_id: string; id?: string; name: string; kind: "select";
     affects_price?: boolean; affects_recipe?: boolean; required?: boolean;
     sort_order?: number; values: OptionValueDoc[];
   }
   export interface PricingModifierDoc {
     client_id: string; option_client_id: string; option_value_client_id: string;
     modifier_kind: "add_flat"; amount: number;
   }
   export interface ProductMaterialDoc {
     client_id: string; quantity_per_unit: number; notes?: string | null;
     catalog_variant_id?: string | null; variant_selector?: Record<string, unknown> | null;
     catalog_item_id?: string | null; scaled_by_option_client_id?: string | null;
     unit_id?: string | null;
   }
   export interface BundleItemDoc {
     client_id: string; child_product_client_id?: string; child_product_id?: string;
     quantity: number; display_order?: number; relationship_kind?: string;
   }
   export interface ProductDoc {
     client_id: string; id?: string; name: string; description?: string | null;
     default_price?: number; base_price?: number; sku?: string | null;
     unit?: string; pricing_unit?: string; category_id?: string | null; unit_id?: string | null;
     is_taxable?: boolean; is_active?: boolean;
     type?: "LABOR" | "MATERIAL" | "OTHER"; kind?: "service" | "material" | "package";
     minimum_charge?: number | null; minimum_quantity?: number | null;
     linked_catalog_item_id?: string | null; bundle_pricing_mode?: string | null;
     external_source?: string | null; external_id?: string | null;
     options?: ProductOptionDoc[]; pricing_modifiers?: PricingModifierDoc[];
     product_materials?: ProductMaterialDoc[]; bundle_items?: BundleItemDoc[];
   }
   export interface VariantDoc {
     client_id: string; id?: string; sku?: string | null; quantity?: number;
     price_override?: number | null; warning_threshold?: number | null;
     critical_threshold?: number | null; unit_id?: string | null;
     option_value_client_ids?: string[];
     external_source?: string | null; external_id?: string | null;
   }
   export interface FamilyDoc {
     id?: string; name: string; category_id?: string | null;
     default_unit_id?: string | null; notes?: string | null;
     external_source?: string | null; external_id?: string | null;
   }
   export interface CatalogSetupPayload {
     mode: SetupMode;
     family?: FamilyDoc;
     catalog_options?: unknown[];
     variants?: VariantDoc[];
     products?: ProductDoc[];
     product_materials?: ProductMaterialDoc[];
     deleted_ids?: Record<string, string[]>;
   }
   ```
2. Create `dedupe-matcher.types.ts`:
   ```ts
   export type DedupeAction = "create" | "show-diff" | "merge-all" | "skip";
   export interface LiveCatalogRow { id: string; sku: string | null; name: string; [field: string]: unknown; }
   export interface DiffField { field: string; incoming: unknown; existing: unknown; }
   export interface CardMatch {
     cardClientId: string;
     matchedRowId: string | null;     // null => no live match => create
     matchedOn: "sku" | "name" | null;
     defaultAction: DedupeAction;      // show-diff on match, create on no-match
     diffs: DiffField[];
     externalSource: string | null;
     externalId: string | null;
   }
   export interface DedupeResult { matches: CardMatch[]; }
   ```
3. `npx vitest run src/lib/catalog-wizard/commit/__tests__/payload-builder.test.ts` — expect "No test files found" (proves the dir exists / config resolves). Commit: `chore(catalog-wizard): scaffold commit module + lock RPC payload + dedupe types`.

---

### Task 3.1: PURE payload builder — products + options/values + add_flat tiers (TDD core)

**Skills:** none (pure logic).

**Files:**
- Create `src/lib/catalog-wizard/commit/payload-builder.ts`
- Create `src/lib/catalog-wizard/commit/__tests__/payload-builder.test.ts`

**Design tokens:** n/a.

**Steps:**
1. Write the failing test for the simplest product map. The builder takes already-vocab-resolved cards (category_id/unit_id are real UUIDs by the time it runs — Task 3.2 owns resolution) and a `mode`:
   ```ts
   import { describe, it, expect } from "vitest";
   import { buildCatalogSetupPayload } from "../payload-builder";

   describe("buildCatalogSetupPayload — flat product", () => {
     it("maps a single flat product to a products[] doc with a client_id", () => {
       const payload = buildCatalogSetupPayload({
         mode: "edit",
         products: [{
           clientId: "c1", name: "Service Call", basePrice: 95, sku: "SVC-1",
           kind: "service", isTaxable: true,
         }],
       });
       expect(payload.mode).toBe("edit");
       expect(payload.products).toHaveLength(1);
       const p = payload.products![0];
       expect(p.client_id).toBe("c1");
       expect(p.name).toBe("Service Call");
       expect(p.base_price).toBe(95);
       expect(p.default_price).toBe(95);   // builder mirrors base→default
       expect(p.sku).toBe("SVC-1");
       expect(p.kind).toBe("service");
       expect(p.type).toBe("LABOR");        // service→LABOR mapping
       expect("tiered_pricing" in p).toBe(false);  // NEVER emit tiered_pricing
     });
   });
   ```
2. `npx vitest run src/lib/catalog-wizard/commit/__tests__/payload-builder.test.ts` → fails (`buildCatalogSetupPayload` undefined).
3. Minimal impl: define the builder input type (a clean camelCase `BuilderInput` distinct from the wire `CatalogSetupPayload`), implement flat-product mapping including kind→type mapping (`service→LABOR`, `material→MATERIAL`, `package→OTHER`), `basePrice`→both `base_price` and `default_price`. Generate a `client_id` only if the card lacks one (prefer the card's stable id). Do NOT set `tiered_pricing`.
4. Run → passes. Commit: `feat(catalog-wizard): payload builder — flat product mapping`.
5. Failing test for the **tier ladder** (the never-built path — this is the load-bearing one):
   ```ts
   it("maps a size tier to select option + values + add_flat modifiers (never tiered_pricing)", () => {
     const payload = buildCatalogSetupPayload({
       mode: "edit",
       products: [{
         clientId: "p1", name: "Asphalt Shingle Roof", kind: "service",
         tier: { optionName: "Size", basePrice: 4000, steps: [
           { label: "Small", price: 4000 }, { label: "Medium", price: 6500 }, { label: "Large", price: 9000 },
         ]},
       }],
     });
     const p = payload.products![0];
     expect(p.base_price).toBe(4000);            // base = lowest tier
     expect(p.options).toHaveLength(1);
     const opt = p.options![0];
     expect(opt.kind).toBe("select");
     expect(opt.affects_price).toBe(true);
     expect(opt.values.map(v => v.label)).toEqual(["Small", "Medium", "Large"]);
     // modifiers: base tier = 0 delta (or omitted), others = price - base
     const mods = p.pricing_modifiers!;
     expect(mods.every(m => m.modifier_kind === "add_flat")).toBe(true);
     const med = mods.find(m => m.option_value_client_id === opt.values[1].client_id)!;
     expect(med.amount).toBe(2500);              // 6500 - 4000
     const large = mods.find(m => m.option_value_client_id === opt.values[2].client_id)!;
     expect(large.amount).toBe(5000);            // 9000 - 4000
     expect(med.option_client_id).toBe(opt.client_id);  // modifier refs same product's option
     expect("tiered_pricing" in p).toBe(false);
   });
   ```
6. Run → fails. Impl the tier expansion: lowest step price → `base_price`; each step → an `OptionValueDoc` with a minted `client_id`; each step delta (`price - base`) → an `add_flat` `PricingModifierDoc` whose `option_client_id` = the option's client_id and `option_value_client_id` = the value's client_id. Omit a zero-delta modifier for the base step (or emit amount 0 — match the test). Run → passes. Commit: `feat(catalog-wizard): payload builder — tier ladder (select + add_flat, no tiered_pricing)`.
7. Failing test for **variant-pinned recipe** (`product_materials` nested in a product) — assert a nil-selector family pin is REJECTED/normalized to require a concrete `catalog_variant_id` (per spec §4: nil-selector family pins are silently dropped from the cut list, so the builder must never emit one):
   ```ts
   it("pins recipes to a concrete catalog_variant_id and rejects nil-selector family pins", () => {
     const payload = buildCatalogSetupPayload({ mode: "edit", products: [{
       clientId: "p1", name: "Deck Board Run", kind: "material",
       recipes: [{ catalogVariantId: "11111111-1111-1111-1111-111111111111", quantityPerUnit: 3 }],
     }]});
     expect(payload.products![0].product_materials![0].catalog_variant_id)
       .toBe("11111111-1111-1111-1111-111111111111");
     expect(() => buildCatalogSetupPayload({ mode: "edit", products: [{
       clientId: "p2", name: "Bad", kind: "material",
       recipes: [{ catalogItemId: "22222222-2222-2222-2222-222222222222" }], // family pin, no variant, no selector
     }]})).toThrow(/recipe.*concrete variant|variant_selector/i);
   });
   ```
8. Run → fails. Impl recipe mapping: require either `catalog_variant_id` or a non-empty `variant_selector`; throw a typed error otherwise. Run → passes. Commit: `feat(catalog-wizard): payload builder — variant-pinned recipes`.
9. Failing tests for **bundles** (`bundle_items[]` with `child_product_client_id` resolving to a sibling product in the same payload, and `relationship_kind` default `'required'`) and **catalog family + variants** (one `family` object + `variants[]`, `option_value_client_ids` cross-refs). Cover the SINGLE-FAMILY constraint: a builder call accepts AT MOST one family; passing >1 family throws (the route loops families, the builder does not). Run → fails → impl → passes. Commit: `feat(catalog-wizard): payload builder — bundles + single catalog family/variants`.
10. Failing test for `deleted_ids` pass-through in edit mode and `mode` defaulting. Run → fails → impl → passes. Commit: `feat(catalog-wizard): payload builder — deleted_ids + mode`.

---

### Task 3.2: Vocabulary pre-resolution — auto-create categories/units before commit

**Skills:** none (service orchestration; services already exist).

**Files:**
- Create `src/lib/catalog-wizard/commit/vocab-resolver.ts`
- Create `src/lib/catalog-wizard/commit/__tests__/vocab-resolver.test.ts`

**Design tokens:** n/a.

**Steps:**
1. Failing test — given cards whose category/unit are NAMES (from QB account names / CSV columns / trade defaults) and a set of existing categories/units, the resolver returns a `{ categoryIdByName, unitIdByName }` map, creating only the missing ones via the injected services:
   ```ts
   import { describe, it, expect, vi } from "vitest";
   import { resolveVocabulary } from "../vocab-resolver";

   it("creates only missing categories/units and returns name→id maps (case-insensitive)", async () => {
     const createCategory = vi.fn(async ({ name }) => ({ id: "cat-new", name }));
     const createUnit = vi.fn(async ({ display }) => ({ id: "unit-new", display }));
     const result = await resolveVocabulary({
       companyId: "co-1",
       categoryNames: ["Roofing", "roofing", "New Cat"],   // dedupe + case-insensitive
       unitNames: ["each", "Square"],
       existingCategories: [{ id: "cat-roof", name: "Roofing" }],
       existingUnits: [{ id: "unit-each", display: "each", dimension: "count" }],
       services: { createCategory, createUnit },
     });
     expect(result.categoryIdByName.get("roofing")).toBe("cat-roof");  // matched existing
     expect(result.categoryIdByName.get("new cat")).toBe("cat-new");   // created
     expect(createCategory).toHaveBeenCalledTimes(1);
     expect(result.unitIdByName.get("square")).toBe("unit-new");
     expect(createUnit).toHaveBeenCalledTimes(1);
   });
   ```
2. `npx vitest run .../vocab-resolver.test.ts` → fails.
3. Impl: lowercase-trim keys for matching, dedupe input names, look up existing first, create missing via the injected `createCategory`/`createUnit` (defaults wire to `CatalogCategoryService.create` / `CatalogUnitService.create`). Default new-unit `dimension` to `"count"` (the resolver cannot infer dimension from a name; `count` is the safe default per `CATALOG_UNIT_DIMENSIONS`). Run → passes. Commit: `feat(catalog-wizard): vocab pre-resolution (auto-create categories/units)`.
4. Failing test for the **card-rewrite** step — `applyVocabToCards(cards, maps)` replaces each card's category/unit NAME ref with the resolved UUID so the builder receives real ids. Run → fails → impl → passes. Commit: `feat(catalog-wizard): rewrite card category/unit refs to resolved ids`.
5. Failing test: a card already carrying a UUID category_id/unit_id passes through untouched (no spurious create). Run → fails → impl → passes. Commit: `fix(catalog-wizard): pass through pre-resolved uuid vocab refs`.

---

### Task 3.3: PURE show-diff dedupe matcher (TDD) + external_* stamping

**Skills:** none (pure logic). **Depends on Phase-1 additive `external_*` columns for the WRITE side; the matcher itself is pure and testable now.**

**Files:**
- Create `src/lib/catalog-wizard/commit/dedupe-matcher.ts`
- Create `src/lib/catalog-wizard/commit/__tests__/dedupe-matcher.test.ts`

**Design tokens:** n/a.

**Steps:**
1. Failing test — SKU match (case/space-insensitive), default action `show-diff`, per-field diffs:
   ```ts
   import { describe, it, expect } from "vitest";
   import { matchCards } from "../dedupe-matcher";

   it("matches on lower(trim(sku)) and produces per-field diffs with show-diff default", () => {
     const res = matchCards({
       externalSource: "quickbooks",
       cards: [{ clientId: "c1", sku: " SVC-1 ", name: "Service Call", basePrice: 120, externalId: "QB-42" }],
       liveRows: [{ id: "row-1", sku: "svc-1", name: "Service Call", base_price: 95 }],
     });
     const m = res.matches[0];
     expect(m.matchedRowId).toBe("row-1");
     expect(m.matchedOn).toBe("sku");
     expect(m.defaultAction).toBe("show-diff");
     expect(m.diffs).toContainEqual({ field: "base_price", incoming: 120, existing: 95 });
     expect(m.externalSource).toBe("quickbooks");
     expect(m.externalId).toBe("QB-42");
   });
   ```
2. `npx vitest run .../dedupe-matcher.test.ts` → fails.
3. Impl: normalize SKU via `s => s?.trim().toLowerCase()`; build a SKU index over `liveRows`; on hit, set `matchedOn: "sku"`, `defaultAction: "show-diff"`, compute `diffs` over the comparable field set (name, base_price/default_price, unit, category, is_taxable) where incoming != existing; stamp `externalSource`/`externalId` from the card. Run → passes. Commit: `feat(catalog-wizard): dedupe matcher — SKU match + per-field diff`.
4. Failing test — **name fallback when SKU absent** (both card.sku and the only candidate's sku are null): match on `lower(trim(name))`, `matchedOn: "name"`. And no-match → `defaultAction: "create"`, `matchedRowId: null`. Run → fails → impl → passes. Commit: `feat(catalog-wizard): dedupe matcher — name fallback + create default`.
5. Failing test — **external_id re-sync precedence**: if a card's `externalSource`+`externalId` equals a live row's `external_source`+`external_id`, match on that FIRST (re-import re-syncs the same row even if SKU/name changed), `matchedOn: "external"`. Add `"external"` to the `matchedOn` union. Run → fails → impl → passes. Commit: `feat(catalog-wizard): dedupe matcher — external_id re-sync precedence`.
6. Failing test — applying actions: `applyDedupe(cards, matches)` → for `skip` drop the card; for `merge-all` set the card's `id` to `matchedRowId` (so the builder UPSERTs); for `show-diff` with per-field user selections, apply only accepted fields; for `create` leave id unset but STAMP `external_source`/`external_id`. Run → fails → impl → passes. Commit: `feat(catalog-wizard): apply dedupe actions (skip/merge/show-diff/create) + stamp external_*`.

---

### Task 3.4: The commit API route — accessToken client + catalog_setup_save + idempotency

**Skills:** none (server route; `ops-copywriter` deferred to 3.5 for strings).

**Files:**
- Create `src/lib/supabase/accessToken-client.ts`
- Create `src/app/api/catalog/setup/commit/route.ts`
- Create `src/app/api/catalog/setup/commit/__tests__/route.test.ts`

**Design tokens:** n/a.

**Steps:**
1. Create `accessToken-client.ts` — a per-request Supabase client that carries the verified Firebase token so the RPC's `auth.jwt()->>'email'` resolves:
   ```ts
   import { createClient, type SupabaseClient } from "@supabase/supabase-js";
   /** Per-request client carrying the operator's Firebase idToken as accessToken so
    *  SECURITY INVOKER RPCs (e.g. catalog_setup_save) see the JWT email and pass
    *  the private.get_user_company_id() scope guard. NOT a singleton. */
   export function getAccessTokenClient(idToken: string): SupabaseClient {
     const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
     const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
     return createClient(url, anon, {
       auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
       accessToken: async () => idToken,
     });
   }
   ```
   Commit: `feat(supabase): per-request accessToken client for SECURITY INVOKER RPCs`.
2. Failing route test — happy path (SELL products-only). Mock `verifyAuthToken` → `{ uid, email }`, `findUserByAuth` → `{ id, company_id }`, the vocab resolver, the builder, and a client whose `.rpc("catalog_setup_save", ...)` returns `{ ok: true, counts: { products: 2 }, id_map: {...} }`. Assert the route returns 200 with `{ ok: true, counts }` and that `rpc` was called with `p_company_id`, a non-empty `p_idempotency_key`, and a payload with `mode: "edit"`:
   ```ts
   it("commits accepted products via catalog_setup_save (edit mode, stable key)", async () => {
     // ...mock setup...
     const res = await POST(makeReq({ token: "t", sessionId: "sess-1", cards: [...] }));
     expect(res.status).toBe(200);
     const rpc = rpcSpy.mock.calls[0][1];
     expect(rpc.p_company_id).toBe("co-1");
     expect(rpc.p_idempotency_key).toMatch(/^sess-1:/);   // stable per session
     expect(rpc.p_payload.mode).toBe("edit");
   });
   ```
3. `npx vitest run src/app/api/catalog/setup/commit/__tests__/route.test.ts` → fails.
4. Impl the route, mirroring `/api/setup/progress` for the auth preamble but diverging on the client used for the RPC:
   - Parse `{ token, sessionId, cards, stockFamilies?, mode? }`; 400 on missing token/sessionId/cards.
   - `verifyAuthToken(token)` → `{ uid, email }`; `findUserByAuth(uid, email, "id, company_id")`; 404 if no user; 400 if no `company_id`.
   - **Permission gate:** check the granular bit (`catalog.run_setup`, or `products.manage` until Phase 1 lands) via the server permission check — never role names. 403 on deny. (CONFIRM bit id with Phase 1.)
   - Vocab pre-resolution using the **service-role** client (`getServiceRoleClient()`): read existing categories/units, run `resolveVocabulary`, `applyVocabToCards`.
   - Run dedupe (`matchCards`/`applyDedupe`) against live rows read service-role.
   - `buildCatalogSetupPayload({ mode: mode ?? "edit", products, ... })`.
   - **RPC call via the accessToken client** (`getAccessTokenClient(token)`), with `p_idempotency_key = \`${sessionId}:${mode}\`` (suffix family ordinal for multi-family stock — see step 6).
   - If `result.blockers?.length`, return 422 with `{ ok: false, blockers }` (do NOT stamp completion).
   - On `result.ok`, proceed to Task 3.5 (completion). Return 200 `{ ok: true, counts, id_map }`.
   Run → passes. Commit: `feat(api): catalog setup commit route (accessToken client + catalog_setup_save)`.
5. Failing test — **idempotency replay**: two POSTs with the same `sessionId` + identical cards hit the RPC with the same key; the second returns the cached response. Assert the route surfaces the RPC's idempotent response unchanged. Run → fails → impl (none beyond passing the stable key — the RPC handles replay) → passes. Commit: `test(api): catalog commit idempotency replay`.
6. Failing test — **single-family STOCK loop**: when `stockFamilies` has 2 families, the route makes 2 RPC calls (the RPC writes ONE family per call), each with key `\`${sessionId}:edit:family:${i}\``, and aggregates counts. Run → fails → impl the family loop → passes. Commit: `feat(api): commit stock one-family-per-call (single-family RPC contract)`.
7. Failing test — **scope-guard surfacing**: if the RPC returns `{ ok: false, blockers: [{ code: "company_scope_mismatch" }] }` (the accessToken bridge failed to carry email), the route returns 422 and logs a clear diagnostic. Run → fails → impl → passes. Commit: `fix(api): surface catalog commit scope-mismatch clearly`. (This is the safety net for the confirm-at-execution accessToken risk.)

---

### Task 3.5: Completion — stamp `catalog_setup_completed_at` + Sonner toast + rail notification (direct insert)

**Skills:** `ops-copywriter` (notification title/body + toast string, OPS voice). **Depends on Phase-1 `company_settings.catalog_setup_completed_at` column.**

**Files:**
- Create `src/lib/catalog-wizard/commit/completion-notification.ts`
- Create `src/lib/catalog-wizard/commit/__tests__/completion-notification.test.ts`
- Modify `src/app/api/notifications/dispatch/route.ts` (add `catalog_ready` to the 3 maps — additive)
- Modify `src/lib/api/services/notification-dispatch.ts` (add `catalog_ready` to the client union for parity)
- Modify `src/app/api/catalog/setup/commit/route.ts` (call completion on `ok`)

**Design tokens:** n/a for the data layer (Task 3.6 owns the visual count-up/toast styling).

**Steps:**
1. **Why direct-insert, not dispatch (verified):** `/api/notifications/dispatch` filters out the acting user (`recipientIds.filter(id => id !== user.uid)`) — but the operator IS the completion recipient, so dispatch would no-op. The completion rail notification therefore inserts DIRECTLY into `notifications` (service-role, scoped to the operator), exactly like the PMF pipeline (`type: 'pmf_alert'`) and the CLAUDE.md rail example.
2. Failing test for `insertCatalogReadyNotification`:
   ```ts
   import { describe, it, expect, vi } from "vitest";
   import { insertCatalogReadyNotification } from "../completion-notification";

   it("inserts a catalog_ready notification scoped to the operator", async () => {
     const insert = vi.fn(async () => ({ error: null }));
     const db = { from: vi.fn(() => ({ insert })) } as any;
     await insertCatalogReadyNotification(db, {
       userId: "u-1", companyId: "co-1", productCount: 24, stockCount: 12,
     });
     const row = insert.mock.calls[0][0];
     expect(row.user_id).toBe("u-1");
     expect(row.company_id).toBe("co-1");
     expect(row.type).toBe("catalog_ready");
     expect(row.is_read).toBe(false);
     expect(row.persistent).toBe(false);
     expect(row.action_url).toBe("/catalog");
     expect(row.action_label).toMatch(/OPEN CATALOG/i);   // copy via ops-copywriter
     expect(row.body).toMatch(/24 products/);
   });
   ```
3. `npx vitest run .../completion-notification.test.ts` → fails.
4. Invoke `ops-copywriter` for the title (`Catalog ready`), body (`Your price book is live. {N} products, {M} in stock.` — `—` not "N/A" for zero), and action label (`OPEN CATALOG →`). Impl `insertCatalogReadyNotification`. Run → passes. Commit: `feat(catalog-wizard): catalog_ready rail notification (direct insert)`.
5. Failing test for `stampCatalogSetupCompleted(db, companyId)` — UPDATE `company_settings` set `catalog_setup_completed_at = now()` where `company_id = companyId` (companyId is TEXT — pass as-is, no uuid cast). Assert the update payload + filter. Run → fails → impl → passes. Commit: `feat(catalog-wizard): stamp company-scoped catalog_setup_completed_at`.
6. Wire both into the route's `ok` branch (service-role client for both writes; both fire-and-forget — a notification/stamp failure must NOT fail the commit, log only). Add `catalog_ready` additively to dispatch route's `NotificationEventType`, `CHANNEL_PREF_KEY` (map to `"project_updates"` or a new `"catalog_setup"` key with a safe default), and `INAPP_TYPE`; add it to the client union in `notification-dispatch.ts` for type parity — but add NO `dispatchCatalogReady` helper (completion is direct-insert). Add a route test asserting completion fns are called after `ok` and skipped on `blockers`. Run → passes. Commit: `feat(api): fire completion stamp + rail notification on catalog commit`.

---

### Task 3.6: Integration point — supply-strip count-up + Sonner toast on success (cite tokens, defer build)

**Skills:** `interface-design` + `frontend-design` + `animation-architect` → `web-animations` (mandatory for the count-up + toast); `ops-copywriter` (toast string); `audit-design-system` done-gate.

**Files:**
- Modify (UI/canvas phase, NOT here — this task DOCUMENTS the contract): the commit-success handler that calls `toast()` and triggers the supply-strip count-up. Read the real surface at `/Users/jacksonsweet/Projects/OPS/ops-web-overhaul-p2-shell/src/components/catalog/supply-strip.tsx`, `catalog-page.tsx`, and `(dashboard)/catalog/page.tsx`.

**Design tokens:** olive `#9DB582` (`olive`) for the +delta / "added" success treatment; hero-number **count-up 800ms quadratic ease-out** (DESIGN.md motion table) for the supply-strip numbers (0/0 → live counts) on completion; single easing `cubic-bezier(0.22,1,0.36,1)` everywhere else; accent `#6F94B0` (`ops-accent`) ONLY on the primary CTA — NEVER on the completion stats or the toast; JetBrains Mono tabular-lining slashed-zero for all numbers; empty/zero = `—` / `$0`. Honor `prefers-reduced-motion` (count-up → snap to final value).

**Steps:**
1. This phase delivers the DATA path (route returns `{ ok, counts }`); the VISUAL completion is built in the canvas/UI phase. Here, write the integration CONTRACT the UI phase consumes and a unit test for the toast-string helper so copy is locked now:
   - Failing test for `catalogCommitToastMessage({ products, stock })` → `"Catalog ready — 24 products, 12 in stock"` (zero → `—`). `npx vitest run` → fails.
2. Invoke `ops-copywriter` for the toast string (terse, sentence case, no emoji, no exclamation). Impl the pure helper in `src/lib/catalog-wizard/commit/completion-notification.ts` (co-located, reused by both toast + rail). Run → passes. Commit: `feat(catalog-wizard): commit success toast copy helper`.
3. Document (in the helper's JSDoc + the route's response shape) the exact integration the UI phase must wire: on a 200 `{ ok: true, counts }`, (a) `toast(catalogCommitToastMessage(counts))` via the mounted `<Toaster/>` (CONFIRM Toaster is mounted in the catalog/dashboard layout — `sonner` ^1.7.0 is installed), (b) invalidate the catalog TanStack queries so `supply-strip.tsx` re-reads live counts, (c) animate the strip numbers with the 800ms count-up. No production UI code lands in P3 — flag for the canvas phase. Commit: `docs(catalog-wizard): commit→completion UI integration contract`.
4. Run the FULL phase suite to verify nothing regressed: `npx vitest run src/lib/catalog-wizard/ src/app/api/catalog/` → expect all green. Run `audit-design-system` over any token references introduced. Final commit if needed: `test(catalog-wizard): green commit-pipeline suite`.

---

**Execution-time confirmations (carried from the structured `confirmations` field):** the accessToken-client must actually expose `email` to Postgres (verify one live Canpro call; fallback = an additive SECURITY DEFINER RPC variant); the STOCK single-family loop strategy; the idempotency-key derivation; Phase-1 additive columns + permission bit landed before 3.3/3.5; `<Toaster/>` mounted; and the absolute prohibition on emitting `tiered_pricing` (enforced by Task 3.1 tests).
