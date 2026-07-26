# Phase C Guided Catalog and Inventory Onboarding Implementation Plan

> **For implementing agent:** REQUIRED SKILL: Use `custom-skills:executing-plans` to execute this plan task-by-task.

**Goal:** Replace the one-shot catalog suggestion lane with a durable Phase C interview that reconciles the live catalog, creates a complete quote/material/task system after explicit approval, verifies the result, and then hands off to a separate idempotent opening-inventory importer.

**Architecture:** Keep `/catalog/setup` as the single entry point, but make a server-owned guided session the source of truth. The model may extract facts and propose questions/actions; deterministic Zod validators, live reconciliation, permission checks, content hashes, and company-scoped Postgres RPCs own every write. The existing manual/template/upload/QuickBooks lanes remain available as secondary setup methods. Quoting consumes the same normalized Product option and material-mapping contracts so color, minimum charge, tax, task type, and recipe selection survive into signed estimate lines.

**Tech stack:** Next.js App Router, React 19, TypeScript, Zod, Zustand, TanStack Query, OpenAI JSON schema output, Supabase/Postgres/RLS/RPC, Vitest, Testing Library, Playwright, Framer Motion.

**Design sources:** `.interface-design/system.md`, `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`, `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/colors_and_type.css`.

**Required skills while executing:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ops-design`, `custom-skills:wizard-audit`, `ops-copywriter:ops-copywriter`, `animation-studio:animation-architect`, `animation-studio:web-animations`, `supabase:supabase`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`.

**Approved design:** `docs/superpowers/specs/2026-07-24-phase-c-guided-catalog-and-inventory-onboarding-design.md`

---

## Execution constraints

- Do not mutate live Canpro data until the implementation, automated checks, a dry-run readback, and Jackson's explicit production-write approval are all complete.
- Fetch the live Supabase schema before writing each migration or RPC; do not rely on generated types alone.
- Preserve existing product, family, variant, option, and task-type IDs whenever a live match exists.
- Never invent a supplier SKU, cost, catalog ID, task-type ID, or option mapping.
- The browser never sends an arbitrary executable action plan. The server persists the validated plan; commit RPCs load it by session ID and approval hash.
- Every migration is additive except the narrowly scoped, identity-preserving data mutations performed inside the approved commit RPC.
- Keep legacy setup lanes working and covered while Phase C becomes the default guided path.

---

### Task 1: Lock the durable data contract with migration tests

**Files:**

- Create: `supabase/migrations/20260724170000_phase_c_catalog_onboarding_foundation.sql`
- Create: `tests/unit/supabase/phase-c-catalog-onboarding-foundation-migration.test.ts`
- Modify: `src/lib/types/database.types.ts`
- Modify: `ops-software-bible/03_DATA_ARCHITECTURE.md`

**Step 1: Write the failing migration contract test**

Assert the migration contains:

- `catalog_guided_setup_sessions`
- `catalog_guided_setup_actions`
- `catalog_setup_verification_items`
- `catalog_supplier_cost_profiles`
- `product_material_quantity_rules`
- `catalog_product_capability_bindings`
- `catalog_inventory_imports`
- `catalog_inventory_import_rows`
- company indexes, unique idempotency constraints, updated-at triggers, RLS, and restricted grants
- session statuses `interviewing | review | approved | committing | attention | complete | abandoned`
- action statuses `planned | running | committed | verified | failed`
- import statuses `draft | review | committing | attention | complete | abandoned`

Run:

```bash
npx vitest run tests/unit/supabase/phase-c-catalog-onboarding-foundation-migration.test.ts
```

Expected: FAIL because the migration does not exist.

**Step 2: Implement the additive schema**

Use JSONB only for versioned structured documents:

```sql
catalog_guided_setup_sessions:
  facts, sources, unresolved_questions, contradictions,
  live_snapshot, proposed_plan, validation_issues,
  commit_journal, readback

catalog_guided_setup_actions:
  action_key, action_hash, action_type, target_kind,
  target_id, request, response, error
```

Store queryable identities in typed columns: company, operator, session, source hash, row fingerprint, matched variant, status, timestamps, and commit operation ID.

`catalog_supplier_cost_profiles` holds standard/alternate purchasing costs without overwriting `catalog_variants.unit_cost_override`:

```sql
(company_id, catalog_variant_id, profile_key) unique
profile_key text
unit_cost numeric
is_default boolean
activation_rule jsonb
```

`product_material_quantity_rules` references one `product_materials` row and carries the generic calculation contract (`product_quantity`, `coverage`, `edge_length`, `cut_plan`) plus purchase rounding and fallback.

