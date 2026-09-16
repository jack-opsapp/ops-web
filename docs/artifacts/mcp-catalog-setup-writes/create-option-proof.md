# Local SQL proof — `prepare_create_catalog_option` under exposure V24

Migrations proved, in order:

1. `supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql` (task 6)
2. `supabase/migrations/20260916010000_agent_catalog_setup_write_variant.sql` (the write spine)
3. `supabase/migrations/20260916020000_agent_catalog_setup_write_thresholds.sql` (kind 2)
4. `supabase/migrations/20260916030000_agent_catalog_setup_write_pricing.sql` (kind 3)
5. `supabase/migrations/20260916040000_agent_catalog_setup_write_supplier_cost.sql` (kind 4)
6. `supabase/migrations/20260916050000_agent_catalog_setup_write_option.sql` (this kind)

Database: a local PostgreSQL 17 copy of production structure plus Canpro Deck
and Rail's real catalogue (company `a612edc0-5c18-4c4d-af97-55b9410dd077`,
`currency_code` CAD). The families exercised are **Endcap rail**
`948ac4a0-882f-efe9-3bc4-b6f7c53fb12f` — one option (Color / Black), one variant
with 340 on hand — and **Vinyl** `9b30f44d-47da-4134-872d-7f9c2d6f1b44`, whose
Color × Type grid is fifteen variants, which is the scale the gaps document's
real case ran at (sixteen Posts backfilled as `42"`).

The whole run is one transaction that ends in `rollback`. Section 13 re-reads
the database afterwards to show it is untouched.

Runnable transcript: `create-option-proof.sql` in this directory.

## What each section proves

| § | Claim |
|---|-------|
| 0 | Before anything: the effect-policy table is empty, `agent_catalog_setup_compile_create_option` does not exist, Endcap rail has one option (Color, sort 10) with one value (Black) and one variant with 340 on hand and no price override. |
| 0b | **`catalog_setup_save` already writes all three of this kind's tables** — `catalog_options`, `catalog_option_values` and `catalog_variant_option_values` — and it **dedupes the variant matrix**, which is what shapes the payload below. The row policies on those three tables name no `run_setup` key, while the supplier-cost table's do: that asymmetry is why this kind asks for the spine's authority and the money kinds ask for more. |
| 1 | All six migrations apply cleanly on production structure, in ledger order. |
| 2 | A synthetic V24 client registers with `ops.catalog.read` + `ops.catalog.prepare` and nothing else. |
| 3 | **Scenario 9 / decision W10.** With no seal row, the prepare raises `CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED`. |
| 4 | An operator seeds the reviewed effect hash. Installing this kind moved that hash on purpose — the compile and the projection are reachable from the functions the seal walks. |
| 6 | **Scenario 1 — prepare.** `Height` with `42"` and `72"`, backfilling `42"`, returns `approval_required`. The proposal's `after` lists the new axis with `option_ref: null` and both values with `value_ref: null`, every existing option unchanged with its real ids, and the one variant as `backfilled` reading `Black / 42"`. `backfill` is `{option_name: Height, value: 42", variant_count: 1}`; `before` is the same grid with `variant_count: 0`. Effects: `options_created 1`, `option_values_created 2`, `variants_backfilled 1`, `variants_updated 1`, everything else `0`. One `approve_catalog_setup_write` action carries the identical seal, and the operator notification reads **"Review the new option and the value every variant on file gets."** |
| 6b | **The payload.** See below — this is the section with the finding in it. |
| 6c | **Scenario 2 — replay.** The same idempotency key returns `replayed: true` with the identical `preview_sha256`, and the family still has exactly one option: preparing twice writes nothing. |
| 7 | **The commit** runs `catalog_setup_save` as the approving operator and the read-back matches the approved `after` with the save's assigned ids substituted into the two nulls. Receipt: `option_ref` `f98276fb-…`, `effects` byte-identical to the proposal's. |
| 7b | Option `Height` exists at sort 20 beside Color at 10, both values exist at 10 and 20, and the variant reads `Black / 42"` with **exactly one** Height value. |
| 7c | **Nothing else moved.** Every variant row of the family is byte-identical on sku / quantity / price_override / unit_cost_override / both thresholds / is_active / unit_id; every option, value and join of **every other family in the company** is byte-identical; no stock event exists for the family; no supplier cost profile was touched; the family's `default_price` 6, `default_unit_cost` 2.5 and its two default thresholds are unchanged. |
| 8 | **Scenario 3 — the two tools compose.** `prepare_create_catalog_variant` for **Black / 72"** on the family that just gained the axis prepares and commits, and the committed variant carries both axes with the ids the option write created. This is the Posts → Height → new variants story from the gaps document (#1, #2, #3, #4), done end to end through MCP. |
| 9a | **Scenario 4** — `height` against a family that now has `Height` raises `CATALOG_SETUP_OPTION_EXISTS`. The match is case-insensitive and trimmed. |
| 9b | **Scenario 5** — `value_for_existing_variants: 'Gloss'` when the values are `['Matte']` raises `CATALOG_SETUP_BACKFILL_VALUE_INVALID`. |
| 9c | **Scenario 6** — a family with fifteen variants and no `value_for_existing_variants` raises `CATALOG_SETUP_WRITE_INPUT_INVALID`. |
| 9d | `['Matte', 'matte']` raises `CATALOG_SETUP_OPTION_VALUES_DUPLICATE`. The selector compares lower and trimmed, so two values that differ only in case cannot be told apart by the resolver either. |
| 9e | **Diverter** `fc4e178b-…` carries two active variants with identical option-value sets — a real row in this catalogue — and raises `CATALOG_SETUP_VARIANT_SET_AMBIGUOUS`. See below. |
| 10a | **Scenario 7** — a family with no variants that names `value_for_existing_variants` raises `CATALOG_SETUP_WRITE_INPUT_INVALID`: there is nothing to backfill, and OPS refuses rather than silently accepting a field it cannot honour. |
| 10b | The same request **without** it prepares with `variants_backfilled 0`, `backfill.value null`, an empty variant list, and commits — the option and both values land. |
| 11 | **Scenario 8** — renaming one of Vinyl's option values between prepare and commit makes the commit raise `CATALOG_SETUP_SOURCE_STALE`. The approved document was derived from an exact family pre-image; a family that moved underneath it would have been overwritten. |
| 12 | **The wide case.** Vinyl: `Finish` with `Matte`/`Gloss`, backfilling `Matte` across **fifteen** variants. `variants_backfilled 15`, `backfill.variant_count 15`, fifteen variants listed by name (`Sahara Beige / 68mil Fuzzy / Matte`, …), `sort_order` defaulted to **11** — the family's existing options are 0 and 1, so ten past the highest. The commit succeeds and all fifteen variants carry `Matte`. |
| 13 | **Scenario 10 — after `rollback`:** zero effect-policy rows, no compile function, Endcap rail back to one option and one variant, and the temporary family gone. |

