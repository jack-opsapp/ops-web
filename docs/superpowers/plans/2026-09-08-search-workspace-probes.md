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

---

# v2 — accent folding + candidate pre-filter

Task 1b. Spec §4.7 "v2 design". Applied to production `ijeekuhbatykdomumfjx` as
ledger version **20260909055047** (`search_workspace_v2`);
`md5(statements[1]) = a3cacefb1e71f846b57bec75d02ef192`, byte-identical to
`supabase/migrations/20260909055047_search_workspace_v2.sql` (trailing newline
stripped) and to the bible archive copy.

Same three personas as v1. Every probe ran inside `begin; … rollback;`; nothing
but the migration persisted.

## v2.0 — what changed, in one paragraph

The envelope contract is untouched. Two things moved underneath it:

1. **`private.search_norm(text)`** — `unaccent(lower(btrim(collapse whitespace)))`
   — replaces `private.agent_normalize_discovery_text` on **both** sides of every
   comparison, including the five long free-text bodies v1 matched with a bare
   `lower()`.
2. **`private.search_workspace_candidates(...)`** — SECURITY DEFINER, owner
   `postgres` (`rolbypassrls = true`, and no table sets `FORCE ROW LEVEL
   SECURITY`) — scans the company once without RLS and returns
   `(kind, id, rank, updated_at)` and nothing else. `public.search_workspace`
   stays SECURITY INVOKER and re-reads every candidate id from its base table
   under the caller's own policies, so RLS is still the only authority and every
   `total` is the exact count of candidates that survived it.

## v2.1 — unaccent: available, installable, reachable by the API roles

```
pg_available_extensions  unaccent  default_version 1.1  installed_version NULL
pg_available_extension_versions  unaccent 1.1  trusted true
```

`trusted true` is why `create extension if not exists unaccent with schema
extensions` succeeded as the MCP `postgres` role, which is **not** a superuser
(`rolsuper = false`, member of `pg_read_all_data, supabase_privileged_role, …`).
No BLOCKED condition.

After install:

```
extensions.unaccent(text)                 STABLE  PARALLEL SAFE  anon ✓ authenticated ✓ service_role ✓  (via PUBLIC)
extensions.unaccent(regdictionary,text)   STABLE  PARALLEL SAFE  anon ✓ authenticated ✓ service_role ✓
schema extensions USAGE                   anon ✓ authenticated ✓ service_role ✓  PUBLIC ✗
```

Both are executable by the API roles, so **no SECURITY DEFINER wrapper was
needed** — `private.search_norm` is SECURITY INVOKER and `unaccent` runs as the
caller. `search_norm` uses the **two-argument** form with an explicitly
qualified dictionary (`'extensions.unaccent'::regdictionary`) because the
one-argument form resolves the dictionary name through the caller's
`search_path`.

Fold behaviour, measured, not assumed:

```
unaccent('extensions.unaccent', lower('Héllo RENÉ ﬁ Ｗ ß'))  → 'hello rene fi w ss'
unaccent('extensions.unaccent', lower('Paul O’Callaghan — René Ｗ'))
                                                            → "paul o'callaghan - rene w"
```

The rules fold more than diacritics: the curly apostrophe `’ → '`, the em dash
`— → -`, the `ﬁ` ligature, fullwidth Latin, and `ß → ss`. That is what makes the
two intentional result changes in §v2.3 happen, and it also means the NFKC
width-folding v1 got from `agent_normalize_discovery_text` is not lost.

## v2.2 — the shape of the fix, and why it is fast

`explain (analyze, buffers)` of the invoker's inner query, founder, `'bc'`
(the broad 2-character case), counting only:

```
CTE cand
  ->  Function Scan on search_workspace_candidates k   (actual time=67.053..67.163 rows=447)  Buffers: shared hit=450
projects
  ->  Nested Loop                                       (actual time=69.880..138.505 rows=239)
        ->  CTE Scan on cand (Filter: kind = 'projects')                        rows=239, removed 208
        ->  Index Scan using projects_company_id_id_uidx on projects p          loops=239
              Index Cond: (company_id = <company> AND id = k.id)
              Filter: (deleted_at IS NULL AND private.current_user_can_view_project_row(id, company_id, deleted_at))
clients   ->  Nested Loop  (actual time=1.379..59.134 rows=126)   Index Cond: (id = k.id AND company_id = <company>)
leads     ->  Nested Loop  (actual time=1.057..23.663 rows=75)
tasks     ->  Nested Loop  (actual time=1.338..6.417  rows=7)
```

That is the whole design in one plan: the candidate scan reads the company
**once** without RLS in 67 ms and 450 buffers, and the per-row policy helper then
runs 447 times instead of 1,645. The index condition is usable ahead of the RLS
quals because `uuid_eq` is `proleakproof = true` in this cluster — checked, not
assumed.

Three measurements decided the final shape:

| change | broad `'bc'` |
|---|---|
| candidate pre-filter alone, `search_norm` with `set search_path` | 296 ms |
| + `search_norm` with **no** `SET` clause (planner can inline it) | ~254 ms |
| + skip `agent_normalize_discovery_phone` when no token is numeric | **204 ms** |

*Why no `SET search_path` on `search_norm`.* A SQL function carrying a `SET`
clause cannot be inlined by the planner and pays a GUC save/restore per call;
`search_norm` is evaluated ~8,000 times per search. Measured on the candidate
scan, RLS-free, same rows: **108 ms with the clause, 66 ms without.** Every name
inside the body is schema-qualified instead (`extensions.unaccent`,
`pg_catalog.lower/btrim/regexp_replace`; `coalesce` is grammar, not a resolvable
function), and the function is SECURITY INVOKER, so it crosses no privilege
boundary. The migration proves the claim rather than asserting it — a post-assert
evaluates `search_norm('  Héllo   WORLD  ')` under the normal search_path and
again under `search_path = pg_temp`, and fails the migration unless both return
`'hello world'`.

**Stated plainly as the one deviation with a cost:** this puts
`private.search_norm` into the Supabase advisor's `function_search_path_mutable`
WARN group, which a previous sweep (`20260601163641_harden_function_search_path_mutable`)
had emptied of new entries. The group now lists 5 functions; 4 pre-date this
work (`private.normalize_title`, `private.derive_project_name`,
`private.projects_autoname`, `public.ads_plan_annual_value`). Restoring the
clause would cost ~42 ms on every search (broad `'bc'` ≈ 246 ms against a 250 ms
budget — inside the target, but with a 2% margin instead of 18%). It is a
one-line change if the reviewer prefers the lint clean.

*Why `v_has_phone`.* `private.agent_normalize_discovery_phone` is
`PARALLEL UNSAFE` plpgsql and was being evaluated on all 470 clients and 554
leads on every search, including searches with no digits in them. `phone_n` is
only ever read when a token has a digit run, so it is now wrapped in
`case when v_has_phone then … end`, where `v_has_phone` is a plpgsql variable and
therefore a plan-time constant.

*Not attempted.* The candidate scan cannot go parallel while
`agent_normalize_discovery_phone` is `PARALLEL UNSAFE`; changing that helper's
metadata is outside this task (it backs index expressions used by the agent
discovery reads).

## v2.3 — differential against v1: 33 of 35 envelopes byte-identical

v1 and v2 were captured **in the same rolled-back transaction** — v1 ran first,
the v2 DDL was applied inside the transaction, v2 ran second — for 35
persona/query pairs across three companies and three permission scopes. The
comparison is whole-envelope `jsonb` equality at `p_limit_per_kind = 25`: ids,
order, rank, every payload field, not just totals.

```
33 of 35 pairs: ENVELOPES BYTE-IDENTICAL (limit 25)
 2 of 35 pairs: differ — both are unaccent folding typography, both widen
```

Identical (totals shown `projects/clients/leads/tasks/documents`):