`catalog_product_capability_bindings` carries only the catalog-side seam (`deck_geometry/v1`, required inputs, fallback); it is not a system-wide capability registry.

**Step 3: Add generated-type parity**

Add exact Row/Insert/Update shapes and relationships to `database.types.ts`, including line-item snapshot fields already live but not represented by `LineItem`.

**Step 4: Run the focused test**

Expected: PASS.

**Step 5: Commit**

```bash
git add supabase/migrations/20260724170000_phase_c_catalog_onboarding_foundation.sql tests/unit/supabase/phase-c-catalog-onboarding-foundation-migration.test.ts src/lib/types/database.types.ts ops-software-bible/03_DATA_ARCHITECTURE.md
git commit -m "feat(catalog): add guided setup and inventory import foundation"
```

---

### Task 2: Define the Phase C fact, proposal, action, and readback contracts

**Files:**

- Create: `src/lib/catalog-setup/phase-c/types.ts`
- Create: `src/lib/catalog-setup/phase-c/schemas.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/schemas.test.ts`
- Modify: `src/lib/catalog-setup/agent/proposal-schemas.ts`

**Step 1: Write failing schema tests**

Cover:

- one `question` or one `review`, never both
- facts classified as customer product, customer option, staff-only choice, quote disclosure, pricing, material compatibility, purchasing, inventory, labor, task type, or specialized-tool input
- provenance `live_ops | operator | upload | verified_supplier | calculation`
- confidence and contradiction references
- action groups `CREATE | REUSE | UPDATE | MERGE | ARCHIVE | NEEDS_INPUT`
- `taskTypeId`, storefront visibility, minimum charge, taxability, Product options, catalog mappings, material quantity rules, supplier cost profiles, and verification items
- unknown supplier SKUs remain `null`
- thickness cannot be emitted as a customer option when the product plan marks it staff-only

Run:

```bash
npx vitest run src/lib/catalog-setup/phase-c/__tests__/schemas.test.ts
```

Expected: FAIL.

**Step 2: Implement strict versioned Zod schemas**

The main turn result is:

```ts
type CatalogAgentTurn =
  | { kind: "question"; question: GuidedQuestion; facts: CatalogFact[] }
  | { kind: "review"; blueprint: CatalogBlueprint; facts: CatalogFact[] };
```

All nested objects are `.strict()`. IDs are either verified UUIDs/client IDs or absent; no free-form ID-looking strings.

**Step 3: Keep old cards compatible**

Add an explicit adapter from the new flat-product subset to the existing `StagingCard` schema for deterministic/manual lanes. Do not make the Phase C blueprint fit inside the old three-card model.

**Step 4: Run tests and commit**

```bash
git add src/lib/catalog-setup/phase-c src/lib/catalog-setup/agent/proposal-schemas.ts
git commit -m "feat(catalog): define Phase C setup contracts"
```

---

### Task 3: Build a complete company-scoped live catalog snapshot

**Files:**

- Create: `src/lib/catalog-setup/phase-c/live-catalog-context.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/live-catalog-context.test.ts`
- Create: `src/app/api/catalog/setup/sessions/route.ts`
- Create: `src/app/api/catalog/setup/sessions/__tests__/route.test.ts`
- Modify: `src/lib/catalog-setup/session-lock-service.ts`

**Step 1: Write failing context tests**

The loader must return active and soft-deleted:

- products and task links
- product options/values/modifiers
- product material rows and quantity rules
- families, axes, values, variants, joins
- product/catalog option mappings
- physical stock units
- supplier cost profiles
- categories, units, task types
- existing verification items and catalog capability bindings

It must filter every table to the verified company directly or through a company-owned parent.

**Step 2: Implement the loader using the request's access-token client**

Run independent reads in parallel, normalize decimals/dates, sort deterministically, and hash the canonical snapshot. Never pass unrelated customer data to the model.

**Step 3: Implement session start/resume**

`POST /api/catalog/setup/sessions`:

1. verifies Firebase token
2. resolves current operator/company
3. checks `catalog.view` and `catalog.run_setup`
4. resumes the operator/company's non-terminal session when safe
5. acquires the existing company setup lock
6. stores the initial live snapshot/hash
7. returns server capability availability plus the session

Do not hide the guided path behind `NEXT_PUBLIC_CATALOG_AGENT_ENABLED`; the route reports a recoverable unavailable state if server generation is not configured.

**Step 4: Verify**

