# `search_workspace` — probe record

Task 1 of `docs/plans/2026-09-08-universal-search-database.md`. Spec:
`docs/superpowers/specs/2026-09-08-universal-search-database-design.md`.

Applied to production `ijeekuhbatykdomumfjx` as ledger version **20260909051424**
(`search_workspace_rpc`); `md5(statements[1]) = 844669be4b881ba4aac31f68c747745e`,
byte-identical to `supabase/migrations/20260909051424_search_workspace_rpc.sql`
(trailing newline stripped) and to the bible archive copy.

Every probe ran inside `begin; … rollback;`. Nothing but the migration persisted.

Personas
- **Founder / admin:** `canprojack@gmail.com` `283d49df-90a1-4abb-b94c-3e9f17f02c0d`,
  Canpro `a612edc0-5c18-4c4d-af97-55b9410dd077`.
- **Assigned-scope crew:** `michael.truong1231@gmail.com` `8cd7056e-85d9-4aea-899e-71614c80adb7`,
  same company, non-admin, `projects.view`/`clients.view`/`tasks.view = assigned`,
  `invoices.view`/`estimates.view` unset.
- **Documents:** Canpro holds **zero** invoices and estimates, so the document probes
  ran as `peterjmitchell1988@gmail.com` (MAVERICK PROJECTS LTD
  `ddee107c-33cd-483e-8278-0f8d8a180181`, 44 invoices / 27 estimates — the only
  company in production with either).

---

## Step 1 — normalizer output (never assumed)

```
private.agent_normalize_discovery_text('  Héllo   WORLD  (250) 555-1234 INV-104_2 ')
  → 'héllo world (250) 555-1234 inv-104_2'
private.agent_normalize_discovery_phone('(250) 555-1234') → '+12505551234'
private.agent_normalize_discovery_phone('2505551')        → NULL
private.agent_normalize_discovery_phone('hidden')         → NULL
```

Three findings that changed the SQL:

1. **Lower-cased, whitespace-collapsed, trimmed — but diacritics are NOT folded.**
   `Héllo → héllo`, not `hello`. `unaccent` is not installed (extensions present:
   citext, pg_cron, pg_net, pg_stat_statements, pg_trgm, pgcrypto, plpgsql,
   supabase_vault, uuid-ossp, vector). No `lower(...)` wrapper is needed. Accent
   insensitivity in spec §4.3 is only as strong as NFKC: `RENÉ` finds `René`,
   `rene` does not.
2. **A phone *fragment* does not normalize.** `agent_normalize_discovery_phone`
   accepts only a complete NANP number, so the spec's own requirement that
   `2505551` match `(250) 555-1234` is unreachable through the helper the plan
   names. The token side now uses its own digit run
   (`regexp_replace(tok,'[^0-9]','','g')`, ≥3 digits, token made only of
   `[+0-9(). -]`); the stored side still goes through the helper, so the fragment
   is matched against the canonical `+1XXXXXXXXXX`.
3. **`agent_normalize_discovery_text` is SECURITY INVOKER** and calls
   `agent_discovery_unicode15_text_is_supported` and
   `agent_trim_discovery_display_text`. Both are confirmed executable by
   `anon`/`authenticated`, and the migration now asserts them (the plan asserted
   only the three top-level helpers) plus `USAGE` on schema `private`.

`private.agent_escape_like_literal` and `private.agent_discovery_prefix_upper_bound`
are executable by **no** API role (`anon`/`authenticated`/`service_role` all false)
— confirmed, and not called.

