# Local SQL proof — repairing hand-written catalogue damage

Migration proved: `supabase/migrations/20260916060000_repair_double_encoded_catalog_text.sql`.

**It has not been applied anywhere.** The whole run is one transaction on a
local PostgreSQL 17 copy of production structure plus Canpro Deck and Rail's
real catalogue, and it ends in `rollback`. Section 7 re-reads the database
afterwards to show it is untouched.

Runnable transcript: `text-repair-proof.sql` in this directory.

The migration repairs two things the same hand-written SQL left behind: text
that was double-encoded, and four supplier costs left finer than a cent. Both
break the same read, for the same families, for the same reason — a value no
surface can render.

## What is wrong, part one: the text

An em dash is U+2014. UTF-8 encodes it as the three bytes `E2 80 94`. Read those
bytes back as Latin-1 and encode them as UTF-8 again and they stop being one
character and become three: U+00E2, U+0080, U+0094. That is what is stored. The
hand-written SQL that loaded Canpro's cost sheets before there was a write
surface did that to every em dash it wrote.

U+0080 is a C1 control character. `private.agent_p2_optional_canonical_text`
refuses control characters, so it returns NULL for such a label; the catalogue
detail read marks the cost row invalid and
`private.agent_p2_catalog_detail_v1` raises `agent_catalog_source_data_invalid`
for the whole family. The text is not merely ugly — it is unreadable to every
surface that refuses control characters, which includes `get_catalog_item` with
cost access and the approval preview in the agent queue.

## What the scan actually found

The migration scans for the general double-encoding signature — a UTF-8 lead
character U+00C2..U+00F4 followed by continuation characters U+0080..U+00BF —
across the named text and jsonb columns of every company's catalogue. Sixteen
(table, column) pairs are scanned; four carry anything (§0):

```
              tbl               |     col     | rows_with_signature
--------------------------------+-------------+---------------------
 catalog_items                  | description |                   1
 catalog_option_values          | value       |                   1
 catalog_supplier_cost_profiles | label       |                  59
 catalog_supplier_cost_profiles | source      |                 107
```

`catalog_supplier_cost_profiles.activation_rule`, `catalog_items.name`,
`catalog_items.notes`, `catalog_options.name`, `catalog_variants.sku`,
`catalog_categories.name`, `products.name`, `products.description`,
`product_options.name`, `product_options.default_value`,
`product_option_values.value` and `product_materials.notes` carry none.

**Four distinct corrupted sequences exist in the whole database, and no others**
(§0b). The repair is exact rather than a guess because this is the complete
list:

```
 stored_codepoints | repaired_codepoint | repaired | occurrences | columns_seen
-------------------+--------------------+----------+-------------+--------------
 U+E2 U+80 U+94    | U+2014             | —        |         176 |            2
 U+E2 U+80 U+93    | U+2013             | –        |           5 |            1
 U+C2 U+BE         | U+BE               | ¾        |           1 |            1
 U+C3 U+97         | U+D7               | ×        |           1 |            1
```

The em dash is the cost sheets. The en dash is a date range in a `source`
block. The other two are outside the cost table entirely and were not known
before this scan: Torpedoes' `Length` option value, which should read `1¾"`,
and the Glass Panel family description, which should read `width × height`.
Neither is a control character, so neither was visible as a failure — they were
simply wrong on screen.

Every one of the 168 candidate rows survives the inverse of the corruption and
comes back clean (§0c): `round_trips` 168, `clean_after` 168,
`still_corrupt_after` 0. The 59 labels and 107 `source` blocks carry control
characters today; the option value does not.

## What each section proves

| § | Claim |
|---|-------|
| 0 | The sixteen scanned (table, column) pairs, and the four that carry the signature. |
| 0b | The four distinct corrupted sequences that exist, with counts — the whole list, so the repair is exact. |
| 0c | Every candidate row round-trips and comes back with no control character; none still matches the signature afterwards. |
| 0d | **Before:** the four `catalog_supplier_cost_profiles` rows whose `unit_cost` is finer than a cent — 4.1992, 4.2804, 9.2684, 9.7440, all Canpro's Glass Panel family, all live. Out of 137 profiles in the whole database, those four and no others. |
| 1 | **Before:** the sample label is stored as `Deksmart 2025 wholesale <BAD:E2-80-94> standard` and `agent_p2_optional_canonical_text` returns NULL for it. |
| 1b | A synthetic cost-authorised grant, so `get_catalog_item` can be called the way the MCP read layer calls it. |
| 2 | **Before:** a cost-authorised read of an affected Vinyl variant raises `agent_catalog_source_data_invalid`. Across Canpro's 103 live variants: **52 readable, 47 refused with `agent_catalog_source_data_invalid`, 4 refused with `agent_money_minor_units_not_exact`.** |
| 3 | The migration applies, repairing 59 labels, 107 `source` blocks, 1 family description and 1 option value — **168 rows, 0 skipped**. |
| 4 | **After:** zero rows carry the signature and zero rows carry a control character, across all sixteen columns. |
| 4b | The ledger holds 172 rows — 59 label / 107 source / 1 description / 1 option value / 4 `unit_cost` — and no row where before equals after. |
| 4d | **After:** the four costs read 4.2000, 4.2800, 9.2700, 9.7400, the ledger's after side matches what the column actually stores, and **0 live profiles are finer than a cent**. |
| 4c | The sample label reads `Deksmart 2025 wholesale — standard` and `agent_p2_optional_canonical_text` now returns it. All five distinct cost labels read correctly, the option value reads `1¾"` and the family description reads `width × height`. |
| 5 | **After:** the same cost-authorised read succeeds and returns both supplier labels readable. Across the same 103 variants: **92 readable, 11 refused, 0 refused on money precision** — the money-precision outcome is gone from the tally entirely. |
| 6 | A second pass finds **0** rows still repairable: the migration is idempotent, which its own postflight also asserts. |
| 6b | The cost pass is idempotent on the same terms: **0** rows still finer than a cent, and **0** rows a second pass would touch. |
| 7 | **After `rollback`:** the 59 corrupted labels are back, the four costs are back at four decimals, and `private.catalog_text_repairs_20260916` does not exist. Production is untouched. |

