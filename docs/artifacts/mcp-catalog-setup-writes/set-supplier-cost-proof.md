# Local SQL proof — `prepare_set_supplier_cost` under exposure V24

Migrations proved, in order:

1. `supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql` (task 6)
2. `supabase/migrations/20260916010000_agent_catalog_setup_write_variant.sql` (the write spine)
3. `supabase/migrations/20260916020000_agent_catalog_setup_write_thresholds.sql` (kind 2)
4. `supabase/migrations/20260916030000_agent_catalog_setup_write_pricing.sql` (kind 3)
5. `supabase/migrations/20260916040000_agent_catalog_setup_write_supplier_cost.sql` (this kind)

Database: a local PostgreSQL 17 copy of production structure plus Canpro Deck
and Rail's real catalogue (company `a612edc0-5c18-4c4d-af97-55b9410dd077`,
`currency_code` CAD). The variant exercised is **Vinyl / Sahara Beige / 68mil
Fuzzy** `18234bac-442f-41e8-98e7-956c051fbf21`, which carries two real profiles:
`deksmart-standard` 16.9200 (default) and `deksmart-condo` 15.7200, with
`unit_cost_override` 16.92 — the two cost models already agreeing, because they
were written by hand together.

The whole run is one transaction that ends in `rollback`. Section 17 re-reads
the database afterwards to show it is untouched.

## What each section proves

| § | Claim |
|---|-------|
| 0 | Before anything: the effect-policy table is empty, the narrow writer does not exist, the variant carries its two deksmart profiles with `unit_cost_override` 16.92, and the company has 137 live profiles. |
| 0b | **`catalog_setup_save` has no supplier-cost section at all** — both `strpos` probes against the live function definition return `0`. The `catalog_supplier_cost_profiles_one_default` partial unique index exists, and **no variant in the company carries profiles without a default**, so the rule this writer keeps is one the data already satisfies. |
| 1 | All five migrations apply cleanly on production structure, in ledger order. |
| 2 | Two synthetic V24 clients register: one carrying `ops.catalog_costs.read`, one without it for §15. |
| 3 | **Decision W10.** With no seal row, the prepare raises `CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED`. |
| 4 | An operator seeds the reviewed effect hash. The spine already NAMED `private.catalog_supplier_cost_profile_save` before it existed, so creating it moved the hash on purpose. |
| 5 | **No app role can execute the narrow writer** — `has_function_privilege` is `f` for `public`, `anon`, `authenticated` and `service_role`. |
| 5c | **107 of the 137 live profiles carry text OPS will not render, and 59 carry it in the label.** See below. |
| 6 | **(1) A new non-default profile.** `rails-direct-2026` at 18.2500 joins the sheet with `state: created`, the default stays on `deksmart-standard`, `variant_unit_cost_mirrored` is **false** and the variant's own cost field stays at 16.92. The stored row carries the caller's `activation_rule` and `source` verbatim plus the server's own `ops` block. The notification reads **"Review a supplier cost change on this catalog item."** — no figure. |
| 7 | **(2) Promote it.** The preview shows `rails-direct-2026 → promoted / DEFAULT`, `deksmart-standard → demoted`, `deksmart-condo → unchanged`, and the variant cost moving 16.9200 → 18.2500. Effects: `profiles_promoted 1`, `profiles_demoted 1`, `profiles_updated 1`, `supplier_cost_profiles_written 2`, `variant_unit_cost_mirrored true`. After the commit the rows and the variant's `unit_cost_override` (18.25) agree, and **every other variant of the family is byte-identical**, profiles included. |
| 8 | **(3) Reprice the default** to 19.40. No demotion, no promotion — `profiles_updated 1`, `supplier_cost_profiles_written 1` — and the mirror moves with it: the read-back reports 19.4000 and the column reads 19.4. |
| 9 | **(4) Un-defaulting the variant's only default is refused** with `CATALOG_SETUP_DEFAULT_REQUIRED`, and the rows are unchanged. A variant carrying profiles keeps exactly one default. |
| 10 | **(5) A soft-deleted profile written again comes back.** `deksmart-condo` is soft-deleted inside the transaction; the preview reports `state: revived` with `profiles_revived 1` and `profiles_created 0`, and the commit brings the row back rather than violating `(company, variant, profile_key)` — which is unique **without** a `deleted_at` predicate, so an insert would have failed. |
| 11 | **(6) A `$`-prefixed key in `activation_rule` is refused**, and so is a caller-authored `ops` key in `source` — that one is reserved for the server's provenance. |
| 12 | **(7)** A currency that is not the company's own raises `CATALOG_SETUP_CURRENCY_INVALID`. |
| 13 | **(8)** The request §10 committed, repeated byte for byte, raises `CATALOG_SETUP_NO_CHANGE`. |
| 14 | **(9)** Moving the variant's SKU between prepare and commit makes the commit raise `CATALOG_SETUP_SOURCE_STALE`, and the profile it would have written does not exist afterwards. |
| 15 | **(10)** A grant without `ops.catalog_costs.read` raises `CATALOG_SETUP_WRITE_AUTHORITY_REVISION_INVALID`, and an operator without `finances.view` raises `CATALOG_SETUP_WRITE_AUTHORITY_DENIED` at compile time. |
| 16 | End of transaction: five proposals staged, four committed, four writer-ledger rows. |
| 17 | **(12) After `rollback`:** zero effect-policy rows, no writer function, the variant back to its two deksmart profiles with `deksmart-standard` default, `unit_cost_override` 16.92, SKU NULL, and 137 live profiles across 97 variants, each with exactly one default. |