```bash
npx vitest run src/lib/catalog-setup/phase-c/__tests__/live-catalog-context.test.ts src/app/api/catalog/setup/sessions/__tests__/route.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/catalog-setup/phase-c/live-catalog-context.ts src/lib/catalog-setup/phase-c/__tests__/live-catalog-context.test.ts src/app/api/catalog/setup/sessions/route.ts src/app/api/catalog/setup/sessions/__tests__/route.test.ts src/lib/catalog-setup/session-lock-service.ts
git commit -m "feat(catalog): start durable guided setup sessions"
```

---

### Task 4: Implement deterministic reconciliation and the Canpro acceptance fixture

**Files:**

- Create: `src/lib/catalog-setup/phase-c/reconcile.ts`
- Create: `src/lib/catalog-setup/phase-c/reference/deksmart.ts`
- Create: `src/lib/catalog-setup/phase-c/__fixtures__/canpro-vinyl.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/reconcile-canpro.test.ts`

**Step 1: Write the failing Canpro reconciliation test**

Fixture the observed live state:

- existing `Vinyl` family
- Type and Color axes
- 12 existing 68mil variant IDs
- two existing 60mil variant IDs
- one blank variant
- zero stock units/recipes/order/allocation references
- existing `Vinyl Install` task type ID

Expected plan:

- reuse and rename the family
- preserve 12 68mil IDs
- create seven missing 68mil colors
- create 60mil family and move the two existing IDs
- rebuild correct color joins
- retire Type after the move
- archive blank only after reference preflight
- reuse the task type
- create no duplicate normalized colors/families/task types

**Step 2: Implement stable matching order**

1. exact stable ID/external identity
2. normalized exact identity plus parent scope
3. fuzzy candidate that always becomes `NEEDS_INPUT`

Produce explicit action objects with expected source row fingerprints.

**Step 3: Add verified DekSmart reference data**

Store only the approved facts:

- 19 Ultra colors, two Smoothback colors
- known material SKUs
- package sizes/coverage
- standard and condo costs
- unknown membrane/clip SKUs as `null`

This is verified supplier reference data, not a Canpro-only preset. The Canpro company fixture remains test-only.

**Step 4: Run and commit**

```bash
npx vitest run src/lib/catalog-setup/phase-c/__tests__/reconcile-canpro.test.ts
git add src/lib/catalog-setup/phase-c
git commit -m "feat(catalog): reconcile guided plans against live catalog"
```

---

### Task 5: Turn the setup agent into a one-question-at-a-time catalog specialist

**Files:**

- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`
- Create: `src/lib/catalog-setup/phase-c/semantic-validator.ts`
- Create: `src/lib/catalog-setup/phase-c/conversation-reducer.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/conversation-reducer.test.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/semantic-validator.test.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/turn/route.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/turn/__tests__/route.test.ts`
- Modify: `src/lib/hooks/use-setup-agent.ts`

**Step 1: Write failing tests**

Prove:

- one unresolved high-value question per turn
- no question when live/operator/supplier facts already answer it
- contradictions block only affected actions
- staff/customer choices stay distinct
- agent cannot mark a blueprint reviewable while required task type, price, tax, minimum, visibility, mapping, or recipe compatibility is unresolved
- malformed output leaves prior facts/session intact

**Step 2: Implement model prompting**

Give the model:

- sanitized live snapshot summary
- structured facts/sources/contradictions
- verified supplier reference excerpts selected by exact product identity
- allowed action vocabulary
- explicit prohibition on writes and invented IDs/SKUs/costs

Use JSON-schema response output. The model proposes; `semantic-validator.ts` rejects unsafe or incomplete structures and `reconcile.ts` binds live IDs.

**Step 3: Persist every accepted turn**

The turn route uses optimistic session versioning, validates the answer, appends facts with provenance, recalculates unresolved questions, refreshes stale live reads when required, and stores either the next question or reviewable blueprint.

**Step 4: Run and commit**

```bash
npx vitest run src/lib/catalog-setup/phase-c/__tests__/conversation-reducer.test.ts src/lib/catalog-setup/phase-c/__tests__/semantic-validator.test.ts src/app/api/catalog/setup/sessions/[sessionId]/turn/__tests__/route.test.ts
git add src/lib/catalog-setup src/app/api/catalog/setup/sessions src/lib/hooks/use-setup-agent.ts
git commit -m "feat(catalog): add stateful Phase C setup interview"
```

---

### Task 6: Extend the payload builder for complete product/catalog plans

**Files:**

- Modify: `src/lib/catalog-setup/commit/payload-builder.types.ts`
- Modify: `src/lib/catalog-setup/commit/payload-builder.ts`
- Modify: `src/lib/catalog-setup/commit/card-to-builder-input.ts`
- Modify: `src/lib/catalog-setup/commit/__tests__/payload-builder.test.ts`
- Modify: `src/lib/catalog-setup/commit/task-types-commit.ts`
- Modify: `src/lib/catalog-setup/commit/task-types-commit.test.ts`

**Step 1: Add failing tests**

Require wire support for:

- `task_type_id` and `task_type_ref`
- arbitrary select options/values without price modifiers
- catalog axes/values and variant joins
- catalog/product axis/value mappings
- family-pinned material selectors
- material quantity rules
- supplier cost profiles
- capability bindings
- nullable supplier SKUs
- exact task-type reuse and returned ID linking in the same plan

**Step 2: Extend pure builder types and mappings**

Keep the current flat/tier behavior. Add a complete Phase C `ExecutionPlanInput` builder rather than overloading `StagingCard`.

The standard vinyl product must serialize:

```ts
{
  name: "Vinyl membrane installation",
  basePrice: 11.73,
  pricingUnit: "sqft",
  unitCost: 2.00,
  minimumCharge: 1500,
  isTaxable: true,
  showInStorefront: true,
  taskTypeId: existingVinylInstallId,
  options: [{ name: "Color", affectsRecipe: true, values: ultraColors }],
}
```

The 60mil product has no thickness option, has `showInStorefront: false`, states 60mil in its name/quote disclosure, and carries `$12.73`, `$2.25`, `$1,500`, taxable.

**Step 3: Run and commit**

```bash
npx vitest run src/lib/catalog-setup/commit
git add src/lib/catalog-setup/commit
git commit -m "feat(catalog): build complete guided catalog execution plans"
```

---

### Task 7: Add the company-scoped preflight and catalog commit RPC

**Files:**

- Create: `supabase/migrations/20260724171000_phase_c_catalog_commit_rpc.sql`
- Create: `tests/unit/supabase/phase-c-catalog-commit-migration.test.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/review/route.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/commit/route.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/commit/__tests__/route.test.ts`
- Modify: `src/lib/catalog-setup/commit/completion-notification.ts`

**Step 1: Write failing SQL and route tests**

The contract must prove:

- SECURITY INVOKER and current-company derivation
- `catalog.run_setup` recheck in database or equivalent existing permission helper
- row/session locks
- approval hash and snapshot fingerprint checks
- allowlisted action types
- action-level content-addressed idempotency
- identity-preserving variant re-parent
- broad blank-variant reference preflight
- exact task-type reuse/create/link
- all-or-recoverable execution journal
- readback verification before session `complete`
- replay returns the prior verified response

**Step 2: Implement review**

Review refreshes the live context and returns an exact diff if the snapshot changed. A stable review stores the canonical plan hash and changes the session to `review`.

**Step 3: Implement commit RPC**

The RPC loads the server-stored plan by session ID and approval hash. It never executes action JSON supplied by the browser. For each action:

1. verify source fingerprint and company ownership
2. reuse a verified journal result or execute
3. write/verify the target
4. mark the action verified

The family split occurs in one database transaction. Cross-domain failures preserve the journal and set `attention`; the next call resumes only unverified actions.

**Step 4: Implement route and completion side effects**

The route:

- verifies actor and permissions
- invokes the access-token RPC
- performs a full readback
- sends `CATALOG READY` notification only on complete
- returns exact partial state and `FINISH SETUP` when attention is required

**Step 5: Run and commit**

```bash
npx vitest run tests/unit/supabase/phase-c-catalog-commit-migration.test.ts src/app/api/catalog/setup/sessions/[sessionId]/commit/__tests__/route.test.ts
git add supabase/migrations/20260724171000_phase_c_catalog_commit_rpc.sql tests/unit/supabase/phase-c-catalog-commit-migration.test.ts src/app/api/catalog/setup/sessions src/lib/catalog-setup/commit/completion-notification.ts
git commit -m "feat(catalog): commit and verify guided catalog plans"
```

---

### Task 8: Replace the one-shot conversation with the durable Phase C UI

**Files:**

- Create: `src/components/catalog-setup/phase-c/GuidedCatalogSetup.tsx`
- Create: `src/components/catalog-setup/phase-c/GuidedQuestionPane.tsx`
- Create: `src/components/catalog-setup/phase-c/BlueprintReview.tsx`
- Create: `src/components/catalog-setup/phase-c/ActionGroup.tsx`
- Create: `src/components/catalog-setup/phase-c/CatalogReadyPane.tsx`
- Create: `src/components/catalog-setup/phase-c/__tests__/guided-catalog-setup.test.tsx`
- Modify: `src/components/catalog/setup/catalog-setup-route.tsx`
- Modify: `src/components/catalog-setup/setup-wizard-shell.tsx`
- Modify: `src/components/catalog-setup/DriverPane.tsx`
- Modify: `src/stores/catalog-setup-store.ts`
- Modify: `src/i18n/dictionaries/en/catalog-setup.json`
- Modify: `src/i18n/dictionaries/es/catalog-setup.json`

**Step 1: Write failing component tests**

Cover:

- guided path is visible whenever permissions allow, without a public env flag
- session resumes after remount
- one question at a time
- sources/confidence/contradictions are understandable but quiet
- review groups exact actions and unresolved items
- only one accent CTA: `CREATE CATALOG` or `FINISH SETUP`
- no writes before click
- success text and inventory handoff
- malformed/failed/offline/changed-live-state recovery
- keyboard/focus/44px target/reduced-motion behavior
- i18n parity

**Step 2: Implement the screen hierarchy**

Keep the two-pane workbench:

- left: current Phase C question or source input
- right: live blueprint/reconciliation as it becomes known
- secondary `OTHER SETUP METHODS` entry for upload/template/manual/QuickBooks

No chat bubble theater. The conversation is a focused decision flow. The action review uses compact rows, not cards for every database object.

**Step 3: Implement motion**

- 200ms pane entry
- 250ms question → review/success transition
- canonical `[0.22, 1, 0.36, 1]`
- opacity-only 150ms reduced-motion fallback
- no spring, bounce, or new package

**Step 4: Verify and commit**

```bash
npx vitest run src/components/catalog-setup/phase-c src/components/catalog/setup src/lib/catalog-setup/__tests__/catalog-setup-i18n.test.ts
git add src/components/catalog-setup src/components/catalog/setup src/stores/catalog-setup-store.ts src/i18n/dictionaries
git commit -m "feat(catalog): ship durable Phase C guided setup UI"
```

---

### Task 9: Make configurable products resolve correctly on web estimates

**Files:**

- Create: `src/lib/products/product-configuration-resolver.ts`
- Create: `src/lib/products/__tests__/product-configuration-resolver.test.ts`
- Create: `src/lib/api/services/product-configuration-service.ts`
- Create: `src/lib/hooks/use-product-configuration.ts`
- Create: `src/components/ops/product-configuration-fields.tsx`
- Modify: `src/components/ops/line-item-editor.tsx`
- Modify: `src/components/ops/create-estimate-modal.tsx`
- Modify: `src/lib/types/pipeline.ts`
- Modify: `src/lib/api/services/estimate-service.ts`
- Create: `tests/integration/configured-estimate-line.test.tsx`

**Step 1: Write failing resolver/integration tests**

Prove:

- selecting a product loads required options and defaults
- Color is selectable and snaps to `configured_options`
- no Thickness option appears
- standard product unit price is `$11.73`
- 60mil product is staff-selectable, visibly says 60mil, and uses `$12.73`
- `minimum_charge` floors the pre-tax line total at `$1,500`
- task type/ref, unit cost, unit, type, selected options, resolved price, and label are snapshotted
- later product edits do not alter saved estimate lines

**Step 2: Implement the pure resolver**

```ts
resolveProductConfiguration({
  product,
  options,
  values,
  modifiers,
  configuredOptions,
  quantity,
}) => {
  unitPrice,
  extendedBeforeMinimum,
  lineTotalBeforeTax,
  resolvedOptionsLabel,
  configuredOptions,
}
```

Apply `minimumCharge` after quantity and discount, before tax. Preserve signed-line snapshot fields.

**Step 3: Extend line-item types/service**

Add `configuredOptions`, `resolvedUnitPrice`, and `resolvedOptionsLabel` to `LineItem`, `LineItemRow`, Create/Update mappings, and portal/display readers.

**Step 4: Build the option controls**

Render only required product choices. For vinyl, that is Color. The 60mil distinction lives in the product identity/name, never a customer option.

**Step 5: Run and commit**

```bash
npx vitest run src/lib/products/__tests__/product-configuration-resolver.test.ts tests/integration/configured-estimate-line.test.tsx
git add src/lib/products src/lib/api/services/product-configuration-service.ts src/lib/hooks/use-product-configuration.ts src/components/ops/product-configuration-fields.tsx src/components/ops/line-item-editor.tsx src/components/ops/create-estimate-modal.tsx src/lib/types/pipeline.ts src/lib/api/services/estimate-service.ts tests/integration/configured-estimate-line.test.tsx
git commit -m "feat(estimates): resolve catalog options and minimum charges"
```

---

### Task 10: Apply the company's default GST rate in estimate creation

**Files:**

- Create: `src/lib/api/services/tax-rate-service.ts`
- Create: `src/lib/hooks/use-tax-rates.ts`
- Create: `src/lib/tax/__tests__/default-tax-rate.test.ts`
- Modify: `src/components/ops/create-estimate-modal.tsx`
- Modify: `src/lib/api/services/estimate-service.ts`
- Modify: `src/lib/hooks/index.ts`

**Step 1: Write the failing tax test**

For a taxable `$1,500` minimum line and a default active GST rate of `0.05`, assert:

- subtotal `$1,500`
- tax `$75`
- total `$1,575`
- estimate `tax_rate = 0.05`
- non-taxable lines do not contribute

Normalize legacy whole-percent values defensively only when the live schema/readback proves they exist.

**Step 2: Implement default-rate loading and totals**

Use the company's active default tax rate. If none exists, show a visible configuration blocker instead of silently claiming GST.

**Step 3: Run and commit**

```bash
npx vitest run src/lib/tax/__tests__/default-tax-rate.test.ts tests/integration/configured-estimate-line.test.tsx
git add src/lib/api/services/tax-rate-service.ts src/lib/hooks/use-tax-rates.ts src/lib/tax src/components/ops/create-estimate-modal.tsx src/lib/api/services/estimate-service.ts src/lib/hooks/index.ts
git commit -m "fix(estimates): apply company default tax rate"
```

---

### Task 11: Implement the catalog-side OPS Tools seam and deck-geometry fallback

**Files:**

- Create: `src/lib/catalog-setup/capabilities/catalog-capability-manifest.ts`
- Create: `src/lib/catalog-setup/capabilities/deck-geometry.ts`
- Create: `src/lib/catalog-setup/capabilities/__tests__/deck-geometry.test.ts`
- Create: `src/components/ops/deck-geometry-fields.tsx`
- Modify: `src/components/ops/product-configuration-fields.tsx`
- Modify: `src/lib/types/pipeline.ts`
- Modify: `src/lib/api/services/estimate-service.ts`

**Step 1: Write failing capability tests**

Prove:

- enabled Deck Designer output supplies finished area, cut plan, exposed edges, wall/parapet edges
- unavailable capability falls back to manual deck dimensions
- multiple rectangular decks produce summed surface area and per-deck cuts
- no MCP terminology reaches UI
- persisted configuration remains structured under the estimate-line snapshot

**Step 2: Implement the small catalog manifest**

Expose `deck_geometry/v1` only to products with a binding. Label the UI `// OPS TOOLS`. This is a local capability seam, not the postponed system-wide registry.

