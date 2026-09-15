# Recipe Engine Correctness, Railing Takeoff Bridge, MCP Catalog Writes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (this session) — one Opus agent per task, reviewed by the planner against the real diff before the next wave.

**Goal:** Make a Canpro recipe produce trustworthy material demand from either estimator counts or a Deck Designer drawing, and give MCP a safe write/read surface for the catalog data those recipes depend on.

**Architecture:** The only live recipe consumer is `private.resolve_estimate_material_demand_plan` (called by `accept_estimate_to_job` → `persist_estimate_material_booking_projection`). Every fix keeps that one engine authoritative: the database stops mis-scaling lines, both editors materialize option defaults, the iOS Deck Designer writes railing counts into the same integer options the estimator uses, and MCP writes route through `catalog_setup_save` behind OPS-side approval.

**Tech Stack:** Postgres/plpgsql (Supabase prod `ijeekuhbatykdomumfjx`), Next.js 15 + vitest (`ops-web`), Swift/SwiftData + XCTest (`ops-ios`), MCP control plane (`src/lib/agent-control-plane`).

**Design System:** N/A for tasks 1–4 and 6 (no new UI surfaces). Task 5 adds approval-queue preview rows: `ops-design`, `interface-design`, `ops-copywriter`, `audit-design-system`.

**Required Skills:** `superpowers:test-driven-development`, `superpowers:verification-before-completion`; task 5 UI also `ops-design`, `ops-copywriter`, `audit-design-system`.

**Source docs:** `~/Downloads/ops-mcp-gaps.md` rev 9 (§Recipe engine, design notes 1–14), `~/Downloads/canpro-recipe-rules.md` rev 5 (§Test).

**Base:** ops-web `origin/main` a06f6f5e5, branch `feat/recipe-engine-railing-bridge`, worktree `ops-web-recipe-engine`. ops-ios local `main`, worktree branch `feat/railing-takeoff-bridge`.

**Release boundary:** nothing is pushed, applied to prod, or exposed to MCP clients without Jackson's explicit go. All DB work is proven on the local Postgres 17 copy (schema-only restore from prod + Canpro catalog rows + synthetic actor/client).

---

## Decisions (made by the planner; flagged ones go to Jackson)

