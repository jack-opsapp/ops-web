# Estimate acceptance: hold + missing-count refusal (release step 1) — local proof

Migration: `supabase/migrations/20260917010000_estimate_accept_refuses_missing_counts.sql`
(file md5 `97b71af8eec21104d18efc7c533bc09d`). Branch `fix/estimate-accept-missing-counts`.

**Step 1 of 3.** Acceptance holds every tracked-inventory estimate that carries a
count-driven product (iOS invents counts: `LineItemEditSheet.swift:458`,
`DesignToEstimateAdapter.swift:143`), and refuses blank counts once the hold lifts.
Catalogue defaults are **not** touched. Step 2 is the iOS release; step 3 clears the
integer defaults and redefines `private.estimate_recipe_count_hold_active()` to
`select false`.

Everything below ran on 2026-09-16 (America/Vancouver) against the local proving
Postgres at `~/.ops-local-pg` (127.0.0.1:55432). Production was only read.

| Database | What it is |
|---|---|
| `ops_eamc_before` | `TEMPLATE ops_override_level_apply` — production structure, Canpro seed, catalogue write vertical installed, zero-patch resolver (md5 `9541f451…`), **no** migration |
| `ops_eamc_final` | `TEMPLATE ops_eamc_before`, then the final migration file applied once |

Reproduce: `docs/artifacts/estimate-accept-missing-counts/{canpro-proof,quickbooks-proof,refusal-body-proof}.sql`
and `supabase/tests/estimate_accept_missing_counts.sql`; each carries its own psql
line and ends in `ROLLBACK`. "Hold off" everywhere means the switch redefined to
`select false` inside that rolled-back transaction — exactly what step 3 will do.

---

## 1. Production, read-only (Supabase MCP `execute_sql`, project `ijeekuhbatykdomumfjx`)

Re-checked at `2026-09-17 04:01:13 UTC`, immediately before the final commits:

| Function | md5(prosrc) |
|---|---|
| `public.accept_estimate_to_job(uuid,text)` (replaced) | `3c61ba998d52ae3f42db9133a50fb27b` |
| `private.persist_estimate_material_booking_projection(uuid,uuid)` | `45957758c5fd5bccb35f902e1cd589c3` |
| `private.resolve_estimate_material_demand_plan(uuid,uuid)` | `9541f4512b764ea867635c32baa899a8` |
| `private.sync_accepted_estimate_project_tasks(uuid)` | `7190e77637656ab408767cecc7b4b34a` |
| `public.accept_estimate_to_job_from_quickbooks(uuid,uuid,uuid,text,text)` | `c8ada4851e5b2d7844c11eab5eb79d74` |
| `private.agent_catalog_setup_write_effect_revision()` | `a56dcc88d2f1a917d48833066bd6eb32` |

Picket Rail — Level count defaults (untouched by step 1): Left ends `1`, Right ends
`1`, Corners `0`, 45° corners `0`, Wall returns `0`. Hold and check not installed.
Line items on count-driven products, any estimate, any status: **0** — nothing is held
or refused on day one. (Earlier stranding check, same session: 5 required recipe count
options in production, all on this product; 0 lines on non-accepted estimates; 0 lacking
a numeric value.)

---

## 2. (f) The migration, and the catalogue write seal

Before (`ops_eamc_final`, untouched):

```
 seal: sha256:9af6b481c7fc86045008ee6d81d646b381c6cf6473fd481709ccd24bf48c23c6
 public.accept_estimate_to_job(...)  3c61ba998d52ae3f42db9133a50fb27b  {postgres=X/postgres,authenticated=X/postgres,anon=X/postgres}
 integer defaults: Left ends 1 · Right ends 1 · Corners 0 · 45° corners 0 · Wall returns 0
```

Apply:

```
BEGIN / SET / SET / DO ($prerequisites$)
CREATE FUNCTION x4 / DO ($acl$) / COMMENT x3
NOTICE:  estimate acceptance: count-driven products held, missing recipe counts refused (tracked inventory), no data changed, catalogue write seal unchanged
DO ($postflight$)
COMMIT
apply exit=0
```

After:

```
 seal: sha256:9af6b481c7fc86045008ee6d81d646b381c6cf6473fd481709ccd24bf48c23c6      <- identical
 private.assert_estimate_accept_recipe_counts(p_estimate_id uuid)  5cb8912c66ab91417afcc9fb5c56b80c  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}
 private.estimate_recipe_count_hold_active()                       12121c1c821d63ac9833861df2e81850  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}
 private.estimate_recipe_count_lines(p_estimate_id uuid)           1941e484c70701699fc6b0d7e770dfef  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}
 private.persist_estimate_material_booking_projection(...)         45957758c5fd5bccb35f902e1cd589c3  (unchanged)
 private.resolve_estimate_material_demand_plan(...)                9541f4512b764ea867635c32baa899a8  (unchanged)
 private.sync_accepted_estimate_project_tasks(...)                 7190e77637656ab408767cecc7b4b34a  (unchanged)
 public.accept_estimate_to_job(...)                                9f533799f54d0fae2f5aa062038283d0  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}
 public.accept_estimate_to_job_from_quickbooks(...)                c8ada4851e5b2d7844c11eab5eb79d74  (unchanged)
 integer defaults: Left ends 1 · Right ends 1 · Corners 0 · 45° corners 0 · Wall returns 0     <- unchanged
 private.integer_option_defaults_cleared_20260917: does not exist
```

The postflight also proves: `accept_estimate_to_job` minus the one inserted block is
byte-exact with `3c61ba99…`; the check sits after the replay return and before
`sync_accepted_estimate_project_tasks(`; the hold is evaluated before the count check;
the switch returns true; the four installed bodies hash to the values above.

Re-applying the file refuses and changes nothing:

```
ERROR:  estimate_accept_missing_counts_already_installed
reapply exit=3
```

---

## 3. Canpro "Picket Rail — Level", 20 lf (`canpro-proof.sql`)

As `anon` with the Canpro operator's JWT subject (the iOS path). Estimates `0a`–`0f`,
keys `canpro-proof-<case>`; phase 2 re-uses phase 1's keys.

### After the migration (`ops_eamc_final`)

```
 step | hold  | label                                                     | accepted | replay | mode    | warnings | demand_ids | sqlstate | hint
    1 | true  | (a) all counts entered                                    | f        |        |         |          |            | 22023    | estimate_accept_recipe_counts_hold
    2 | true  | (b) Corners removed                                       | f        |        |         |          |            | 22023    | estimate_accept_recipe_counts_hold
    3 | true  | (c) no count-driven product                               | t        | f      | tracked |        0 |          0 |          |
    4 | true  | (d) replay of (c), same key                               | t        | t      | tracked |        0 |          0 |          |
    5 | false | (e) all counts entered, same key as (a)                   | t        | f      | tracked |        0 |         20 |          |
    6 | false | (e) Corners removed, same key as (b)                      | f        |        |         |          |            | 22023    | estimate_accept_recipe_counts_missing
    7 | false | (e) every integer count removed                           | f        |        |         |          |            | 22023    | estimate_accept_recipe_counts_missing
    8 | false | (e) Corners explicitly 0                                  | t        | f      | tracked |        0 |         20 |          |
    9 | false | (e) replay of all counts entered                          | t        | t      | tracked |        0 |         20 |          |
   10 | false | (e) retry after Corners entered, same key as (b)          | t        | f      | tracked |        0 |         20 |          |
   11 | false | (e) count added to the product after the line was written | f        |        |         |          |            | 22023    | estimate_accept_recipe_counts_missing
   12 | true  | (d) replay of (e) all counts, hold back on                | t        | t      | tracked |        0 |         20 |          |
```

**Refusal text (the iOS banner reads MESSAGE verbatim):**

```
 1  Picket Rail — Level can't be accepted from the app until the next OPS update. The estimate is safe to leave as is.
 2  Picket Rail — Level can't be accepted from the app until the next OPS update. The estimate is safe to leave as is.
 6  Missing count on Picket Rail — Level: Corners. Open the estimate, enter the count, accept again.
 7  Missing counts on Picket Rail — Level: Left ends, Right ends, Corners, 45° corners, Wall returns. Open the estimate, enter the counts, accept again.
11  Missing count on Picket Rail — Level: Stair returns. Open the estimate, enter the count, accept again.
```

