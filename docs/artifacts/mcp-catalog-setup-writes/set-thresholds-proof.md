# Local SQL proof — `prepare_set_variant_thresholds` under exposure V24

Migrations proved, in order:

1. `supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql` (task 6)
2. `supabase/migrations/20260916010000_agent_catalog_setup_write_variant.sql` (the write spine)
3. `supabase/migrations/20260916020000_agent_catalog_setup_write_thresholds.sql` (this kind)

Database: a local PostgreSQL 17 copy of production structure plus Canpro Deck
and Rail's real catalogue (company `a612edc0-5c18-4c4d-af97-55b9410dd077`).
The family exercised is **Line** `393c5c83-d9df-2a48-9837-2e04501b34c6`: three
options (Color, Mount Type, Height), eight live variants, no `default_price`,
four variants already carrying thresholds and four carrying none. The target is
**Black / Topmount / 72"** `411f89c9-d2a1-44a8-8377-6c11a098f0f7`, which has
neither threshold today.

The whole run is one transaction that ends in `rollback`. Section 17 re-reads
the database afterwards to show it is untouched. `ON_ERROR_ROLLBACK` is on, so
each expected refusal rolls back only its own statement; every other statement
ran to completion and the session reported no unexpected error.

## What each section proves

| § | Claim |
|---|-------|
| 0 | Before anything: the effect-policy table is empty, this kind's compile function does not exist, the target variant has no thresholds, the family has no defaults. |
| 1 | All three migrations apply cleanly on production structure, in ledger order. |
| 2 | A synthetic V24 client and grant on consent v18 register, and the harness calls the prepare with exactly the binding the TypeScript repository sends. |
| 3 | **Decision W10.** With no seal row, the prepare raises `CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED`. Nothing in either migration can turn the tool on. |
| 4 | An operator seeds the reviewed effect hash. Installing this kind changed that hash on purpose — the compile and read-back functions are part of what `agent_catalog_setup_write_effect_revision()` hashes, so a seal reviewed against the one-kind spine cannot silently cover a two-kind one. |
| 5 | A digest of every **other** Line variant is taken before anything is written: id, sku, quantity, price, cost, both thresholds, active flag, unit and the full option-value set, as stored text. |
| 6 | Prepare warning 24 / critical 6 returns `status: approval_required`. `before` reads `null / none` on both levels; `after` reads `24 / variant` and `6 / variant`. Effects are `variants_updated: 1`, `thresholds_changed: 2` and zero everywhere else. One `agent_actions` row carries the matching `preview_sha256`; one persistent notification reads **"Review the stock levels this variant will warn at."** — the kind's own line, not the create kind's. |
| 6b | The staged payload is the family's complete current document: eight variants, no `family` object, no stock units, no stock events, and exactly one variant's two threshold fields moved. Every other variant's thresholds are re-sent as they stand. |
| 7 | The commit runs `catalog_setup_save` as the approving operator and returns a `set_thresholds` receipt with `preview_sha256`, `readback_sha256` and `receipt_sha256`. |
| 7b | The row that landed: `warning_threshold` 24, `critical_threshold` 6, `quantity` 0, `price_override` 200.0000, still active. `readback = proposal.after` is **true** and the action is `executed`. |
| 7c | **Every other variant of the family is byte-identical** — the digest from §5 still matches. Eight variants, five now carrying a warning level. |
| 8 | Replaying the same commit key returns the stored receipt with `replayed: true` — it does not write twice. |
| 9 | With 24 now in force, a prepare naming only `critical: 30` raises `CATALOG_SETUP_THRESHOLDS_INVALID`. The guard is on the levels that end up in force, not only on the arguments. |
| 10 | A prepare naming the levels already in force raises `CATALOG_SETUP_NO_CHANGE`. |
| 11 | With a family default of 10 in place, clearing the warning with an explicit `null` previews `after.warning = 10 / family` against `before.warning = 24 / variant`, counts `thresholds_changed: 1`, commits, and leaves the row's own `warning_threshold` NULL with `critical_threshold` still 6. The fallback is shown, not hidden. |
| 12 | Changing a different variant's SKU between prepare and commit makes the commit raise `CATALOG_SETUP_SOURCE_STALE`. The approved document never lands on a family that moved. |
| 13 | A variant id that is not this company's raises `CATALOG_SETUP_VARIANT_NOT_FOUND`. The caller never supplies a family, so a variant cannot be aimed at a family it does not belong to. |
| 14 | A request naming neither threshold raises `CATALOG_SETUP_WRITE_INPUT_INVALID`. |
| 15 | The seeded seal still equals the installed effect revision, and the compile dispatcher names this kind. |
| 16 | The `create_variant` kind still prepares with `operation: create_catalog_variant` and commits through the now kind-agnostic commit, returning its `variant_ref`. Generalising the prepare and the commit did not break the kind that was already there. |
| 17 | After `rollback`: zero effect-policy rows, no compile function, the target variant back to no thresholds, the family back to no default, the SKU back to NULL. |

