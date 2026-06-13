# Catalog Setup Wizard — Design Spec

- **Status:** Design approved by Jackson 2026-06-13 — all open questions resolved (§17). Ready for writing-plans on go-ahead. Spec doc awaiting a commit-location decision (held off the contended primary checkout).
- **Date:** 2026-06-12 (brainstorm), refined 2026-06-13
- **Surface:** OPS-Web (logged-in product). Mirrors / shares data with the iOS Catalog tab.
- **Initiative:** `CATALOG WIZARD` (net-new feature). Spawns named `CATALOG WIZARD - P<phase>-<task#>`.
- **Gating dependency:** the P3-2 Catalog surface (`/catalog`, segments PRODUCTS + STOCK). Built and committed but **only** on the push-held `feat/web-overhaul` branch (worktree `ops-web-overhaul-p2-shell`); absent from `origin/main` and the primary checkout. The wizard cannot ship before that surface lands.
- **This document is a design spec only. No code is written from it until the implementation plan (writing-plans) is approved.**

---

## 1. The problem

A trades business owner signs up. Today, the Catalog tab greets them with two empty tables (`// NO PRODUCTS YET`, `// NO STOCK YET`) and no way in. Every estimate they will ever build rides on a price book that does not exist yet — and building it by hand means hundreds of rows of products, costs, prices, options, materials, and stock thresholds, entered through forms, before they get any value. That is exactly the wall an overwhelmed operator walks away from.

Meanwhile, most established shops already *have* this data — in QuickBooks, in a spreadsheet, in a photographed price sheet, in their head. Making them retype it is the wrong default.

**The Catalog Setup Wizard stands up a company's entire OPS operating system — price book, pricing logic, stock, trade & task types, estimate-line-item readiness — from whatever they already have, in minutes, without a single blank form when we can avoid one.**

It is a lifeline, not a tech demo. The test (per root CLAUDE.md): does it make a stressed owner feel like they just found the thing that gives them their business back?

## 2. Goals & non-goals

**Goals**
- Take a 0-products / 0-stock company to a real, priced, estimate-ready catalog in one guided session.
- Stand up the *whole operating system*: sellable products + the never-built optioned/tiered pricing, stock (when tracked), trade & task types, and estimate-line-item readiness.
- Default to **smart defaults over interrogation** — import, agent, and templates carry the load; typing is the last resort.
- Be **invited, never blocking**; resumable; safe to abandon and return.
- Reuse OPS's proven web wizard vocabulary, existing catalog services, and the idempotent commit pipeline — assemble, don't reinvent.
- Be on-system: military tactical minimalist, every element justified by "why this, for this user, at this moment."

**Non-goals (v1)**
- Replacing the day-2 Catalog management surface (the wizard sets up; the Catalog tab maintains).
- Sage catalog import (deferred — tracked in `bug_reports` `fd9052b8-4ece-42d7-8ed3-324ab9bc3df7`).
- A standalone iOS rebuild — iOS already ships three guided flows; this is the **web** wizard, sharing the same `catalog_*` data contract.
- Full power-user option/modifier authoring (integer/boolean options, multiply/per-count modifiers) — the wizard exposes the guided "price by option" tier ladder; the product editor owns the full matrix.

## 3. Decisions locked (with Jackson, 2026-06-13)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Scope of v1** | Whole operating system — sell + stock + trade/task types + estimate-line-item readiness. |
| 2 | **Defaults engine** | The agent generates it. |
| 3 | **Agent architecture** | A dedicated, narrow, **always-on Setup Agent** (suggest-only; owner approves every write), decoupled from gated Phase C. A thin per-trade template is the floor for offline / declined / failure. Phase C companies get the deeper autonomous agent layered on. |
| 4 | **Launch posture** | Invited, never blocking. Full-page first-run invitation on a 0/0 Catalog tab; resumable; gentle just-in-time nudge on first estimate with no products; "set up later" always available. |
| 5 | **Structural model** | **Conversation + live-building canvas** — one full-page surface; sources feed a shared accept/edit/reject staging canvas; one "build it" commit. |
| 6 | **Import scope** | QuickBooks now; Sage as a fast-follow. Import generalizes to *any source* (connected book, spreadsheet, document/photo, conversation, template, manual). |