## The finding: why the payload sends every variant's whole value set

The obvious payload is the one that changes least: leave each variant's
`option_value_ids` alone and add the one new value under
`option_value_client_ids`, which is the only way to name a row that does not
exist yet. Run on Vinyl, that produces fifteen blockers:

```
"code": "matrix_signature_conflict",
"path": "variants.option_value_client_ids",
"message": "Variant matrix signature already exists in this draft.",
"signature": ["agent_new_value_1"],
"paths": [["variants[0].option_value_client_ids"], … ["variants[14].option_value_client_ids"]]
```

`catalog_setup_save` groups the draft's variants by their
`option_value_client_ids` and refuses a draft in which two of them are the same.
A backfill that sends only the new value gives every variant the identical
one-element signature. So the payload sends each variant's **complete** value
set under `option_value_client_ids`, and declares a `client_id` for every
existing option value so the save recognises the ids it is handed — the row's
own id, which maps to itself:

```json
{
  "mode": "edit",
  "family_id": "948ac4a0-882f-efe9-3bc4-b6f7c53fb12f",
  "catalog_options": [
    { "id": "3e429d49-…", "name": "Color", "sort_order": 10,
      "values": [ { "id": "ecf50891-…", "value": "Black", "sort_order": 10,
                    "client_id": "ecf50891-…" } ] },
    { "client_id": "agent_new_option", "name": "Height", "sort_order": 20,
      "values": [ { "client_id": "agent_new_option_value_1", "value": "42\"", "sort_order": 10 },
                  { "client_id": "agent_new_option_value_2", "value": "72\"", "sort_order": 20 } ] }
  ],
  "variants": [
    { "id": "7d82d8e3-…", "sku": null, "quantity": "340", "price_override": null,
      "warning_threshold": null, "critical_threshold": null, "unit_id": null, "excluded": false,
      "option_value_client_ids": [ "ecf50891-…", "agent_new_option_value_1" ] }
  ],
  "stock_units": [], "stock_unit_events": []
}
```

Those signatures are distinct because the variants were distinct — which is the
other half of the finding. Canpro has one family where they are not:

```
           catalog_item_id            |                   vs                   | count
--------------------------------------+----------------------------------------+-------
 fc4e178b-566e-4ee8-b7bc-2a0e4ed54d27 | {1afd76ff-9dc4-48a4-810b-342d9fe508fa} |     2
```

