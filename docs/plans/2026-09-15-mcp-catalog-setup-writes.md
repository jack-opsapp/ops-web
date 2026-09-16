# MCP Catalog Writes and the Recipe Read — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Tasks 6 then 5, in that order — they share one exposure revision.

**Goal:** Give the OPS MCP surface the catalog writes Canpro's setup needed (every one of which was done by hand-written SQL), and make `get_catalog_item` show enough of a recipe to audit it.

**Architecture:** Both the new read shape and the five write tools ship in ONE new MCP exposure revision (V24) so external clients see a single consent change. Writes never touch tables directly: each tool stages a proposal, an operator approves it inside OPS (the `prepare_customer_update` model), and the commit runs `public.catalog_setup_save` as that operator. Supplier cost profiles are the one exception — `catalog_setup_save` has no section for them — and get a narrow SQL save function built to the same conventions.

**Tech Stack:** Next.js 15 + vitest, Postgres/plpgsql, MCP control plane under `src/lib/agent-control-plane`.

**Required Skills:** `superpowers:test-driven-development`, `superpowers:verification-before-completion`; for the approval-queue rows `ops-design`, `custom-skills:interface-design`, `ops-copywriter`, `custom-skills:audit-design-system`.

**Base:** ops-web `origin/main` a06f6f5e5 + `feat/recipe-engine-railing-bridge`.

**Source:** `~/Downloads/ops-mcp-gaps.md` rev 9 — gaps #1–#9, #11, #17–#21, #24, #27, #28 and design notes 1–5, 7–11.

---

## Inspection findings that shape this plan (done 2026-09-15)

- `private.agent_catalog_compile` / `agent_catalog_apply` (migration `20260908221635_agent_catalog_authoring.sql`) is the existing agent write path and is **not** a fit: it writes `public.*` tables directly through dynamic SQL rather than through `catalog_setup_save`; its `stock` entity sets `catalog_variants.quantity` and writes `inventory_deductions` instead of a stock event; it has no thresholds, no supplier cost profiles, and no option-with-backfill; it refuses any recipe row carrying a selector or `scaled_by_option_id` ("Review it in the dedicated recipe editor"); and it is dark — `prepare_catalog_changes` lives only in the unpublished V19/trial exposures and raises `CATALOG_ACTIVATION_REQUIRED` because `private.agent_catalog_effect_policy` has no seal row. **Leave it alone.** Its prepare → `agent_actions` → operator approval → `commit_*_as_actor` → readback → receipt spine is the pattern to copy, not the writer.
- `public.catalog_setup_save(p_company_id, p_idempotency_key, p_payload jsonb)` accepts `mode`, `family`, `catalog_options`, `variants`, `stock_units`, `stock_unit_events`, `products`, `product_materials`, `deleted_ids`; it writes categories, families, options, option values, variants, variant option values, stock units, stock unit events, products, product options/values, pricing modifiers, product materials, bundle items and option mappings. It sets variant `warning_threshold` / `critical_threshold` and family `default_warning_threshold` / `default_critical_threshold`. It has **no** supplier-cost-profile section, and no other Postgres function writes `catalog_supplier_cost_profiles`.
- The payload is **family-scoped and replacing**: a variant doc omitting a field can null it. Every wrapper therefore reads the family's current state, merges the caller's change onto it, and sends a complete document — with the pre-image hashed into the proposal so the commit can refuse if the family moved underneath it.
- `sale_price = coalesce(variant.price_override, family.default_price)` (confirmed empirically). There is no unique constraint on a variant's option-value set, thresholds are stored in whole units while MCP reports milliunits, and a family whose price varies by option has no `default_price` — so a new variant with no `price_override` reads as `sale_price: null`.

## Decisions