Seven further design questions were resolved 2026-06-13 — see **§17** (Setup Agent ungated for all; show-diff dedupe; doc/photo extraction in v1; merge the QB read-only branch; plaintext-token pre-ship gate; trade picker + CHECK widening; company-scoped completion).

## 4. Verified landscape (what's real)

All claims below verified against live prod (`ijeekuhbatykdomumfjx` / `ops-app`) and current code during the 2026-06-13 recon.

**Catalog surface (the host).** `/catalog` with two segments — PRODUCTS (price book: inline cost/price/margin, NO-COST worklist, config counts) and STOCK (variant-aware buy-run triage) — under a 3-tile SUPPLY strip. Full product editor at `/catalog/products/[id]`. Per-segment empty states exist; **no catalog-wide first-run orchestration and no wizard hook** — that surface is net-new. Lives only on `feat/web-overhaul`.

**Two product systems, one mental trap.** A *quoting* side — `products` + `product_options` + `product_option_values` + `product_pricing_modifiers` + `product_materials` + `product_bundle_items` → estimates reference them via the shared `line_items` table (there is **no** `estimate_line_items` table). And a *stock* side — `catalog_items` → `catalog_variants` (with `catalog_options`/`catalog_option_values`/`catalog_variant_option_values`, `catalog_categories`, `catalog_units`, `catalog_tags`). Bridged by `catalog_product_option_mappings` + `products.linked_catalog_item_id`. **There is no single "catalog item" concept.** Rendering both systems as peer "add items" steps is the QuickBooks-and-Sage data-model-leak failure; the design must not do it.

**Greenfield reality.** `product_options` = **0 rows** and `product_pricing_modifiers` = **0 rows** across all of prod — nobody has ever authored an optioned/tiered product on any surface. `products` = 22, `catalog_variants` = 142, `task_types` = 196. Tenants: Canpro + Maverick.

**Pricing contract (settled, counterintuitive).** Tiers/variants are **not** a price column. To price "by size," write a `select` `product_option` + `product_option_values` + `add_flat` `product_pricing_modifiers` — exactly iOS `GuidedCatalogSetupModel.TierSpec`. `ProductConfigurationResolver` is the **only** read-consumed pricing path. `products.tiered_pricing` (jsonb) **exists** but is **dead** for pricing — never write it. (Memory note "`tiered_pricing_json` has no prod column" is imprecise: the column is `products.tiered_pricing`; the dead-for-pricing conclusion stands.) Recipes (`product_materials`) must pin a concrete `catalog_variant_id` (or a fully-resolvable `variant_selector`); a nil-selector family pin is silently dropped from the cut list.

**Baseline already seeded.** `initialize_company_defaults(p_company_id)` (idempotent, runs at company creation) seeds default `task_types` + units. The wizard operates on *higher* layers and must **read-merge**, never re-seed primitives.

**Inventory is opt-in.** `company_inventory_settings.inventory_mode` ∈ {`off`, `tracked`}. Stock/threshold steps are conditional on opt-in. Thresholds are columns at three levels (category / tag / variant), most-specific-wins — not a table.

**Types & trade.** The only types table is `task_types`. `projects.trade` is a CHECK enum of exactly `roofing|hvac|plumbing`. A trade-picker step requires **widening that CHECK — an additive but iOS-shared schema change.**

**Commit & setup infrastructure (already on prod).** `catalog_setup_save(p_company_id, p_idempotency_key, p_payload jsonb)` → idempotent, **merge-capable** bulk commit over the whole family + product tree (modes `create`/`edit`, client-supplied ids, `deleted_ids`, returns `id_map`/`counts`/`blockers`), backed by the `catalog_setup_save_requests` ledger (UNIQUE `(company_id, idempotency_key)`). `catalog_import_validate/apply` + `products_import_validate/apply` (validate-then-apply, SECURITY DEFINER, return row→id maps) — but these are **create-only and reject duplicate SKUs / unknown category_id/unit_id**, so they are the wrong commit for a merging wizard. Generic `wizard_states` + `wizard_analytics` tables exist (today iOS-defaulted: `platform='ios'`, text ids). `data_setup_requests` is a dormant paid white-glove path.