**(a) all counts entered — held.** DETAIL:

```
{"code": "estimate_accept_recipe_counts_hold",
 "estimate_id": "44444444-4444-4444-8444-00000000000a",
 "products": [{"product_id": "3efc9582-ac59-4f13-919e-c1b3e3495cc3",
               "product_name": "Picket Rail — Level",
               "line_item_ids": ["55555555-5555-4555-8555-00000000000a"]}]}
```

**(b) blank Corners — held, not count-refused**: the hold is decided first (hint `…_hold`).

**What a refused call left behind:**

```
 label                              | projects | tasks | demands | snapshots | acceptance_requests | stage_transitions | notifications | estimate                    | stage
 (a) hold refusal                   | 0        | 0     | 0       | 0         | 0                   | 0                 | 0             | draft/unapproved/no project | new_lead
 (b) hold refusal                   | 0        | 0     | 0       | 0         | 0                   | 0                 | 0             | draft/unapproved/no project | new_lead
 (e) count refusal, Corners removed | 0        | 0     | 0       | 0         | 0                   | 0                 | 0             | draft/unapproved/no project | new_lead
```

Retry-safe: steps 5 and 6 re-use the held calls' keys and run fresh (`replay f`).

**(c) no count-driven product — accepts exactly as before.** Normalised response md5
`8d7966d49efe9f9665057d9adfb8b85e` on both databases; `diff` of the two sections is empty.

**(d) replays.** Replay of (c) under the hold; and step 12 — Picket Rail estimate
accepted with the hold off (standing in for one accepted before this migration), replayed
after the hold is back on — `same_project t · replay_flag t · completed_requests 1`.

**(e) hold off — the guard, ready for step 3.**
- All counts entered accepts, demands exactly the table: Picket Rail 19'6 Black/Picket
  1.052 · Line 3.334 · EPL 1 · EPR 1 · Corner 1 · Corner Sleeve 1 · Line Sleeve 1.052 ·
  Endcap rail 2 · Lag Screws 3"/Black 38 · Tech Screws Black 38 (45.0, Bottom/Top Wall
  Bracket 0). Identical to `canpro-recipe-test/scenario-A-after-fix.txt`.
- Blank Corners refused naming Corners; every count removed refused naming all five once.
- Corners explicitly 0 accepts: Corner 0, Corner Sleeve 0, Lag/Tech Screws 32, no warnings.
- A count ("Stair returns", required, with a recipe line scaled by it) added to the product
  after the line was written with every count: refused, names it.
- Retry after entering Corners, same key: accepts fresh; Corner 1, Corner Sleeve 1,
  Lag/Tech Screws 38.

### Before the migration (`ops_eamc_before`), same script, for contrast

```
 (a) all counts entered                                    t  tracked  warnings 0   demands 20
 (b) Corners removed                                       t  tracked  warnings 4   demands 20
 (c) no count-driven product                               t  tracked  warnings 0   demands 0
 (e) every integer count removed                           t  tracked  warnings 15  demands 20   <- the "15 warnings held for review" job
 (e) count added to the product after the line was written t  tracked  warnings 1   demands 21
 (a)/(b) left behind: projects 1 · tasks 1 · demands 20 · snapshots 1 · acceptance_requests 1 · stage_transitions 1 · approved · won
```

---

## 4. Full matrix (`supabase/tests/estimate_accept_missing_counts.sql`, `ops_eamc_final`)

Synthetic company, `anon` role. Railing = end post 2 per Left end, corner post 1 per
Corner, top rail 0.1/lf (its counts carry catalogue defaults 1 and 0, to show the
database never uses them); every line 20 lf. All 26 PASS.