| # | Decision |
|---|---|
| W1 | Five tools, in the brief's order: `prepare_create_catalog_variant`, `prepare_set_variant_thresholds`, `prepare_set_catalog_pricing`, `prepare_set_supplier_cost`, `prepare_create_catalog_option`. Each returns `status: "approval_required"` with a proposal, `preview_sha256` and `expires_at` — never a completed write. |
| W2 | One proposal table `private.agent_catalog_setup_writes` with a `kind` discriminator, and one `agent_actions.action_type` `approve_catalog_setup_write`. Five tools, one approval surface — an operator learns one review screen, not five. |
| W3 | Commit runs as the approving operator through `public.catalog_setup_save` for variant / thresholds / pricing / option kinds, re-deriving the payload from live rows and refusing on `CATALOG_SETUP_SOURCE_STALE` when the family's pre-image hash moved. Supplier cost commits through a new `private.catalog_supplier_cost_profile_save` (idempotency key, one-default-per-variant invariant, `source` provenance object). |
| W4 | Opening quantity on a new variant is a **stock event** (`stock_units` + `stock_unit_events` in the payload), never a direct `quantity` set. Thresholds are accepted in whole units and echoed in whole units; the tool descriptions say so. |
| W5 | `prepare_create_catalog_variant` rejects a value set that already exists on the family (application-layer uniqueness, design note 1) and requires a price when the family has no `default_price` (design note 8). |
| W6 | `prepare_create_catalog_option` requires `value_for_existing_variants` — adding a dimension to a family with variants must say what the existing ones are, or the grid is left ambiguous (design note 3). The proposal lists every variant it will backfill. |
| W7 | `prepare_set_supplier_cost` takes `profile_key`, `label`, `unit_cost`, `is_default`, `activation_rule`, `source`. Flipping a new profile to default demotes the current default in the same transaction; the proposal shows both rows before and after. |
| W8 | New OAuth scope `ops.catalog.prepare` (operation `prepare`), consent label in the same voice as `ops.customers.prepare`. Costs: none beyond existing Supabase usage. |
| W9 | Task 6's richer recipe read and these five tools ship in exposure V24 together. V24 = V23's tool set + the five prepare tools, V23's grantable scopes + `ops.catalog.prepare`. V23 pins keep the old recipe shape: the catalog detail SQL takes a `p_recipe_shape` argument selected from the exposure, exactly as deck geometry v1/v2 are selected in `server-factory.ts`. |
| W10 | Nothing activates on merge: the tools are registered but every prepare raises until an effect-policy seal row exists for `catalog_setup_write`, mirroring `agent_catalog_effect_policy`. Turning them on is a separate, explicit approval. |

## Task 6 — `get_catalog_item` shows the recipe (do first)

**Files:** `src/lib/agent-control-plane/services/p2/catalog/sql/agent_catalog_reads.body.sql` + a migration redefining `private.agent_p2_catalog_detail_v1` (take the LATEST prod definition as the base — `20260830180000_agent_catalog_empty_supplier_costs.sql` patched it); `contracts/catalog-purchasing.ts`; `registry/read-capabilities/p2/catalog.ts`; `registry/capability-manifest.ts`; `registry/mcp-exposure-catalog.ts`; `mcp/server-factory.ts`; `mcp/oauth/{scopes,scope-catalog,canary}.ts`; `services/p2/catalog/{catalog-reads,catalog-repository}.ts`; `src/i18n/dictionaries/{en,es}/mcp-*.json`; `mcp/docs/reference.ts`; tests beside each.

Per recipe row add: `family_ref`, `variant_selector` (untrusted business data), `quantity_per_unit` (decimal string, 4 dp, alongside the existing `quantity_milliunits`), `scaled_by` `{option_ref, option_name}` or null, `quantity_basis` `"per_product_unit" | "per_option_count"`. Add `recipe_products[]` once per referenced product: `{product_ref, product_label, options[{option_ref, name, kind, required, affects_recipe, default_value, values[{value_ref, value}]}]}`, deleted rows excluded, ordered by `sort_order, id`, bounded like the existing recipe bound. Closes gap #27: a line scaled by "Left ends" stops reading as "1 per unit".

## Task 5 — the five write tools (after Task 6)

For each tool, in order: contract (zod input, proposal, commit input, receipt) → proposal table migration + `prepare_*_as_system` / `commit_*_as_actor` / `reject_*_as_actor` → capability definition + manifest + exposure V24 entry → domain dispatch → service (authorization, repository, prepare) → approval-queue wiring (`approval-queue-service.ts`, `src/lib/types/approval-queue.ts`, `agent/queue/page.tsx`, `queue-row.ts`, `action-detail.tsx` preview) → i18n + docs → tests (contract, service, SQL runtime with a rolled-back local proof, approval flow, exposure/manifest).

Ship each tool as its own commit. A tool is not done until its local SQL proof shows the write landing through `catalog_setup_save`, the readback matching the approved proposal, and a stale pre-image being refused.

## Verification gate

- `npx vitest run src/lib/agent-control-plane src/lib/api/services src/components/agent` green against a pre-change baseline; `tsc --noEmit` adds no errors (baseline on `origin/main` today: 6, all pre-existing test-file errors).
- Local SQL proofs for every new function, each in a transaction that rolls back.
- Bible updated: `04_API_AND_INTEGRATION.md` (tool list, scopes, exposure V24) and `03_DATA_ARCHITECTURE.md` (proposal table, supplier-cost save function).
- `ops-mcp-gaps.md` gap rows closed with the tool that closes them.
