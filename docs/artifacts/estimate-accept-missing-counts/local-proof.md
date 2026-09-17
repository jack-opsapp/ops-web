# Estimate acceptance refuses missing recipe counts — local proof

Migration: `supabase/migrations/20260917010000_estimate_accept_refuses_missing_counts.sql`
(file md5 `3411526a878f07c8fefae43921324369`). Branch `fix/estimate-accept-missing-counts`.

Everything below ran on 2026-09-16 (America/Vancouver) against the local proving
Postgres at `~/.ops-local-pg` (127.0.0.1:55432). Nothing touched production except
the read-only queries in §1.

| Database | What it is |
|---|---|
| `ops_eamc_before` | `TEMPLATE ops_override_level_apply` — production structure, Canpro seed, catalogue write vertical installed, zero-patch resolver (md5 `9541f451…`), **no** migration |
| `ops_eamc_final` | `TEMPLATE ops_eamc_before`, then the final migration file applied once |

Reproduce: `docs/artifacts/estimate-accept-missing-counts/{canpro-proof,quickbooks-proof,ledger-proof}.sql`
and `supabase/tests/estimate_accept_missing_counts.sql`; each file carries its own
psql line and ends in `ROLLBACK`.

---

## 1. Production, read-only (Supabase MCP `execute_sql`, project `ijeekuhbatykdomumfjx`)

Fingerprints the migration asserts, as production holds them:

| Function | md5(prosrc) | ACL |
|---|---|---|
| `public.accept_estimate_to_job(uuid,text)` | `3c61ba998d52ae3f42db9133a50fb27b` | postgres, authenticated, anon |
| `private.persist_estimate_material_booking_projection(uuid,uuid)` | `45957758c5fd5bccb35f902e1cd589c3` | postgres, authenticated, anon |
| `private.resolve_estimate_material_demand_plan(uuid,uuid)` | `9541f4512b764ea867635c32baa899a8` | postgres, authenticated, anon |
| `private.sync_accepted_estimate_project_tasks(uuid)` | `7190e77637656ab408767cecc7b4b34a` | — |
| `public.accept_estimate_to_job_from_quickbooks(uuid,uuid,uuid,text,text)` | `c8ada4851e5b2d7844c11eab5eb79d74` | postgres, service_role |
| `private.agent_catalog_setup_write_effect_revision()` | `a56dcc88d2f1a917d48833066bd6eb32` | postgres |
| `public.fn_set_updated_at()` | `1c4318bee4240d4113d86fad7eb15623` | — |

`product_options` on production: constraints `product_options_kind_check`, pkey, fkey
only — nothing reads `default_value`; one trigger, `trg_product_options_updated_at`.
No default privileges on schema `private` (new private functions must be granted
explicitly — the migration does).

The five rows the strip clears (the migration's `$prerequisites$` asserts exactly
these, and nothing else matches the rule anywhere in production):

| id | name | kind | required | affects_recipe | default_value | scaled recipe lines |
|---|---|---|---|---|---|---|
| `3b9c6b74…` | Left ends | integer | true | true | `1` | 4 |
| `97cc24bb…` | Right ends | integer | true | true | `1` | 4 |
| `20a023c9…` | Corners | integer | true | true | `0` | 4 |
| `fc1bafc4…` | 45° corners | integer | true | true | `0` | 1 |
| `f1594fb3…` | Wall returns | integer | true | true | `0` | 2 |

Stranding check (before merge):

| Measure | Production |
|---|---|
| required, recipe-affecting integer options, all companies | 5 (all on `3efc9582…` Picket Rail — Level) |
| integer options carrying any default, all companies | 5 (the same five) |
| line items on **non-accepted** estimates whose product has such an option | **0** |
| … of those lacking a numeric value | **0** |
| line items on such products, any estimate status | 0 |
| `product_materials` scaled by an option of another product, a deleted option, or a non-integer option | 0 |

Nothing in production is blocked or stranded on day one.

---

## 2. (g) The migration, and the catalogue write seal

Before (`ops_eamc_final`, untouched):