**Existing web wizard vocabulary (reuse, don't reinvent).** `task-types-wizard.tsx` (inline state machine + `createdIdsRef` idempotency), `email-setup-wizard.tsx` (Radix Dialog, clickable step bar), `comms-config-wizard` / onboarding `/setup` (full-page shells). `stepper-rail.tsx` (the only reusable multi-step primitive). `activate-step.tsx` (green stats completion screen). `industry-presets.ts` + `curated-colors.ts` (the preset-data shape). `CategoryPicker`, `UnitPicker`, `InlineCreate{Category,Unit}Dialog`. Persisted resume pattern: `useSetupStore` (Zustand `persist`). API shape: Firebase token → `verifyAuthToken` → `findUserByAuth` → service-role → idempotent RPC.

**iOS parity (the mental model to mirror).** `GuidedCatalogSetupFlow` = a 5-question plain-language survey → `BusinessProfile.setupModules` derives an ordered module plan (`assembly`/`services`/`goods`/`stock`) → per-module commit. The web wizard should pose the same questions and produce the same plan. iOS limits the guided path to the tier ladder and pushes full authoring to product detail (`ProductOptionAuthoringSheet`).

**Phase C gating.** Per-company `admin_feature_overrides` (live keys: `deck_builder`, `phase_c` only). Synthetic flag injection in `/api/feature-flags/route.ts` (on `feat/web-overhaul`). Client: `flagsReady && canAccessFeature('phase_c')`. Server: `AdminFeatureOverrideService.isAIFeatureEnabled(companyId,'phase_c')` (fail-closed). Suggest-then-act backbone: `approval-queue-service.ts` over `agent_actions`.

**Accounting / import.** OAuth connect on main (`accounting_connections`, `/api/integrations/quickbooks{,/callback}`, `AccountingTokenService`) — **tokens stored plaintext** (open security bug `7600a1a2-566b-4d11-82a9-db72e966ee85`). The merged sync (`sync-orchestrator.ts`) is **push-first** (writes clients/invoices/estimates/payments *into* QB) — the wizard must never touch it. A read-only Pull→Stage→Review→Apply engine exists but only on unmerged `feat/quickbooks-readonly-sync` (~272 behind main), and even there **importing the QB Item catalog into OPS products is explicitly out of scope** (verified: 0 of 340 staged QB lines kept item id/name). So the QB-item→catalog mapping, staging cards, and dedupe/merge are **net-new**. Sage has zero read/item plumbing — fully greenfield.

## 5. Mental model — organize by what they *sell*, not by the tables

The wizard never asks "add a product" next to "add a catalog item." It organizes around the operator's reality, lifted from iOS `BusinessProfile.setupModules`:

> *What do you sell? How do you charge? Do you carry materials? Do you count them?*

From those answers it derives an ordered **module plan**:
- **SELL** — what goes on an estimate (`products`), and how it's priced (flat, or by option/tier via `product_options` + `add_flat` modifiers). Always present.
- **STOCK** — the materials they carry (`catalog_items` → `catalog_variants`), with on-hand and reorder points. **Only if they track inventory.**
- **TYPES** — their trade and the task types that structure jobs (`task_types`; trade picker writes `projects.trade`). Already seeded → confirm/extend, not rebuild.

Stock and quoting are linked *for the user automatically* (`products.linked_catalog_item_id`, `catalog_product_option_mappings`, recipes via `product_materials`) — never surfaced as a separate "now link these two systems" chore.

## 6. Information architecture & launch

**Entry points** (state-aware, never blocking):
1. **First-run takeover.** A company with 0 products *and* 0 stock sees a full-page invitation **on `/catalog`** instead of the empty segment tables. Single primary CTA into the wizard; quiet "set up later" returns them to the (still-empty) catalog.
2. **Persistent re-entry.** Always reachable from a Catalog kebab/overflow action and from Settings. Resumes in progress.
3. **Just-in-time nudge.** The first time a user opens the estimate builder with no products, a non-blocking prompt offers to run setup — but lets them proceed regardless (precedent: `SetupInterceptionModal`, used here as a *nudge*, not a gate).

**Completion state.** Because catalog is **company-scoped** (existing `setup_progress` is user-scoped — a real divergence), completion is tracked at the company level: a `company_settings` flag (e.g. `catalog_setup_completed_at`) plus the always-honest "data exists" signal (the supply strip stops showing 0/0). On finish: a Sonner toast + a header-rail notification (reuse `setup_prompt`/`system`, or add a `catalog_ready` `NotificationType` — additive).

**Exit / abandon.** "Set up later" at any point. Partial progress persists (see §11). Nothing committed until the owner accepts cards and hits **build it** — abandoning leaves zero half-built rows (staging is client-side until commit).

## 7. The surface — conversation + live-building canvas

One full-page route (the heavier shell, like `comms-config-wizard` / onboarding `/setup` — not a cramped dialog, given the scope). Two panes:

- **Left — the driver.** The Setup Agent conversation by default. In fallback (offline / declined / agent unavailable), the *same* pane renders the deterministic survey questions as guided prompts. One pane, two drivers.
- **Right — the live-building canvas.** The operating system materializes here as the conversation/import progresses, grouped by module (SELL / STOCK / TYPES). Every proposed row is a card the owner can **accept / edit / reject**. A running counter (`N proposed · M added`). Nothing lands in the catalog until accepted; **build it** commits the accepted set.

A persistent module rail (SELL → STOCK → TYPES → REVIEW) shows progress. Stepper uses neutral fills (DESIGN.md: **no accent on steppers**); the single accent element is the primary CTA (**build it**).

This structure is the answer to the data-model trap: import, agent, template, and manual all feed **one** canvas, so the owner never sees "products vs catalog items" — they see *their stuff*, taking shape.

## 8. Sources → one canvas

"Import" is not "QuickBooks" — it is **bring what you already have, in whatever form.** The opening question is human: *"How do you want to start?"*

| Source | Lane | What it does | Status |
|--------|------|--------------|--------|
| **Connect QuickBooks** | structured pull | OAuth (reuse existing connect) → read-only pull of QB `Item` → mapped cards | connect EXISTS; item→catalog mapping NET-NEW |
| **Upload a spreadsheet (CSV/XLSX)** | deterministic mapper | port iOS `CatalogCSVMapper` (family-grouping, header alias auto-map, name→category/unit resolution) → cards | logic exists in Swift; web port NET-NEW |
| **Upload a document / photo** | agent extraction | the always-on Setup Agent reads a PDF price list / photo of a parts list / pasted text → cards | NET-NEW (agent capability) |
| **Describe it to the agent** | agent generation | conversational generate + enrich | NET-NEW (agent) |
| **Start from a template** | per-trade preset | the offline/decline floor — a curated per-trade starter the owner trims | preset content NET-NEW |
| **Add manually** | direct entry | reuse `ProductQuickAdd` / `AddStockDialog` / inline-create pickers | EXISTS |

Uploads **auto-route**: a clean CSV/XLSX goes to the deterministic mapper (exact, instant, free, handles hundreds of rows); a messy doc/photo goes to the agent. The owner never picks a lane — they just hand over what they have.

**Connect flow obeys the design-judgment rule.** One "import from your accounting software" action that **detects** the connected provider (the accounting connection already exists) and pulls — never the side-by-side QuickBooks/Sage peer cards the accounting page ships today (the canonical failure). Switch/disconnect lives behind a compact live badge.

## 9. The modules (what each writes, mapped to live tables)

### SELL (always)
Writes `products` (name, description, `default_price` = `base_price`, `unit_cost`, `sku`, `is_taxable`, `kind` ∈ service|material|package, `type` ∈ LABOR|MATERIAL|OTHER, `pricing_unit`). Optioned/tiered pricing writes `product_options` (`select`) + `product_option_values` + `add_flat` `product_pricing_modifiers` (base = lowest tier) — **never `tiered_pricing`.** Bundles → `product_bundle_items`. Estimate-line-item readiness is the *outcome* of a populated, priced `products` set — no separate step.

### STOCK (only if `inventory_mode='tracked'`)
Writes `catalog_items` (family) + `catalog_variants` (SKU: `quantity` on-hand, `unit_cost_override`/`price_override`, `warning_threshold`/`critical_threshold`, `unit_id`). Reorder points → variant thresholds (a single source reorder point fans into warning + an agent-derived critical). Recipes that draw stock down on sale → `product_materials` pinned to a concrete `catalog_variant_id`. If a stock-bearing item arrives but the company is `inventory_mode='off'`, the wizard surfaces a **one-time** "track inventory?" decision rather than silently dropping quantities.

### TYPES (confirm/extend)
Trade picker → `projects.trade` (requires the additive CHECK widening — confirmed, see §15). Proposed v1 trade list (extensible; anchored on the 8 bespoke DESIGN.md trade glyphs + the existing enum values): roofing, hvac, plumbing, electrical, flooring, masonry, drywall, concrete, cleaning, windows & doors — plus a general/other fallback. Final list to lock at plan time. Task types → confirm the seeded defaults, add trade-typical ones (`task_types`: display, color via `curated-colors`, is_default, display_order). No standalone "set up your types" interrogation — types are confirmed in context.

## 10. The Setup Agent

A **dedicated, narrow agent** whose only job is standing up the operating system. Not the broad Phase C autonomy stack.

- **Suggest-only.** It proposes cards; it never writes directly. The owner accepts/edits/rejects every row. This is the guardrail that makes ungating defensible.
- **Always-on (confirmed — Jackson 2026-06-13):** available to every company, because "agent generates it" is the chosen engine and the baseline must work for everyone. Only the deeper, autonomous Phase C agent layers on for `phase_c` companies (it can pre-stage a whole proposed catalog into the canvas, route through `agent_actions`).
- **Capabilities:** converse to generate/enrich; ingest an uploaded document/photo and extract rows; reorganize/cluster imported QB/CSV rows; propose options/tiers/recipes/types that import can't express.
- **Graceful degradation.** Offline / declined / failure → the same canvas runs on the deterministic survey + template + manual. The agent is never a hard dependency.
- **Framing.** Per OPS rules, **never labeled "AI"** in-product. Call it "guided setup" / "set it up for you" / describe the behavior. Audience language: subtrades / owner-operators / the trades / crews — never "contractor."
- **Model & implementation** (for the plan, not this spec): a server route that streams structured proposals (Claude via the Anthropic SDK / AI SDK), constrained to OPS catalog schemas; document/photo extraction via the model's vision/document input. Invoke `vercel:ai-sdk` / `claude-api` skills at build time.

## 11. Commit, persistence & resume

- **Commit:** the accepted set goes through **`catalog_setup_save`** (mode `edit`, client-supplied ids so it UPSERTs not double-creates, a stable session `idempotency_key` so a refresh/retry replays the cached response). **Not** `catalog_import_apply` (create-only, rejects dup SKUs). One atomic, idempotent, crash-safe call.
- **Vocabulary prerequisite:** `catalog_setup_save`/import RPCs reject unknown `category_id`/`unit_id`. The wizard auto-creates or maps categories/units (from QB account names, CSV columns, or trade defaults) **before** staging cards, so no card errors on commit.
- **Dedupe:** match imported rows against the live catalog on `lower(trim(sku))` (and name when SKU is absent) → a matched card defaults to **show-diff** (per-field accept; Jackson 2026-06-13), with merge-all and skip also offered, instead of a create that would hard-fail the DB unique index. Add nullable `external_source` + `external_id` columns (additive, iOS-safe) so re-imports re-sync instead of duplicating (avoids the won-conversion class of bug).
- **Persistence/resume:** persisted Zustand (the `useSetupStore` pattern) holds the in-progress canvas across refresh; "pick up where you left off?" on re-entry. Optionally reuse `wizard_states`/`wizard_analytics` (would need web-aware `platform`/id columns).

## 12. Permissions & gating

- **Baseline path = normal catalog RBAC.** Gate on granular permissions, never role names (`has_permission`, not `role IN (...)`). Likely `products.manage` (+ `inventory.manage` for stock steps, `calendar`/types perms for trade/task types as applicable).
- **New permission bit** (e.g. `catalog.run_setup`) must be **registered in `src/lib/types/permissions.ts`** or account-holders/company-admins (who derive perms from `ALL_PERMISSIONS`, not the DB) are silently denied.
- **Setup Agent:** ungated (confirmed) — no `phase_c` requirement, only the catalog RBAC above. The **deeper autonomous** layer stays `phase_c`-gated (`flagsReady && canAccessFeature('phase_c')` client; `isAIFeatureEnabled` server, fail-closed).
- **Import:** reuse/extend the `accounting` flag + a granular import permission; gate behind the plaintext-token fix before enabling beyond Canpro.

## 13. Design system & motion

Full-page **glass-surface** canvas on pure #000; inner modals **glass-dense**. Cake Mono Light UPPERCASE for step/module titles + buttons + badges (DESIGN.md names "wizard titles" explicitly, 28–32px), Mohave sentence-case body, **JetBrains Mono tabular-lining slashed-zero for all numbers/prices**. Accent `#6F94B0` on the single primary CTA + focus rings **only** — never on stepper, Back, toggles, tags, links. Controls from the spec ladder (36px standard buttons/inputs, radius 5; chips 4px) — **no touch targets on web**. Earth-tone semantics for state (olive=added/positive, tan=review/attention, rose=cost). Icons **lucide-react** only. Empty/zero = `—` or `$0`, never "N/A".

**Motion** (one curve `cubic-bezier(0.22,1,0.36,1)`, no spring/bounce, honor `prefers-reduced-motion`): step transitions ~250ms x-slide; card-accept = a brief olive confirm + count-up on the running totals; supply-strip numbers count up 800ms on completion. There is **no canonical wizard-stepper component** in `ui_kits/ops-web/` — the stepper + canvas card must be **mocked and approved before code** (§6 enforcement). Build-time gates: invoke `frontend-design` / `interface-design`, `animation-architect` + `web-animations`, `ops-copywriter`, and pass `audit-design-system`.

## 14. Copy (sample, OPS voice — to be finalized via ops-copywriter at build)

| Surface | String |
|---------|--------|
| First-run headline | `STAND UP YOUR CATALOG` |
| First-run sub | `Your price book, your stock, your trades — set up once, ready for every estimate.` |
| Source prompt | `How do you want to start?` |
| Agent opener | `What do you sell, and how do you charge for it?` |
| QB detected | `You're on QuickBooks. Pull your items in?` |
| Card states | `ACCEPT` · `EDIT` · `REJECT` · `MERGE` |
| Dup match | `Already in your catalog — merge or skip?` |
| Primary CTA | `BUILD IT` |
| Validation error | `// 3 ROWS NEED A PRICE` |
| Offline fallback | `[ OFFLINE — SWITCH TO GUIDED SETUP ]` |
| Completion (rail) | title `Catalog ready` · body `Your price book is live. 24 products, 12 in stock.` · action `OPEN CATALOG →` |
| Exit | `Set up later` |

Rules honored: sentence case for content / UPPERCASE for authority; `//` section + `[ ]` instructional prefixes; no emoji, no exclamation points; never "AI"; never "contractor".

## 15. Schema changes required (all additive / iOS-safe)

1. `products.external_source` (text, nullable) + `products.external_id` (text, nullable) — re-import identity/dedupe. Same on `catalog_items` (and/or `catalog_variants`) for stock re-sync.
2. New granular permission bit (`catalog.run_setup` or similar) — DB grant **and** `src/lib/types/permissions.ts` registration.
3. `company_settings.catalog_setup_completed_at` (timestamptz, nullable) — company-scoped completion.
4. **Widen `projects.trade` CHECK** beyond `roofing|hvac|plumbing` to the full trade list (confirmed) — additive but **shared with shipped iOS**; only safe as a CHECK expansion (never a rename/retype). Proposed list in §9; final list locks at plan time.
5. (Optional) `catalog_ready` value added to the `NotificationType` union (additive; iOS reads the same table).
6. (Import) plaintext-token remediation on `accounting_connections` — **pre-ship gate** for multi-tenant.

Per the iOS-sync constraint, only additive (nullable column / new table / CHECK expansion) changes are safe between App Store releases.

## 16. Failure modes & edge cases (wizard-audit, adapted to web)

**Prerequisites.** Company exists; baseline `initialize_company_defaults` ran (task_types/units present → read-merge); the `/catalog` surface (P3-2) is deployed; only one setup session at a time per company; not in an expired-subscription lockout.

**Role / permission matrix.** Account-holder / company-admin: full run. Office (with `products.manage`): full run. Operator/crew (scoped, no manage): wizard hidden or read-only — they never hit a dead "build it". Every step's required permission is checked up front (compound gate), not just the wizard-level bit — a step that needs `inventory.manage` is auto-skipped/hidden for someone without it (no hard stall).

**Per-step / per-card war-game.**
- **Required-field stalls.** A product needs a name + price to be valid; a stock variant needs a unit; RPCs reject unknown category/unit. The wizard pre-resolves vocabulary and blocks **build it** with a precise message (`// 3 ROWS NEED A PRICE`) rather than a silent disabled button.
- **Duplicate on commit.** DB unique indexes hard-reject dup SKUs. Mitigated by SKU/name match → merge/skip/diff *before* commit; commit via merge-capable `catalog_setup_save`, not create-only apply.
- **Re-run.** Running the wizard again on a populated catalog must merge, not double-create (external_id + SKU match). Completion flag flips re-entry to "add more / edit", not a fresh takeover.
- **Partial completion + resume.** Refresh/navigate-away/app-background mid-session restores the staged canvas (persisted store). Nothing committed until **build it**, so an abandon leaves zero rows.
- **Skip.** "Set up later" and per-module skip; skipped modules leave honest empty states, not half-built data.
- **Agent off.** No `phase_c` (and if Setup Agent stays gated): the deterministic survey + template + manual stand alone. The wizard is fully functional with the agent disabled.
- **Agent failure mid-session.** Model error/timeout → the canvas keeps every already-accepted card; the pane falls back to guided prompts; no data loss.
- **Offline.** Import/agent require connectivity; the wizard detects offline, surfaces `[ OFFLINE — SWITCH TO GUIDED SETUP ]`, and holds commits (iOS precedent).
- **Multi-tenant / token.** Plaintext tokens block import beyond Canpro until fixed; `company_id` scoping on every read/write; pull is read-only (`pull_only`), never the push orchestrator.
- **Sync conflict.** A sibling (or iOS) editing the catalog mid-session: commit is idempotent + merge-by-id; last-write reconciles at the row level, not a blind overwrite.
- **Inventory off but stock arrives.** One-time "track inventory?" prompt; if declined, stock-bearing items down-shift to products-only (quantities not dropped silently — surfaced).

**Cross-cutting.** Analytics on every step (shown/started/step_completed/skipped/abandoned/completed). Completion fires toast + rail notification. The wizard never plugs into `useSetupGate`'s hard app-entry redirect (it is launched, not gating). Honor `prefers-reduced-motion` throughout.

## 17. Resolved decisions (Jackson, 2026-06-13)

1. **Setup Agent is ungated** — the narrow, suggest-only, approve-every-write setup agent is available to *all* companies. Only the deeper autonomous layer stays `phase_c`-gated. (Keystone of decision #3 — confirmed.)
2. **Dedupe default = show-diff** (per-field accept) on a SKU/name match; merge-all and skip also offered.
3. **Document/photo agent extraction is in v1**, alongside deterministic CSV/XLSX import.
4. **Merge the QuickBooks read-only branch** (`feat/quickbooks-readonly-sync`, ~272 behind) and reconcile it as the QB pull foundation — not a re-implementation. (Reconciliation effort is a planned task; see §18.)
5. **Plaintext-token remediation is a hard pre-ship gate** for QB import beyond Canpro.
6. **Trade picker confirmed**, accepting the additive iOS-shared `projects.trade` CHECK widening. Proposed v1 trade list in §9 (final list locks at plan time).
7. **Completion is company-scoped** — `company_settings.catalog_setup_completed_at`, not the user-scoped `setup_progress` pattern.

## 18. Branch / build recommendation (Jackson's call — flagged per brief)

This is a **net-new feature initiative** that *depends on* the P3-2 Catalog surface, which today lives only on the push-held `feat/web-overhaul` branch (worktree `ops-web-overhaul-p2-shell`), with no "Catalog shipped" sign-off and legacy `/products`+`/inventory` not yet deleted.

- **Do not presume this rides `feat/web-overhaul`.** It likely warrants its **own** branch (e.g. `feat/catalog-setup-wizard`) cut from wherever P3-2 lands, built in an **isolated worktree** (the primary `OPS-Web` checkout currently has 55 files of unrelated sibling WIP on `feat/inbox-dark-launch` — do not build or commit there).
- **Sequencing:** the wizard cannot ship before P3-2 Catalog is verified/merged. Recommend: (a) Jackson confirms P3-2 status; (b) cut the wizard branch from the P3-2 base; (c) land the additive schema (external_id, permission bit, completion flag) first; (d) build the canvas + deterministic sources (manual, CSV/XLSX); (e) layer the always-on Setup Agent (conversational generate/enrich + document/photo extraction); (f) QB import last — first **reconcile/merge the `feat/quickbooks-readonly-sync` branch** (~272 behind) as the pull foundation, then add the net-new item→catalog mapping + show-diff dedupe, all behind the plaintext-token remediation gate.
- **This spec doc** is currently written but **uncommitted** (held off the contended `feat/inbox-dark-launch` checkout). Tell me where to commit it: a dedicated branch/worktree, or onto the current branch anyway.

## 19. References

- Live prod: Supabase `ijeekuhbatykdomumfjx` (`ops-app`).
- Catalog surface: `ops-web-overhaul-p2-shell/src/app/(dashboard)/catalog/`, `src/components/catalog/`.
- Catalog spec context: `docs/specs/2026-06-11-catalog-capability-inventory.md`, `docs/specs/2026-06-11-web-overhaul-master-plan.md` (§6 UX-judgment gate).
- Commit/import RPCs: `catalog_setup_save`, `catalog_import_validate/apply`, `products_import_validate/apply`, `initialize_company_defaults`.
- Wizard precedents: `src/components/settings/{task-types-wizard,email-setup-wizard,import-pipeline-wizard}.tsx`, `wizard-steps/stepper-rail.tsx`, `wizard-steps/activate-step.tsx`; `src/lib/data/industry-presets.ts`.
- iOS parity: `ops-ios/OPS/Views/Catalog/GuidedSetup/`, `Services/Catalog/GuidedCatalogSetup/`, `Services/ProductConfigurationResolver.swift`, `RecipeResolver.swift`.
- QuickBooks: spec `docs/superpowers/specs/2026-06-01-quickbooks-readonly-sync-design.md`; branch `feat/quickbooks-readonly-sync`; QBO Item API; `accounting_connections` (plaintext-token bug `7600a1a2`).
- Phase C: `/api/feature-flags/route.ts`, `admin-feature-override-service.ts`, `approval-queue-service.ts`.
- Design: `ops-design-system/project/DESIGN.md`.
- Sage fast-follow: `bug_reports` `fd9052b8-4ece-42d7-8ed3-324ab9bc3df7`.