```
 step | hold | case                                                      | accepted | replay | mode    | hint
    1 | t    | HOLD A  all counts entered                                | f        |        |         | estimate_accept_recipe_counts_hold
    2 | t    | HOLD B  Corners absent                                    | f        |        |         | estimate_accept_recipe_counts_hold
    3 | t    | HOLD J1 two products                                      | f        |        |         | estimate_accept_recipe_counts_hold
    4 | t    | HOLD J3 three products, every count entered               | f        |        |         | estimate_accept_recipe_counts_hold
    5 | t    | HOLD J2 four products                                     | f        |        |         | estimate_accept_recipe_counts_hold
    6 | t    | HOLD E  no count-driven product                           | t        | f      | tracked |
    7 | t    | HOLD E  replay, same key                                  | t        | t      | tracked |
    8 | t    | HOLD G  count-driven products only as unselected optionals| t        | f      | tracked |
    9 | t    | HOLD F  inventory off, count-driven product               | t        | f      | off     |
   10 | f    | A  all counts                                             | t        | f      | tracked |
   11 | f    | A  replay, same key                                       | t        | t      | tracked |
   12 | f    | B  Corners absent                                         | f        |        |         | estimate_accept_recipe_counts_missing
   13 | f    | C  every count absent                                     | f        |        |         | estimate_accept_recipe_counts_missing
   14 | f    | D  Corners explicitly 0                                   | t        | f      | tracked |
   15 | f    | E  no recipe counts                                       | t        | f      | tracked |
   16 | f    | G  blank counts on unselected optional lines              | t        | f      | tracked |
   17 | f    | H1 "2" and " 4 "                                          | t        | f      | tracked |
   18 | f    | H2 Corners "abc"                                          | f        |        |         | estimate_accept_recipe_counts_missing
   19 | f    | H3 true and null                                          | f        |        |         | estimate_accept_recipe_counts_missing
   20 | f    | H4 -2 and 0                                               | t        | f      | tracked |
   21 | f    | J1 two products                                           | f        |        |         | estimate_accept_recipe_counts_missing
   22 | f    | J2 four products                                          | f        |        |         | estimate_accept_recipe_counts_missing
   23 | f    | B  retry after Corners entered, same key                  | t        | f      | tracked |
   24 | f    | F  inventory off, counts absent                           | t        | f      | off     |
   25 | f    | I  count added after the line was written                 | f        |        |         | estimate_accept_recipe_counts_missing
   26 | t    | HOLD A  replay of A accepted with the hold off            | t        | t      | tracked |
```

Messages, exactly as asserted:

```
HOLD A, B   Railing can't be accepted from the app until the next OPS update. The estimate is safe to leave as is.
HOLD J1     Railing and Gate can't be accepted from the app until the next OPS update. The estimate is safe to leave as is.
HOLD J3     Railing, Gate and Planter can't be accepted from the app until the next OPS update. The estimate is safe to leave as is.
HOLD J2     Railing, Gate, Planter and 1 more product can't be accepted from the app until the next OPS update. The estimate is safe to leave as is.
B, H2       Missing count on Railing: Corners. Open the estimate, enter the count, accept again.
C, H3       Missing counts on Railing: Left ends, Corners. Open the estimate, enter the counts, accept again.
J1          Missing counts on Railing: Left ends, Corners; Gate: Gate posts. Open the estimate, enter the counts, accept again.
J2          Missing counts on Railing: Corners; Gate: Gate posts; Planter: Corners; and 1 more product. Open the estimate, enter the counts, accept again.
I           Missing count on Deck rail: Stair posts. Open the estimate, enter the count, accept again.
```

Residue — hold refusal of A and count refusal of B: projects 0 · tasks 0 · demands 0 ·
snapshots 0 · stage_transitions 0 · acceptance_requests 0 · notifications 0 ·
draft/unapproved/no project · stage quoted.

Booked with the hold off: A end 2 / corner 3 / rail 2 · B retry corner 2 · D corner 0 ·
E fascia 10 · G end 4 / corner 1 · H1 end 4 / corner 4 · H4 end 0 / corner 0 · scaled
warnings 0 · off-mode demands 0.

Agreement with the resolver (estimate K, approved, job exists): the check reads
"missing" on exactly the six (line, count) pairs the resolver warns on — `02` Left ends
(absent) and Corners `"abc"`, `03` Left ends `true` and Corners `null`, `04` Corners
`"1e3"` (`"2.5"` counts for both), `07` Gate posts (configured_options is an array). The
hold sees booked lines `01:0, 02:2, 03:2, 04:1, 05:0, 07:1` — never the unselected
optional line 06 or the unscaled Fascia line 08.