**Step 3: Implement manual dimensions**

Allow one or more deck rectangles; compute finished area deterministically and let the operator edit edge classifications. Keep cut planning read/calculate only.

**Step 4: Run and commit**

```bash
npx vitest run src/lib/catalog-setup/capabilities/__tests__/deck-geometry.test.ts tests/integration/configured-estimate-line.test.tsx
git add src/lib/catalog-setup/capabilities src/components/ops/deck-geometry-fields.tsx src/components/ops/product-configuration-fields.tsx src/lib/types/pipeline.ts src/lib/api/services/estimate-service.ts
git commit -m "feat(catalog): connect deck geometry to configured products"
```

---

### Task 12: Build the separate Inventory Import draft pipeline

**Files:**

- Create: `src/lib/catalog-inventory-import/types.ts`
- Create: `src/lib/catalog-inventory-import/schemas.ts`
- Create: `src/lib/catalog-inventory-import/parse-text.ts`
- Create: `src/lib/catalog-inventory-import/normalize.ts`
- Create: `src/lib/catalog-inventory-import/fingerprint.ts`
- Create: `src/lib/catalog-inventory-import/match.ts`
- Create: `src/lib/catalog-inventory-import/__tests__/parse-normalize.test.ts`
- Create: `src/lib/catalog-inventory-import/__tests__/fingerprint.test.ts`
- Create: `src/lib/catalog-inventory-import/__tests__/canpro-rows.test.ts`
- Create: `src/app/api/catalog/inventory-imports/route.ts`
- Create: `src/app/api/catalog/inventory-imports/[importId]/review/route.ts`