## The finding this proof surfaced

The first run of §6 did not fail on a counter or a constraint. It raised
`CATALOG_SETUP_SOURCE_UNSAFE_TEXT` from the spine's whole-proposal safety gate,
and the reason is in the data:

```
 live_profiles | unreadable_label | unreadable_source
---------------+------------------+-------------------
           137 |               59 |               107
```

```
 profile_key    | label
----------------+------------------------------------------------
 deksmart-condo | Deksmart <U+00E2><U+0080><U+0094> condo (tag order CONDO)
```

The bytes are `U+00E2 U+0080 U+0094` — a UTF-8 em dash re-encoded as if it were
Latin-1 — and `U+0080` is a C1 control character. The direct-SQL workaround that
loaded Canpro's cost sheets wrote every em dash that way, so 107 of 137 live
profiles carry control characters in `source` and 59 carry them in `label`.
`private.agent_prompt_text_is_safe` refuses them — correctly, because an
approval preview is not a place to render control bytes — and since the preview
lists **every** profile the variant has, the gate would have refused every cost
change on those variants. The tool would have been unusable on the exact
catalogue it was built for.

Neither refusing the sheet nor rendering the bytes is acceptable, so the
projection **withholds the row's own text instead**: an unreadable row keeps its
`profile_key`, its `unit_cost` and its `is_default` flag, and comes back with
`label: null`, `activation_rule: {}` and `source: {}`. §6's proposal shows both
deksmart rows exactly that way while the new row carries its text in full. The
approval queue renders the withheld rows with "Recorded text withheld" and a
note explaining why, so a cost in force is never silently dropped from a sheet
the operator is approving.

Three properties make that safe rather than a fudge:

- the preview and the read-back run the **same** projection, so they still
  compare for equality;
- the withheld fields are never what the request is about — the target row's
  text always comes from the caller;
- the caller's own `label`, `activation_rule` and `source` are refused outright
  if they carry control characters (§11), so this tool can only ever reduce the
  number of unreadable rows. Writing such a row through it replaces the
  unreadable text with readable text.

Repairing the 107 historical rows is a separate migration and a separate
decision; it is not something a write tool should do as a side effect of an
unrelated approval.

## Judgement calls this proof records

- **`state` lives only on the after side.** The before side is the sheet on
  file; the after side is the same sheet with what this approval does to each
  row. The read-back strips `state` before comparing, because a state is a
  prediction about a write and a read-back is a read of what landed.
- **Canonical order is `is_default desc, profile_key`, not the catalogue read's
  `updated_at desc`.** A timestamp cannot be predicted at prepare time, and the
  read-back compares the approved `after` for equality. Default-first is also
  what an operator reads first.
- **A revive is counted as `profiles_revived`, not `profiles_created`.** The
  brief's counter list named neither; reporting a revived row as created would
  be a true-ish counter beside a `state` that says otherwise.
- **Server provenance lives under a reserved `ops` key inside `source`**, and
  the projection strips it. That is what lets a commit-time `recorded_at` sit on
  the row without breaking the read-back's equality check, and the
  bounded-object rule refuses a caller key named `ops` so it cannot be forged.
- **This kind requires `catalog.run_setup` as well as `finances.view`.** The
  supplier-cost table's own row policy names `catalog.run_setup`, and a
  `SECURITY DEFINER` writer reached through MCP must not be a way around the
  policy that guards the table it writes.
- **The mirror is predicted in the compile and performed in the writer, by the
  same rule**, so `variant_unit_cost_mirrored` in the sealed proposal is not a
  claim the commit can contradict. The repository's matcher also refuses a
  preview whose mirror flag disagrees with the numbers beside it.

## Reproducing

```bash
for f in 20260915224500_agent_catalog_recipe_read_v24 \
         20260916010000_agent_catalog_setup_write_variant \
         20260916020000_agent_catalog_setup_write_thresholds \
         20260916030000_agent_catalog_setup_write_pricing \
         20260916040000_agent_catalog_setup_write_supplier_cost; do
  sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
    supabase/migrations/$f.sql > /tmp/m_$f.sql
done

psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
  -v task6_migration=/tmp/m_20260915224500_agent_catalog_recipe_read_v24.sql \
  -v catalog_setup_write_migration=/tmp/m_20260916010000_agent_catalog_setup_write_variant.sql \
  -v thresholds_migration=/tmp/m_20260916020000_agent_catalog_setup_write_thresholds.sql \
  -v pricing_migration=/tmp/m_20260916030000_agent_catalog_setup_write_pricing.sql \
  -v supplier_cost_migration=/tmp/m_20260916040000_agent_catalog_setup_write_supplier_cost.sql \
  -f docs/artifacts/mcp-catalog-setup-writes/set-supplier-cost-proof.sql
```

