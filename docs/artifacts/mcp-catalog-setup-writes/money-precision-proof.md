# Local SQL proof — catalogue money at the currency's minor unit

Migration proved:
`supabase/migrations/20260916070000_agent_catalog_setup_write_money_precision.sql`.

**It has not been applied anywhere.** The prerequisite migrations were applied
to `ops_test_6`, a disposable copy of the local production database made with
`create database ops_test_6 template postgres`, because they carry their own
`begin;`/`commit;`. The proof itself is one transaction on that copy and ends in
`rollback`. The proving database (`postgres`) was never written to.

Runnable transcript: `money-precision-proof.sql` in this directory.

## What is wrong

`prepare_create_catalog_variant`, `prepare_set_catalog_pricing` and
`prepare_set_supplier_cost` accept a decimal string of up to four fraction
digits, because that is the scale of the `numeric(14,4)` columns they write.
All three write money: a new variant's `price_override`, a family or variant
sale price, and a supplier profile's unit cost.

The catalogue **read** does not accept that. `private.agent_money_to_minor_units`
projects money in minor units and raises `agent_money_minor_units_not_exact` on
any stored number that is not exact there — and the detail read raises for the
**whole family**, not just the offending row. CAD and USD carry two decimals, so
`16.925 CAD` was a value the write surface would take and the read surface would
then refuse to show.

This is not hypothetical. Four of Canpro's Glass Panel supplier cost profiles
carry exactly that shape today, and section 5 of `text-repair-proof.md` records
them taking `get_catalog_item` down for their family both before and after the
text repair. The write tools could have created four more.

## What the fix is

One check in each of the three compile functions, with the other input
validation — before any authority check, any lock and any read of the family —
raising `CATALOG_SETUP_MONEY_PRECISION_INVALID` (SQLSTATE `22023`, the class the
sibling input refusals already use). The two kinds that write no money
(`set_thresholds`, `create_option`) are untouched and carry no guard, which §0
shows directly.

The decision is delegated to `private.agent_currency_minor_exponent_or_null`,
**the same exponent table the read uses**, so the write and the read cannot
disagree about what a currency's minor unit is. A currency that table does not
name is refused rather than guessed at.

The test is value exactness in minor units, which is the read's own test.
Trailing zeros are therefore not precision: `16.9200` is `16.92` and passes,
while `16.925` does not.

The contract layer carries the same bound in zod (`CatalogMinorUnitMoneySchema`
in `src/lib/agent-control-plane/contracts/catalog-setup-write.ts`, table
`{ CAD: 2, USD: 2 }`, unknown currencies refused), on all three of
`price_override`, `sale_price` and `unit_cost`. The SQL is the backstop for a
client that bypasses it.

## What each section proves

| § | Claim |
|---|-------|
| 0 | All three money-writing compile functions carry the guard and reach it through the read's own exponent table; `set_thresholds` and `create_option`, which write no money, carry neither. |
| 1 | `set_pricing` at `16.925 CAD` raises `CATALOG_SETUP_MONEY_PRECISION_INVALID`. |
| 1b | The same request at `16.92` is accepted and proposes `{"amount": "16.9200", "origin": "family", "currency": "CAD"}` — the projection still renders stored money at four decimal places, unchanged. |
| 1c | `16.9200` is accepted and proposes the identical price: trailing zeros are not precision. |
| 2 | `set_supplier_cost` refuses `4.1992` and `9.744` — two of the four real Glass Panel shapes — with the same error. |
| 2b | `4.20` on the same variant clears the gate and compiles a full proposal (`supplier_cost_profiles_written: 1`, `variant_unit_cost_mirrored: true`). |
| 3 | `create_variant` refuses a new variant priced at `45.005 CAD`. |
| 3b | The same new variant at `45.00` clears the gate and compiles a full proposal, `sale_price` `"45.0000"`. |
| 4 | A currency the exponent table does not name (`ZZZ`) is refused rather than assumed to carry two decimals. |
| 5 | `private.agent_money_to_minor_units(16.925, 'CAD')` raises `agent_money_minor_units_not_exact` — the write now refuses exactly what the read refuses. |