**Step 1: Write failing parser/normalizer tests**

Cover XLSX/CSV/pasted text and:

- full roll
- precut
- offcut
- full/partial adhesive pail
- 8ft flashing stick
- 10ft clip stick
- quarter-pail round-down
- full-stick-only import
- default `Canpro Shop`
- exact SKU/family/color match
- ambiguity never auto-approved
- same file/sheet/normalized row fingerprint dedupes

**Step 2: Reuse existing safe parsers**

Reuse `parseCsv` and lazy `parseXlsx`. Store immutable source rows and normalized drafts server-side. Deterministic exact matching runs before any agent suggestion.

**Step 3: Add draft/review routes**

Require catalog/inventory view access to draft. Hash the raw source, preserve every failed row, and return prior import state on a duplicate source hash.

**Step 4: Run and commit**

```bash
npx vitest run src/lib/catalog-inventory-import src/app/api/catalog/inventory-imports
git add src/lib/catalog-inventory-import src/app/api/catalog/inventory-imports
git commit -m "feat(inventory): draft and match opening inventory imports"
```

---

### Task 13: Commit opening inventory idempotently

**Files:**

- Create: `supabase/migrations/20260724172000_catalog_inventory_import_commit_rpc.sql`
- Create: `tests/unit/supabase/catalog-inventory-import-commit-migration.test.ts`
- Create: `src/app/api/catalog/inventory-imports/[importId]/commit/route.ts`
- Create: `src/app/api/catalog/inventory-imports/[importId]/commit/__tests__/route.test.ts`