**Diverter** carries two active variants with the same single option value. A
backfill would give them the same signature again and the save would block the
commit after the operator had already approved it. The compile refuses that
family up front with `CATALOG_SETUP_VARIANT_SET_AMBIGUOUS` (§9e) — a dimension
cannot be added to a grid whose rows cannot be told apart, and saying so at
prepare time is the difference between a refusal and a dead approval.

## The second finding: a created row cannot name its own id

In edit mode `catalog_setup_save` blocks an option or value `id` that does not
already belong to the family (`catalog_option_not_found`,
`catalog_option_value_not_found`), so a new option must be sent by `client_id`
and the save assigns the uuid. A preview that named an id would be inventing
one, so the created option and its values carry `option_ref: null` /
`value_ref: null` — exactly as the spine's `create_variant` preview carries no
variant ref.

That leaves the read-back with something to prove rather than assume. The
commit reads the live grid, then builds its expectation from the approved
`after` by dropping the per-row states and putting the save's own
`id_map.agent_new_option` and `id_map.agent_new_option_value_<n>` into the two
nulls. The values are numbered by their position in the approved list, and the
compile sorts the value list once — before it builds either the payload or the
proposal — so position `n` means the same value on both sides. If the map is
missing an id, or the grid that landed differs from the grid that was approved
in any other way, the commit raises `CATALOG_SETUP_READBACK_MISMATCH`.

## Authority: this kind asks for the spine's, not the money kinds'

`set_pricing` and `set_supplier_cost` require `catalog.run_setup` because the
fields they write are reached by a SECURITY DEFINER writer that would otherwise
step past the row policy guarding them — and the supplier-cost policy names that
key itself:

```
           tablename           |                    policyname                    | names_run_setup
-------------------------------+--------------------------------------------------+-----------------
 catalog_option_values         | company_isolation                                | f
 catalog_options               | company_isolation                                | f
 catalog_supplier_cost_profiles| catalog_supplier_cost_profiles_company_isolation | t
 catalog_supplier_cost_profiles| catalog_supplier_cost_profiles_firebase_bridge   | t
 catalog_variant_option_values | company_isolation                                | f
```

This kind's three tables ask for company isolation and nothing else, and the
write runs as the approving operator through a SECURITY INVOKER save, so those
policies apply unchanged. There is no guard to step past, so there is no key to
ask for: `prepare_create_catalog_option` declares exactly what
`prepare_create_catalog_variant` declares. A postflight in the migration refuses
to install if the reauthorization ever quietly adds this kind to the
`run_setup` list, and the compile is asserted to make no permission check of its
own.

## Regression: the four earlier proofs with all five write migrations installed

Each earlier proof was re-run on the disposable copy `ops_test_6` with its
migration list extended to install all six migrations before its own scenarios.
All four exit `0`, none raises `CATALOG_SETUP_READBACK_MISMATCH`, and every
error each one prints is one of its own expected refusals:

| Proof | Exit | Errors raised (all inside its `ON_ERROR_STOP off` blocks) |
|---|---|---|
| `create-variant-proof.sql` | 0 | `ACTIVATION_REQUIRED`, `AUTHORITY_REVISION_INVALID`, `OPTION_COVERAGE_INVALID`, `PRICE_REQUIRED`, `VARIANT_EXISTS`, `SOURCE_STALE` |
| `set-thresholds-proof.sql` | 0 | `ACTIVATION_REQUIRED`, `THRESHOLDS_INVALID`, `WRITE_INPUT_INVALID`, `NO_CHANGE`, `VARIANT_NOT_FOUND`, `SOURCE_STALE` |
| `set-pricing-proof.sql` | 0 | `ACTIVATION_REQUIRED`, `WRITE_AUTHORITY_DENIED`, `CURRENCY_INVALID`, `NO_CHANGE`, `SOURCE_STALE` |
| `set-supplier-cost-proof.sql` | 0 | `ACTIVATION_REQUIRED`, `DEFAULT_REQUIRED`, `WRITE_INPUT_INVALID` ×2, `CURRENCY_INVALID`, `NO_CHANGE`, `SOURCE_STALE`, `WRITE_AUTHORITY_DENIED`, `AUTHORITY_REVISION_INVALID` |

`ops_test_6` is unchanged afterwards: zero effect-policy rows and no
`agent_catalog_setup_compile_create_option`.

## Nothing activates

The migration seeds no seal row and its postflight refuses to install if one
exists under `2026-09-15.catalog-setup-write.v1`. After the proof's `rollback`:

```
 catalog_effect_policy_rows
----------------------------
                          0

 compile_after
---------------
 (null)

 endcap_options | endcap_variants | proof_family
----------------+-----------------+--------------
              1 |               1 |            0
```