| # | Decision | Why |
|---|---|---|
| D1 | Scaled line with missing / non-numeric configured value → `required_quantity = 0` + warning `scaled_option_value_missing`. Numeric = jsonb number, or a string matching `^\s*-?[0-9]+(\.[0-9]+)?\s*$` (legacy writers). Negative clamps to 0 (existing `greatest(…,0)`). | Brief step 1. Zero is loud (warning) and never overcounts; 20× overcount is silent. |
| D2 | A demand row is still emitted for a zero-quantity scaled line (status `projected`, required 0) so the warning is attached to a concrete material in the booking projection. | Keeps the demand-key set stable across edits; the warning is actionable per material. |
| D3 | Web `configured_options` values become `string | number | boolean`: select → value id (string), integer → JSON number, boolean → JSON bool. Defaults (`product_options.default_value`, text) are parsed per kind on line creation. Invalid integer default → option treated as unset (required → missing). | Matches iOS writer (`CatalogEstimateMerger.encodeConfiguredOptions`) and the SQL resolver. |
| D4 | Capability key canonical form is the registry ref **`deck-geometry/v1`** (hyphen). Fixtures, tests, `measureSource` for `cut_plan`, and the payload validator align to it; the validator rejects any `capabilityKey` not in the registry; a DB CHECK enforces `^[a-z0-9]+(-[a-z0-9]+)*/v[0-9]+$` on `catalog_product_capability_bindings.capability_key` (0 rows today). | Registry is the authority and every other ref (`catalog-core/v1`, `dynamic-material-quantity/v1`) is hyphenated. |
| D5 | Railing bridge lives in iOS Deck Designer (`ops-ios/OPS/DeckBuilder` + `Services/DesignToEstimateAdapter.swift`). `ComponentEmitter` emits **one `railing` component per railing type** (grouped by `RailingConfig.railingType`) carrying totals: `linear_feet`, `left_ends`, `right_ends`, `corners`, `off_angle_corners`, `house_returns`. The adapter writes an integer option when its normalized name matches: Left ends ← `left_ends`; Right ends ← `right_ends`; Corners / 90° corners ← `corners`; 45° corners / Off-angle corners ← `off_angle_corners`; House returns ← `house_returns`. Quantity = total LF. `$design.<key>` sources still win when set. | Deck Designer is iOS-only; the adapter + `company_default_products` path already exists. |
| D6 **(flag)** | Handedness: standing outside the deck facing the railing, the run end on your **left** is a left end. For a chain walked with the deck on the walker's right, the chain's final vertex is the left end. With no surface to decide the inside, walk order = edge order and the flag `handedness_basis: "edge_order"` is recorded. | EPL/EPR are physically handed; Jackson confirms which side installers call "left". |
| D7 **(flag)** | Vertex classification between two railing edges by turn angle θ (0° = straight): θ ≤ 10° → straight (no count); \|θ − 90°\| ≤ 10° and convex → Corners +1; \|θ − 90°\| ≤ 10° and reflex (inside corner) → Left +1, Right +1 (inside corners discontinued, rule "use endpost instead"); anything else → 45° corners +1, Left +1, Right +1 (rule "two end posts and a 45 degree sleeve"). | Canpro rules §Corners and angles. |
| D8 **(flag)** | House return: a chain end whose vertex is shared with a `house_edge`. It still counts as a left/right end (default is an end post) and is reported as `house_returns`. The bridge never writes **Wall returns** (bracket-instead-of-post is an estimator choice). | Canpro rules §Returns: end posts by default. Writing Wall returns would double-count against the end post. |
| D9 **(flag)** | Openings: stair openings and gates on a railing edge deduct their width from LF (as `ComponentEmitter` does today) and each opening adds Left +1, Right +1 (rail terminates on both sides). | Railing physically ends at an opening. |
| D10 | MCP writes: five **prepare** tools that stage a proposal and create an `agent_actions` row for approval **inside OPS** (same model as `prepare_customer_update`); commit runs as the approving operator and calls `public.catalog_setup_save` (variant, thresholds, pricing, option+backfill). Supplier cost profiles are not covered by `catalog_setup_save`, so they commit through a new narrow `private.catalog_supplier_cost_profile_save` with identical idempotency/fence conventions. | Brief step 5 + gap design notes 1–5, 11. |
| D11 | MCP read change (task 6) and the five prepare tools ship together in one new exposure revision (V24) so external clients see one consent change. | Exposure revisions are frozen; two back-to-back revisions double the OAuth churn. |
| D12 | `private.agent_catalog_compile/apply` stays untouched. Findings recorded for Jackson: dark (no activation seal), writes tables directly via dynamic SQL (not `catalog_setup_save`), stock = direct `quantity` set + `inventory_deductions` (not event-sourced), refuses selector/scaled recipes, has no thresholds / supplier profiles / option backfill. | Brief says inspect first; it is not a fit for the requested writes. |

---

## Task 1 — Scaled-line fallthrough (DB + iOS + web editor)

### 1a. Database (ops-web worktree)

**Files:**
- Create: `supabase/migrations/20260915220000_recipe_scaled_option_missing_zero.sql` — `create or replace function private.resolve_estimate_material_demand_plan(...)`, body copied **byte-exact** from prod (`pg_get_functiondef`) with only the scaled block changed.
- Create: `supabase/tests/recipe_scaled_option_missing.sql` (psql script run against local DB, sentinel-rollback).
- Test: `tests/unit/supabase/recipe-scaled-option-missing-migration.test.ts` (static contract: migration contains the warning code, no `quantity_per_unit × line_quantity` fallback when `scaled_by_option_id` is set).

