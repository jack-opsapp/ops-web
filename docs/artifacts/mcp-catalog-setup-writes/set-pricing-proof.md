# Local SQL proof — `prepare_set_catalog_pricing` under exposure V24

Migrations proved, in order:

1. `supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql` (task 6)
2. `supabase/migrations/20260916010000_agent_catalog_setup_write_variant.sql` (the write spine)
3. `supabase/migrations/20260916020000_agent_catalog_setup_write_thresholds.sql` (kind 2)
4. `supabase/migrations/20260916030000_agent_catalog_setup_write_pricing.sql` (this kind)

Database: a local PostgreSQL 17 copy of production structure plus Canpro Deck
and Rail's real catalogue (company `a612edc0-5c18-4c4d-af97-55b9410dd077`,
`currency_code` CAD). Two families are exercised because a family price and a
variant price are two different writes through two different functions:

- **Endcap rail** `948ac4a0-882f-efe9-3bc4-b6f7c53fb12f` — `default_price` 6,
  one live variant (**Black**) carrying no override, so the family default is
  what it sells for.
- **Line** `393c5c83-d9df-2a48-9837-2e04501b34c6` — no `default_price`, eight
  live variants each carrying its own override. The target is
  **Black / Topmount / 72"** `411f89c9-d2a1-44a8-8377-6c11a098f0f7` at 200.

The whole run is one transaction that ends in `rollback`. Section 17 re-reads
the database afterwards to show it is untouched. `ON_ERROR_ROLLBACK` is on, so
each expected refusal rolls back only its own statement; every other statement
ran to completion and the session reported no unexpected error.

## Why this kind needed a writer of its own

`public.catalog_setup_save` writes a variant's `price_override`. It does **not**
write a family's `default_price`. Section 0b reads the live function definition
and shows it: the string `catalog_items.default_price` does not occur in it, nor
does `default_unit_cost`, nor `catalog_supplier_cost_profiles`, nor
`unit_cost_override`. Its family section touches `category_id`, `name`,
`description`, `image_url`, the two default thresholds, `default_unit_id` and
`notes`, and nothing else. No other Postgres function updates an existing
family's `default_price` either.

So a family-level price is the first catalogue write in this vertical the
wizard's save path cannot carry, and it gets a narrow sealed writer beside it:
`private.catalog_family_default_price_save`. A **variant**-level price still
goes through `catalog_setup_save` with the family's complete document, exactly
as the first two kinds do. Which writer runs is decided by
`private.agent_catalog_setup_write_apply`, one branch per kind — the commit no
longer names a writer at all.

## What each section proves

