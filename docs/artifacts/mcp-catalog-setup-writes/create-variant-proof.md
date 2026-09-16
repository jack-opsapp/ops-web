# Local SQL proof — `prepare_create_catalog_variant` under exposure V24

Migrations proved, in order:

1. `supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql` (task 6)
2. `supabase/migrations/20260916010000_agent_catalog_setup_write_variant.sql` (this task)

Database: a local PostgreSQL 17 copy of production structure plus Canpro Deck
and Rail's real catalogue (company `a612edc0-5c18-4c4d-af97-55b9410dd077`).
The family exercised is **Vinyl** `9b30f44d-47da-4134-872d-7f9c2d6f1b44`: two
options (Color with twelve values, Type with two), fifteen live variants, no
`default_price`, and unit costs already loaded on fourteen of them.

The whole run is one transaction that ends in `rollback`. Section 15 re-reads
the database afterwards to show it is untouched. `ON_ERROR_ROLLBACK` is on, so
each expected refusal rolls back only its own statement; every other statement
ran to completion and the session reported no unexpected error.

## What each section proves

| § | Claim |
|---|-------|
| 0 | Before anything: the effect-policy table is empty, the proposal table does not exist, Vinyl has 15 variants. |
| 1 | Both migrations apply cleanly on production structure, in ledger order. |
| 2 | A synthetic V24 client and grant on consent v18, and a V23 client and grant on v9, both register — so `mcp_oauth_labels_for_scopes` really does label `ops.catalog.prepare` under v18 and still labels every v9 scope. |
| 3 | **Decision W10.** With no seal row, the prepare raises `CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED`. Nothing in the migration can turn the tool on. |
| 4 | An operator seeds the reviewed effect hash. This is the only thing that activates the surface, and it happens outside the migration. |
| 5 | A prepare returns `status: approval_required` with the sealed proposal, writes one `agent_actions` row whose `preview_sha256` matches the returned seal, and one persistent notification pointing at `/agent/queue`. |
| 5b | The staged payload is the family's **complete current document** — both options, all fifteen existing variants plus the one new one — with the opening quantity carried as a `stock_units` entry and a `receive` `stock_unit_events` entry. |
| 6 | The commit runs `catalog_setup_save` as the approving operator and returns a receipt whose readback equals the approved preview, with `preview_sha256`, `readback_sha256` and `receipt_sha256` all present. |
| 6b | The row that landed: the right two option values, `price_override` 45.0000, thresholds 30/12, `quantity` 12; one stock unit of 12; one `receive` event of +12 attributed to the operator (`created_by`), not to `service_role`. The readback equals the approved preview and the action is `executed`. |
| 6c | Vinyl now has 16 variants, all fourteen pre-existing `unit_cost_override` values survive, and exactly one variant has a non-zero quantity. Re-sending the whole family document nulled nothing. |
| 7 | Replaying the same commit key returns the stored receipt with `replayed: true` — it does not write twice. |
| 8 | Renaming an option value between prepare and commit makes the commit raise `CATALOG_SETUP_SOURCE_STALE`. The approved document never lands on a family that moved. |
| 9 | A value set that already exists on the family raises `CATALOG_SETUP_VARIANT_EXISTS` (design note 1 — the database has no such constraint). |
| 10 | A family with no `default_price` and no `price_override` raises `CATALOG_SETUP_PRICE_REQUIRED` (design note 8 / decision W5). |
| 11 | Naming only one of the family's two live options raises `CATALOG_SETUP_OPTION_COVERAGE_INVALID` (design note 3). |
| 12 | The same request on a **V23** grant raises `CATALOG_SETUP_WRITE_AUTHORITY_REVISION_INVALID`. A V23 or V14 pin can never prepare a catalogue write. |
| 13 | A reject leaves the catalogue unchanged and marks the action `rejected` with the reviewer's note. |
| 14 | Every function that names consent v9 also names v18, and the customer-update authority names both manifest v20 and v28 — additive, nothing replaced. |
| 15 | After `rollback`: zero effect-policy rows, no proposal table, Vinyl back to 15 variants, the renamed option value back to `Driftwood`. |

## Deviations this proof records