| persona | query | v1 = v2 |
|---|---|---|
| founder | `bc` | 239/126/75/7/0 |
| founder | `hidden oaks cres` | 1/0/0/1/0 |
| founder | `hidden oaks` | 1/0/0/1/0 |
| founder | `3556 Hidden Oaks Cres` | 1/0/0/1/0 |
| founder | `3556 hidden` | 1/0/0/1/0 |
| founder | `cres oaks hidden 3556` | 1/0/0/1/0 |
| founder | `cobble thompson` | 1/0/0/0/0 |
| founder | `oak bay` | 6/2/4/4/0 |
| founder | `oak oak  OAK bay` | 6/2/4/4/0 |
| founder | `vinyl` | 57/1/94/129/0 |
| founder | `darwin` | 1/1/1/1/0 |
| founder | `Ohl` | 1/1/3/0/0 |
| founder | `2508960799` / `2508960` / `250-896-0799` | 0/1/0/0/0 each |
| founder | `b_` | 0/1/4/0/0 |
| founder | `b%` | 0/0/1/0/0 |
| founder | `one two … nine` | 0/0/0/0/0 |
| founder | `h` | 0/0/0/0/0 |
| crew | `bc` | 8/5/0/0/0 |
| crew | `hidden oaks cres` / `hidden oaks` | 0/0/0/0/0 |
| crew | `darwin` | 1/0/0/1/0 |
| crew | `vinyl` | 4/0/0/17/0 |
| crew | `cobble thompson` / `oak bay` / `thompson` | 0/0/0/0/0 |
| maverick | `qb220` | 0/0/0/0/1 |
| maverick | `QB-220` | 1/0/1/1/1 |
| maverick | `220` | 1/1/1/1/1 |
| maverick | `mq48jaje` | 0/1/1/0/2 |
| maverick | `bc` | 2/4/6/0/0 |

The two that moved:

```
founder 'o''callaghan'   v1 0/0/0/0/0   v2 1/1/0/0/0
  v2 clients.items[0].name  "Paul O’Callaghan"
  v2 projects.total 1 (the client's project, matched on the client name)
founder '...'            v1 0/0/9/0/0   v2 0/0/13/0/0
  the four added leads are Steve Clark, Kevin Falk, Marcel Mercier and
  2502179334 — verified directly: each one's `opportunities.description`
  contains U+2026 (…), which unaccent folds to '...'.
```

Both are the accent/typography folding spec §4.7 asked for, working on real
data. Neither is a scope leak: both queries were run as the founder, who can
already see every row in the company.

**The RLS-scope widening did not change any result set.** Moving the match out
from under RLS means a project's client name is now tested without RLS, so a
caller who can see a project but not its client could newly find the project by
the client's name. Probed for it directly (crew `thompson`, crew `cobble
thompson`, crew `oak bay`, crew `bc`, crew `vinyl`, crew `darwin`): every crew
envelope came back byte-identical to v1. The client's name is still never
returned to such a caller — the payload join runs under RLS and yields null.

## v2.4 — security proofs (mandatory, all rolled back)

**(1) The helper refuses a company that is not the caller's.** Called directly as
the assigned-scope crew member (`authenticated`), which is exactly the exposure
the `grant execute … to anon, authenticated` creates:

```
private.search_workspace_candidates('ddee107c-…'::uuid, 'bc', …)   -- MAVERICK's id
  → raised 42501 SEARCH_WORKSPACE_CANDIDATES_COMPANY_MISMATCH
private.search_workspace_candidates(null::uuid, 'bc', …)
  → raised 42501 SEARCH_WORKSPACE_CANDIDATES_COMPANY_MISMATCH
```

`p_company` is never authority. The helper re-derives the caller's company with
`private.get_user_company_id()` — the same call `public.search_workspace` makes —
and raises unless they are equal and non-null.

**(2) RLS, not the helper, decides what the caller sees.** Same crew member, same
transaction:

```
private.search_workspace_candidates(<own company>, 'bc', …) where kind='projects'
  → 239 candidate rows   (the RLS-free match set: every project in the company)
