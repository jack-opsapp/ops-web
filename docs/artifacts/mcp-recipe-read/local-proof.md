# Local SQL proof — catalogue recipe read v2 under exposure V24

Migration proved: `supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql`

Database: a local PostgreSQL 17 copy of production structure plus Canpro Deck
and Rail's real catalogue (company `a612edc0-5c18-4c4d-af97-55b9410dd077`,
product *Picket Rail — Level* `3efc9582-ac59-4f13-919e-c1b3e3495cc3`, 20 recipe
lines, 9 product options). The whole run is one transaction that ends in
`rollback`; section 12 re-reads the function source afterwards to show the
database is untouched.

Everything between `begin;` and `rollback;` ran in a single psql session with
`ON_ERROR_STOP on`; the run reported zero errors.

## What each section proves

| § | Claim |
|---|-------|
| 0 | The database carries the exact base definition this migration was written against (`prosrc` md5 `bb36d87af76f5e759a58a3bf7183c42e`, 28366 bytes). |
| 1 | Result fingerprints for three real families, taken before the migration. |
| 2 | The migration applies cleanly: guards pass, the pre-shape overloads are dropped, three functions are created, grants are re-applied, the V24 exposure patches land. |
| 3 | **Shape v1 is byte-identical to the pre-migration definition** on all three families. |
| 4 | **Shape v2 reads the EPL line as scaled**: `quantity_basis = per_option_count`, `scaled_by.option_name = "Left ends"`, with the three-axis `variant_selector`. This is gap #27 — the line no longer reads as "1 EPL per unit". |
| 5 | Lag Screws' four lines (design note 12) come back in a deterministic order, three scaled by different count options, each with its own `material_ref`. |
| 6 | `recipe_products` lists the referencing product's **nine** options with their kinds. |
| 7 | Shape v1 exposes neither `recipe_products` nor the new per-line fields; shape v2 reports its own bounded source counts. |
| 7b | A four-decimal quantity (`0.0526`, three such lines exist in production) makes shape v1 refuse the whole family; shape v2 reads it through `quantity_per_unit` with `quantity_milliunits` null. |
| 8 | An unknown or null shape raises `invalid_agent_catalog_detail_request` (SQLSTATE 22023). |
| 9 | Every function that accepted `2026-09-10.mcp-exposure.v23` now also names `2026-09-15.mcp-exposure.v24`, and still names V23. |
| 10 | A real bearer on an existing V23 grant still resolves when the app's active revision is V24, and a new V24 grant resolves too. |
| 11 | No customer-update effect-policy row was seeded. |
| 12 | After `rollback` the production definition is unchanged. |

## Transcript