```
 seal: sha256:9af6b481c7fc86045008ee6d81d646b381c6cf6473fd481709ccd24bf48c23c6
 public.accept_estimate_to_job(...)  3c61ba998d52ae3f42db9133a50fb27b  {postgres=X/postgres,authenticated=X/postgres,anon=X/postgres}
 Left ends 1 · Right ends 1 · Corners 0 · 45° corners 0 · Wall returns 0   (Color Black · Mount Type Side mount · Height 42" · Lag length 3")
```

Apply:

```
BEGIN / SET / SET / DO ($prerequisites$)
CREATE TABLE / ALTER TABLE / ALTER TABLE / REVOKE / COMMENT
INSERT 0 5                       <- ledger rows, one statement with the strip
CREATE FUNCTION x3 / DO ($acl$) / COMMENT x2
NOTICE:  estimate acceptance: missing recipe counts refused (tracked inventory), 5 integer defaults cleared and ledgered, catalogue write seal unchanged
DO ($postflight$)
COMMIT
apply exit=0
```

After:

```
 seal: sha256:9af6b481c7fc86045008ee6d81d646b381c6cf6473fd481709ccd24bf48c23c6      <- identical
 private.assert_estimate_accept_recipe_counts(p_estimate_id uuid)  3e204df5599a030cab07b74176cd13ab  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}
 private.estimate_recipe_count_gaps(p_estimate_id uuid)            5338ead45ed9b05ae28e11b0df514a0b  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}
 private.persist_estimate_material_booking_projection(...)         45957758c5fd5bccb35f902e1cd589c3  (unchanged)
 private.resolve_estimate_material_demand_plan(...)                9541f4512b764ea867635c32baa899a8  (unchanged)
 private.sync_accepted_estimate_project_tasks(...)                 7190e77637656ab408767cecc7b4b34a  (unchanged)
 public.accept_estimate_to_job(...)                                92a60638e181008cb875ac9ae02379dc  {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}
 public.accept_estimate_to_job_from_quickbooks(...)                c8ada4851e5b2d7844c11eab5eb79d74  (unchanged)
 Left ends · Right ends · Corners · 45° corners · Wall returns: default_value NULL; the four selects keep theirs
```

The postflight also proves `accept_estimate_to_job` minus the one inserted block is
byte-exact with `3c61ba99…`, and the guard sits after the replay return and before
`sync_accepted_estimate_project_tasks(`.

Re-applying the file refuses and changes nothing:

```
ERROR:  estimate_accept_missing_counts_already_installed
reapply exit=3
```

---

## 3. Canpro "Picket Rail — Level", 20 lf (`canpro-proof.sql`)

Acceptance runs as `anon` with the Canpro operator's JWT subject — the role the iOS
app reaches PostgREST with.

### Before the migration (`ops_eamc_before`)

```
 step |              label              | accepted | replay |  mode   | warnings | demand_ids
    1 | (a) all counts entered          | t        | f      | tracked |        0 |         20
    2 | (b) Corners removed             | t        | f      | tracked |        4 |         20
    3 | (c) every integer count removed | t        | f      | tracked |       15 |         20
    4 | (d) Corners explicitly 0        | t        | f      | tracked |        0 |         20
    5 | (e) no recipe products          | t        | f      | tracked |        0 |          0
    6 | (f) replay of (a), same key     | t        | t      | tracked |        0 |         20

 (b)/(c) left behind: projects 1 · tasks 1 · demands 20 · snapshots 1 · acceptance_requests 1 · stage_transitions 1 · estimate approved · opportunity won
```

(c) is the "15 inventory warnings held for review" banner: a whole job booked with
zero end posts, corners, sleeves and endcaps.

### After the migration (`ops_eamc_final`)

```
 step |              label              | accepted | replay |  mode   | warnings | demand_ids | sqlstate |                 hint
    1 | (a) all counts entered          | t        | f      | tracked |        0 |         20 |          |
    2 | (b) Corners removed             | f        |        |         |          |            | 22023    | estimate_accept_recipe_counts_missing
    3 | (c) every integer count removed | f        |        |         |          |            | 22023    | estimate_accept_recipe_counts_missing
    4 | (d) Corners explicitly 0        | t        | f      | tracked |        0 |         20 |          |
    5 | (e) no recipe products          | t        | f      | tracked |        0 |          0 |          |
    6 | (f) replay of (a), same key     | t        | t      | tracked |        0 |         20 |          |
```