public.search_workspace('bc')
  → projects.total 8     (after the caller's own RLS)
```

and the eight are exactly the crew member's assigned set:

```
915 Darwin Ave, Citygate Residences Building B, Full Deck Reno, Vinyl and Rail,
Railings and Vinyl, Deck Renovation, Resheet & Rail, Under Door Vinyl Patch
```

byte-identical to v1's eight. Scope confirmed live for that persona:
`projects assigned · clients assigned · tasks assigned · invoices NULL ·
estimates NULL`.

**(3) Founder totals and row sets are unchanged.** `search_workspace('bc')` as
the founder returns `239/126/75/7/0`, and the ordered id arrays at limit 25 are
identical to v1 for **all four** non-empty kinds (projects 25, clients 25, leads
25, tasks 7) — same ids, same order, so same ranks and same tie-breaks.

**Residual exposure, stated plainly.** The helper must be executable by `anon`
and `authenticated` because the SECURITY INVOKER function calls it as the
caller. A caller who invokes it directly therefore learns the **ids**,
`updated_at` and rank tier of rows in **their own company** that match a
fragment, including rows their row-scope hides. No row content crosses the
boundary — every field the client ever sees is read back under RLS — and nothing
about any other company is reachable. This is inherent to the spec's design and
is not new authority over content; it is new visibility of id existence within
one's own company.

## v2.5 — the v1 probe battery, re-run against the applied v2

### 1. `search_workspace('hidden oaks')` — founder

```
tokens ["hidden","oaks"]   projects.total 1   clients 0   leads 0   tasks 1   documents 0
projects.items[0] {"id":"bfd686b8-0828-48e4-95b5-ca56074594cd","title":"3556 Hidden Oaks Cres",
  "status":"completed","address":"3556 Hidden Oaks Cres, Cobble Hill, BC, Canada",
  "updated_at":"2026-08-07T20:55:52.838051+00:00","client_name":"James Thompson"}
tasks.items[0]    {"id":"fd7cde4b-c6f3-4857-ae3b-7b38387688fa","title":"Vinyl Install",
  "status":"completed","task_type":"Vinyl Install",
  "project_id":"bfd686b8-0828-48e4-95b5-ca56074594cd",
  "updated_at":"2026-08-07T04:20:09.42008+00:00","project_title":"3556 Hidden Oaks Cres"}
```

### 2. Ranking tiers — project `3556 Hidden Oaks Cres` (`bfd686b8…`)

| tier | query | projects.total | items[0].title |
|---|---|---|---|
| 0 exact | `3556 Hidden Oaks Cres` | 1 | 3556 Hidden Oaks Cres |
| 1 prefix | `3556 hidden` | 1 | 3556 Hidden Oaks Cres |
| 2 all tokens, reordered | `cres oaks hidden 3556` | 1 | 3556 Hidden Oaks Cres |
| 3 scattered (address word + client-name word) | `cobble thompson` | 1 | 3556 Hidden Oaks Cres |

### 3. Phone — client `Ken Swift`, stored `250-896-0799`

| query | clients.total | items[0] |
|---|---|---|
| `2508960799` | 1 | Ken Swift / 250-896-0799 |
| `2508960` (**fragment**) | 1 | Ken Swift / 250-896-0799 |
| `250-896-0799` | 1 | Ken Swift / 250-896-0799 |

### 4. Document numbers — Maverick

| query | documents.total | items |
|---|---|---|
| `qb220` | 1 | estimate `QB-220` approved 565.00 "LIVE-QBO-MAP-mq4anho6 Customer" |
| `QB-220` | 1 | same |
| `220` | 1 | same |
| `mq48jaje` | 2 | invoice `QI-LIVE-mq48jaje-f60e` partially_paid 100.00 · estimate `QE-LIVE-mq48jaje-f60e` sent 125.00 |

### 5. Wildcards are literal

| query | projects | clients | leads | tasks |
|---|---|---|---|---|
| `bc` | 239 | 126 | 75 | 7 |
| `b_` | 0 | 1 | 4 | 0 |
| `b%` | 0 | 0 | 1 | 0 |

### 6. Tokens

```
'one two three four five six seven eight nine'
  → query "one two three four five six seven eight nine"
    tokens ["one","two","three","four","five","six","seven","eight"]  (8, "nine" dropped)
'oak oak  OAK bay'
  → query "oak oak oak bay"   tokens ["oak","bay"]
```

### 7. Degenerate input — full envelope, never an error

| query | `query` out | tokens | keys | totals |
|---|---|---|---|---|
| `'h'` | `"h"` | `[]` | all 7 | 0/0/0/0/0 |
| SQL `NULL` | `""` | `[]` | all 7 | 0/0/0/0/0 |
| `'   '` (whitespace only) | `""` | `[]` | all 7 | 0/0/0/0/0 |
| `'...'` | `"..."` | `["..."]` | all 7 | leads 13, rest 0 |

The whitespace-only row is new to v2 and is why `btrim` is inside `search_norm`:
v1 inherited trimming from `agent_normalize_discovery_text`, and without it a
padded query would have failed rank tier 0/1 by a leading space.

### 8. Limit clamp — `[1, 25]`, totals uncapped

| requested | projects returned | clients | leads | totals |
|---|---|---|---|---|
| 999 | 25 | 25 | 25 | 239 / 126 / 75 |
| 0 | 1 | 1 | 1 | 239 / 126 / 75 |
| 8 (default) | 8 | 8 | 8 | 239 / 126 / 75 |
| SQL NULL | 8 | — | — | 239 |

### 9. Scoping — same query, two callers

| query | caller | projects | clients | leads | tasks | documents |
|---|---|---|---|---|---|---|
| `bc` | founder (admin) | 239 | 126 | 75 | 7 | 0 |
| `bc` | crew (assigned) | **8** | **5** | **0** | **0** | **0** |
| `hidden oaks` | founder | 1 | 0 | 0 | 1 | 0 |
| `hidden oaks` | crew | **0** | 0 | 0 | 0 | 0 |

Identical to v1's table. Leads remain the clean "kind the caller cannot read"
case: `total: 0`, empty envelope, **no 42501**.

### 10. Performance — the point of v2

`explain (analyze, buffers)` as the founder, warm, on the largest company:

```
-- v2, broad 2-character query
explain (analyze, buffers) select public.search_workspace('bc');
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=203.982..203.983 rows=1 loops=1)
  Buffers: shared hit=11141
