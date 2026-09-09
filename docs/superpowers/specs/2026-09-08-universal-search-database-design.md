# Universal search — database-backed design

**Date:** 2026-09-08 · **Status:** approved by Jackson (product shape) · **Branch:** `feat/universal-search-db` (based on `fix/sweep0908-load-failures`, which carries the palette group-visibility fix this build replaces)

## 1. Purpose

The ⌘K palette (`src/components/ops/command-palette.tsx`) is how an operator jumps to a thing from a fragment they remember — a street, a surname, a phone number, an invoice number, "the deck job on Hidden Oaks". Today it downloads every project, client, task and opportunity in the company when it opens (Canpro: 13 requests, ~1,600 rows, 2.2 s), then substring-filters a handful of fields in the browser. Bug `fa5a9ff2` ("universal search is not searching database") exposed both the rendering defect (fixed on the sweep branch) and the design: it does not search the database, it searches a download.

This build replaces that with one ranked, permission-scoped database search across five kinds — **projects, clients, leads, tasks, documents (invoices + estimates)** — returned in a single round trip.

## 2. Scope

**In**
- One SQL function `public.search_workspace(p_query text, p_limit_per_kind integer default 8)` → `jsonb`, SECURITY INVOKER, RLS-scoped, granted to `anon`, `authenticated`, `service_role`.
- Client service + hook + palette rewrite of the entity section; palette copy localized (en + es) into a new `command-palette` dictionary namespace.
- Books open-by-link for a specific invoice or estimate: `/books?segment=invoices&invoice=<id>` and `/books?segment=estimates&estimate=<id>`.
- Tests at every layer, live observation, bible + migration-archive updates.

**Out (deliberately, addable on the same foundation)**
- Highlighting matched words in result rows.
- Searching people/crew, expenses, bills, catalog items, email threads.
- Any change to the MCP agent's discovery reads (`read_agent_*_discovery_as_system`), which stay as they are.
- Focusing a specific task inside the project window (`OpenProjectWindowOpts` has no task focus today); a task result opens its project, as now.
- New trigram indexes. Production volumes are 365 projects / 563 clients / 476 tasks / 584 leads / 44 invoices / 27 estimates across 55 companies; the existing `*_agent_discovery_*_trgm_idx` indexes already cover project title/address, lead title/address and client name. Revisit when any single company passes ~5,000 rows of one kind.

## 3. Foundations reused (verified by object 2026-09-08)

- `pg_trgm@1.6` installed. Expression indexes exist over `private.agent_normalize_discovery_text(col) COLLATE "C" gin_trgm_ops` on `projects.title/address` (where `deleted_at is null`), `clients.name` (where `deleted_at is null and merged_into_client_id is null`), `opportunities.title/address` (where `deleted_at is null and merged_into_opportunity_id is null`). Matching MUST use the same expression (`private.agent_normalize_discovery_text(col) like …`) so these indexes apply for tokens of three or more characters.
- `private.agent_normalize_discovery_text(text)`, `private.agent_normalize_discovery_phone(text)`, `private.agent_normalize_discovery_email(text)` — immutable, executable by `anon`/`authenticated`/`service_role` (they back index expressions). `private.agent_escape_like_literal` and `private.agent_discovery_prefix_upper_bound` are **postgres-only** and must NOT be called; escape inline.
- Row scoping comes from the tables' RLS (`company_isolation` + restrictive `role_scope_read` on all six tables, all via `private.current_user_*` helpers that `anon`/`authenticated` can execute). The function adds `company_id = private.get_user_company_id()` (executable by the API roles) as an explicit planner-friendly filter but never as the authority.
- Rule (bible ch03 § has_permission): a SECURITY INVOKER function may only reference functions `anon` and `authenticated` can EXECUTE. The migration asserts this for every helper it names.

## 4. The function — `public.search_workspace`

### 4.1 Contract
```
search_workspace(p_query text, p_limit_per_kind integer default 8) returns jsonb
security invoker · stable · set search_path = pg_catalog, public, private, pg_temp
```
`p_limit_per_kind` is clamped to `[1, 25]`. The result is always the full envelope, never null:

```json
{
  "query": "<normalized query>",
  "tokens": ["hidden", "oaks"],
  "projects":  { "total": 12, "items": [ { "id": "…", "title": "…", "address": "…", "status": "in_progress", "client_name": "…", "updated_at": "…" } ] },
  "clients":   { "total": 3,  "items": [ { "id": "…", "name": "…", "email": "…", "phone": "…", "address": "…", "updated_at": "…" } ] },
  "leads":     { "total": 1,  "items": [ { "id": "…", "title": "…", "contact_name": "…", "stage": "quoted", "address": "…", "updated_at": "…" } ] },
  "tasks":     { "total": 0,  "items": [ { "id": "…", "title": "…", "project_id": "…", "project_title": "…", "task_type": "…", "status": "active", "updated_at": "…" } ] },
  "documents": { "total": 2,  "items": [ { "id": "…", "kind": "invoice", "number": "INV-1042", "title": "…", "client_name": "…", "total": 4812.5, "status": "sent", "updated_at": "…" } ] }
}
```
`total` is the count of matching rows of that kind visible to the caller (exact, not capped). `items` is at most `p_limit_per_kind`, ordered by rank then recency. A query that normalizes to fewer than 2 characters, or to no tokens, returns the envelope with `tokens: []`, every `total: 0` and every `items: []` — never an error.

### 4.2 Query normalization and tokens
1. `v_query := private.agent_normalize_discovery_text(p_query)`; if null (control characters, over-long) treat as empty.
2. Split on whitespace; drop empties; de-duplicate preserving order; keep at most 8 tokens; each token is used as a `like` fragment with `\`, `%`, `_` escaped inline (`replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_')`).
3. For each token, also compute:
   - `phone_digits`: `private.agent_normalize_discovery_phone(t)` — non-null only when the token looks like a phone fragment; when non-null the token additionally matches `private.agent_normalize_discovery_phone(<phone column>) like '%' || phone_digits || '%'`. (A bare digit run such as `2505551` must match `(250) 555-1234`.)
   - `doc_key`: `regexp_replace(t, '[^a-z0-9]', '', 'g')` — used for document numbers so `inv104`, `INV-104` and `104` all match `INV-1042` by prefix on `regexp_replace(lower(number), '[^a-z0-9]', '', 'g')`.

### 4.3 Matching (per kind)
A row matches when **every** token matches **at least one** of the kind's fields. Field matching is `private.agent_normalize_discovery_text(field) like '%' || escaped_token || '%'` (normalizer applied to both sides, so accents and case never matter). Fields, exactly:

| kind | primary (ranking) | secondary fields |
|---|---|---|
| projects (`projects` p, left join `clients` c on c.id = p.client_id) | `p.title` | `p.address`, `p.notes`, `p.description`, `p.trade`, `c.name` |
| clients (`clients`) | `name` | `email`, `phone_number` (text + phone_digits), `address`, `notes` |
| leads (`opportunities`) | `title` | `description`, `contact_name`, `contact_email`, `contact_phone` (text + phone_digits), `address` |
| tasks (`project_tasks` t, join `projects` p on p.id = t.project_id, left join `task_types` tt on tt.id = t.task_type_id) | `coalesce(t.custom_title, tt.display)` | `t.task_notes`, `tt.display`, `p.title` |
| documents — invoices (`invoices` i, left join `clients` c) | `i.invoice_number` (doc_key prefix) | `i.subject`, `c.name` |
| documents — estimates (`estimates` e, left join `clients` c) | `e.estimate_number` (doc_key prefix) | `e.title`, `c.name` |

Row exclusions (in addition to RLS): `deleted_at is not null` on the row; `clients.merged_into_client_id is not null`; `opportunities.merged_into_opportunity_id is not null`; tasks whose project is deleted. Closed, archived, completed, lost, paid, void rows are **included** — the `status`/`stage` field on the row is what tells them apart.

### 4.4 Ranking
Per row, `rank` is the smallest applicable tier:

| tier | condition (on the normalized primary field `pf` and the normalized whole query `q`) |
|---|---|
| 0 | `pf = q` (exact) |
| 1 | `pf like q || '%'` (starts with the whole query) |
| 2 | every token matches `pf` (all words in the name, any order) |
| 3 | otherwise (tokens satisfied across secondary fields) |

For documents the primary field is the number; tier 0/1 use `doc_key` prefix equality/prefix against the normalized number, tier 2 applies to `subject`/`title`. Order within a kind: `rank asc, updated_at desc nulls last, id asc`. `total` is computed with the same predicate (`count(*)`), not from the limited set.