**(a) all counts entered — accepts, demands match the brief exactly**

```
 family              | variant                  | required
 Picket Rail 19'6    | Black / Picket           | 1.0520000
 Line                | Black / Side mount / 42" | 3.3340000
 EPL                 | Black / Side mount / 42" |         1
 EPR                 | Black / Side mount / 42" |         1
 Corner              | Black / Side mount / 42" |         1
 Corner Sleeve       | Black / Normal           |         1
 Line Sleeve         | Black / Normal           | 1.0520000
 Endcap rail         | Black                    |         2
 Lag Screws          | 3" / Black               |    38.000
 Tech Screws         | Black                    |    38.000
 45.0                | Black / Normal           |         0   (45° corners = 0)
 Bottom Wall Bracket | Black / Normal           |         0   (Wall returns = 0)
 Top Wall Bracket    | Black / Normal           |         0   (Wall returns = 0)
```

Identical to the before run and to `canpro-recipe-test/scenario-A-after-fix.txt`.

**(b) Corners removed — refused**

```
MESSAGE  Missing count on Picket Rail — Level: Corners. Open the estimate, enter the count, accept again.
HINT     estimate_accept_recipe_counts_missing
DETAIL   {"code": "estimate_accept_recipe_counts_missing",
          "estimate_id": "44444444-4444-4444-8444-00000000000b",
          "lines": [{"line_item_id": "55555555-5555-4555-8555-00000000000b",
                     "product_id": "3efc9582-ac59-4f13-919e-c1b3e3495cc3",
                     "product_name": "Picket Rail — Level",
                     "missing_counts": [{"product_option_id": "20a023c9-500e-4cf9-96a3-f518d9cee078",
                                         "name": "Corners", "configured_value": null}]}]}
```

What the refused call left behind:

```
 label                           | projects | tasks | demands | snapshots | acceptance_requests | stage_transitions | notifications | estimate_status | approved | has_project | opportunity_stage
 (b) Corners removed             |        0 |     0 |       0 |         0 |                   0 |                 0 |             0 | draft           | f        | f           | new_lead
 (c) every integer count removed |        0 |     0 |       0 |         0 |                   0 |                 0 |             0 | draft           | f        | f           | new_lead
```

**(c) every integer count removed — refused, each count named once (15 recipe lines, 5 counts)**

```
Missing counts on Picket Rail — Level: Left ends, Right ends, Corners, 45° corners, Wall returns. Open the estimate, enter the counts, accept again.
```

**(d) Corners explicitly 0 — accepts**; Corner and Corner Sleeve book 0, Lag/Tech Screws 32,
no warnings.

**(e) no recipe products — accepts exactly as before.** Normalised response (ok, mode,
warnings, overruns, missing mappings, demand count, project created, task count,
booking reason, demand performed) md5 `8d7966d49efe9f9665057d9adfb8b85e` on **both**
databases; `diff` of the two sections is empty.

**(f) replay of (a), same key — replays**: same project id, `idempotent_replay = true`,
one completed acceptance request.

---

## 4. Full case matrix (`supabase/tests/estimate_accept_missing_counts.sql`, `ops_eamc_final`)

Synthetic company, `anon` role. Railing = end post 2 per Left end, corner post 1 per
Corner, top rail 0.1/lf; every line 20 lf.