**Change (replace lines 305–313 of the prod body):**
```sql
      if v_material.scaled_by_option_id is not null then
        v_scaled_raw := v_line.configured_options -> v_material.scaled_by_option_id::text;
        v_scaled_value := case
          when v_scaled_raw is null then null
          when jsonb_typeof(v_scaled_raw) = 'number' then (v_scaled_raw #>> '{}')::numeric
          when jsonb_typeof(v_scaled_raw) = 'string'
               and (v_scaled_raw #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
            then btrim(v_scaled_raw #>> '{}')::numeric
          else null
        end;
        if v_scaled_value is null then
          v_required_quantity := 0;
          v_scaled_warning := jsonb_build_object(
            'code', 'scaled_option_value_missing',
            'estimate_id', p_estimate_id,
            'line_item_id', v_line.line_item_id,
            'product_id', v_line.product_id,
            'product_material_id', v_material.product_material_id,
            'product_option_id', v_material.scaled_by_option_id,
            'configured_value', v_scaled_raw
          );
          v_warnings := v_warnings || jsonb_build_array(v_scaled_warning);
          v_material_warning_payload := v_material_warning_payload || jsonb_build_array(v_scaled_warning);
        else
          v_required_quantity := greatest(coalesce(v_material.quantity_per_unit, 0), 0)
            * greatest(v_scaled_value, 0);
        end if;
      else
        v_required_quantity := greatest(coalesce(v_material.quantity_per_unit, 0), 0)
          * greatest(coalesce(v_line.line_quantity, 0), 0);
      end if;
```
Declare `v_scaled_raw jsonb; v_scaled_value numeric; v_scaled_warning jsonb;`.

**Steps:** write static test (fail) → write migration → apply to local DB (`psql host=127.0.0.1 port=55432`) → run `supabase/tests/recipe_scaled_option_missing.sql` cases: (a) option value `3` → 3×q; (b) key missing → 0 + warning; (c) `"abc"` → 0 + warning; (d) `"2"` → 2×q; (e) unscaled line unchanged → q×line_qty → all pass → commit `fix(recipes): zero a scaled recipe line when its option count is missing`.

### 1b. iOS mirror (ops-ios worktree)

**Files:** `OPS/Services/RecipeResolver.swift`, `OPS/Services/CutListMaterializer.swift` (decoder), `OPS/Views/Estimates/**/LineItemEditSheet.swift` decoder twin (locate), `OPSTests/Catalog/RecipeResolverTests.swift`.

- Add `struct ResolverWarning: Equatable { let code: String; let productMaterialId: String; let productOptionId: String? }` and `func resolveDetailed(...) throws -> (materials: [ResolvedMaterial], warnings: [ResolverWarning])`; `resolve(...)` returns `resolveDetailed(...).materials` (source-compatible).
- Scaled branch: `.integer(n)` → `quantityPerUnit × n`; anything else (missing, `.selectId`, `.boolean`) → quantity 0 + warning `scaled_option_value_missing`.
- Decoder: check `CFGetTypeID(raw as CFTypeRef) == CFBooleanGetTypeID()` **before** `as? Int` so JSON `true` never becomes `.integer(1)`; Double branch requires integral value in both decoders.
- Tests (write first): missing option → 0 + warning; `.boolean(true)` on scaled line → 0 + warning; existing `test_scaledByOption_replacesLineQuantityScaling` still passes; decoder: `{"a": true, "b": 1, "c": 2.0, "d": 2.5}` → boolean, integer(1), integer(2), absent.
- Commit `fix(recipes): zero a scaled cut-list line when its option count is missing`.

### 1c. Web editor materializes defaults (ops-web worktree)