### 4.5 Shape of the SQL
Five CTEs (one per kind, invoices and estimates unioned inside `documents`), each producing `(rank, updated_at, id, payload jsonb)`, then `jsonb_build_object` of `jsonb_build_object('total', count, 'items', jsonb_agg(payload order by rank, updated_at desc, id) filtered to the limit)`. Tokens live in a `text[]` local; the all-tokens predicate is `not exists (select 1 from unnest(v_tokens) tok where not (<field1 like> or <field2 like> …))`. Write it as plain SQL in a `plpgsql` function (tokens and clamps are easier in plpgsql); no dynamic SQL.

### 4.6 Security
- `security invoker` — the caller's RLS is the authority. Verified in the migration's post-assert by executing `select search_workspace('x')` inside a `set local role authenticated` block with a persona user's claims and checking it succeeds (not 42501).
- Every referenced function has EXECUTE for `anon` and `authenticated` (asserted with `has_function_privilege` in the migration; the assert lists each helper by signature).
- `grant execute on function public.search_workspace(text, integer) to anon, authenticated, service_role;` — no `public` grant.
- Input is never interpolated into SQL text; `like` fragments are escaped; output is data only.

### 4.7 Performance — measured, then redesigned (v2)
v1 (ledger `20260909051424`) measured **788 ms** warm for a 2-token query on the largest company. Search predicates were not the cost: counting the company's rows with **no** predicate cost 579 ms, because every RLS read policy calls a per-row SECURITY DEFINER helper (`private.current_user_can_view_*_row`) and the function reads every row of every kind. Trigram indexes cannot serve a six-field OR, and `lower`/`like` are not leakproof so the planner cannot run them before the policy. Also found: the shared normalizer does not fold diacritics (`unaccent` was not installed), and it validates input one character at a time — 4.6 s over the leads' free-text bodies — so v1 already matches long bodies with `lower()`.