- **`unit_cost` on the created variant reads `null`.** `public.catalog_setup_save`
  has no `unit_cost_override` column in its variant upsert (verified against the
  live definition), so the tool cannot set a variant cost and does not offer the
  input. Cost belongs to `prepare_set_supplier_cost`, which is the model
  `get_catalog_item` actually reads (gaps #17, #18).
- **`variants[].quantity` mirrors the opening quantity.** No trigger on
  `catalog_variants` or `catalog_stock_unit_events` projects stock events onto
  the scalar, and `catalog_setup_save` replaces `quantity` with 0 when a variant
  doc omits it. The receipt event is the audit trail; the scalar is the number
  the rest of OPS reads, and §6b shows both agreeing at 12.
- **The recorded event's `payload.source` reads `catalog_setup_save`.** That
  function merges its own provenance object over any caller payload. The tool's
  `kind` survives beside it.

## Transcript

```
Pager usage is off.
BEGIN

## 0. production state before the migrations
 catalog_effect_policy_rows 
----------------------------
                          0
(1 row)

 proposal_table_before 
-----------------------
 
(1 row)

 vinyl_variants 
----------------
             15
(1 row)


## 1. applying the V24 recipe read (task 6) then the catalogue setup writes
SET
SET
DO
DROP FUNCTION
DROP FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
REVOKE
REVOKE
REVOKE
GRANT
DO
DO
SET
SET
DO
CREATE TABLE
ALTER TABLE
ALTER TABLE
REVOKE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
REVOKE
REVOKE
GRANT
CREATE POLICY
CREATE POLICY
CREATE POLICY
CREATE POLICY
CREATE FUNCTION
REVOKE
GRANT
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
ALTER TABLE
ALTER TABLE
CREATE FUNCTION
DO
DO
DO

## 2. a synthetic V24 client, grant and reviewed effect seal (rolled back)
SET
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
                                                                                v18_labels                                                                                 
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 {"Prepare exact catalog changes for named operator approval in OPS; never change stock or prices without that approval","See products, stock levels, and selling prices"}
(1 row)

CREATE FUNCTION
CREATE FUNCTION
  set_config  
--------------
 service_role
(1 row)


## 3. the seal is absent: every prepare refuses (decision W10)
csw-proof.sql:126: ERROR:  CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED

## 4. an operator seals the reviewed effects (this migration seeds nothing)
INSERT 0 1
             revision              |     effect_sha256     
-----------------------------------+-----------------------
 2026-09-15.catalog-setup-write.v1 | sha256:6084af42a03...
(1 row)


## 5. prepare a new Vinyl variant: Boardwalk / 60mil Smooth, $45.00, 12 on hand
SELECT 1
                                         prepare_envelope                                         
--------------------------------------------------------------------------------------------------
 {                                                                                               +
     "kind": "create_variant",                                                                   +
     "run_id": "26c801b1-ffed-42a1-90b2-f513f8a1d4a4",                                           +
     "status": "approval_required",                                                              +
     "replayed": false,                                                                          +
     "action_id": "7f1ccca3-9880-4342-8c56-0928b1f47438",                                        +
     "request_id": "req-5e07d36ca49a",                                                           +
     "change_set_id": "1c5b971c-1b2a-4327-8e8e-f4103237e722",                                    +
     "preview_sha256": "sha256:4a464cdc58bc781e911013a89ad4de61f248e8a4b5a1e8106f89ee36e07778f6",+
     "schema_revision": "2026-09-15.v1",                                                         +
     "contract_version": "2026-08-07.v1"                                                         +
 }
(1 row)

                                                proposal                                                
--------------------------------------------------------------------------------------------------------
 {                                                                                                     +
     "kind": "create_variant",                                                                         +
     "after": {                                                                                        +
         "variant": {                                                                                  +
             "sku": null,                                                                              +
             "quantity": "12",                                                                         +
             "is_active": true,                                                                        +
             "unit_cost": null,                                                                        +
             "sale_price": "45.0000",                                                                  +
             "stock_units": 1,                                                                         +
             "stock_events": 1,                                                                        +
             "option_values": [                                                                        +
                 {                                                                                     +
                     "value": "Boardwalk",                                                             +
                     "value_ref": {                                                                    +
                         "id": "247c1452-41db-485e-9463-6cc7059c3bb5",                                 +
                         "kind": "catalog_option_value"                                                +
                     },                                                                                +
                     "option_ref": {                                                                   +
                         "id": "507683da-ac06-477e-90cb-e895e7bcdd5c",                                 +
                         "kind": "catalog_option"                                                      +
                     },                                                                                +
                     "option_name": "Color"                                                            +
                 },                                                                                    +
                 {                                                                                     +
                     "value": "60mil Smooth",                                                          +
                     "value_ref": {                                                                    +
                         "id": "a0a25675-71dc-4c45-b01f-99c4a3409f0b",                                 +
                         "kind": "catalog_option_value"                                                +
                     },                                                                                +
                     "option_ref": {                                                                   +
                         "id": "eac1b169-30dd-4d58-8480-14f97b670654",                                 +
                         "kind": "catalog_option"                                                      +
                     },                                                                                +
                     "option_name": "Type"                                                             +
                 }                                                                                     +
             ],                                                                                        +
             "sale_price_source": "variant_override",                                                  +
             "warning_threshold": "30",                                                                +
             "critical_threshold": "12"                                                                +
         },                                                                                            +
         "currency": "CAD",                                                                            +
         "opening_quantity": {                                                                         +
             "note": "Opening count from the 2026 cost sheet",                                         +
             "quantity": "12",                                                                         +
             "recorded_as": "stock_receive_event"                                                      +
         }                                                                                             +
     },                                                                                                +
     "before": {                                                                                       +
         "default_price": null,                                                                        +
         "variant_count": 15,                                                                          +
         "default_unit_cost": null,                                                                    +
         "existing_value_sets": [                                                                      +
             "Antique Beige / 60mil Smooth",                                                           +
             "Antique Beige / 68mil Fuzzy",                                                            +
             "Boardwalk / 68mil Fuzzy",                                                                +
             "Dove Grey / 60mil Smooth",                                                               +
             "Dove Grey / 68mil Fuzzy",                                                                +
             "Driftwood / 68mil Fuzzy",                                                                +
             "Hansberry / 68mil Fuzzy",                                                                +
             "Heritage / 68mil Fuzzy",                                                                 +
             "Mojave / 68mil Fuzzy",                                                                   +
             "Pebblestone / 68mil Fuzzy",                                                              +
             "Royal Oak / 68mil Fuzzy",                                                                +
             "Sahara Beige / 68mil Fuzzy",                                                             +
             "Silver Maple / 68mil Fuzzy",                                                             +
             "Slate Grey / 68mil Fuzzy",                                                               +
             null                                                                                      +
         ],                                                                                            +
         "existing_value_sets_truncated": false                                                        +
     },                                                                                                +
     "family": {                                                                                       +
         "name": "Vinyl",                                                                              +
         "family_ref": {                                                                               +
             "id": "9b30f44d-47da-4134-872d-7f9c2d6f1b44",                                             +
             "kind": "catalog_family"                                                                  +
         }                                                                                             +
     },                                                                                                +
     "effects": {                                                                                      +
         "messages_sent": 0,                                                                           +
         "prices_changed": 0,                                                                          +
         "options_created": 0,                                                                         +
         "variants_created": 1,                                                                        +
         "stock_units_created": 1,                                                                     +
         "variants_backfilled": 0,                                                                     +
         "stock_events_recorded": 1,                                                                   +
         "accounting_sync_enqueued": 0,                                                                +
         "supplier_cost_profiles_written": 0                                                           +
     },                                                                                                +
     "evidence": [                                                                                     +
         {                                                                                             +
             "kind": "operator_statement",                                                             +
             "text": "Jackson confirmed Boardwalk 60mil Smooth ships at 45.00 with 12 on hand.",       +
             "content_kind": "untrusted_business_data",                                                +
             "source_sha256": "sha256:dbfd45bf70764655a8142ccb96289e461d8cbba3e778e57342e943b39070c9f4"+
         }                                                                                             +
     ],                                                                                                +
     "reversal": "A correction requires a fresh preview and approval.",                                +
     "operation": "create_catalog_variant",                                                            +
     "expires_at": "2026-09-15T22:33:53.829292-07:00",                                                 +
     "policy_revision": "2026-09-15.catalog-setup-write.v1"                                            +
 }
(1 row)

         action_type         | status  | context_source |                           source_id                            | priority | seal_matches 
-----------------------------+---------+----------------+----------------------------------------------------------------+----------+--------------
 approve_catalog_setup_write | pending | control_room   | agent-catalog-setup-write:1c5b971c-1b2a-4327-8e8e-f4103237e722 | normal   | t
(1 row)

       type       |        title         |                           body                           | persistent |  action_url  | action_label 
------------------+----------------------+----------------------------------------------------------+------------+--------------+--------------
 agent_suggestion | Catalog change ready | Review the new variant, its price and its opening stock. | t          | /agent/queue | REVIEW
(1 row)


## 5b. the payload is the family COMPLETE current document plus one variant
 options | variants_in_document | stock_units | stock_events | new_variant_client_id | opening_event_type | mirrors_quantity 
---------+----------------------+-------------+--------------+-----------------------+--------------------+------------------
       2 |                   16 |           1 |            1 | agent_new_variant     | receive            | t
(1 row)


## 6. commit as the approving operator
                                              receipt                                              
---------------------------------------------------------------------------------------------------
 {                                                                                                +
     "ok": true,                                                                                  +
     "kind": "create_variant",                                                                    +
     "effect": "catalog_setup_write_saved_inside_ops",                                            +
     "run_id": "26c801b1-ffed-42a1-90b2-f513f8a1d4a4",                                            +
     "effects": {                                                                                 +
         "messages_sent": 0,                                                                      +
         "prices_changed": 0,                                                                     +
         "options_created": 0,                                                                    +
         "variants_created": 1,                                                                   +
         "stock_units_created": 1,                                                                +
         "variants_backfilled": 0,                                                                +
         "stock_events_recorded": 1,                                                              +
         "accounting_sync_enqueued": 0,                                                           +
         "supplier_cost_profiles_written": 0                                                      +
     },                                                                                           +
     "readback": {                                                                                +
         "sku": null,                                                                             +
         "quantity": "12",                                                                        +
         "is_active": true,                                                                       +
         "unit_cost": null,                                                                       +
         "sale_price": "45.0000",                                                                 +
         "stock_units": 1,                                                                        +
         "stock_events": 1,                                                                       +
         "option_values": [                                                                       +
             {                                                                                    +
                 "value": "Boardwalk",                                                            +
                 "value_ref": {                                                                   +
                     "id": "247c1452-41db-485e-9463-6cc7059c3bb5",                                +
                     "kind": "catalog_option_value"                                               +
                 },                                                                               +
                 "option_ref": {                                                                  +
                     "id": "507683da-ac06-477e-90cb-e895e7bcdd5c",                                +
                     "kind": "catalog_option"                                                     +
                 },                                                                               +
                 "option_name": "Color"                                                           +
             },                                                                                   +
             {                                                                                    +
                 "value": "60mil Smooth",                                                         +
                 "value_ref": {                                                                   +
                     "id": "a0a25675-71dc-4c45-b01f-99c4a3409f0b",                                +
                     "kind": "catalog_option_value"                                               +
                 },                                                                               +
                 "option_ref": {                                                                  +
                     "id": "eac1b169-30dd-4d58-8480-14f97b670654",                                +
                     "kind": "catalog_option"                                                     +
                 },                                                                               +
                 "option_name": "Type"                                                            +
             }                                                                                    +
         ],                                                                                       +
         "sale_price_source": "variant_override",                                                 +
         "warning_threshold": "30",                                                               +
         "critical_threshold": "12"                                                               +
     },                                                                                           +
     "replayed": false,                                                                           +
     "action_id": "7f1ccca3-9880-4342-8c56-0928b1f47438",                                         +
     "variant_ref": {                                                                             +
         "id": "2c96a222-de3c-48d0-8017-ffe8e96d1ef7",                                            +
         "kind": "catalog_variant"                                                                +
     },                                                                                           +
     "committed_at": "2026-09-15T22:03:53.886714-07:00",                                          +
     "change_set_id": "1c5b971c-1b2a-4327-8e8e-f4103237e722",                                     +
     "preview_sha256": "sha256:4a464cdc58bc781e911013a89ad4de61f248e8a4b5a1e8106f89ee36e07778f6", +
     "receipt_sha256": "sha256:2c66a048c35af5e8498565b5e267619161e2a17ec80328d2741dfb29fb7fa4e4", +
     "readback_sha256": "sha256:5f667578b15bfd6fbc8dd553f601a0d88232bb559159b20cdcb73df1ea5374c6",+
     "confirmation_receipt_id": "f44d7ec9-4be3-40fb-8771-14e6533f8ae5"                            +
 }
(1 row)


## 6b. the row that landed, its option values, its stock unit and its event
                  id                  | sku | quantity | price_override | unit_cost_override | warning_threshold | critical_threshold | is_active |      option_values       
--------------------------------------+-----+----------+----------------+--------------------+-------------------+--------------------+-----------+--------------------------
 2c96a222-de3c-48d0-8017-ffe8e96d1ef7 |     |       12 |        45.0000 |                    |                30 |                 12 | t         | Boardwalk / 60mil Smooth
(1 row)

 unit_kind | status | quantity_value |                 notes                  
-----------+--------+----------------+----------------------------------------
 each      | full   |             12 | Opening count from the 2026 cost sheet
(1 row)

 event_type | to_status | quantity_delta |       source       | attributed_to_operator 
------------+-----------+----------------+--------------------+------------------------
 receive    | full      |             12 | catalog_setup_save | t
(1 row)

 readback_equals_approved_preview |  status  | action_executed 
----------------------------------+----------+-----------------
 t                                | executed | t
(1 row)


## 6c. no other Vinyl variant was disturbed
 vinyl_variants | unit_costs_preserved | non_zero_quantities 
----------------+----------------------+---------------------
             16 |                   14 |                   1
(1 row)


## 7. replaying the same commit key returns the same receipt
 replayed 
----------
 true
(1 row)


## 8. a stale family pre-image refuses the commit
SELECT 1
UPDATE 1
csw-proof.sql:240: ERROR:  CATALOG_SETUP_SOURCE_STALE
UPDATE 1

## 9. a value set that already exists is refused
csw-proof.sql:255: ERROR:  CATALOG_SETUP_VARIANT_EXISTS
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_98.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 10. a family with no default_price and no price_override is refused
csw-proof.sql:266: ERROR:  CATALOG_SETUP_PRICE_REQUIRED
SQL expression "private.agent_catalog_setup_compile_create_variant(p_company, p_actor, p_request)"
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 4 at RETURN
PL/pgSQL assignment "v_compiled := private.agent_catalog_setup_write_compile(
    p_company_id, p_actor_user_id, p_kind, p_request)"
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 44 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_98.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 11. an incomplete option set is refused (design note 3)
csw-proof.sql:275: ERROR:  CATALOG_SETUP_OPTION_COVERAGE_INVALID
SQL expression "private.agent_catalog_setup_compile_create_variant(p_company, p_actor, p_request)"
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 4 at RETURN
PL/pgSQL assignment "v_compiled := private.agent_catalog_setup_write_compile(
    p_company_id, p_actor_user_id, p_kind, p_request)"
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 44 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_98.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 12. a V23 grant can never prepare a catalogue write
csw-proof.sql:287: ERROR:  CATALOG_SETUP_WRITE_AUTHORITY_REVISION_INVALID
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_98.prepare_write(text,jsonb,uuid) line 14 at RETURN

## 13. a rejected proposal leaves the catalogue unchanged
                          rejection                          
-------------------------------------------------------------
 {                                                          +
     "ok": true,                                            +
     "effect": "left_unchanged_inside_ops",                 +
     "action_id": "c0547488-1a2d-4ae5-9c60-c3c87a02caf9",   +
     "change_set_id": "c18e4792-7490-4890-99e4-4f59eb649110"+
 }
(1 row)

  status  | review_notes  
----------+---------------
 rejected | Wrong colour.
(1 row)


## 14. exposure and consent acceptance
                                                    signature                                                    | v18 | v9 | v28 | v20 
-----------------------------------------------------------------------------------------------------------------+-----+----+-----+-----
 private.mcp_oauth_labels_for_scopes(text[],text)                                                                |   3 |  2 |   0 |   0
 public.resolve_mcp_oauth_access_token_as_system(text,text)                                                      |   1 |  1 |   0 |   0
 private.assert_agent_customer_update_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text) |   2 |  2 |   1 |   1
(3 rows)

 set_config 
------------
 
(1 row)

ROLLBACK

## 15. after rollback production is untouched
 catalog_effect_policy_rows 
----------------------------
                          0
(1 row)

 proposal_table_after 
----------------------
 
(1 row)

 vinyl_variants 
----------------
             15
(1 row)

   value   
-----------
 Driftwood
(1 row)

```