| § | Claim |
|---|-------|
| 0 | Before anything: the effect-policy table is empty, the narrow writer does not exist, Endcap rail's `default_price` is `6` (stored text `6`), its one variant carries no override. |
| 0b | **`catalog_setup_save` cannot write a family default price, a family default cost, a variant cost override, or a supplier cost profile.** All four `strpos` probes against the live function definition return `0`. This is the fact the whole migration rests on, re-verified against the database rather than taken from the brief. |
| 1 | All four migrations apply cleanly on production structure, in ledger order, with every prerequisite and postflight satisfied. |
| 2 | A synthetic V24 client and grant on consent v18 register, and the harness calls the prepare with exactly the binding the TypeScript repository sends. |
| 3 | **Decision W10.** With no seal row, the prepare raises `CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED`. Nothing in this migration can turn the tool on. |
| 4 | An operator seeds the reviewed effect hash. Installing this kind changed that hash on purpose: the compile, the read-back, the apply dispatcher and the new writer are all part of what `agent_catalog_setup_write_effect_revision()` hashes, and the writer is named in it explicitly rather than found by accident. |
| 5 | **No app role can execute the narrow writer, or read its ledger.** `has_function_privilege` is `f` for `public`, `anon`, `authenticated` **and** `service_role`; `has_table_privilege` on `private.agent_catalog_setup_writer_requests` is `f` for all four. The commit is already `SECURITY DEFINER`, so even the service lane has no business calling the writer directly. |
| 6 | Prepare Endcap rail 6 → 7.50 returns `status: approval_required`. `before.price` reads `6.0000 / family`, `after.price` reads `7.5000 / family`, and `affected_variants` lists the one variant moving `6.0000 → 7.5000`, both sides with `sale_price_origin: family`. Effects are `families_updated: 1`, `variants_updated: 0`, `prices_changed: 1` and zero everywhere else. One persistent notification reads **"Review a price change on this catalog item."** — this kind's own line. |
| 6b | **The staged payload is the narrow writer's argument document, not a family document**: `{"writer": "catalog_family_default_price_save", "family_id": …, "default_price": "7.5"}`. `jsonb_typeof(payload->'variants')` is NULL — no variant row is sent, so no variant row can move. |
| 7 | The commit returns a `set_pricing` receipt keyed by `item_ref` (a family default change has no single variant to name), with `preview_sha256`, `readback_sha256` and `receipt_sha256`. |
| 7b | The row that landed: `default_price` **7.5**, stored text **`7.5`** — `trim_scale`d rather than scale-inflated to `7.5000`, so the row reads the way a human-written row reads. `default_unit_cost` is untouched at 2.5. `readback = proposal.after` is **true**. The ledger row carries server-stamped provenance: `{"recorded_by": "mcp", "action_id": …, "change_set_id": …, "recorded_at": …}`, with `default_price_before` `6` and `default_price` `7.5`. Nothing in that block comes from the caller. |
| 8 | Replaying the same commit key returns the stored receipt with `replayed: true` — it does not write twice. |
| 9 | **Clearing a family default with an explicit `null`.** `after.price` is `{amount: null, origin: "none"}` and every affected variant reads `sale_price: null, sale_price_origin: "none"` — the variants that end with no price are listed one by one, not counted. The commit lands and the read-back matches; `default_price` is NULL. |
| 10 | **A variant override of 100 on a Line variant, through `catalog_setup_save`.** Effects flip to `families_updated: 0`, `variants_updated: 1`. The receipt's `item_ref` is the variant. |
| 10b | This payload **is** the family's complete document: eight variants, with only the target's `price_override` moved to `"100"`. Every sibling is re-sent as its exact stored text (`45`, `200`, `200`, `200`, `40`, `40`, `45`), never as a four-decimal projection. |
| 10c | **Every other variant of the family is byte-identical** — the pre-write digest still matches, and the siblings' `price_override::text` values are unchanged. |
| 11 | Clearing that override leaves the variant with **no price at all**: `before.price` `100.0000 / variant` → `after.price` `null / none`, because Line has no family default to fall back to. The read-back matches and the row's `price_override` is NULL. That is loud and correct rather than silently inheriting a wrong number (design note 8). |
| 12 | A currency that is not the company's own raises `CATALOG_SETUP_CURRENCY_INVALID`. |
| 13 | A request that resolves to the price already on file raises `CATALOG_SETUP_NO_CHANGE`. |
| 14 | Renaming the family between prepare and commit makes the commit raise `CATALOG_SETUP_SOURCE_STALE`, and the target variant's price is unchanged afterwards. The approved document never lands on a family that moved. |
| 15 | An operator without `catalog.run_setup` cannot compile a price change: `CATALOG_SETUP_WRITE_AUTHORITY_DENIED`, raised at compile time so a prepare refuses up front rather than a commit refusing after an approval. |
| 16 | End of transaction: five proposals staged, four committed. |
| 17 | **After `rollback`:** zero effect-policy rows, no writer function, no ledger table, Endcap rail back to `default_price` `6` with stored text `6`, the two Line variants back to `200` and `45`. Production is untouched. |

## Judgement calls this proof records

- **`prices_changed` counts variants whose resolved sale price moves, not
  fields written.** Pinning a variant to the number it already inherits writes a
  real row — it stops a later family edit from moving that price — and moves no
  price, so it reports `variants_updated: 1, prices_changed: 0`. Clearing a
  family default moves every variant that had none of its own. The counter
  answers the question an operator actually has.
- **`before` and `after` are the same projection shape, and the read-back
  compares `after` for equality.** That rules out putting a per-row
  `sale_price_before` / `sale_price_after` diff inside `after`: those values
  cannot be re-derived from live rows once the write has landed, so a read-back
  containing them would have to be trusted rather than checked. The two sides
  list the same variants in the same order and the approval UI zips them, which
  gives the operator the same "6.00 → 7.50" reading with none of the trust.
- **The projection carries no timestamp.** A projection naming `updated_at`
  could never be predicted at prepare time, and the equality check is the whole
  point of the read-back.
- **The affected-variant list is bounded at 128 and refused above it
  (`CATALOG_SETUP_AFFECTED_VARIANTS_TOO_MANY`), never truncated.** A shortened
  list of prices is a preview nobody can approve honestly.
- **This kind requires `catalog.run_setup`, which the spine's four keys do not
  include.** `catalog_items.default_price` is written nowhere in OPS except the
  catalogue setup wizard, whose route (`src/app/api/catalog/setup/commit/route.ts`)
  gates on that key, and the supplier-cost table's own row policy names it too.
  A `SECURITY DEFINER` writer reached through MCP must not become a way around
  the authority that guards the field it writes. The check runs in the compile
  (§15), in `agent_catalog_setup_write_reauthorize` on every commit, and inside
  the writer itself.
- **Prices are stored `trim_scale`d.** `catalog_items.default_price` and
  `catalog_variants.price_override` are unconstrained `numeric`, which keep the
  display scale they were written with. Writing `7.5000` would have left a row
  reading `7.5000` beside human-written rows reading `6`. The writer trims, and
  the sibling re-send keeps using the thresholds migration's
  `price_override_exact` so untouched rows stay byte-identical (§10c).