## The numbers, before and after

```
                 before                                        after
 outcome                           | variants |   outcome                           | variants
-----------------------------------+----------+   -----------------------------------+----------
 readable                          |       52 |   readable                          |       92
 agent_catalog_source_data_invalid |       47 |   agent_catalog_source_data_invalid |       11
 agent_money_minor_units_not_exact |        4 |   (no rows)
```

The repair takes cost-authorised `get_catalog_item` from 52 of Canpro's 103
variants to 92. After it, nothing in the catalogue carries the signature, no
cost label is refused by the canonical text gate, and no cost is refused by the
money projection.

**One separate problem remains, and it is not this one.** It was found by this
proof and is not repaired here:

- **11 variants still raise `agent_catalog_source_data_invalid`** — 8 on Line, 2
  on Picket Rail 19'6, 1 on Line Sleeve. The raise is the **recipe** section of
  `agent_p2_catalog_detail_v1` (`v_recipe_invalid`), not the cost section: a
  recipe row on those families carries a raw unit with no resolved label or
  abbreviation. Nothing to do with encoding, and nothing to do with money.

## What is wrong, part two: the costs

Four `catalog_supplier_cost_profiles` rows carry a `unit_cost` finer than a
cent: 4.1992, 4.2804, 9.2684 and 9.7440 CAD, all on Canpro's Glass Panel family
under `profile_key` `vitrum-2026`. Out of 137 profiles in the whole database
those four are the only ones (§0d), and they are arithmetic the loader left
unrounded rather than a number anyone chose.

`private.agent_money_to_minor_units` projects money in minor units and raises
`agent_money_minor_units_not_exact` rather than rounding a price it was not
authorised to round — and, like the text problem, it takes the whole family's
read down, not just the row. That is the four refusals in the before tally (§2); after the rounding they are gone from §5 entirely.

The product decision is that costs are cents-exact. The migration rounds every
live profile whose cost is not already exact at two decimals, half-up
(`round(numeric, 2)`), for every company, and records each change in the same
ledger under `column_name = 'unit_cost'`, with both sides as the column stores
them. On this copy of production that is exactly those four rows (§4d).

Two postflight assertions guard it: nothing live is finer than a cent
afterwards, and no cost moved by as much as a cent or crossed to or from zero.

## The guards, and why they are there

The signature is a heuristic — text that legitimately contains `Â` followed by a
continuation character would match it — so it never decides anything on its own.
A row is repaired only when **both** of these hold:

1. the value survives `convert_from(convert_to(value, 'LATIN1'), 'UTF8')`, which
   is the exact inverse of the corruption and throws for anything that was never
   double-encoded from Latin-1-representable bytes, and
2. the result contains no control character — a repair that leaves one behind
   has not repaired anything the refusing surfaces can use.

Anything failing either test is left exactly as it is and counted in a NOTICE.
On this catalogue nothing failed either test; the guards are for the rows this
has not seen.

The cost pass needs no heuristic — `unit_cost <> round(unit_cost, 2)` is exact —
so its guards are on the result instead: no cost may move by as much as a cent,
none may cross to or from zero, and every after value must be exactly the
half-up rounding of its before value. Any of those failing aborts the
transaction.

Scope is a literal list of sixteen (table, column) pairs inside the migration
plus one named column on one named table, not a catalogue scan, so what the
repair can reach is reviewable by reading it.
`tests/unit/supabase/repair-double-encoded-catalog-text-migration.test.ts`
asserts those lists, the ledger, the guards, and that the file contains no
`DELETE`, no `TRUNCATE`, no `DROP TABLE`, no statement naming the effect policy,
and no control character of its own.

## Auditable, reversible, idempotent

Every changed row's table, column, id, before and after go into
`private.catalog_text_repairs_20260916`, revoked from `public`, `anon`,
`authenticated` and `service_role`, with RLS enabled and forced. Reversing the
repair is an `UPDATE` from `before_value`.

A repaired value no longer matches the signature — verified for every local row
before the migration was written, and asserted by its own postflight, which
counts the rows still repairable after the pass and refuses to commit unless
that count is zero (§6 re-runs the same count independently and gets 0).

A rounded cost is already exact at two decimals, so it is no longer a candidate
either. The postflight asserts that directly too, and §6b re-runs the same count
independently and gets 0.

## Not an effect change

This migration writes data. It defines no trigger and redefines none of the
functions `private.agent_catalog_setup_write_effect_revision()` hashes, so the
catalogue write vertical's seal is unaffected, and the file neither reads nor
writes `private.agent_catalog_effect_policy`.

## After the rollback

```
 rows_with_signature
---------------------
                  59

 ledger_after
--------------
 (null)

 costs_finer_than_a_cent_after_rollback
----------------------------------------
                                      4
```