```
 step | case_label                                   | accepted | replay | mode    | sqlstate | result | message
    1 | A  all counts                                | t        | f      | tracked |          | PASS   |
    2 | A  replay, same key                          | t        | t      | tracked |          | PASS   |
    3 | B  Corners absent                            | f        |        |         | 22023    | PASS   | Missing count on Railing: Corners. Open the estimate, enter the count, accept again.
    4 | C  every count absent                        | f        |        |         | 22023    | PASS   | Missing counts on Railing: Left ends, Corners. Open the estimate, enter the counts, accept again.
    5 | D  Corners explicitly 0                      | t        | f      | tracked |          | PASS   |
    6 | E  no recipe counts                          | t        | f      | tracked |          | PASS   |
    7 | G  blank counts on unselected optional lines | t        | f      | tracked |          | PASS   |
    8 | H1 "2" and " 4 "                             | t        | f      | tracked |          | PASS   |
    9 | H2 Corners "abc"                             | f        |        |         | 22023    | PASS   | Missing count on Railing: Corners. Open the estimate, enter the count, accept again.
   10 | H3 true and null                             | f        |        |         | 22023    | PASS   | Missing counts on Railing: Left ends, Corners. Open the estimate, enter the counts, accept again.
   11 | H4 -2 and 0                                  | t        | f      | tracked |          | PASS   |
   12 | J1 two products                              | f        |        |         | 22023    | PASS   | Missing counts on Railing: Left ends, Corners; Gate: Gate posts. Open the estimate, enter the counts, accept again.
   13 | J2 four products                             | f        |        |         | 22023    | PASS   | Missing counts on Railing: Corners; Gate: Gate posts; Planter: Corners; and 1 more product. Open the estimate, enter the counts, accept again.
   14 | B  retry after Corners entered, same key     | t        | f      | tracked |          | PASS   |
   15 | F  inventory off, counts absent              | t        | f      | off     |          | PASS   |
   16 | I  count added after the line was written    | f        |        |         | 22023    | PASS   | Missing count on Deck rail: Stair posts. Open the estimate, enter the count, accept again.

B residue: projects 0 · tasks 0 · demands 0 · snapshots 0 · stage_transitions 0 · acceptance_requests 0 · notifications 0 · draft/unapproved/no project · stage quoted

Booked:  A end 2 / corner 3 / rail 2 · B retry corner 2 · D corner 0 · E fascia 10 · G end 4 / corner 1 · H1 end 4 / corner 4 · H4 end 0 / corner 0 · scaled warnings 0

Agreement with the resolver (estimate K, approved, job exists):
 line | count      | configured | resolver_warns | check_refuses
 02   | Left ends  | (absent)   | t              | t
 02   | Corners    | "abc"      | t              | t
 03   | Left ends  | true       | t              | t
 03   | Corners    | null       | t              | t
 04   | Corners    | "1e3"      | t              | t      ("2.5" on the same line counts, for both)
 07   | Gate posts | (array)    | t              | t
 (lines 01, 05 complete; 06 unselected optional; 08 unscaled — neither side reports them)

NOTICE:  estimate_accept_missing_counts_runtime_passed
```

Case I is test-matrix item (i): the Deck rail line was written with every count the
product had; a required "Stair posts" count and a recipe line scaled by it were added
afterwards; acceptance refuses and names the new count.

The resolver is unchanged — `supabase/tests/recipe_scaled_option_missing.sql` on
`ops_eamc_final`: 9/9 PASS, 4 `scaled_option_value_missing` warnings,
`recipe_scaled_option_missing_runtime_passed`.

---

## 5. (h) QuickBooks path (`quickbooks-proof.sql`)

A QuickBooks-accepted Canpro estimate with every count blank, through
`accept_estimate_to_job_from_quickbooks` as `service_role`:

```
 database        | migration_applied | md5
 ops_eamc_before | f                 | c8ada4851e5b2d7844c11eab5eb79d74
 status succeeded · mode tracked · warnings 15 · scaled_option_value_missing 15 · demand_rows 20 · zero_quantity_rows 15

 ops_eamc_final  | t                 | c8ada4851e5b2d7844c11eab5eb79d74
 status succeeded · mode tracked · warnings 15 · scaled_option_value_missing 15 · demand_rows 20 · zero_quantity_rows 15
```