Planning Time: 0.013 ms
Execution Time: 203.994 ms

-- v2, typical 3-token query
explain (analyze, buffers) select public.search_workspace('hidden oaks cres');
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=58.283..58.284 rows=1 loops=1)
  Buffers: shared hit=693
Planning Time: 0.011 ms
Execution Time: 58.294 ms
```

Baseline, same session, same data, v1 as it stood in production:

```
select public.search_workspace('bc');                → 778.373 ms, shared hit 38866
select public.search_workspace('hidden oaks cres');  → 786.450 ms, shared hit 38866
```

Five warm runs of each on v2, to show it is not a lucky sample:

```
'bc'                203.880  207.499  205.746  209.376  206.497   ms
'hidden oaks cres'   52.099   52.111   51.326   51.005   51.003   ms
```

| query | spec §4.7 v2 target | v1 | v2 | verdict |
|---|---|---|---|---|
| `'bc'` (broad, 2 char, largest company) | p95 ≤ 250 ms | 778 ms | **204–209 ms** | met |
| `'hidden oaks cres'` (typical 2–3 token) | ≤ 150 ms | 786 ms | **51–58 ms** | met |

Buffers fall 38,866 → 11,141 on the broad query and 38,866 → 693 on the typical
one. The v1 note that "closing the remaining gap means changing something
outside this task" is resolved: the gap was the per-row RLS helper running on
every row of the company, and the candidate pre-filter stops it from running on
rows that cannot match.

### 11. Accent folding (new)

Production holds no accented name in Canpro, so the row was created inside the
rolled-back transaction: `Renée Dupré-Ångström`.

| query | normalized query | clients.total | items[0].name |
|---|---|---|---|
| `rene` | `rene` | 1 | Renée Dupré-Ångström |
| `renee dupre` | `renee dupre` | 1 | Renée Dupré-Ångström |
| `Renée Dupré` | `renee dupre` | 1 | Renée Dupré-Ångström |
| `RENEE DUPRE` | `renee dupre` | 1 | Renée Dupré-Ångström |
| `angstrom` | `angstrom` | 1 | Renée Dupré-Ångström |
| `dupre-angstrom` | `dupre-angstrom` | 1 | Renée Dupré-Ångström |

`rene` finding `René` is the exact case v1 could not do (v1 §Step 1 finding 1).
Note the normalization is symmetric: typing the accented form and typing the
plain form both normalize to `renee dupre`.

### 12. Typographic folding on real production rows (new)

| query (straight ASCII) | result |
|---|---|
| `o'callaghan` | clients.total 1 → **Paul O’Callaghan**; projects.total 1 → Privacy Screen (matched via the client name) |
| `producer's way` | projects.total 1 → **3746 Producer’s Way** |