Escape mechanics verified directly (the `\` inside `$fn$ … $fn$` survives):

```
'a_b'  like '%a\_b%'  escape '\' → true      'axb'  like '%a\_b%'  escape '\' → false
'100%' like '%100\%%' escape '\' → true      '100x' like '%100\%%' escape '\' → false
```

---

## Step 2 — two defects found in the plan's SQL during the dry run

### A. NULL propagation admitted every row (correctness)

The plan's match predicate is
`not exists (select 1 from unnest(...) tk where not (<or-chain>))`.
When every field of a row is NULL the or-chain is NULL, `not NULL` is NULL, the
subquery returns nothing, and `not exists` is **true** — the row matches.

First dry run, `search_workspace('hidden oaks')` as the founder:

```
projects 275   clients 465   leads 483   tasks 317      <- every visible row
```

Isolated A/B on the projects predicate:

```
without coalesce → 25 rows        with coalesce(<or-chain>, false) → 1 row
```

Every kind now wraps the or-chain in `coalesce(…, false)`. The tier-2 test also
uses `coalesce(<primary>,'')` so a NULL primary field cannot be mis-ranked as
"all tokens in the name".

### B. Document numbers had to match by *contains*, not prefix

Spec §4.2 requires `104` to find `INV-1042`, but `104` is not a prefix of
`inv1042`, and the plan's predicate is `number_key like key || '%'`. Matching is
now `number_key like '%' || key || '%'`; **ranking is unchanged** (tier 0
equality, tier 1 prefix), so `inv104` still outranks `104`.

---

## Step 3 / Step 5 — probes

Probes 1–3 were run in the dry run and again against the applied function; 4–9
were run against the applied function. Results below are the applied function's.

### 1. `search_workspace('hidden oaks')` — founder

```
tokens ["hidden","oaks"]   projects.total 1   clients 0   leads 0   tasks 1   documents 0
projects.items[0].title "3556 Hidden Oaks Cres"
  address "3556 Hidden Oaks Cres, Cobble Hill, BC, Canada"  status "completed"
  client_name "James Thompson"  updated_at "2026-08-07T20:55:52.838051+00:00"
```

### 2. Ranking tiers — project `3556 Hidden Oaks Cres` (`bfd686b8-…`)

| tier | query | projects.total | items[0].title |
|---|---|---|---|
| 0 exact | `3556 Hidden Oaks Cres` | 1 | 3556 Hidden Oaks Cres |
| 1 prefix | `3556 hidden` | 1 | 3556 Hidden Oaks Cres |
| 2 all tokens, reordered | `cres oaks hidden 3556` | 1 | 3556 Hidden Oaks Cres |
| 3 scattered (address word + client-name word) | `cobble thompson` | 1 | 3556 Hidden Oaks Cres |

Tier 3 is the real cross-field proof: neither `cobble` nor `thompson` is in the
title — one is in the address, the other only in the joined client's name.

### 3. Phone — client `Ken Swift`, stored `250-896-0799`

| query | clients.total | items[0] |
|---|---|---|
| `2508960799` (bare digits) | 1 | Ken Swift / 250-896-0799 |
| `2508960` (**fragment**) | 1 | Ken Swift / 250-896-0799 |
| `250-896-0799` (as stored) | 1 | Ken Swift / 250-896-0799 |

The middle row is the case the plan's SQL could not have satisfied.

### 4. Document numbers — Maverick

| query | documents.total | items |
|---|---|---|
| `qb220` | 1 | estimate `QB-220`, approved, 565.00, "LIVE-QBO-MAP-mq4anho6 Customer" |
| `QB-220` | 1 | same |
| `220` (numeric part only) | 1 | same |
| `mq48jaje` | 2 | invoice `QI-LIVE-mq48jaje-f60e` partially_paid 100.00; estimate `QE-LIVE-mq48jaje-f60e` sent 125.00 |

`kind` discriminates correctly and `total` is a JSON number.

### 5. Wildcards are literal

| query | projects | clients | leads | tasks |
|---|---|---|---|---|
| `bc` (baseline) | 239 | 126 | 75 | 7 |
| `b_` | 0 | 1 | 4 | 0 |
| `b%` | 0 | 0 | 1 | 0 |

If `_`/`%` were wildcards, `b_` and `b%` would return at least the `b` counts
(hundreds). No error in either case.

### 6. Tokens

```
'one two three four five six seven eight nine'
  → tokens ["one","two","three","four","five","six","seven","eight"]  (8, "nine" dropped)
'oak oak  OAK bay'
  → query "oak oak oak bay"   tokens ["oak","bay"]   (case-folded, whitespace-collapsed, de-duplicated)
```

### 7. Degenerate input — full envelope, never an error

| query | `query` out | tokens | totals |
|---|---|---|---|
| `'h'` | `"h"` | `[]` | all 0 |
| SQL `NULL` | `""` | `[]` | all 0 |
| `'...'` | `"..."` | `["..."]` | leads 9, rest 0 |

All three return the complete 7-key envelope
(`query, tokens, projects, clients, leads, tasks, documents`). `'...'` is ≥ 2
characters, so it is a real search for a literal `...` and 9 lead descriptions
genuinely contain it — spec §6's "only punctuation → commands only" is the
client-side gate, not a database rule.

### 8. Limit clamp — `[1, 25]`, totals uncapped

| requested | projects returned | clients returned | leads returned | totals |
|---|---|---|---|---|
| 999 | 25 | 25 | 25 | 239 / 126 / 75 |
| 0 | 1 | 1 | 1 | 239 / 126 / 75 |
| default (8) | 8 | — | — | 239 |

### 9. Scoping — same query, two callers

`private.current_user_scope_for` for the crew persona:
`projects assigned · clients assigned · tasks assigned · invoices NULL · estimates NULL · is_admin false`

| query | caller | projects | clients | leads | tasks | documents |
|---|---|---|---|---|---|---|
| `bc` | founder (admin) | 239 | 126 | 75 | 7 | 0 |
| `bc` | crew (assigned) | **8** | **5** | **0** | **0** | **0** |
| `hidden oaks` | founder | 1 | 0 | 0 | 1 | 0 |
| `hidden oaks` | crew | **0** | 0 | 0 | 0 | 0 |

The 8 projects are exactly the crew member's assigned set (915 Darwin Ave,
Citygate Residences Building B, Full Deck Reno, Vinyl and Rail, Railings and
Vinyl, Deck Renovation, Resheet & Rail, Under Door Vinyl Patch). Leads are the
clean "kind the caller cannot read" case: 554 opportunities exist in the company
and the founder matches 75 of them, the crew member matches 0 — `total: 0` and an
empty envelope, **no 42501**.

### 10. Performance

`explain (analyze, buffers) select public.search_workspace('hidden oaks cres')`
as the founder, warm, on the largest company:

```
Result (actual time=788.665..788.666 rows=1 loops=1)
  Buffers: shared hit=38866
Planning Time: 0.014 ms
Execution Time: 788.685 ms
```

**Spec §4.7's target is p95 < 150 ms. The measured figure is 788 ms.** It is not
reachable from inside a SECURITY INVOKER function under the current RLS. Evidence:

*The floor is RLS, not search.* Counting each table's visible rows with **no
search predicate at all**, as the founder:

| table | rows | time |
|---|---|---|
| projects | 275 | 80 ms |
| clients | 466 | 232 ms |
| opportunities | 520 | 165 ms |
| project_tasks | 346 | 101 ms |
| invoices / estimates | 0 | <1 ms |
| **total** | | **579 ms** |

Every one is an index scan on `company_id` with a per-row `Filter:
private.current_user_can_view_*_row(...)` — a STABLE SECURITY DEFINER function
per row (≈26 shared buffers per client row). Spec §4.3 requires matching on
unindexed secondary columns (`notes`, `description`, `trade`, `task_notes`,
contact fields), so every company row must be read; there is no candidate set to
narrow first.

*The trigram indexes cannot serve this query.* Confirmed by plan: the six-field
OR falls back to a company index scan plus filter. And RLS cannot be deferred
behind a cheap text filter — `lower` and `textlike` both have
`proleakproof = false` in this cluster, so the planner must evaluate the RLS
quals first. Verified: `lower(name||email||address) like any(...)` on clients
still took 252 ms with RLS evaluated on all 488 rows first.

*What was fixed.* The first working build took **5,181 ms**. Two changes brought
it to 788 ms:

1. **Single-pass shape.** Each base table is read once into a materialized CTE
   and all five kinds derive from those, instead of five statements re-scanning
   `clients` four times and `projects` twice.
2. **Free-text bodies use `lower()`, not the normalizer** — a measured 18×.
   `agent_normalize_discovery_text` validates input **one character at a time**
   (`agent_discovery_unicode15_text_is_supported` runs `generate_series` over
   every character and tests each against a ~700-range `int4multirange`). Canpro's
   `opportunities.description` averages 585 chars and peaks at 9,942:

   | leads CTE, 520 rows | time | buffers |
   |---|---|---|
   | `agent_normalize_discovery_text(description)` | 4,649 ms | 311,488 |
   | `lower(description)` | 257 ms | 12,902 |

   Applied to the five long free-text bodies only (`projects.notes`,
   `projects.description`, `clients.notes`, `opportunities.description`,
   `project_tasks.task_notes`). Every primary/ranking field and every column
   backed by a `*_agent_discovery_*_trgm` index keeps the normalizer, so spec §3's
   index-expression parity and the tier 0/1 semantics are untouched.

Data-gathering CTEs after the fix: clients 432 ms, opportunities 267 ms,
tasks 163 ms, projects 124 ms, task_types 1 ms — 991 ms cold, 788 ms warm
end-to-end.

Closing the remaining gap means changing something outside this task: memoizing
the per-row scope lookup inside the `private.current_user_can_view_*_row`
helpers, or maintaining a denormalized search table. Both are separate
initiatives with blast radius across the whole app. Flagged, not attempted.

---

## Applied object

```
search_workspace(text,integer)
  security_definer false   volatility STABLE
  search_path      pg_catalog, public, private, pg_temp
  EXECUTE  anon ✓  authenticated ✓  service_role ✓  PUBLIC ✗
  comment  present
```