**Files:**
- Modify: `src/lib/products/product-configuration-resolver.ts` — `ConfiguredOptionValue = string | number | boolean`; per-kind resolution (select as today; integer: accept number or integer string, emit number, label `Name: n`; boolean: accept bool or `"true"/"false"`, emit bool, label `Name: Yes/No`); defaults parsed from `defaultValue` text.
- Modify: `src/components/ops/product-configuration-fields.tsx` (controls read/write number/bool), `src/components/ops/line-item-editor.tsx` (state types), `src/lib/api/services/estimate-service.ts` + invoice mapping types, `src/lib/estimates/estimate-draft-validation.ts` if typed, any `Record<string, string>` configured-options type in the save path.
- Ensure defaults are materialized even if the configuration fields never mount: `selectProduct` resolves configuration from fetched options before the line enters state, or save path re-resolves. Verify by test, not by reading.
- Tests (first): resolver emits `{select: id, integer: 1, boolean: true}` from defaults `"Black"`, `"1"`, `"true"`; explicit override wins; `"abc"` integer default on required option → missing; round-trip `mapLineItemToDb` keeps number/bool; a line created with the Canpro option set and no edits carries all 9 keys.
- Run: `npx vitest run src/lib/products src/components/ops tests/integration/configured-estimate-line.test.ts tests/unit/ops` + `npx tsc --noEmit` (compare against main's baseline error count).
- Commit `fix(estimates): write every product option default onto new lines`.

## Task 2 — Canpro acceptance test on local DB

Planner-owned. Local Postgres 17 at `127.0.0.1:55432` (schema-only restore of prod `public, private, auth, extensions`; 52 restore errors, all unrelated: pgvector / trigram / citext tables). Seed: Canpro catalog + product rows copied with a `company_id` filter (catalog data only, no customer PII), synthetic company/user/client/role rows, no `accounting_connections` rows (sync structurally disabled; pg_net/pg_cron absent).

Script `docs/artifacts/canpro-recipe-test/run.sql`, one transaction per scenario, `set local request.jwt.claims` to the synthetic user:
1. Draft estimate + one line: product `3efc9582…`, quantity 20, `configured_options` = Color Black id, Mount Side mount id, Height 42" id, Lag 3" id, Left ends 1, Right ends 1, Corners 1, 45° corners 0, Wall returns 0.
2. `select public.accept_estimate_to_job(estimate_id, 'canpro-test-1')`.
3. Dump `booking_projection_result` demands (variant name + options, required quantity) and every warning code.
4. Scenario B (proves Task 1): same line with integer keys omitted, before and after the migration.
5. Scenario C (proves Task 4): line built from the iOS bridge output fixture.

Report actual vs doc table.

## Task 3 — Capability key alignment (ops-web)

**Files:** `src/lib/catalog-setup/phase-c/__fixtures__/canpro-desired.ts`, `src/lib/catalog-setup/phase-c/action-payload-contracts.ts` (capability binding + quantity rule payload schemas), `src/lib/catalog-setup/phase-c/__tests__/{reconcile-canpro,readback-verifier,deksmart-desired,semantic-validator}.test.ts`, new migration `supabase/migrations/20260915221000_capability_binding_key_format.sql`.
- Replace every `deck_geometry/v1` with `deck-geometry/v1`.
- Payload validator: `capabilityKey` must be a key of the ops capability registry (import the registry's ref list; no second copy); `measureSource` on `cut_plan` must be a registered capability ref.
- Test first: binding with `deck_geometry/v1` → `unsupported_action_payload`; `deck-geometry/v1` passes payload validation.
- Migration: `alter table public.catalog_product_capability_bindings add constraint catalog_product_capability_bindings_key_format check (capability_key ~ '^[a-z0-9]+(-[a-z0-9]+)*/v[0-9]+$') not valid; validate constraint …;`
- Commit `fix(catalog): key capability bindings by the registry ref`.

## Task 4 — Railing takeoff → line item bridge (ops-ios)

**Files:**
- Create: `OPS/DeckBuilder/Engine/RailingTakeoff.swift` — pure `RailingTakeoff.compute(data: DeckDrawingData) -> [RailingTakeoff.Group]` with `railingType, linearFeet, leftEnds, rightEnds, corners, offAngleCorners, houseReturns, handednessBasis`.
- Modify: `OPS/DeckBuilder/Engine/ComponentEmitter.swift` — railing components per D5 (keep gates/post_set/stair emission unchanged; keep existing per-edge LF deductions).
- Modify: `OPS/Services/DesignToEstimateAdapter.swift` — integer option name matching per D5 (after `$design.` source, before `default_value`).
- Test: `OPSTests/DeckBuilder/RailingTakeoffTests.swift`, extend `OPSTests/Catalog/DesignToEstimateAdapterTests.swift`.
- Required cases: single straight 20 ft edge (L1 R1 C0); 10 ft + 10 ft with 90° convex corner (L1 R1 C1, LF 20); U shape (L1 R1 C2); 135° vertex (45°: 1, L2 R2); straight-through 2 edges at 178° (L1 R1 C0); closed railing loop of 4 edges (L0 R0 C4); chain end on a house_edge vertex (houseReturns 1, ends unchanged); stair opening on an edge (LF − width, L+1 R+1); two railing types → two groups; house edges and edges without `railingConfig` ignored; inside corner on an L-shaped footprint (L+1 R+1, C0).
- Adapter test: Canpro-shaped options (4 selects, 5 integers) + the 10+10 corner drawing → quantity 20, Left ends 1, Right ends 1, Corners 1, 45° corners 0, Wall returns = default 0; encoded JSON from `CatalogEstimateMerger.encodeConfiguredOptions` written to `docs/artifacts/railing-bridge/canpro-corner-line.json` for Task 2 scenario C.
- Build/test: worktree-local `-derivedDataPath` and `-clonedSourcePackagesDirPath .spm-local`, copy `OPS/Utilities/Secrets.xcconfig`; run the three test classes.
- Commit `feat(deck-builder): write railing ends and corners onto the estimate line`.

## Task 6 — MCP recipe read (ops-web)

**Files:** `src/lib/agent-control-plane/services/p2/catalog/sql/agent_catalog_reads.body.sql`, new migration redefining `private.agent_p2_catalog_detail_v1`, `src/lib/agent-control-plane/contracts/catalog-purchasing.ts` (`CatalogRecipeRelationshipSchema`), read-capability definition + manifest revision, docs dictionaries, tests.
- Recipe row adds: `family_ref` (`catalog_item_id`), `variant_selector` (object, `content_kind` untrusted), `quantity_per_unit` (decimal string, 4dp — keep `quantity_milliunits` for compatibility), `scaled_by` `{option_ref, option_name}` or null, `quantity_basis` `"per_product_unit" | "per_option_count"`.
- Per product (deduplicated within the result): `product_options[]` `{option_ref, name, kind, required, affects_recipe, default_value, values[{value_ref, value}]}` capped with the existing bound.
- New manifest revision + exposure V24 (tools unchanged from V23 for this task); token resolver allowlist migration adds V24.
- Tests first: SQL body contract test, zod schema accepts the Canpro EPL row, manifest/exposure tests.
- Commit `feat(mcp): show recipe selectors, scaling and product options on catalog items`.

## Task 5 — MCP catalog write tools (ops-web, after Task 6)

Specified in a dedicated plan `docs/plans/2026-09-15-mcp-catalog-setup-writes.md`, written by the planner after Task 6 lands (it depends on V24's shape). Order: create variant (opening quantity as a receive stock event, thresholds in whole units, price required when family has no default, reject duplicate option-value set) → set thresholds → set price (family or variant) → set supplier cost profile (default flip in one transaction) → create option + values with required backfill value for existing variants.

---

## Verification gate before reporting

- ops-web: targeted vitest suites green, `tsc --noEmit` no new errors vs `origin/main` baseline.
- ops-ios: RecipeResolverTests, RailingTakeoffTests, DesignToEstimateAdapterTests, CatalogEstimateMergerTests green.
- Local DB: Task 2 report with actual vs expected and warning codes, scenarios A/B/C.
- Bible: `ops-software-bible` recipe engine section updated (warning code, configured_options shape, railing bridge, capability key).