Both are stored with U+2019. Under v1 both queries returned an empty envelope.

## v2.6 — applied objects

```
public.search_workspace(text,integer)
  security_definer false   volatility STABLE   owner postgres
  search_path      pg_catalog, public, private, pg_temp
  EXECUTE  anon ✓  authenticated ✓  service_role ✓  PUBLIC ✗   comment present

private.search_workspace_candidates(uuid,text,text[],text[],text[])
  security_definer true    volatility STABLE   owner postgres (rolbypassrls true)
  search_path      pg_catalog, public, private, pg_temp
  EXECUTE  anon ✓  authenticated ✓  service_role ✓  PUBLIC ✗   comment present

private.search_norm(text)
  security_definer false   volatility STABLE   owner postgres   proconfig NULL (see v2.2)
  EXECUTE  anon ✓  authenticated ✓  service_role ✓  PUBLIC ✗   comment present

extension unaccent 1.1 installed in schema extensions
```

Every one of those properties is asserted inside the migration itself, so a
re-apply that broke any of them would fail rather than ship.

## v2.7 — deviations from spec §4.7, and why

1. **`search_workspace_candidates` takes `p_query text` in addition to
   `p_frags/p_phones/p_doc_keys`.** Rank tiers 0 and 1 are defined against the
   whole normalized query, which cannot be reconstructed from the per-token
   fragments — `'oak oak OAK bay'` normalizes to `'oak oak oak bay'` but
   tokenizes to `["oak","bay"]`. The spec's `returns table (kind, id, rank,
   updated_at)` is unchanged; without the query the `rank` column could not be
   computed. The escaped prefix fragment and the alnum doc key are derived inside
   the helper from `p_query`, so the escaping rule lives in one place.
2. **`kind` is emitted as `invoices` / `estimates`, not `documents`.** Two
   different tables, two id spaces; the invoker needs to know which table to read
   an id back from. The client-facing `kind` in the envelope is still
   `invoice` / `estimate`, exactly as v1.
3. **`btrim` was added inside `search_norm`.** The spec's formula is
   `unaccent(lower(regexp_replace(coalesce($1,''),'\s+',' ','g')))`, which does
   not trim. v1 got trimming free from `agent_normalize_discovery_text`, and
   without it a padded query silently loses rank tiers 0 and 1. See probe 7.
4. **`search_norm` carries no `SET search_path`.** Documented in full in §v2.2,
   including the lint it costs and the one-line way to reverse it.
5. **No functional smoke inside the migration.** Spec §4.6 suggested a
   rolled-back `set local role authenticated` smoke in the post-assert. That
   would hard-code a real persona's auth subject into a production migration
   file; v1 did not do it either. The smokes live here instead, as probes, run
   against the applied function.

Nothing else in the spec was changed, skipped, or approximated.