## Transcript

```
## 0. the guard is installed in all three compile functions that write money,
##    and in neither of the two that do not
                    proname                    | has_guard | uses_read_table
-----------------------------------------------+-----------+-----------------
 agent_catalog_setup_compile_create_option     | f         | f
 agent_catalog_setup_compile_create_variant    | t         | t
 agent_catalog_setup_compile_set_pricing       | t         | t
 agent_catalog_setup_compile_set_supplier_cost | t         | t
 agent_catalog_setup_compile_set_thresholds    | f         | f

## 1. set_pricing: 16.925 CAD is refused
ERROR:  CATALOG_SETUP_MONEY_PRECISION_INVALID
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb) line 75 at RAISE

## 1b. the same request at 16.92 clears the precision gate
 {"amount": "16.9200", "origin": "family", "currency": "CAD"}

## 1c. trailing zeros are not precision: 16.9200 is the same number and passes
 {"amount": "16.9200", "origin": "family", "currency": "CAD"}

## 2. set_supplier_cost: the four Glass Panel shapes are all refused
-- 4.1992
ERROR:  CATALOG_SETUP_MONEY_PRECISION_INVALID
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb) line 94 at RAISE
-- 9.744
ERROR:  CATALOG_SETUP_MONEY_PRECISION_INVALID
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb) line 94 at RAISE

## 2b. 4.20 on the same variant clears the precision gate
 {"profiles_updated": 1, "variant_unit_cost_mirrored": true, "supplier_cost_profiles_written": 1, ...}

## 3. create_variant: a new variant priced at 45.005 CAD is refused
ERROR:  CATALOG_SETUP_MONEY_PRECISION_INVALID
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_create_variant(uuid,uuid,jsonb) line 100 at RAISE

## 3b. the same new variant at 45.00 clears the precision gate and compiles
 accepted_sale_price
---------------------
 "45.0000"

## 4. a currency whose minor unit the read table does not name is refused
ERROR:  CATALOG_SETUP_MONEY_PRECISION_INVALID

## 5. the precision refusal is what the read would have refused
ERROR:  agent_money_minor_units_not_exact
CONTEXT:  PL/pgSQL function agent_money_to_minor_units(numeric,text) line 12 at RAISE

ROLLBACK
```

## What this does not change

Nothing about what OPS shows. Both projections and both readbacks still render
stored money as four-decimal text (§1b, §1c, §3b), so the pre-image of a row
written by hand at four decimals still reads back truthfully. No column type, no
stored row, no proposal, no grant, no consent row and no exposure revision is
touched. Every tool in the vertical that writes money is now covered; nothing
else is.

## This moves the effect seal, and that is intended

`private.agent_catalog_setup_write_effect_revision()` hashes
`pg_get_functiondef` of every function reachable from the catalogue write spine,
and all three compile functions are reachable. Replacing them changes the revision
this vertical's effect policy would be sealed against. Nothing is sealed yet —
the tools are dark until an operator installs a seal row (decision W10) — so
this moves a value nothing is currently compared against. Whoever installs the
seal must do it after this migration, not before.

## The bodies are carried through unchanged

The three definitions in the migration are the definitions from
`20260916010000_agent_catalog_setup_write_variant.sql`,
`20260916030000_agent_catalog_setup_write_pricing.sql` and
`20260916040000_agent_catalog_setup_write_supplier_cost.sql`, byte for byte,
plus the one check and its `v_minor` declaration.
`tests/unit/supabase/agent-catalog-setup-write-money-precision-migration.test.ts`
asserts that directly: it strips the guard from the new file and requires what
remains to contain each original body verbatim. Those three files are left
alone.