## What this proof changed about the spine

- **The spine's header listed the wrong extension points.** Two of its five were
  already done (the `kind` CHECK on `private.agent_catalog_setup_writes` already
  names all five kinds; the rate limiter already allow-lists all five capability
  ids), and three real per-kind places were unlisted: the prepare hard-coded the
  proposal's `operation` and the operator notification's body, and the commit
  hard-coded the read-back to `id_map.agent_new_variant` and the variant
  projection. This migration replaces all three with per-kind lookups and one
  `private.agent_catalog_setup_write_readback` dispatcher, and §16 proves the
  first kind still works through them.
- **Siblings were not byte-identical until this migration fixed it.** The first
  run of §7c came back **false**. `catalog_setup_save` replaces a variant row
  from its document, so the payload re-sends every live field of every variant —
  and the spine re-sent `price_override` as the four-decimal money projection.
  `catalog_variants.price_override` is an *unconstrained* `numeric`, which keeps
  the display scale it was stored with, so every sibling's price came back as
  `200.0000` where it had been `200`. The number never moved; the row did. The
  approval preview says the write touches this variant only, and that has to be
  true of the row and not just of its value, so the family state now carries the
  price's exact stored text (`price_override_exact`) and the payload re-sends
  that. §7c is true on the second run, and the migration's postflight refuses to
  install if either function stops carrying it. This also fixes the same latent
  drift in `prepare_create_catalog_variant`.

## Deviations this proof records

- **The brief asked for a variant whose warning is 6 to be refused a `critical: 10`.**
  No Canpro variant has a warning of 6, so §9 makes the same point with the
  levels this proof just established: warning 24 in force, a prepare naming only
  `critical: 30`, refused by name.
- **Canpro has no family or category threshold defaults today** (0 of 33
  families, 0 of 6 categories), so §11 sets a family default inside the
  transaction to demonstrate the `family` origin. The `category` origin is
  exercised by the same shared function
  (`private.agent_catalog_setup_threshold_level`) and by the contract tests.
- **Thresholds are stored as `double precision` and reported as whole units.**
  No Canpro threshold is fractional (0 of 56 variant values), and the tool
  refuses with `CATALOG_SETUP_THRESHOLDS_NOT_WHOLE` rather than reporting a
  whole-unit field as `null` if it ever met one.

## Transcript

