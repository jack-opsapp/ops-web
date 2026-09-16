# Local SQL proof — catalogue writes keep the family's level

Migration proved:
`supabase/migrations/20260916090000_agent_catalog_setup_write_override_level.sql`
(file md5 `e04da739127844127c417c3515eb3c93`).

**It has not been applied anywhere but local copies.** The proving database is
`ops_override_level`, a disposable copy of the local production database
(`create database ops_override_level template ops_test_6`, which carries
migrations 1–7 of this vertical) with
`20260916080000_align_variant_unit_cost_override_to_default_profile.sql` then
applied for real. The proof is one transaction on that copy and ends in
`rollback`; section 6 shows the database exactly as it was. The migration was
also applied for real, with its own `begin;`/`commit;`, to a second copy
(`ops_override_level_apply`): it committed, and a second apply refused with
`agent_catalog_setup_override_level_already_installed`.

Runnable transcript: `override-level-proof.sql` in this directory. Live
documents for the five level scenarios, parsed by the TypeScript contract in
`catalog-setup-write-override-level-live-shape.test.ts`, come from
`override-level-live-capture.sql`.

## The rule

A write mirrors a value at the level the family already uses and never changes
that level as a side effect.

1. A **family ref** writes the family default only. It never creates a variant
   override, and the preview lists every override that will shadow the new
   value, flagging one that will equal it as `redundant` (information only —
   nothing clears it).
2. A **variant ref** whose inherited value is NULL writes the variant term.
3. A **variant ref** whose inherited value is set writes the variant term only
   when the new value differs from the inherited one. When it is equal, the
   variant ends up inheriting: its term is NULL afterwards, which clears an
   override that was set, and a request that changes nothing is refused as
   `CATALOG_SETUP_NO_CHANGE`.

Equality is numeric. Thresholds apply the rule per level. An explicit null still
clears. The supplier-cost mirror applies rule 3 against
`catalog_items.default_unit_cost` and never writes that column. The rule lives in
one function, `private.agent_catalog_setup_override_for`.

The commit then enforces it for every kind: it snapshots the family's live
variants immediately before the write and, after the write and before the
read-back, refuses with `CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED` (SQLSTATE 55000)
if any of the five variant terms changed, is non-NULL, and equals the value the
variant would inherit.

## Fixtures

Local Canpro data has no family or category threshold defaults and no redundant
price, cost or threshold overrides, exactly like production. To exercise every
branch the transaction adds, and rolls back:

| | Fixture |
|---|---|
| F1 | Hardware (Corner Sleeve's category) warns at **30** — a Corner Sleeve variant with no warning of its own inherits it from the **category** |
| F2 | Corner Sleeve's family critical level is **10** |
| F3 | Two more colours, Bronze and Grey, so new variants can be created |
| F4 | White / Normal given a **15.00** price override by hand, outside MCP, before the family price moves — a pre-existing redundant override |

Corner Sleeve is priced (15.00) and costed (8.50) once, for the family. Glass
Panel is costed per variant and carries five `unit_id` overrides equal to its
family unit. Vinyl carries fifteen.

## Results

| § | Scenario | Result |
|---|---|---|
| 0 | Production state | 0 redundant price / cost / warning / critical overrides; **21** live variants whose `unit_id` equals the family default (production: 31 — the local slice holds Canpro only) |
| 1 | Shipped code, seal live | Black / Normal asked for 15.00, its inherited family price: shipped preview `{15.0000, origin: variant}`, payload `price_override: "15"` — the defect |
| 2b | Migration landed | 12 definitions, fingerprints below; no app role executes any writer or compile, `catalog_family_default_price_save` and `compile_create_option` included; only `service_role` executes the commit |
| 3 | Seal after the migration | `seal_matches = f`; prepare → `CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED`; commit of the proposal staged in §1 → `CATALOG_SETUP_WRITE_EFFECT_POLICY_CHANGED` |
| 3b–3c | Runbook reseal | `seal_matches = t`; the §1 proposal **still** refuses (`EFFECT_POLICY_CHANGED`) and Black's price stays NULL |
| a1 | Black price 15 and 15.00 (= family) | `CATALOG_SETUP_NO_CHANGE` both times |
| a2 | Black price 18.00 | before `{15.0000, family}` → after `{18.0000, variant}`; stored `18`; siblings byte-identical |
| a3 | Black price back to 15.00 | before `{18.0000, variant}` → after `{15.0000, family}`, `prices_changed 1`; payload `price_override: null`; stored NULL; siblings byte-identical |
| a4 | White 19.00, then explicit null | commits `{19.0000, variant}`; the clear previews and reads back `{15.0000, family}`; stored NULL; siblings byte-identical |
| b1 | Black warn 30 (own 30, category 30) | warning `{30, variant}` → `{30, category}`, critical untouched `{10, variant}`, `thresholds_changed 1`; stored warning NULL, critical 10 |
| b2 | Black warn 30 + critical 10 | per level: warning unchanged, critical `{10, variant}` → `{10, family}`, `thresholds_changed 1`; stored both NULL |
| b3 | Same request again | `CATALOG_SETUP_NO_CHANGE` |
| b4 | Black warn 25 + critical 10 | warning `{25, variant}`, critical `{10, family}`; stored 25 / NULL |
| b5 | White | still carries its own 30 / 10 — redundant overrides no write touched |
| c1 | New Bronze / Normal at 15.00, warn 30, critical 10 | preview `sale_price {15.0000, family}`, `unit_cost {8.5000, family}`, `warning {30, category}`, `critical {10, family}`; payload sends `price_override`, `warning_threshold`, `critical_threshold` all null; read-back equals preview; stored all NULL; existing variants byte-identical |
| c2 | New Grey / Normal at 17.00, warn 40, critical 10 | `{17.0000, variant}`, `{8.5000, family}`, `{40, variant}`, `{10, family}`; stored 17.0000 / 40 / NULL |
| d1 | White: new 8.50 default (= family cost 8.50) | mirror runs; `{8.5000, family}` → `{8.5000, family}`; stored override **stays NULL** (shipped code would have written 8.5) |
| d2 | Black: promote the 8.00 profile | `{8.5000, family}` → `{8.0000, variant}`; stored `8` |
| d3 | Black: promote the 8.50 profile back | `{8.0000, variant}` → `{8.5000, family}`; stored override **cleared to NULL**; family cost still `8.5` |
| d4 | Glass Panel Clear / 5mm 4.20 → 4.35 (per-variant costing) | `{4.2000, variant}` → `{4.3500, variant}`; stored `4.35`; its `unit_id` still equals the family default and the guard did not trip; siblings byte-identical |
| e | Corner Sleeve family 15.00 → 17.00 | affected Black and Bronze (`prices_changed 2`); shadowing White `15.0000` (redundant **true → false**) and Grey `17.0000` (redundant **false → true**); read-back equals preview; default `17`; **every** variant byte-identical — neither redundant override was cleared |
| f1 | Bronze price payload tampered to `17` (= family) | `CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED`, detail `[{field: price_override, variant_id: Bronze}]`; every variant identical; proposal not committed, action still `pending` |
| f2 | New Glass Panel Pinhead / 5mm tampered to carry the family `unit_id` | `CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED` on `unit_id` of the new variant (counts as changed from NULL); Glass Panel still 5 variants |
| f3 | Thresholds write on White tampered to pin **sibling** Black to 17 | `CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED` on Black's `price_override`; every variant identical |
| f4 | The **shipped** `compile_set_pricing` (20260916070000) reinstated and resealed | it previews Black at `{17.0000, variant}`; commit refuses with `CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED` before the read-back; Black still NULL; savepoint restores the new compile (`c504a193…`) |
| f5 | Redundant overrides nobody wrote | 21 `unit_id` overrides equal to the family default; all **33** Canpro families compared against themselves: **0** with offenders; a real thresholds commit on Vinyl (15 such rows) succeeds with siblings byte-identical |
| 6 | After rollback | seal table empty, commit fingerprint back to shipped `e515d98f…`, rule function absent, Black / White / Clear 5mm exactly as before |

"Siblings byte-identical" is an md5 over the exact stored text of `sku`,
`quantity`, `price_override`, `unit_cost_override`, `warning_threshold`,
`critical_threshold`, `unit_id` and `is_active` of every other live variant in
the family, taken before and after each commit.

## Fingerprints after the migration (`md5(prosrc)`)

| function | md5 |
|---|---|
| private.agent_catalog_setup_amount_level (new) | b82ea11c068505537117351be1e9ea52 |
| private.agent_catalog_setup_override_for (new) | b8e34530ca950130e31f8f8fee83e3dc |
| private.agent_catalog_setup_override_level_changes (new) | 7b2138b6dccc6c35783ab764853b822a |
| private.agent_catalog_setup_variant_projection | b9f9d4f5521a76480be0c0465f6cc571 |
| private.agent_catalog_setup_compile_create_variant | b0a5c5fc7d8512d31f699a705dde7d2d |
| private.agent_catalog_setup_compile_set_thresholds | 496e09a9c6f47ca7fd9667ea98cea0b2 |
| private.agent_catalog_setup_pricing_projection | 691c29e1dd19c95583411cd5a294b965 |
| private.agent_catalog_setup_compile_set_pricing | c504a193c60e4b244b3a092ae1de9ec0 |
| private.agent_catalog_setup_supplier_cost_projection | ad913a43bc8fce759f61c0f1d983546f |
| private.catalog_supplier_cost_profile_save | 7d7008cf018fc16a80d2865e013b50bb |
| private.agent_catalog_setup_compile_set_supplier_cost | 1259c051e1f77ec261411e90d574f1f6 |
| public.commit_catalog_setup_write_as_actor | 71c84921f77ba1e986f5877e6bf6103d |

The transcript below records the commit at `71c84921…`: it was re-run after the
last edit to the migration file, and matches the committed file. Local effect
revision moved from `sha256:bed7f48d…` to `sha256:9af6b481…`; production's
values differ (production carries triggers the local dump does not), which is
why the reseal step computes the value in place rather than copying one.

## Transcript

```text
Pager usage is off.
BEGIN

## 0. production state before the migration
 catalog_effect_policy_rows 
----------------------------
                          0
(1 row)

        shipped_commit_md5        
----------------------------------
 e515d98f1e3d761539e2f259f99a12b9
(1 row)

     name      | default_price | default_unit_cost | default_warning_threshold | default_critical_threshold | has_default_unit 
---------------+---------------+-------------------+---------------------------+----------------------------+------------------
 Corner Sleeve | 15            | 8.5               |                           |                            | f
 Glass Panel   |               |                   |                           |                            | t
 Vinyl         |               |                   |                           |                            | t
(3 rows)

 redundant_price | redundant_cost | redundant_warning | redundant_critical | redundant_unit 
-----------------+----------------+-------------------+--------------------+----------------
               0 |              0 |                 0 |                  0 |             21
(1 row)


## 1. the seal is live, as it is in production, and a proposal is pending under it
SET
INSERT 0 0
INSERT 0 1
INSERT 0 1
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
  set_config  
--------------
 service_role
(1 row)

INSERT 0 1
             revision              |     effect_sha256     | seal_matches 
-----------------------------------+-----------------------+--------------
 2026-09-15.catalog-setup-write.v1 | sha256:bed7f48d2bb... | t
(1 row)

SELECT 1
                        shipped_before                        |                         shipped_after                         | shipped_payload_price 
--------------------------------------------------------------+---------------------------------------------------------------+-----------------------
 {"amount": "15.0000", "origin": "family", "currency": "CAD"} | {"amount": "15.0000", "origin": "variant", "currency": "CAD"} | "15"
(1 row)


## 2. applying the migration
SET
SET
DO
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
DO
psql:$SCRATCH/m_override_level.sql:2361: NOTICE:  catalogue override level: rule installed, commit guard installed, effect seal moved (reseal required)
DO
SET

## 2b. what landed: fingerprints, and no app role can execute a writer or compile
                       function                        |            md5_prosrc            | security_definer 
-------------------------------------------------------+----------------------------------+------------------
 private.agent_catalog_setup_amount_level              | b82ea11c068505537117351be1e9ea52 | f
 private.agent_catalog_setup_compile_create_variant    | b0a5c5fc7d8512d31f699a705dde7d2d | t
 private.agent_catalog_setup_compile_set_pricing       | c504a193c60e4b244b3a092ae1de9ec0 | t
 private.agent_catalog_setup_compile_set_supplier_cost | 1259c051e1f77ec261411e90d574f1f6 | t
 private.agent_catalog_setup_compile_set_thresholds    | 496e09a9c6f47ca7fd9667ea98cea0b2 | t
 private.agent_catalog_setup_override_for              | b8e34530ca950130e31f8f8fee83e3dc | f
 private.agent_catalog_setup_override_level_changes    | 7b2138b6dccc6c35783ab764853b822a | t
 private.agent_catalog_setup_pricing_projection        | 691c29e1dd19c95583411cd5a294b965 | t
 private.agent_catalog_setup_supplier_cost_projection  | ad913a43bc8fce759f61c0f1d983546f | t
 private.agent_catalog_setup_variant_projection        | b9f9d4f5521a76480be0c0465f6cc571 | t
 private.catalog_supplier_cost_profile_save            | 7d7008cf018fc16a80d2865e013b50bb | t
 public.commit_catalog_setup_write_as_actor            | 71c84921f77ba1e986f5877e6bf6103d | t
(12 rows)

                    proname                    | app_role_can_execute | service_role_can_execute 
-----------------------------------------------+----------------------+--------------------------
 agent_catalog_setup_amount_level              | f                    | f
 agent_catalog_setup_compile_create_option     | f                    | f
 agent_catalog_setup_compile_create_variant    | f                    | f
 agent_catalog_setup_compile_set_pricing       | f                    | f
 agent_catalog_setup_compile_set_supplier_cost | f                    | f
 agent_catalog_setup_compile_set_thresholds    | f                    | f
 agent_catalog_setup_override_for              | f                    | f
 agent_catalog_setup_override_level_changes    | f                    | f
 catalog_family_default_price_save             | f                    | f
 catalog_supplier_cost_profile_save            | f                    | f
 commit_catalog_setup_write_as_actor           | f                    | t
(11 rows)


## 3. the seal no longer matches: the tools fail closed until it is reissued
 seal_matches 
--------------
 f
(1 row)

psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:269: ERROR:  CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_write_assert_seal(boolean) line 18 at RAISE
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 45 at assignment
PL/pgSQL function pg_temp_N.prepare_write(text,jsonb) line 14 at RETURN
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:271: ERROR:  CATALOG_SETUP_WRITE_EFFECT_POLICY_CHANGED
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_write_assert_seal(boolean) line 16 at RAISE
SQL statement "SELECT private.agent_catalog_setup_write_assert_seal(true)"
PL/pgSQL function public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text) line 61 at PERFORM
SQL function "commit_write" statement 1

## 3b. the runbook reseal, once, after the migration and the code deploy
UPDATE 1
 seal_matches 
--------------
 t
(1 row)

## 3c. a proposal prepared under the old effects still cannot commit
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:284: ERROR:  CATALOG_SETUP_WRITE_EFFECT_POLICY_CHANGED
CONTEXT:  PL/pgSQL function public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text) line 63 at RAISE
SQL function "commit_write" statement 1
 black_price_override_untouched 
--------------------------------
 
(1 row)


## 4. fixtures (rolled back with everything else)
UPDATE 1
UPDATE 1
INSERT 0 2
     name      | default_price | default_unit_cost | family_critical | category_warning 
---------------+---------------+-------------------+-----------------+------------------
 Corner Sleeve | 15            | 8.5               |              10 |               30
(1 row)

 variant  |     labels     | price_override | unit_cost_override | warning_threshold | critical_threshold | unit_id 
----------+----------------+----------------+--------------------+-------------------+--------------------+---------
 22f9a4ac | Black / Normal |                |                    | 30                | 10                 | 
 2c7cdf44 | White / Normal |                |                    | 30                | 10                 | 
(2 rows)


## (a) set_pricing on Black / Normal, a variant of an item-level-priced family
## a1. the family default, 15.00: the variant already inherits it
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:312: ERROR:  CATALOG_SETUP_NO_CHANGE
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb) line 170 at RAISE
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 10 at RETURN
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 47 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_N.prepare_write(text,jsonb) line 14 at RETURN
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:314: ERROR:  CATALOG_SETUP_NO_CHANGE
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb) line 170 at RAISE
SQL expression "private.agent_catalog_setup_compile_set_pricing(p_company, p_actor, p_request)"
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 10 at RETURN
PL/pgSQL assignment "v_compiled := private.agent_catalog_setup_write_compile(
    p_company_id, p_actor_user_id, p_kind, p_request)"
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 47 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_N.prepare_write(text,jsonb) line 14 at RETURN
## a2. 18.00, which differs: the override is written
SELECT 1
SELECT 1
                         before_price                         |                          after_price                          | shadowing | prices_changed 
--------------------------------------------------------------+---------------------------------------------------------------+-----------+----------------
 {"amount": "15.0000", "origin": "family", "currency": "CAD"} | {"amount": "18.0000", "origin": "variant", "currency": "CAD"} | []        | 1
(1 row)

                        readback_price                         
---------------------------------------------------------------
 {"amount": "18.0000", "origin": "variant", "currency": "CAD"}
(1 row)

 stored 
--------
 18
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

## a3. back to 15.00: the override is cleared and the variant inherits again
UPDATE 1
SELECT 1
                         before_price                          |                         after_price                          |                                                                                                                                         effects                                                                                                                                          
---------------------------------------------------------------+--------------------------------------------------------------+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 {"amount": "18.0000", "origin": "variant", "currency": "CAD"} | {"amount": "15.0000", "origin": "family", "currency": "CAD"} | {"messages_sent": 0, "prices_changed": 1, "options_created": 0, "families_updated": 0, "variants_created": 0, "variants_updated": 1, "stock_units_created": 0, "variants_backfilled": 0, "stock_events_recorded": 0, "accounting_sync_enqueued": 0, "supplier_cost_profiles_written": 0}
(1 row)

 payload_price_override 
------------------------
 null
(1 row)

                        readback_price                        
--------------------------------------------------------------
 {"amount": "15.0000", "origin": "family", "currency": "CAD"}
(1 row)

 stored 
--------
 
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

## a4. an explicit null still clears: White / Normal to 19.00, then null
UPDATE 1
SELECT 1
                        readback_price                         
---------------------------------------------------------------
 {"amount": "19.0000", "origin": "variant", "currency": "CAD"}
(1 row)

SELECT 1
                         before_price                          |                         after_price                          
---------------------------------------------------------------+--------------------------------------------------------------
 {"amount": "19.0000", "origin": "variant", "currency": "CAD"} | {"amount": "15.0000", "origin": "family", "currency": "CAD"}
(1 row)

                        readback_price                        
--------------------------------------------------------------
 {"amount": "15.0000", "origin": "family", "currency": "CAD"}
(1 row)

 stored 
--------
 
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)


## (b) set_thresholds on Black / Normal: own 30 / 10, inherits 30 (category) / 10 (family)
## b1. warning 30: equal to the category level, so the override is cleared
UPDATE 1
SELECT 1
            warning_before            |             warning_after             |           critical_before            |            critical_after            | thresholds_changed 
--------------------------------------+---------------------------------------+--------------------------------------+--------------------------------------+--------------------
 {"value": "30", "origin": "variant"} | {"value": "30", "origin": "category"} | {"value": "10", "origin": "variant"} | {"value": "10", "origin": "variant"} | 1
(1 row)

   committed    
----------------
 set_thresholds
(1 row)

 warning_threshold | critical_threshold 
-------------------+--------------------
                   |                 10
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

## b2. warning 30 and critical 10: per level, only critical moves (cleared)
UPDATE 1
SELECT 1
             warning_after             |           critical_after            | thresholds_changed 
---------------------------------------+-------------------------------------+--------------------
 {"value": "30", "origin": "category"} | {"value": "10", "origin": "family"} | 1
(1 row)

   committed    
----------------
 set_thresholds
(1 row)

 warning_threshold | critical_threshold 
-------------------+--------------------
                   |                   
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

## b3. the same request again: both levels already inherit, nothing changes
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:389: ERROR:  CATALOG_SETUP_NO_CHANGE
CONTEXT:  PL/pgSQL function private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb) line 153 at RAISE
PL/pgSQL function private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb) line 7 at RETURN
PL/pgSQL assignment "v_compiled := private.agent_catalog_setup_write_compile(
    p_company_id, p_actor_user_id, p_kind, p_request)"
PL/pgSQL function public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone) line 47 at assignment
SQL expression "public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp())"
PL/pgSQL function pg_temp_N.prepare_write(text,jsonb) line 14 at RETURN
## b4. warning 25 (differs) and critical 10 (equal): one own level, one inherited
UPDATE 1
SELECT 1
            warning_after             |           critical_after            | thresholds_changed 
--------------------------------------+-------------------------------------+--------------------
 {"value": "25", "origin": "variant"} | {"value": "10", "origin": "family"} | 1
(1 row)

   committed    
----------------
 set_thresholds
(1 row)

 warning_threshold | critical_threshold 
-------------------+--------------------
                25 |                   
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

## b5. White / Normal still carries its own 30 / 10: a redundant override no write touched
 warning_threshold | critical_threshold 
-------------------+--------------------
                30 |                 10
(1 row)


## (c) create_variant on Corner Sleeve
## c1. Bronze / Normal at 15.00, warn 30, critical 10: every value equals what it inherits
SELECT 1
SELECT 1
        after_variant         
------------------------------
 {                           +
     "sku": null,            +
     "quantity": "0",        +
     "is_active": true,      +
     "unit_cost": {          +
         "amount": "8.5000", +
         "origin": "family"  +
     },                      +
     "sale_price": {         +
         "amount": "15.0000",+
         "origin": "family"  +
     },                      +
     "stock_units": 0,       +
     "stock_events": 0,      +
     "warning_threshold": {  +
         "value": "30",      +
         "origin": "category"+
     },                      +
     "critical_threshold": { +
         "value": "10",      +
         "origin": "family"  +
     }                       +
 }
(1 row)

                                                                                 payload_new_variant                                                                                 
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 {"sku": null, "unit_id": null, "excluded": false, "quantity": "0", "client_id": "agent_new_variant", "price_override": null, "warning_threshold": null, "critical_threshold": null}
(1 row)

SELECT 1
 readback_equals_preview 
-------------------------
 t
(1 row)

 price_override | unit_cost_override | warning_threshold | critical_threshold | unit_id 
----------------+--------------------+-------------------+--------------------+---------
                |                    |                   |                    | 
(1 row)

 existing_variants_byte_identical 
----------------------------------
 t
(1 row)

## c2. Grey / Normal at 17.00, warn 40, critical 10: two own values, one inherited
UPDATE 1
SELECT 1
                 sale_price                 |                unit_cost                 |               warning                |              critical               
--------------------------------------------+------------------------------------------+--------------------------------------+-------------------------------------
 {"amount": "17.0000", "origin": "variant"} | {"amount": "8.5000", "origin": "family"} | {"value": "40", "origin": "variant"} | {"value": "10", "origin": "family"}
(1 row)

SELECT 1
 price_override | unit_cost_override | warning_threshold | critical_threshold | unit_id 
----------------+--------------------+-------------------+--------------------+---------
 17.0000        |                    |                40 |                    | 
(1 row)

 existing_variants_byte_identical 
----------------------------------
 t
(1 row)


## (d) set_supplier_cost: the mirror follows the level the family uses
## d1. White / Normal, item-level cost 8.50: a new default at 8.50 leaves it inheriting
UPDATE 1
SELECT 1
               cost_before                |                cost_after                | mirrored 
------------------------------------------+------------------------------------------+----------
 {"amount": "8.5000", "origin": "family"} | {"amount": "8.5000", "origin": "family"} | true
(1 row)

              readback_cost               
------------------------------------------
 {"amount": "8.5000", "origin": "family"}
(1 row)

 stored_override 
-----------------
 
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

## d2. Black / Normal: promote the 8.00 profile, which differs, so the override is set
UPDATE 1
SELECT 1
               cost_before                |                cost_after                 | mirrored 
------------------------------------------+-------------------------------------------+----------
 {"amount": "8.5000", "origin": "family"} | {"amount": "8.0000", "origin": "variant"} | true
(1 row)

               readback_cost               
-------------------------------------------
 {"amount": "8.0000", "origin": "variant"}
(1 row)

 stored_override 
-----------------
 8
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

## d3. Black / Normal: promote the 8.50 profile back; equal to the family, so the override is cleared
UPDATE 1
SELECT 1
                cost_before                |                cost_after                
-------------------------------------------+------------------------------------------
 {"amount": "8.0000", "origin": "variant"} | {"amount": "8.5000", "origin": "family"}
(1 row)

              readback_cost               
------------------------------------------
 {"amount": "8.5000", "origin": "family"}
(1 row)

 stored_override 
-----------------
 
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)

 family_cost_never_written 
---------------------------
 8.5
(1 row)

## d4. Glass Panel Clear / 5mm, costed per variant: 4.20 -> 4.35 is written on the variant
##     (the family carries five unit_id overrides equal to its default; none trips the guard)
SELECT 1
SELECT 1
                cost_before                |                cost_after                 
-------------------------------------------+-------------------------------------------
 {"amount": "4.2000", "origin": "variant"} | {"amount": "4.3500", "origin": "variant"}
(1 row)

               readback_cost               
-------------------------------------------
 {"amount": "4.3500", "origin": "variant"}
(1 row)

 stored_override | unit_id_equals_family_default 
-----------------+-------------------------------
 4.35            | t
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)


## (e) set_pricing on the Corner Sleeve FAMILY, 15.00 -> 17.00
UPDATE 1
 variant  |     labels      | price_override | unit_cost_override | warning_threshold | critical_threshold | unit_id 
----------+-----------------+----------------+--------------------+-------------------+--------------------+---------
 22f9a4ac | Black / Normal  |                |                    | 25                |                    | 
 c9d86148 | Bronze / Normal |                |                    |                   |                    | 
 a69cde0d | Grey / Normal   | 17.0000        |                    | 40                |                    | 
 2c7cdf44 | White / Normal  | 15             |                    | 30                | 10                 | 
(4 rows)

UPDATE 1
SELECT 1
                     shadowing_before                      |                      shadowing_after                      
-----------------------------------------------------------+-----------------------------------------------------------
 [                                                        +| [                                                        +
     {                                                    +|     {                                                    +
         "redundant": true,                               +|         "redundant": false,                              +
         "variant_ref": {                                 +|         "variant_ref": {                                 +
             "id": "2c7cdf44-3473-499b-b086-73737505a565",+|             "id": "2c7cdf44-3473-499b-b086-73737505a565",+
             "kind": "catalog_variant"                    +|             "kind": "catalog_variant"                    +
         },                                               +|         },                                               +
         "value_labels": [                                +|         "value_labels": [                                +
             "White",                                     +|             "White",                                     +
             "Normal"                                     +|             "Normal"                                     +
         ],                                               +|         ],                                               +
         "price_override": "15.0000"                      +|         "price_override": "15.0000"                      +
     },                                                   +|     },                                                   +
     {                                                    +|     {                                                    +
         "redundant": false,                              +|         "redundant": true,                               +
         "variant_ref": {                                 +|         "variant_ref": {                                 +
             "id": "a69cde0d-9ea0-4c8d-a845-8c7c389af873",+|             "id": "a69cde0d-9ea0-4c8d-a845-8c7c389af873",+
             "kind": "catalog_variant"                    +|             "kind": "catalog_variant"                    +
         },                                               +|         },                                               +
         "value_labels": [                                +|         "value_labels": [                                +
             "Grey",                                      +|             "Grey",                                      +
             "Normal"                                     +|             "Normal"                                     +
         ],                                               +|         ],                                               +
         "price_override": "17.0000"                      +|         "price_override": "17.0000"                      +
     }                                                    +|     }                                                    +
 ]                                                         | ]
(1 row)

                  affected                   |                                                                                                                                         effects                                                                                                                                          |                         after_price                          
---------------------------------------------+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+--------------------------------------------------------------
 [["Black", "Normal"], ["Bronze", "Normal"]] | {"messages_sent": 0, "prices_changed": 2, "options_created": 0, "families_updated": 1, "variants_created": 0, "variants_updated": 0, "stock_units_created": 0, "variants_backfilled": 0, "stock_events_recorded": 0, "accounting_sync_enqueued": 0, "supplier_cost_profiles_written": 0} | {"amount": "17.0000", "origin": "family", "currency": "CAD"}
(1 row)

SELECT 1
 readback_equals_preview 
-------------------------
 t
(1 row)

 family_default 
----------------
 17
(1 row)

 every_variant_byte_identical 
------------------------------
 t
(1 row)

 variant  |     labels      | price_override | unit_cost_override | warning_threshold | critical_threshold | unit_id 
----------+-----------------+----------------+--------------------+-------------------+--------------------+---------
 22f9a4ac | Black / Normal  |                |                    | 25                |                    | 
 c9d86148 | Bronze / Normal |                |                    |                   |                    | 
 a69cde0d | Grey / Normal   | 17.0000        |                    | 40                |                    | 
 2c7cdf44 | White / Normal  | 15             |                    | 30                | 10                 | 
(4 rows)


## (f) the post-condition, red: a commit forced to create a redundant override
## f1. a variant price payload tampered to the family default (Bronze, inherits 17.00)
SELECT 1
UPDATE 1
UPDATE 1
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:546: ERROR:  55000: CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED
DETAIL:  [{"field": "price_override", "variant_id": "c9d86148-27b9-4e0a-a46f-8fde8639b0dd"}]
CONTEXT:  PL/pgSQL function public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text) line 129 at RAISE
SQL function "commit_write" statement 1
LOCATION:  exec_stmt_raise, pl_exec.c:3911
 rolled_back_every_variant_identical 
-------------------------------------
 t
(1 row)

 not_committed | action_status 
---------------+---------------
 t             | pending
(1 row)

## f2. a NEW variant tampered to carry the family unit (Glass Panel Pinhead / 5mm)
SELECT 1
UPDATE 1
UPDATE 1
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:571: ERROR:  55000: CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED
DETAIL:  [{"field": "unit_id", "variant_id": "36a1fa7b-4f92-4d96-a887-0934f84ef1c1"}]
CONTEXT:  PL/pgSQL function public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text) line 129 at RAISE
SQL function "commit_write" statement 1
LOCATION:  exec_stmt_raise, pl_exec.c:3911
 rolled_back_every_variant_identical | glass_panel_variants 
-------------------------------------+----------------------
 t                                   |                    5
(1 row)

## f3. a SIBLING tampered: a thresholds write on White that also pins Black to the family price
SELECT 1
UPDATE 1
UPDATE 1
psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:591: ERROR:  55000: CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED
DETAIL:  [{"field": "price_override", "variant_id": "22f9a4ac-eb8d-46a7-a134-1cc75800a700"}]
CONTEXT:  PL/pgSQL function public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text) line 129 at RAISE
SQL function "commit_write" statement 1
LOCATION:  exec_stmt_raise, pl_exec.c:3911
 rolled_back_every_variant_identical 
-------------------------------------
 t
(1 row)

## f4. the SHIPPED set_pricing compile, reinstated: it pins Black to 17.00, and the commit refuses
SAVEPOINT
CREATE FUNCTION
UPDATE 1
SELECT 1
                      shipped_after_price                      
---------------------------------------------------------------
 {"amount": "17.0000", "origin": "variant", "currency": "CAD"}
(1 row)

psql:docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql:608: ERROR:  55000: CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED
DETAIL:  [{"field": "price_override", "variant_id": "22f9a4ac-eb8d-46a7-a134-1cc75800a700"}]
CONTEXT:  PL/pgSQL function public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text) line 129 at RAISE
SQL function "commit_write" statement 1
LOCATION:  exec_stmt_raise, pl_exec.c:3911
 black_still_inherits 
----------------------
 
(1 row)

ROLLBACK
 compile_set_pricing_md5_restored 
----------------------------------
 c504a193c60e4b244b3a092ae1de9ec0
(1 row)

## f5. redundant overrides nobody wrote do not trip it
 live_unit_id_overrides_equal_to_family_default 
------------------------------------------------
                                             21
(1 row)

 families_checked | families_with_offenders 
------------------+-------------------------
               33 |                       0
(1 row)

SELECT 1
SELECT 1
        vinyl_commit_readback        
-------------------------------------
 {"value": "6", "origin": "variant"}
(1 row)

 siblings_byte_identical 
-------------------------
 t
(1 row)


## 5. state at the end of the transaction, before it is thrown away
 variant  |     labels      | price_override | unit_cost_override | warning_threshold | critical_threshold | unit_id 
----------+-----------------+----------------+--------------------+-------------------+--------------------+---------
 22f9a4ac | Black / Normal  |                |                    | 25                |                    | 
 c9d86148 | Bronze / Normal |                |                    |                   |                    | 
 a69cde0d | Grey / Normal   | 17.0000        |                    | 40                |                    | 
 2c7cdf44 | White / Normal  | 15             |                    | 30                | 10                 | 
(4 rows)

 proposals | committed 
-----------+-----------
        19 |        15
(1 row)

ROLLBACK

## 6. after the rollback: the database is exactly as it was
 catalog_effect_policy_rows 
----------------------------
                          0
(1 row)

            commit_md5            
----------------------------------
 e515d98f1e3d761539e2f259f99a12b9
(1 row)

 rule_function 
---------------
 
(1 row)

                  id                  | price_override | unit_cost_override | warning_threshold | critical_threshold 
--------------------------------------+----------------+--------------------+-------------------+--------------------
 22f9a4ac-eb8d-46a7-a134-1cc75800a700 |                |                    |                30 |                 10
 2c7cdf44-3473-499b-b086-73737505a565 |                |                    |                30 |                 10
 a155f06d-2d35-4fbc-91c9-9a214a4dbf43 |                | 4.2                |                   |                   
(3 rows)

```