`NOTICE:  estimate_accept_missing_counts_runtime_passed`

The resolver is unchanged: `supabase/tests/recipe_scaled_option_missing.sql` on
`ops_eamc_final` — 9/9 PASS, `recipe_scaled_option_missing_runtime_passed`.

---

## 5. (g) QuickBooks path (`quickbooks-proof.sql`)

QuickBooks-accepted Canpro estimate, every count blank, as `service_role` — with the
hold installed and on:

```
 ops_eamc_before | migration f | c8ada4851e5b2d7844c11eab5eb79d74 | succeeded · tracked · warnings 15 · scaled_option_value_missing 15 · demand_rows 20 · zero_quantity_rows 15
 ops_eamc_final  | migration t | c8ada4851e5b2d7844c11eab5eb79d74 | succeeded · tracked · warnings 15 · scaled_option_value_missing 15 · demand_rows 20 · zero_quantity_rows 15
```

Unchanged, deliberately: a refusal there becomes a sync log row reading "accepted
estimate bridge failed", Intuit gets 200 (no retry), and no one is notified.

---

## 6. The refusals as PostgREST serialises them (`refusal-body-proof.sql`)

40 ft run, Left/Right ends 1, 45° corners 0, Corners and Wall returns blank.

```
 hold on  | 22023 | estimate_accept_recipe_counts_hold    | Picket Rail — Level can't be accepted from the app until the next OPS update. The estimate is safe to leave as is.
          details {"code": "estimate_accept_recipe_counts_hold", "estimate_id": "…e1", "products": [{"product_id": "3efc9582-…", "product_name": "Picket Rail — Level", "line_item_ids": ["…e1"]}]}
 hold off | 22023 | estimate_accept_recipe_counts_missing | Missing counts on Picket Rail — Level: Corners, Wall returns. Open the estimate, enter the counts, accept again.
          details {"code": "estimate_accept_recipe_counts_missing", "estimate_id": "…e1", "lines": [{… "missing_counts": [{"name": "Corners", …}, {"name": "Wall returns", …}]}]}
```

How MESSAGE reaches the iOS banner (supabase-swift 2.54.1, revision `b118484a`, pinned in
`ops-ios` `Package.resolved`): `PostgrestBuilder.execute` decodes a non-2xx body into
`PostgrestError` with the default decoder; `errorDescription` is `message`;
`EstimateViewModel.markApproved` shows `error.localizedDescription` under "SYS :: ACCEPT
FAILED". RPCs are POST and never retried by the client. `PostgrestError` declares
`detail` while PostgREST sends `details`, so DETAIL never reaches the app; `code` and
`hint` do.

---

## 7. Web editor (vitest, tsc) — final code

```
 ✓ src/lib/products/__tests__/product-configuration-resolver.test.ts (23 tests)
 ✓ src/lib/estimates/__tests__/estimate-draft-validation.test.ts (5 tests)
 ✓ src/lib/catalog-setup/phase-c/__tests__/semantic-validator.test.ts (12 tests)
 ✓ src/lib/catalog-setup/phase-c/__tests__/session-service.test.ts (13 tests)
 ✓ src/components/ops/__tests__/product-configuration-fields.test.tsx (7 tests)
 ✓ tests/unit/components/create-estimate-form.test.tsx (6 tests)
 ✓ tests/unit/components/books-estimate-form-required-options.test.tsx (1 test)
 ✓ tests/unit/services/quickbooks-estimate-acceptance-service.test.ts (3 tests)
 ✓ src/components/ops/__tests__/product-option-form-dialog.test.tsx (3 tests)
 ✓ src/components/ops/__tests__/line-item-editor-pricing.test.ts (4 tests)
 ✓ tests/unit/ops/line-item-editor-calculator.test.tsx (10 tests)
 Test Files  11 passed (11)
      Tests  87 passed (87)
```

`tsc --noEmit`: 6 errors, all pre-existing test files (domain-dispatch, site-visit-canary,
forms, site-visit-approval, register-continuity, oauth-routes); none in changed files.