```
Pager usage is off.
BEGIN

## 0. base definition present on this database
            prosrc_md5            | prosrc_bytes 
----------------------------------+--------------
 bb36d87af76f5e759a58a3bf7183c42e |        28366
(1 row)

SET
INSERT 0 1
INSERT 0 1
INSERT 0 1
SET
CREATE FUNCTION

## 1. pre-migration result fingerprints
SELECT 3
                  family                   |            result_md5            
-------------------------------------------+----------------------------------
 Corner Sleeve (1 line, scaled by Corners) | ac27c2315d80c4127696044b4e3c5d5d
 EPL (1 line, scaled by Left ends)         | b28fa70f27969e2e1c4f8f2b1ac9f52a
 Lag Screws (4 lines, 3 scaled)            | 663fab47aa0f260f9774c24fd7eadc74
(3 rows)


## 2. applying supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql
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
CREATE FUNCTION

## 3. shape v1 is byte-identical to the pre-migration definition
                  family                   |            before_md5            |           after_v1_md5           | identical 
-------------------------------------------+----------------------------------+----------------------------------+-----------
 Corner Sleeve (1 line, scaled by Corners) | ac27c2315d80c4127696044b4e3c5d5d | ac27c2315d80c4127696044b4e3c5d5d | t
 EPL (1 line, scaled by Left ends)         | b28fa70f27969e2e1c4f8f2b1ac9f52a | b28fa70f27969e2e1c4f8f2b1ac9f52a | t
 Lag Screws (4 lines, 3 scaled)            | 663fab47aa0f260f9774c24fd7eadc74 | 663fab47aa0f260f9774c24fd7eadc74 | t
(3 rows)


## 4. shape v2 - the EPL line scaled by "Left ends"
                        epl_recipes_v2                         
---------------------------------------------------------------
 [                                                            +
     {                                                        +
         "unit": null,                                        +
         "scaled_by": {                                       +
             "option_ref": {                                  +
                 "id": "3b9c6b74-f889-4027-9752-fe1cd3f838de",+
                 "kind": "product_option"                     +
             },                                               +
             "option_name": "Left ends"                       +
         },                                                   +
         "family_ref": {                                      +
             "id": "8bc6b876-eef7-ced7-7607-8f5ed97cd351",    +
             "kind": "catalog_family"                         +
         },                                                   +
         "product_ref": {                                     +
             "id": "3efc9582-ac59-4f13-919e-c1b3e3495cc3",    +
             "kind": "product"                                +
         },                                                   +
         "variant_ref": null,                                 +
         "content_kind": "untrusted_business_data",           +
         "material_ref": {                                    +
             "id": "17746a0c-fae5-403b-ba2b-53d5cd899e0b",    +
             "kind": "product_material"                       +
         },                                                   +
         "relationship": "recipe",                            +
         "product_label": "Picket Rail — Level",              +
         "quantity_basis": "per_option_count",                +
         "variant_selector": [                                +
             {                                                +
                 "value_expression": "$option.color",         +
                 "catalog_option_label": "Color"              +
             },                                               +
             {                                                +
                 "value_expression": "$option.height",        +
                 "catalog_option_label": "Height"             +
             },                                               +
             {                                                +
                 "value_expression": "$option.mount type",    +
                 "catalog_option_label": "Mount Type"         +
             }                                                +
         ],                                                   +
         "quantity_per_unit": "1.0000",                       +
         "quantity_milliunits": 1000                          +
     }                                                        +
 ]
(1 row)


## 5. shape v2 - Lag Screws four lines, three scaled, deterministic order
 n | scaled_by_option |  quantity_basis  | quantity_per_unit | quantity_milliunits |             material_ref             |                                                                    variant_selector                                                                    
---+------------------+------------------+-------------------+---------------------+--------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------
 1 | Right ends       | per_option_count | 6.0000            | 6000                | 3420c7f1-2abe-4ada-b1bd-3853c7b76e6e | [{"value_expression": "$option.color", "catalog_option_label": "Color"}, {"value_expression": "$option.lag length", "catalog_option_label": "Length"}]
 2 | Corners          | per_option_count | 6.0000            | 6000                | 3e2cfdc8-b815-4845-8cf5-419b9a7d11c0 | [{"value_expression": "$option.color", "catalog_option_label": "Color"}, {"value_expression": "$option.lag length", "catalog_option_label": "Length"}]
 3 |                  | per_product_unit | 1.0000            | 1000                | 4bc18a71-b1d2-4ddf-bcd0-63a85213f8c0 | [{"value_expression": "$option.color", "catalog_option_label": "Color"}, {"value_expression": "$option.lag length", "catalog_option_label": "Length"}]
 4 | Left ends        | per_option_count | 6.0000            | 6000                | 8ec38194-4cdc-46ec-9d2d-63d69d714ebf | [{"value_expression": "$option.color", "catalog_option_label": "Color"}, {"value_expression": "$option.lag length", "catalog_option_label": "Length"}]
(4 rows)


## 6. shape v2 - recipe_products lists the product options
             product_ref              |    product_label    | option_count |                                                                                        options                                                                                         
--------------------------------------+---------------------+--------------+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 3efc9582-ac59-4f13-919e-c1b3e3495cc3 | Picket Rail — Level |            9 | Color (select), Mount Type (select), Height (select), Lag length (select), Left ends (integer), Right ends (integer), Corners (integer), 45° corners (integer), Wall returns (integer)
(1 row)


## 7. shape v1 exposes no recipe_products and no new per-line fields
 v1_has_recipe_products | v2_has_recipe_products | v1_line_has_scaled_by | v2_line_has_scaled_by |                                                                                             v2_source_inspected                                                                                             
------------------------+------------------------+-----------------------+-----------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 f                      | t                      | f                     | t                     | {"options": 3, "recipes": 1, "families": 1, "variants": 7, "stock_units": 0, "option_values": 6, "supplier_costs": 0, "recipe_products": 1, "recipe_product_options": 9, "recipe_product_option_values": 9}
(1 row)



## 7b. a four-decimal line: shape v1 refuses the family, shape v2 reads it
psql:proof-run.sql:1790: NOTICE:  Line Sleeve shape v1 -> SQLSTATE 22023 / agent_catalog_source_data_invalid
psql:proof-run.sql:1790: NOTICE:  Line Sleeve shape v2 -> quantity_per_unit=0.0526 quantity_milliunits=null basis=per_product_unit
DO
## 8. an unknown shape is refused
psql:proof-run.sql:1814: NOTICE:  shape v3 -> SQLSTATE 22023 / invalid_agent_catalog_detail_request
psql:proof-run.sql:1814: NOTICE:  shape null -> SQLSTATE 22023 / invalid_agent_catalog_detail_request
DO

## 9. exposure V24 is accepted everywhere V23 is, and V23 still is
                                                                        signature                                                                         | v24_mentions | v23_mentions 
----------------------------------------------------------------------------------------------------------------------------------------------------------+--------------+--------------
 public.resolve_mcp_oauth_access_token_as_system(text,text)                                                                                               |            6 |            6
 private.assert_agent_customer_update_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)                                          |            1 |            1
 public.consume_agent_customer_update_prepare_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)                                            |            1 |            1
 public.prepare_agent_customer_update_for_grant_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,jsonb,timestamp with time zone) |            1 |            1
(4 rows)


## 10. a V24 bearer resolves and the existing V23 bearer keeps resolving
INSERT 0 1
INSERT 0 1
INSERT 0 2
  set_config  
--------------
 service_role
(1 row)

                                        bearer                                         | resolved 
---------------------------------------------------------------------------------------+----------
 existing V23 grant, active revision V24                                               |        1
 new V24 grant, active revision V24                                                    |        1
 existing V23 grant, active revision V23 (unchanged)                                   |        1
 V24 grant under an older V23 active revision (cross-accepted, as V14/V23 already are) |        1
(4 rows)

 set_config 
------------
 
(1 row)

## 11. no effect-policy row was seeded
 customer_update_policy_rows 
-----------------------------
                           0
(1 row)

ROLLBACK

## 12. after rollback the production definition is untouched
            prosrc_md5            | prosrc_bytes 
----------------------------------+--------------
 bb36d87af76f5e759a58a3bf7183c42e |        28366
(1 row)
```