## Reproducing

```bash
for f in 20260915224500_agent_catalog_recipe_read_v24 \
         20260916010000_agent_catalog_setup_write_variant \
         20260916020000_agent_catalog_setup_write_thresholds \
         20260916030000_agent_catalog_setup_write_pricing; do
  sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
    supabase/migrations/$f.sql > /tmp/m_$f.sql
done

psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
  -v task6_migration=/tmp/m_20260915224500_agent_catalog_recipe_read_v24.sql \
  -v catalog_setup_write_migration=/tmp/m_20260916010000_agent_catalog_setup_write_variant.sql \
  -v thresholds_migration=/tmp/m_20260916020000_agent_catalog_setup_write_thresholds.sql \
  -v pricing_migration=/tmp/m_20260916030000_agent_catalog_setup_write_pricing.sql \
  -f docs/artifacts/mcp-catalog-setup-writes/set-pricing-proof.sql
```

The transcript is `set-pricing-proof.sql` in this directory. It writes nothing:
the last statement inside the transaction is `rollback`.

## Key output

```
## 0b. catalog_setup_save does not write a family default price
 family_default_price_writes | family_default_cost_writes | supplier_cost_writes | variant_cost_writes
-----------------------------+----------------------------+----------------------+---------------------
                           0 |                          0 |                    0 |                   0

## 3. the seal is absent: every prepare refuses (decision W10)
ERROR:  CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED

## 5. no app role can execute the narrow writer, or read its ledger
   rolename    | can_execute_writer | can_read_ledger
---------------+--------------------+-----------------
 anon          | f                  | f
 authenticated | f                  | f
 service_role  | f                  | f
 public        | f                  | f

## 6b. the payload is the narrow writer argument document
 {"writer": "catalog_family_default_price_save",
  "family_id": "948ac4a0-882f-efe9-3bc4-b6f7c53fb12f",
  "default_price": "7.5"}                            | variants_in_document: (null)

## 7b. the row that landed, exactly
                  id                  |    name     | default_price | stored_text | default_unit_cost
--------------------------------------+-------------+---------------+-------------+-------------------
 948ac4a0-882f-efe9-3bc4-b6f7c53fb12f | Endcap rail |           7.5 | 7.5         |               2.5

 readback_equals_approved_preview |    kind     |   item_kind
----------------------------------+-------------+----------------
 t                                | set_pricing | catalog_family

              writer               |             source
-----------------------------------+--------------------------------------------------
 catalog_family_default_price_save | {"action_id": "…", "recorded_at": "2026-09-16T…",
                                   |  "recorded_by": "mcp", "change_set_id": "…"}

## 8. replaying the same commit key returns the stored receipt
 replayed: true

## 9. clearing the family default leaves every variant with no price
 after.price          : {"amount": null, "origin": "none", "currency": "CAD"}
 after.affected       : [{"sale_price": null, "sale_price_origin": "none", …"Black"}]
 readback_variants    : [{"sale_price": null, "sale_price_origin": "none", …"Black"}]

## 10b. this payload IS the family complete document, with one field moved
 variants_in_document | prices_in_document
----------------------+-----------------------------------------------------------
                    8 | 411f89c9="100", 44b1f59c="45", 8357baa7="200", 9f37f944="200",
                      | a97d7cff="200", b24375a8="40", c0a74a73="40", ddfa2954="45"

## 10c. every other variant of the family is byte-identical
 siblings_unchanged |  sibling_prices_exact
--------------------+-------------------------
 t                  | 45,200,200,200,40,40,45

## 11. clearing that override leaves the variant with no price at all
 before_price: {"amount": "100.0000", "origin": "variant", "currency": "CAD"}
 after_price : {"amount": null,       "origin": "none",    "currency": "CAD"}
 readback_price: {"amount": null, "origin": "none", "currency": "CAD"}
 row: price_override = (null)

## 12. a currency that is not the company currency is refused
ERROR:  CATALOG_SETUP_CURRENCY_INVALID

## 13. a request that resolves to the price already on file is refused
ERROR:  CATALOG_SETUP_NO_CHANGE

## 14. a family that moved between prepare and commit is refused
ERROR:  CATALOG_SETUP_SOURCE_STALE
 44b1f59c-250e-464b-bc52-3e8d7e1e90ae | untouched_by_the_refused_commit: 45

## 15. an operator without catalog.run_setup cannot prepare a price
ERROR:  CATALOG_SETUP_WRITE_AUTHORITY_DENIED

## 16. state at the end of the transaction
 proposals | committed
-----------+-----------
         5 |         4

## 17. after the rollback: production is untouched and the seal is empty
 catalog_effect_policy_rows: 0
 writer_after              : (null)
 948ac4a0… Endcap rail | default_price 6 | stored_text 6
 393c5c83… Line        | default_price   | stored_text
 411f89c9… price_override 200
 44b1f59c… price_override 45
 writer_ledger_after       : (null)
```