**v2 design (authoritative):**
- `create extension if not exists unaccent with schema extensions;` and a new helper `private.search_norm(text) returns text` — `extensions.unaccent(lower(regexp_replace(coalesce($1, ''), '\s+', ' ', 'g')))`, `language sql`, STABLE (unaccent's dictionary is a runtime object), executable by `anon`, `authenticated`, `service_role`. Both the query and every matched field go through `search_norm`; `agent_normalize_discovery_text` is no longer used inside the search path (index parity is moot — no index can serve these predicates). Phone matching keeps `agent_normalize_discovery_phone` on the stored side and a digit-run on the token side.
- **Candidate pre-filter, RLS authority kept.** A SECURITY DEFINER helper `private.search_workspace_candidates(p_company uuid, p_frags text[], p_phones text[], p_doc_keys text[]) returns table (kind text, id uuid, rank int, updated_at timestamptz)` reads the base tables WITHOUT RLS, restricted to `p_company`, and returns only matching ids with their rank. It is executable by `anon`/`authenticated`/`service_role` (our rule) and leaks nothing: `p_company` is not trusted from the caller — `search_workspace` passes `private.get_user_company_id()`, and the helper re-derives it the same way and raises if they differ. The INVOKER function then joins each kind's rows by `id = any(candidate ids)` under normal RLS, so the per-row policy helper runs only on matches. `total` is the count of candidates that survive RLS (exact). This cuts cost from O(company rows) to O(matching rows).
- Target restated from measurement: p95 **≤ 250 ms** for a broad 2-character query on the largest company and **≤ 150 ms** for a typical 2–3-token query; `explain (analyze, buffers)` recorded for both in the probes doc.
- Document numbers match by **contains** on the alnum-folded number (`104` finds `INV-1042`); ranking stays equality → prefix.

### 4.8 Migration
One file `supabase/migrations/<stamp>_search_workspace_rpc.sql` following the repo's guarded style (`begin; set local lock_timeout='3s'; …; commit;`):
1. `do` pre-assert: pg_trgm present; each named helper exists and is executable by `anon` + `authenticated`; else `raise exception`.
2. `create or replace function public.search_workspace(...)`.
3. `revoke all on function public.search_workspace(text, integer) from public; grant execute … to anon, authenticated, service_role;`
4. `comment on function` — one paragraph stating the contract and the SECURITY INVOKER rationale.
5. `do` post-assert: `has_function_privilege('authenticated', 'public.search_workspace(text, integer)', 'EXECUTE')`, and a rolled-back functional smoke (`perform public.search_workspace('smoke')` under `set local role authenticated` with a persona-pool claim) that must return the envelope.

Applied to production via MCP `apply_migration` **before** the web deploy (additive, safe: nothing calls it until the client ships); mirrored byte-exact as `<ledger_version>_<ledger_name>.sql` in `supabase/migrations/` and the bible's `migrations/` archive in the same session.

## 5. Client

### 5.1 Types
Hand-add to `src/lib/types/database.types.ts` under `Functions`, in the generated shape:
```ts
search_workspace: { Args: { p_query: string; p_limit_per_kind?: number }; Returns: Json }
```
Define the envelope types in `src/lib/types/workspace-search.ts` (`WorkspaceSearchResult`, `WorkspaceSearchKind = "projects" | "clients" | "leads" | "tasks" | "documents"`, per-kind item types with `kind` discriminants) and a `parseWorkspaceSearchResult(json): WorkspaceSearchResult` that validates shape defensively (unknown → empty envelope, never throw for a malformed item — drop it).

### 5.2 Service and hook
- `src/lib/api/services/workspace-search-service.ts`: `WorkspaceSearchService.search(query, limitPerKind = 8)` → `requireSupabase().rpc("search_workspace", { p_query, p_limit_per_kind })`; throws `Error` with the PostgREST message on `error`; returns the parsed envelope.
- `src/lib/hooks/use-workspace-search.ts`: `useWorkspaceSearch(rawQuery: string, opts: { enabled: boolean })`.
  - `debounced = useDebouncedValue(rawQuery.trim(), 150)`.
  - `enabled: opts.enabled && debounced.length >= 2 && !!companyId`.
  - `queryKey: ["search", "workspace", companyId, debounced.toLowerCase()]`, `queryFn` → service, `placeholderData: keepPreviousData` (previous results stay while the next query runs — no flicker), `staleTime: 30_000`, retries per the global policy.
  - Returns `{ result, isFetching, isError, refetch, activeQuery: debounced }`.

### 5.3 Palette
Rewrite the entity section of `command-palette.tsx`; the command sections (Create / Navigation / Settings / System) stay.
- Remove `useProjects/useClients/useTasks/useOpportunities` and `entityResults`; use `useWorkspaceSearch(search, { enabled: open })`.
- Groups in fixed order: **Projects, Clients, Leads, Tasks, Documents** (the app's own nouns; "Leads" for opportunities). A group renders only when it has items; every entity `CommandGroup` keeps `forceMount` (cmdk hides unregistered groups — see `reference_cmdk_forcemount_group_hidden`). Group heading = label, plus ` · <total>` when `total > items.length`.
- Row anatomy (two lines max, no wrapping; primary `font-mohave text-body-sm text-text`, secondary `font-mono text-micro text-text-3` — never `text-text-mute`, which the design system reserves for decorative marks; status rendered with the existing `Tag` primitive from `src/components/ui/tag.tsx` in its smallest size and the variant the app already maps for that status — reuse the status→variant mapping the projects table / pipeline use, never a new one):
  - project: `title` — `address` · status
  - client: `name` — `phone` if present else `email`
  - lead: `title` — `contact_name` · stage
  - task: `title` — `project_title` · status
  - document: `number` `title` — `client_name` · `formatCurrency(total)` · status; glyph distinguishes invoice vs estimate.
- Documents group is rendered only when `can("invoices.view") || can("estimates.view")` (RLS already returns nothing otherwise; this avoids a phantom group).
- Selection: project → `openProjectWindow({ projectId, mode: "viewing" })`; client → `openClientWindow({ clientId, mode: "viewing" })`; lead → `router.push(`/pipeline?opportunity=${id}`)`; task → `openProjectWindow({ projectId: task.project_id, mode: "viewing" })`; invoice → `router.push(`/books?segment=invoices&invoice=${id}`)`; estimate → `router.push(`/books?segment=estimates&estimate=${id}`)`. The palette closes first, as now.
- `CommandEmpty` renders only when the active query is ≥ 2 characters, the search has settled (`!isFetching`), and no kind has items. Below 2 characters the palette shows commands only (as today).
- Loading cue: while `isFetching` and there is an active query, the input's search glyph fades to `text-text-mute` over 200 ms with the design system's single easing `cubic-bezier(0.22, 1, 0.36, 1)` and restores on settle; no spinner. The curve is inlined in `tailwind.config.ts` animations today but has no timing token — add `transitionTimingFunction: { ops: "cubic-bezier(0.22, 1, 0.36, 1)" }` to the Tailwind theme (one token, `ease-ops`) and use it; never hardcode the curve in a component. Honors `prefers-reduced-motion` (`motion-reduce:transition-none`; the colour change still applies).
- Error state: when `isError`, a single quiet row under the input: `// SEARCH UNAVAILABLE` with an inline `Retry` action that calls `refetch()`; commands remain usable. No toast.
- Copy moves to `src/i18n/dictionaries/{en,es}/command-palette.json` (placeholder, five group labels, count separator, empty title/body, error line + retry, footer hints, the Create/Navigation/Settings/System headings, and the settings/system action labels currently hardcoded). Copy is written through the `ops-copywriter` skill in the terse product register.

### 5.4 Books open-by-link
`src/components/books/books-page.tsx` already resolves `?segment=`. Extend the invoices and estimates segments:
- On mount and when `searchParams` change, read `invoice` (invoices segment) / `estimate` (estimates segment). If present: fetch by id with the existing `useInvoice(id)` / `useEstimate(id)`; when it resolves, set `editingInvoice` / `editingEstimate` (the same state the row click sets) so the existing detail modal opens; then remove the param from the URL with `router.replace` (keeping `segment` and any other params) so closing the modal does not reopen it and the back button behaves.
- Two failure outcomes, distinguished by the fetch error's status (the invoice/estimate services attach the PostgREST `status` to the error they throw so the global retry policy declines to retry 4xx):
  - **Not found / not visible** (PGRST116 → 406, or 404, or a null document): toast `// INVOICE NOT FOUND` / `// ESTIMATE NOT FOUND` (books dictionary, through ops-copywriter) and clear the param — there is nothing to retry.
  - **Any other failure** (network, 5xx, paused offline): toast a distinct line (`// COULDN'T OPEN INVOICE` / `// COULDN'T OPEN ESTIMATE`, through ops-copywriter) and **keep the param** so a reload retries. An offline/paused query (`data === undefined`, not loading, not errored) is "not settled yet" — never treated as an answer.
- A link to a segment the operator cannot see (`invoices.view` / `estimates.view` gates in `books-page.tsx`) never mounts the segment; `BooksPage` itself must toast the not-found line and strip the stray param in that case.
- The param is the whole contract: nothing else changes in Books.

## 6. Errors and edge cases
- Query under 2 characters / only whitespace / only punctuation → commands only, no request.
- Normalizer rejects the text (control characters, > 8 KB) → treated as no tokens → empty envelope, no error.
- Wildcards in the query (`100%`, `a_b`) are literal.
- Token count over 8 → first 8 tokens used (spec'd, tested).
- A kind the user cannot read at all (RLS) → `total: 0`, empty items — no error.
- PostgREST/RPC failure → palette error row with retry; previous results are not shown as if current.
- Rapid typing → the debounce plus `keepPreviousData` guarantee the visible result set always corresponds to a query the user typed, never a stale one after a newer one settled (TanStack keys by query text).
- Duplicate titles → distinct rows by id; the secondary line disambiguates.

## 7. Testing and proof

**Database (rolled-back probes against production as real users, recorded in the task report):**
- Ranking tiers 0–3 each demonstrated with Canpro data as Jackson (`set local role authenticated` + his claim).
- Phone digits match; document number prefix match (`inv104`, `INV-104`, `104`); accent/case insensitivity.
- Wildcard literals; 9-token query uses 8; sub-2-char query returns the empty envelope; unreadable kind returns `total 0`.
- Scoping: a persona-pool user with `projects.view = assigned` sees only assigned projects; same query as an admin sees more.
- `explain (analyze, buffers)` for one 3-token query on Canpro.

**Vitest (isolated files only):**
- `workspace-search-service.test.ts` — rpc name/args, error propagation, defensive parsing.
- `use-workspace-search.test.tsx` — debounce, 2-char gate, key by normalized query, keepPreviousData.
- `command-palette.test.tsx` (extend the existing RTL suite) — five groups in order with counts; Documents hidden without permission; empty only after settle; error row + retry; Enter on each kind dispatches the right action; keyboard nav across groups.
- `books-open-by-link.test.tsx` — invoice/estimate param opens the detail once, clears the param, not-found toast path.

**Live (standalone Playwright on the merged dev server, demo user pete):** one search per kind with the row visible; Enter on an invoice result lands in Books with the invoice detail open; screenshots kept in the session scratchpad.

**Gates:** every touched test file green in isolation; `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` exits 0 with zero output; `eslint` clean on touched files.

## 8. Documentation
- Bible ch03 (`### has_permission() RPC Function` neighbourhood or the RPC catalogue): add `search_workspace` — contract, invoker rationale, helper dependencies.
- Bible chapter that documents the OPS-Web command palette (`02_USER_EXPERIENCE_AND_WORKFLOWS.md` ⌘K section; `07` if that is where web shortcuts live — executor checks which is clean of sibling WIP and commits only that file): what universal search covers, matching and ranking in one paragraph, the Books open-by-link contract.
- Migration archive mirror (bible `migrations/`), same session as apply.

### 4.9 As built (ledgers `20260909051424` v1, `20260909055047` v2)
- Measured on the largest company: v1 778/786 ms → v2 **204 ms** (broad `bc`) / **51 ms** (`hidden oaks cres`). 33 of 35 persona/query envelopes byte-identical between v1 and v2; the two differences are the intended typographic folding (`o'callaghan` finds `O’Callaghan`; a U+2026 ellipsis matches `...`).
- `private.search_workspace_candidates(p_company, p_query, p_frags, p_phones, p_doc_keys)` — takes the whole normalized query too (tiers 0/1 cannot be rebuilt from de-duplicated tokens). Internal kinds are `invoices`/`estimates` (two id spaces); the client-facing `kind` stays `invoice`/`estimate`.
- `private.search_norm` adds `btrim` and deliberately carries **no `SET search_path`**: a SQL function with a SET clause cannot be inlined and pays a GUC save/restore per call (~8,000 calls per search: 108 ms vs 66 ms). It is SECURITY INVOKER, every name is schema-qualified, and the migration proves the output is identical under `search_path = pg_temp`. Cost: one entry in the Supabase advisor's `function_search_path_mutable` WARN group — accepted for a feature whose point is speed.
- Residual exposure, accepted: the candidate helper must be executable by the API roles, so a caller invoking it directly learns the opaque ids of matching rows in **their own company** that their row scope would hide. No content crosses (every field the client sees is read back under RLS) and no other company is reachable.
- `private.agent_normalize_discovery_phone` is `PARALLEL UNSAFE`, so the candidate scan cannot parallelize; changing that shared helper is outside this feature.

### 5.5 Keyboard anchoring (as built, `67cf2448a`)
cmdk highlights the first *registered* item whenever the search text changes; result rows are force-mounted (unregistered) and arrive after the RPC, so without intervention the highlight sits on a command (observed live: "detail" → Catalog) and Enter goes there. The palette therefore drives cmdk's controlled `value`: when a settled envelope (not placeholder) renders, the value is set to the first result row in group order (`hitValue(kind, id)`, exported from the rows module); when the envelope has no hits, to the first non-disabled `[cmdk-item]` in list order (cmdk's own default), because leaving the value on an unmounted row highlights nothing. Manual ArrowDown/ArrowUp/hover updates the value normally; a new query's envelope re-anchors. Proven with four RTL cases (envelope landing after the keystroke, no-hits fallback, re-anchor after manual movement, hits→no-hits transition) and in a real browser. Lesson recorded: jsdom passed while the browser was wrong — keyboard anchoring of force-mounted rows is browser-verified, always.

## 9. Decisions log
- One RPC over five client fetches: single round trip, consistent ranking, RLS authority, reuses production indexes/normalizers.
- SECURITY INVOKER: authorization is RLS; no actor parameter; the helper-ACL rule is asserted in the migration.
- Fixed group order over relevance-ordered groups: predictable placement beats occasional cleverness.
- 8 per kind with a count in the heading, no "see all": the palette is a jump-to tool; a refined query is the path to more.
- Old/closed/lost included, status-tagged: people search for old jobs.
- No new indexes at current volumes; threshold recorded.
- Tasks open their project (no task focus in the window today).