The transcript is `set-supplier-cost-proof.sql` in this directory. It writes
nothing: the last statement inside the transaction is `rollback`.

## Key output

```
## 0b. catalog_setup_save has no supplier-cost section at all
 supplier_cost_writes | variant_cost_writes
----------------------+---------------------
                    0 |                   0

 CREATE UNIQUE INDEX catalog_supplier_cost_profiles_one_default
   ON public.catalog_supplier_cost_profiles USING btree (company_id, catalog_variant_id)
   WHERE (is_default AND (deleted_at IS NULL))

 variants_with_profiles_but_no_default: 0

## 5. no app role can execute the narrow writer
   rolename    | can_execute_writer
---------------+--------------------
 anon          | f
 authenticated | f
 service_role  | f
 public        | f

## 6. (1) add a new profile that is NOT the default
 after.profiles:
   deksmart-standard  16.9200  default  label null  state unchanged   (text withheld)
   deksmart-condo     15.7200           label null  state unchanged   (text withheld)
   rails-direct-2026  18.2500           "Rails Direct 2026 rate card" state created
 after.variant_unit_cost: "16.9200"          <- no mirror: the default did not move

 the row that landed:
 rails-direct-2026 | 18.2500 | f | {"order_tag": "STANDARD"}
   source {"ops": {"action_id": "…", "recorded_at": "2026-09-16T06:55:57.616Z",
                   "recorded_by": "mcp", "change_set_id": "…"},
           "document": "Rails_Direct_2026.pdf", "quoted_by": "Jared"}
 variant_cost_unmoved: 16.92

## 7. (2) promote it
 cost_before | cost_after | effects
-------------+------------+---------------------------------------------------------
 "16.9200"   | "18.2500"  | profiles_promoted 1, profiles_demoted 1, profiles_updated 1,
                          | supplier_cost_profiles_written 2,
                          | variant_unit_cost_mirrored true, prices_changed 0

 after_sheet: rails-direct-2026 18.2500 default promoted
              deksmart-condo    15.7200         unchanged
              deksmart-standard 16.9200         demoted

 rows after commit:  rails-direct-2026 18.2500 t | deksmart-condo 15.7200 f
                     deksmart-standard 16.9200 f
 variant_cost_mirrored: 18.25
 other_variants_unchanged: t

## 8. (3) reprice the default
 cost_before "18.2500" -> cost_after "19.4000"
 profiles_demoted 0, profiles_promoted 0, supplier_cost_profiles_written 1,
 variant_unit_cost_mirrored true
 readback_variant_cost: 19.4000     variant_cost_mirrored: 19.4

## 9. (4) un-defaulting the variant's only default
ERROR:  CATALOG_SETUP_DEFAULT_REQUIRED
 rails-direct-2023 | t     (unchanged)
 cost-sheet-2025   | f

## 10. (5) revive
 states: rails-direct-2026 unchanged, deksmart-condo revived, deksmart-standard unchanged
 profiles_revived 1 | profiles_created 0
 rows after commit: rails-direct-2026 19.4000 t | deksmart-condo 15.7200 f | deksmart-standard 16.9200 f
   (deleted = f on all three)

## 11. (6) bounded objects
ERROR:  CATALOG_SETUP_WRITE_INPUT_INVALID        -- $-prefixed activation rule key
ERROR:  CATALOG_SETUP_WRITE_INPUT_INVALID        -- caller-authored `ops` provenance

## 12. (7)  ERROR:  CATALOG_SETUP_CURRENCY_INVALID
## 13. (8)  ERROR:  CATALOG_SETUP_NO_CHANGE
## 14. (9)  ERROR:  CATALOG_SETUP_SOURCE_STALE      fastenal_rows_not_written: 0
## 15. (10) ERROR:  CATALOG_SETUP_WRITE_AUTHORITY_REVISION_INVALID   (no cost scope)
##     (10) ERROR:  CATALOG_SETUP_WRITE_AUTHORITY_DENIED             (no finances.view)

## 16. end of transaction
 proposals | committed        writer                             | count
-----------+-----------      ------------------------------------+-------
         5 |         4        catalog_supplier_cost_profile_save |     4

## 17. after the rollback
 catalog_effect_policy_rows: 0
 writer_after              : (null)
 deksmart-standard | 16.9200 | t | deleted f
 deksmart-condo    | 15.7200 | f | deleted f
 unit_cost_override 16.92 | sku (null)
 company_profiles 137 | defaults 97
```