**Step 1: Write failing RPC/route tests**

Require:

- `inventory.manage` and `catalog.stock.adjust`
- actor/company derivation
- approved, unambiguous rows only
- source/import/action idempotency
- one stock-unit row per physical roll/precut/offcut
- pail fractions as `each` units with `full|partial`
- sticks as `length` units with full original/remaining length
- receive events
- mirrored variant quantity readback
- partial recovery journal
- persistent notification resolution
- second identical import changes nothing

**Step 2: Implement the RPC**

The browser approves normalized rows, but the RPC loads them from the company-owned import record and verifies their approval fingerprints. Use the existing physical-unit aggregation semantics.

**Step 3: Implement route/readback**

Return exact created units/events/quantity changes and unresolved rows. Never collapse a partially committed import into a generic failure.

**Step 4: Run and commit**

```bash
npx vitest run tests/unit/supabase/catalog-inventory-import-commit-migration.test.ts src/app/api/catalog/inventory-imports/[importId]/commit/__tests__/route.test.ts
git add supabase/migrations/20260724172000_catalog_inventory_import_commit_rpc.sql tests/unit/supabase/catalog-inventory-import-commit-migration.test.ts src/app/api/catalog/inventory-imports
git commit -m "feat(inventory): commit opening stock without duplicates"
```

---

### Task 14: Ship the Inventory Import UI and permanent catalog entry

**Files:**

- Create: `src/app/(dashboard)/catalog/inventory-import/page.tsx`
- Create: `src/components/catalog/inventory-import/InventoryImportRoute.tsx`
- Create: `src/components/catalog/inventory-import/InventorySourcePane.tsx`
- Create: `src/components/catalog/inventory-import/InventoryMatchReview.tsx`
- Create: `src/components/catalog/inventory-import/InventoryCommitSummary.tsx`
- Create: `src/components/catalog/inventory-import/__tests__/inventory-import-route.test.tsx`
- Modify: `src/components/catalog-setup/phase-c/CatalogReadyPane.tsx`
- Modify: `src/components/catalog/catalog-kebab.tsx`
- Modify: `src/components/catalog/modals/import-modal.tsx`
- Modify: `src/i18n/dictionaries/en/catalog.json`
- Modify: `src/i18n/dictionaries/es/catalog.json`
- Modify: `src/lib/navigation/route-registry.ts`

**Step 1: Write failing UI tests**

Cover:

- completion actions `UPLOAD LIST`, `ENTER MANUALLY`, `NOT NOW`
- permanent `Add opening inventory` entry
- XLSX/CSV/text inputs
- full dry-run preview
- unmatched/ambiguous row correction
- location override
- exact permission blocker while draft remains
- `ADD INVENTORY` is the only accent CTA
- duplicate file opens prior result
- partial recovery exposes `FINISH IMPORT`

**Step 2: Implement the focused import flow**

Use the same two-pane workbench and source→review→commit progression. Replace the misleading legacy `Import CSV` entry with the richer tool while preserving the old parser only as an internal fallback until all tests pass.

**Step 3: Run and commit**