```
Pager usage is off.
BEGIN

## 0. production state before the migrations
 catalog_effect_policy_rows 
----------------------------
                          0
(1 row)

 compile_before 
----------------
 
(1 row)

                  id                  | warning_threshold | critical_threshold | sku 
--------------------------------------+-------------------+--------------------+-----
 411f89c9-d2a1-44a8-8377-6c11a098f0f7 |                   |                    | 
(1 row)

 default_warning_threshold | default_critical_threshold 
---------------------------+----------------------------
                           |                           
(1 row)


## 1. applying the V24 recipe read, the write spine, then this kind
DROP FUNCTION
DROP FUNCTION


## 2. a synthetic V24 client, grant and reviewed effect seal (rolled back)
SET
INSERT 0 1
INSERT 0 1
INSERT 0 1
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
  set_config  
--------------
 service_role
(1 row)


## 3. the seal is absent: every prepare refuses (decision W10)
psql:docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.sql:131: ERROR:  CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_write_assert_seal(boolean) line 12 at RAISE
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 45 at assignment
PL/pgSQL function pg_temp_19.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 4. an operator seals the reviewed effects (this migration seeds nothing)
INSERT 0 1
             revision              |     effect_sha256     
-----------------------------------+-----------------------
 2026-09-15.catalog-setup-write.v1 | sha256:00e2f9dba52...
(1 row)


## 5. the sibling digest before anything is written
SELECT 1
          before_digest           
----------------------------------
 1cdfdcf25ad511baeee79d4e3514438e
(1 row)


## 6. prepare warning 24 / critical 6 on a Line variant that has neither
SELECT 1
                                         prepare_envelope                                         
--------------------------------------------------------------------------------------------------
 {                                                                                               +
     "kind": "set_thresholds",                                                                   +
     "run_id": "e4e39b7d-f1c5-49e3-8044-911755c5db1d",                                           +
     "status": "approval_required",                                                              +
     "replayed": false,                                                                          +
     "action_id": "cfc0de1b-45a7-454f-ace8-7c5abfed9640",                                        +
     "request_id": "req-e2de668b44db",                                                           +
     "change_set_id": "a6cb0d33-13cf-4ec7-a239-58e7d3256d23",                                    +
     "preview_sha256": "sha256:656d8091cf47a5cf20f0f571ef5007f3e7c79870184e7559108c26bfd8654b6c",+
     "schema_revision": "2026-09-15.v1",                                                         +
     "contract_version": "2026-08-07.v1"                                                         +
 }
(1 row)

                                                proposal                                                
--------------------------------------------------------------------------------------------------------
 {                                                                                                     +
     "kind": "set_thresholds",                                                                         +
     "after": {                                                                                        +
         "variant": {                                                                                  +
             "sku": null,                                                                              +
             "variant_ref": {                                                                          +
                 "id": "411f89c9-d2a1-44a8-8377-6c11a098f0f7",                                         +
                 "kind": "catalog_variant"                                                             +
             },                                                                                        +
             "value_labels": [                                                                         +
                 "Black",                                                                              +
                 "Topmount",                                                                           +
                 "72\""                                                                                +
             ]                                                                                         +
         },                                                                                            +
         "warning": {                                                                                  +
             "value": "24",                                                                            +
             "origin": "variant"                                                                       +
         },                                                                                            +
         "critical": {                                                                                 +
             "value": "6",                                                                             +
             "origin": "variant"                                                                       +
         }                                                                                             +
     },                                                                                                +
     "before": {                                                                                       +
         "variant": {                                                                                  +
             "sku": null,                                                                              +
             "variant_ref": {                                                                          +
                 "id": "411f89c9-d2a1-44a8-8377-6c11a098f0f7",                                         +
                 "kind": "catalog_variant"                                                             +
             },                                                                                        +
             "value_labels": [                                                                         +
                 "Black",                                                                              +
                 "Topmount",                                                                           +
                 "72\""                                                                                +
             ]                                                                                         +
         },                                                                                            +
         "warning": {                                                                                  +
             "value": null,                                                                            +
             "origin": "none"                                                                          +
         },                                                                                            +
         "critical": {                                                                                 +
             "value": null,                                                                            +
             "origin": "none"                                                                          +
         }                                                                                             +
     },                                                                                                +
     "family": {                                                                                       +
         "name": "Line",                                                                               +
         "family_ref": {                                                                               +
             "id": "393c5c83-d9df-2a48-9837-2e04501b34c6",                                             +
             "kind": "catalog_family"                                                                  +
         }                                                                                             +
     },                                                                                                +
     "effects": {                                                                                      +
         "messages_sent": 0,                                                                           +
         "prices_changed": 0,                                                                          +
         "options_created": 0,                                                                         +
         "variants_created": 0,                                                                        +
         "variants_updated": 1,                                                                        +
         "thresholds_changed": 2,                                                                      +
         "stock_units_created": 0,                                                                     +
         "variants_backfilled": 0,                                                                     +
         "stock_events_recorded": 0,                                                                   +
         "accounting_sync_enqueued": 0,                                                                +
         "supplier_cost_profiles_written": 0                                                           +
     },                                                                                                +
     "evidence": [                                                                                     +
         {                                                                                             +
             "kind": "operator_statement",                                                             +
             "text": "Jackson wants this line warning at 24 and critical at 6.",                       +
             "content_kind": "untrusted_business_data",                                                +
             "source_sha256": "sha256:42537e5c7fdc0cb22bdc955ff88b4dfeff1f6566fda9d5028c168c11443fdc1c"+
         }                                                                                             +
     ],                                                                                                +
     "reversal": "A correction requires a fresh preview and approval.",                                +
     "operation": "set_variant_thresholds",                                                            +
     "expires_at": "2026-09-15T23:23:52.182584-07:00",                                                 +
     "policy_revision": "2026-09-15.catalog-setup-write.v1"                                            +
 }
(1 row)

         action_type         | status  | context_source |                           source_id                            | priority | seal_matches 
-----------------------------+---------+----------------+----------------------------------------------------------------+----------+--------------
 approve_catalog_setup_write | pending | control_room   | agent-catalog-setup-write:a6cb0d33-13cf-4ec7-a239-58e7d3256d23 | normal   | t
(1 row)

       type       |        title         |                        body                        | persistent |  action_url  | action_label 
------------------+----------------------+----------------------------------------------------+------------+--------------+--------------
 agent_suggestion | Catalog change ready | Review the stock levels this variant will warn at. | t          | /agent/queue | REVIEW
(1 row)


## 6b. the payload is the family COMPLETE document with two fields moved
 variants_in_document | stock_units | stock_events | names_the_family |                                                                                                                                                                                                                 thresholds_in_document                                                                                                                                                                                                                 
----------------------+-------------+--------------+------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
                    8 |           0 |            0 | f                | [{"id": "411f89c9", "warning": "24", "critical": "6"}, {"id": "44b1f59c", "warning": "30", "critical": "12"}, {"id": "8357baa7", "warning": null, "critical": null}, {"id": "9f37f944", "warning": null, "critical": null}, {"id": "a97d7cff", "warning": null, "critical": null}, {"id": "b24375a8", "warning": "18", "critical": "7"}, {"id": "c0a74a73", "warning": "35", "critical": "14"}, {"id": "ddfa2954", "warning": "50", "critical": "20"}]
(1 row)


## 7. commit as the approving operator
                                              receipt                                              
---------------------------------------------------------------------------------------------------
 {                                                                                                +
     "ok": true,                                                                                  +
     "kind": "set_thresholds",                                                                    +
     "effect": "catalog_setup_write_saved_inside_ops",                                            +
     "run_id": "e4e39b7d-f1c5-49e3-8044-911755c5db1d",                                            +
     "effects": {                                                                                 +
         "messages_sent": 0,                                                                      +
         "prices_changed": 0,                                                                     +
         "options_created": 0,                                                                    +
         "variants_created": 0,                                                                   +
         "variants_updated": 1,                                                                   +
         "thresholds_changed": 2,                                                                 +
         "stock_units_created": 0,                                                                +
         "variants_backfilled": 0,                                                                +
         "stock_events_recorded": 0,                                                              +
         "accounting_sync_enqueued": 0,                                                           +
         "supplier_cost_profiles_written": 0                                                      +
     },                                                                                           +
     "readback": {                                                                                +
         "variant": {                                                                             +
             "sku": null,                                                                         +
             "variant_ref": {                                                                     +
                 "id": "411f89c9-d2a1-44a8-8377-6c11a098f0f7",                                    +
                 "kind": "catalog_variant"                                                        +
             },                                                                                   +
             "value_labels": [                                                                    +
                 "Black",                                                                         +
                 "Topmount",                                                                      +
                 "72\""                                                                           +
             ]                                                                                    +
         },                                                                                       +
         "warning": {                                                                             +
             "value": "24",                                                                       +
             "origin": "variant"                                                                  +
         },                                                                                       +
         "critical": {                                                                            +
             "value": "6",                                                                        +
             "origin": "variant"                                                                  +
         }                                                                                        +
     },                                                                                           +
     "replayed": false,                                                                           +
     "action_id": "cfc0de1b-45a7-454f-ace8-7c5abfed9640",                                         +
     "variant_ref": {                                                                             +
         "id": "411f89c9-d2a1-44a8-8377-6c11a098f0f7",                                            +
         "kind": "catalog_variant"                                                                +
     },                                                                                           +
     "committed_at": "2026-09-15T22:53:52.228523-07:00",                                          +
     "change_set_id": "a6cb0d33-13cf-4ec7-a239-58e7d3256d23",                                     +
     "preview_sha256": "sha256:656d8091cf47a5cf20f0f571ef5007f3e7c79870184e7559108c26bfd8654b6c", +
     "receipt_sha256": "sha256:88c4dca439579805a0ea2c29f9b298f16b9315179e637fe98ddfeb431ecc53ed", +
     "readback_sha256": "sha256:1578364927ea2800fbb77eeccfdedee35f64c063ab59d2160a2255d236921226",+
     "confirmation_receipt_id": "ea8c1388-e5ea-44fe-b60b-275fb070cb24"                            +
 }
(1 row)


## 7b. the row that landed, and the read-back against the approved preview
                  id                  | warning_threshold | critical_threshold | quantity | price_override | sku | is_active 
--------------------------------------+-------------------+--------------------+----------+----------------+-----+-----------
 411f89c9-d2a1-44a8-8377-6c11a098f0f7 |                24 |                  6 |        0 |            200 |     | t
(1 row)

 readback_equals_approved_preview |      kind      |             variant_ref              |  status  | action_executed 
----------------------------------+----------------+--------------------------------------+----------+-----------------
 t                                | set_thresholds | 411f89c9-d2a1-44a8-8377-6c11a098f0f7 | executed | t
(1 row)


## 7c. every other variant of the family is byte-identical
 siblings_unchanged | line_variants | with_warning 
--------------------+---------------+--------------
 t                  |             8 |            5
(1 row)


## 8. replaying the same commit key returns the stored receipt
 replayed 
----------
 true
(1 row)


## 9. a critical above the warning already in force is refused
psql:docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.sql:220: ERROR:  CATALOG_SETUP_THRESHOLDS_INVALID
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb) line 131 at RAISE
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 7 at RETURN
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 47 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_19.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 10. the levels already in force are not a change
psql:docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.sql:225: ERROR:  CATALOG_SETUP_NO_CHANGE
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb) line 141 at RAISE
SQL expression "private.agent_catalog_setup_compile_set_thresholds(p_company, p_actor, p_request)"
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 7 at RETURN
PL/pgSQL assignment "v_compiled := private.agent_catalog_setup_write_compile(
    p_company_id, p_actor_user_id, p_kind, p_request)"
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 47 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_19.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 11. clearing a level falls back to the family default, loudly
UPDATE 1
SELECT 1
                       before_levels                       
-----------------------------------------------------------
 {                                                        +
     "variant": {                                         +
         "sku": null,                                     +
         "variant_ref": {                                 +
             "id": "411f89c9-d2a1-44a8-8377-6c11a098f0f7",+
             "kind": "catalog_variant"                    +
         },                                               +
         "value_labels": [                                +
             "Black",                                     +
             "Topmount",                                  +
             "72\""                                       +
         ]                                                +
     },                                                   +
     "warning": {                                         +
         "value": "24",                                   +
         "origin": "variant"                              +
     },                                                   +
     "critical": {                                        +
         "value": "6",                                    +
         "origin": "variant"                              +
     }                                                    +
 }
(1 row)

                       after_levels                        
-----------------------------------------------------------
 {                                                        +
     "variant": {                                         +
         "sku": null,                                     +
         "variant_ref": {                                 +
             "id": "411f89c9-d2a1-44a8-8377-6c11a098f0f7",+
             "kind": "catalog_variant"                    +
         },                                               +
         "value_labels": [                                +
             "Black",                                     +
             "Topmount",                                  +
             "72\""                                       +
         ]                                                +
     },                                                   +
     "warning": {                                         +
         "value": "10",                                   +
         "origin": "family"                               +
     },                                                   +
     "critical": {                                        +
         "value": "6",                                    +
         "origin": "variant"                              +
     }                                                    +
 }
(1 row)

                                                                                                                                          effects                                                                                                                                           
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 {"messages_sent": 0, "prices_changed": 0, "options_created": 0, "variants_created": 0, "variants_updated": 1, "thresholds_changed": 1, "stock_units_created": 0, "variants_backfilled": 0, "stock_events_recorded": 0, "accounting_sync_enqueued": 0, "supplier_cost_profiles_written": 0}
(1 row)

                     cleared_readback                      
-----------------------------------------------------------
 {                                                        +
     "variant": {                                         +
         "sku": null,                                     +
         "variant_ref": {                                 +
             "id": "411f89c9-d2a1-44a8-8377-6c11a098f0f7",+
             "kind": "catalog_variant"                    +
         },                                               +
         "value_labels": [                                +
             "Black",                                     +
             "Topmount",                                  +
             "72\""                                       +
         ]                                                +
     },                                                   +
     "warning": {                                         +
         "value": "10",                                   +
         "origin": "family"                               +
     },                                                   +
     "critical": {                                        +
         "value": "6",                                    +
         "origin": "variant"                              +
     }                                                    +
 }
(1 row)

 warning_threshold | critical_threshold 
-------------------+--------------------
                   |                  6
(1 row)

UPDATE 1

## 12. a family that moved between prepare and commit refuses the commit
SELECT 1
UPDATE 1
psql:docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.sql:265: ERROR:  CATALOG_SETUP_SOURCE_STALE
CONTEXT:  PL/pgSQL function public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text) line 68 at RAISE
UPDATE 1

## 13. a variant that is not this company's is not found
psql:docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.sql:274: ERROR:  CATALOG_SETUP_VARIANT_NOT_FOUND
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb) line 87 at RAISE
SQL expression "private.agent_catalog_setup_compile_set_thresholds(p_company, p_actor, p_request)"
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 7 at RETURN
PL/pgSQL assignment "v_compiled := private.agent_catalog_setup_write_compile(
    p_company_id, p_actor_user_id, p_kind, p_request)"
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 47 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_19.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 14. a request that names no threshold at all is refused
psql:docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.sql:281: ERROR:  CATALOG_SETUP_WRITE_INPUT_INVALID
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb) line 41 at RAISE
SQL expression "private.agent_catalog_setup_compile_set_thresholds(p_company, p_actor, p_request)"
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 7 at RETURN
PL/pgSQL assignment "v_compiled := private.agent_catalog_setup_write_compile(
    p_company_id, p_actor_user_id, p_kind, p_request)"
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 47 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_19.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 15. installing the kind moved the effect revision on purpose
 seal_still_matches | compile_names_the_kind 
--------------------+------------------------
 t                  | t
(1 row)


## 16. the create_variant kind still works through the shared commit
SELECT 1
       operation        |      kind      
------------------------+----------------
 create_catalog_variant | create_variant
(1 row)

                            created_variant_ref                            
---------------------------------------------------------------------------
 {"id": "7204301c-db2e-449e-9636-dc60007d3fec", "kind": "catalog_variant"}
(1 row)

 set_config 
------------
 
(1 row)

ROLLBACK

## 17. after rollback production is untouched
 catalog_effect_policy_rows 
----------------------------
                          0
(1 row)

 compile_after 
---------------
 
(1 row)

                  id                  | warning_threshold | critical_threshold | sku 
--------------------------------------+-------------------+--------------------+-----
 411f89c9-d2a1-44a8-8377-6c11a098f0f7 |                   |                    | 
(1 row)

 default_warning_threshold 
---------------------------
                          
(1 row)

 sku 
-----
 
(1 row)

```