Unchanged, deliberately. Why it was not changed (code read, not run):
`QuickBooksEstimateAcceptanceService.acceptFromQuickBooks` throws on any RPC error;
`QuickBooksWebhookApplyService.applyEstimate` catches it and returns
`status: "error"`, `detail: "accepted estimate bridge failed"`; the webhook route
writes one `accounting_sync_events` row (failed / needs_review) and one
`accounting_sync_log` row (error), and **always answers Intuit 200** so nothing
retries. No notification is created. The only surface that reads either table is the
sync history list (`GET /api/sync`), which shows the generic detail; the sync-issues
panel reads `accounting_sync_queue`, not these. A refusal there would leave the
customer's acceptance unconverted with the owner never told. The QuickBooks reconcile
route that re-applies estimates exists but is not scheduled in `vercel.json`.

---

## 6. Ledger, reversal, and the error body (`ledger-proof.sql`, `ops_eamc_final`)

```
=== LEDGER
 45° corners  | integer | 0 | updated_at_before 2026-09-15 14:11:48.411977-07
 Corners      | integer | 0 | …
 Left ends    | integer | 1 | …
 Right ends   | integer | 1 | …
 Wall returns | integer | 0 | …

=== APP ROLES CANNOT READ THE LEDGER
 anon f · authenticated f · service_role f

=== REVERSAL (the header's statement, rolled back)
UPDATE 5
 Left ends 1 · Right ends 1 · Corners 0 · 45° corners 0 · Wall returns 0
```

A 40 ft run with Left/Right ends 1, 45° corners 0, Corners and Wall returns blank —
the refusal as PostgREST serialises it (`code`, `message`, `details`, `hint`):

```
 code  | 22023
 hint  | estimate_accept_recipe_counts_missing
 message | Missing counts on Picket Rail — Level: Corners, Wall returns. Open the estimate, enter the counts, accept again.
 details | {"code": "estimate_accept_recipe_counts_missing", "estimate_id": "…e1", "lines": [{… "missing_counts": [{"name": "Corners", …}, {"name": "Wall returns", …}]}]}
```

How it reaches the iOS banner (supabase-swift 2.54.1, revision `b118484a`, the version
pinned in `ops-ios` `Package.resolved`, read from a checkout of that exact revision):
`PostgrestBuilder.execute` decodes a non-2xx body into `PostgrestError` with the default
decoder (no key strategy); `PostgrestError: LocalizedError` returns `message` as
`errorDescription`; `EstimateViewModel.markApproved` puts `error.localizedDescription`
into `.failed(message)`, rendered under "SYS :: ACCEPT FAILED". RPCs are POST and are
never retried by the client. `PostgrestError` declares `detail` while PostgREST sends
`details`, so DETAIL never reaches the app; `code` and `hint` do.

---

## 7. Web editor (vitest, tsc)

Test-first. Red before the resolver change (13 failing for the intended reason, e.g.
`expected { 'opt-color': 'val-black', …(8) } to not have property "opt-left"`), then:

```
 ✓ src/lib/estimates/__tests__/estimate-draft-validation.test.ts (5 tests)
 ✓ src/lib/products/__tests__/product-configuration-resolver.test.ts (23 tests)
 ✓ src/lib/catalog-setup/phase-c/__tests__/semantic-validator.test.ts (12 tests)
 ✓ src/lib/catalog-setup/phase-c/__tests__/session-service.test.ts (13 tests)
 ✓ src/components/ops/__tests__/product-configuration-fields.test.tsx (7 tests)
 ✓ tests/unit/components/create-estimate-form.test.tsx (6 tests)
 ✓ tests/unit/components/books-estimate-form-required-options.test.tsx (1 test)
 ✓ src/components/ops/__tests__/product-option-form-dialog.test.tsx (3 tests)
 ✓ tests/unit/services/quickbooks-estimate-acceptance-service.test.ts (3 tests)
 ✓ src/components/ops/__tests__/line-item-editor-pricing.test.ts (4 tests)
 ✓ tests/unit/ops/line-item-editor-calculator.test.tsx (10 tests)
 Test Files  11 passed (11)
      Tests  87 passed (87)
```

`tsc --noEmit`: 6 errors, all pre-existing test files (domain-dispatch, site-visit-canary,
forms, site-visit-approval, register-continuity, oauth-routes); none in changed files.