```bash
npx vitest run src/components/catalog/inventory-import src/lib/catalog-setup/__tests__/catalog-setup-i18n.test.ts
git add src/app/\\(dashboard\\)/catalog/inventory-import src/components/catalog/inventory-import src/components/catalog-setup/phase-c/CatalogReadyPane.tsx src/components/catalog/catalog-kebab.tsx src/components/catalog/modals/import-modal.tsx src/i18n/dictionaries src/lib/navigation/route-registry.ts
git commit -m "feat(inventory): add reviewed opening inventory tool"
```

---

### Task 15: Prove the Canpro system end-to-end without touching production

**Files:**

- Create: `tests/integration/catalog-guided-setup-canpro.test.ts`
- Create: `tests/integration/catalog-inventory-import-canpro.test.ts`
- Create: `tests/e2e/phase-c-catalog-setup.spec.ts`
- Create: `tests/e2e/catalog-opening-inventory.spec.ts`
- Modify: `tests/e2e/helpers/catalog-setup-auth.ts`
- Modify: `playwright.config.ts`

**Step 1: Add authenticated fixture integration**

Use an isolated test company shaped like Canpro. Assert exact readback:

- two products, correct prices/costs/minimum/tax/storefront/task type
- no thickness option
- 19 + 2 colors exactly once
- existing IDs preserved/moved
- recipes mutually compatible
- standard/condo costs separate
- quantity rules and capability binding present
- zero opening inventory
- unresolved supplier identifiers visible

**Step 2: Add replay tests**

- identical catalog commit adds no rows
- lost-response retry returns prior verified result
- identical inventory import changes no quantity
- partial setup/import resumes from journal

**Step 3: Add quote path assertions**

Create standard and 60mil estimate lines; confirm color selection, disclosure, minimum, GST, and saved line configuration.

**Step 4: Run focused and full verification**

```bash
npx vitest run src/lib/catalog-setup src/lib/catalog-inventory-import src/lib/products tests/integration/catalog-guided-setup-canpro.test.ts tests/integration/catalog-inventory-import-canpro.test.ts tests/integration/configured-estimate-line.test.tsx
npx playwright test tests/e2e/phase-c-catalog-setup.spec.ts tests/e2e/catalog-opening-inventory.spec.ts --project=chromium
npm run type-check
npm run build
```

Expected: all pass.

**Step 5: Commit**

```bash
git add tests/integration/catalog-guided-setup-canpro.test.ts tests/integration/catalog-inventory-import-canpro.test.ts tests/e2e/phase-c-catalog-setup.spec.ts tests/e2e/catalog-opening-inventory.spec.ts tests/e2e/helpers/catalog-setup-auth.ts playwright.config.ts
git commit -m "test(catalog): prove Canpro guided setup and inventory import"
```

---

### Task 16: Audit design, copy, accessibility, bible, and production readiness

**Files:**

- Modify: `ops-software-bible/03_DATA_ARCHITECTURE.md`
- Modify: `ops-software-bible/04_API_AND_INTEGRATION.md`
- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md`
- Modify: `ops-software-bible/09_FINANCIAL_SYSTEM.md`
- Modify: `ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- Create: `docs/artifacts/catalog-phase-c-verification/README.md`

**Step 1: Run the required audits**

- `custom-skills:audit-design-system`: zero new hardcoded color/spacing/radius/font values; one accent CTA per state
- `custom-skills:wizard-audit`: refresh, offline, malformed output, permission change, concurrent session, stale review, lost response, duplicate import, partial commit
- `ops-copywriter:ops-copywriter`: terse product register, no emoji/exclamation points, no user-facing AI/MCP terminology
- accessibility: 44px interactive targets, focus order/rings, semantic status/error regions, contrast, reduced motion

**Step 2: Update the bible**

Document the exact tables, RPCs, route contracts, reconciliation order, task-type linkage, Product option/recipe semantics, quote snapshot behavior, capability seam, import lifecycle, and recovery rules.

**Step 3: Capture verification artifacts**

Put screenshots and concise command/readback evidence under `docs/artifacts/catalog-phase-c-verification/`, never the repository root.

**Step 4: Final local verification**

```bash
npm test -- --run
npm run type-check
npm run build
git diff --check
git status --short
```

**Step 5: Commit**

```bash
git add ops-software-bible docs/artifacts/catalog-phase-c-verification
git commit -m "docs(catalog): record guided setup runtime contracts"
```

**Step 6: Stop before production writes**

Report the verified local/test outcome, exact migration status, and the pending production action. Do not apply migrations, push `main`, deploy, or mutate Canpro until Jackson explicitly approves those production actions.
