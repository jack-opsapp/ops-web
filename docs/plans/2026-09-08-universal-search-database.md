# Universal Search (database-backed) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Replace the palette's fetch-everything-then-filter search with one ranked, permission-scoped database search across projects, clients, leads, tasks and documents, plus an open-by-link door into Books for invoices and estimates.

**Architecture:** A SECURITY INVOKER Postgres function `public.search_workspace(p_query, p_limit_per_kind)` returns a jsonb envelope of the top hits per kind (RLS is the authority; company filter is only a planner hint). A debounced TanStack hook calls it through PostgREST and keeps previous results while the next query runs. The palette renders five fixed-order groups from that envelope; Books learns `?invoice=<id>` / `?estimate=<id>`.

**Tech Stack:** Next.js 15 (App Router), React 19, TanStack Query v5, cmdk 1.1.1, Supabase (PostgREST + plpgsql, pg_trgm), Vitest + React Testing Library, Playwright (standalone scripts).

**Design System:** `.interface-design/system.md` (repo copy) and `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`. Tokens used by this plan: `font-mohave text-body-sm text-text` (row primary, 14px), `font-mono text-micro text-text-3` (row secondary, 11px — never `text-text-mute`, which is decorative-only), `font-mono text-micro uppercase tracking-wider text-text-3` (group headings — the palette already applies this via `[&_[cmdk-group-heading]]` classes), `h-icon-16 w-icon-16` (row glyphs, lucide), `Tag` primitive variants `neutral | olive | tan | rose | dim | mute` (`src/components/ui/tag.tsx`), glass surfaces unchanged, spacing multiples of 4/8 px via the repo's own scale (`gap-[4px]`, `px-[6px]` as the Tag does). One easing `cubic-bezier(0.22, 1, 0.36, 1)`.

**Required Skills:** `ops-design` (all UI), `custom-skills:interface-design` (palette + Books UI decisions), `frontend-design:frontend-design` (component build), `custom-skills:elite-animations` + `animation-studio:animation-architect` (Task 6 loading cue only), `ops-copywriter:ops-copywriter` (Task 3 and the Books toast copy), `custom-skills:audit-design-system` (before Task 7 sign-off), `supabase:supabase` + `supabase:supabase-postgres-best-practices` (Task 1).

**Spec:** `docs/superpowers/specs/2026-09-08-universal-search-database-design.md` — the contract. When this plan and the spec disagree, the spec wins; say so in the task report.

**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web-universal-search` on branch `feat/universal-search-db` (own `node_modules`, `.env.local` with dev-bypass flags). Every Bash command starts with `cd /Users/jacksonsweet/Projects/OPS/ops-web-universal-search &&`. Never `git stash`, never push, no AI attribution in commit messages. Isolated vitest only — one `npx vitest run <file> | grep -E "Test Files|Tests  "` per file, never a shell loop. `timeout` does not exist on this Mac; use the tool's timeout.

**Parallelism:** Task 1 (database) and Task 5 (Books open-by-link) are independent of each other and of Tasks 2–4. Tasks 2 → 3 → 4 → 6 are sequential. Task 7 integrates.

---

### Task 1: The `search_workspace` function (database)

**Skills:** `supabase:supabase-postgres-best-practices`. Read bible ch03 § "Execution grants" first: a SECURITY INVOKER function may only call functions `anon` and `authenticated` can EXECUTE.

**Files:**
- Create: `supabase/migrations/<stamp>_search_workspace_rpc.sql` (the `<stamp>` is assigned at apply time — write the file as `supabase/migrations/pending_search_workspace_rpc.sql` first, rename after apply to `<ledger_version>_search_workspace_rpc.sql`)
- Mirror: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/migrations/<ledger_version>_search_workspace_rpc.sql` (byte-exact; bible README governs)
- Test: SQL probes recorded in `docs/superpowers/plans/2026-09-08-search-workspace-probes.md` (executor writes; committed)

**Step 1: Learn the normalizer's actual output (never assume)**

Run via the Supabase MCP `execute_sql` (project `ijeekuhbatykdomumfjx`):
```sql
select private.agent_normalize_discovery_text('  Héllo   WORLD  (250) 555-1234 INV-104_2 ') as text_n,
       private.agent_normalize_discovery_phone('(250) 555-1234') as phone_n,
       private.agent_normalize_discovery_phone('2505551') as phone_fragment,
       private.agent_normalize_discovery_phone('hidden') as phone_none;
```
Record the results in the probes doc. The function below assumes `text_n` is lower-cased, whitespace-collapsed, accent-folded text. If it is NOT lower-cased, wrap every use in `lower(...)`; if it does not fold accents, note it (the spec's accent-insensitivity then rests on `unaccent`, which is not installed — report to the principal before proceeding).

**Step 2: Dry-run the function inside a rolled-back transaction**

The whole `create or replace function` plus probes run inside `begin; … rollback;` through `execute_sql` until every probe passes; nothing persists. Function text (start from this; adjust only where Step 1 forces it):

```sql
create or replace function public.search_workspace(
  p_query text,
  p_limit_per_kind integer default 8
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_company     uuid := private.get_user_company_id();
  v_query       text := private.agent_normalize_discovery_text(p_query);
  v_limit       integer := least(greatest(coalesce(p_limit_per_kind, 8), 1), 25);
  v_tokens      text[] := '{}';
  v_frags       text[] := '{}';   -- '%escaped%' like fragments, aligned with v_tokens
  v_phones      text[] := '{}';   -- phone digit fragments or '' , aligned
  v_doc_keys    text[] := '{}';   -- alnum-only fragments, aligned
  v_query_frag  text;
  v_query_key   text;
  v_tok         text;
  v_empty       jsonb := jsonb_build_object('total', 0, 'items', '[]'::jsonb);
  v_projects    jsonb := v_empty;
  v_clients     jsonb := v_empty;
  v_leads       jsonb := v_empty;
  v_tasks       jsonb := v_empty;
  v_documents   jsonb := v_empty;
begin
  if v_company is null or v_query is null or length(v_query) < 2 then
    return jsonb_build_object(
      'query', coalesce(v_query, ''), 'tokens', '[]'::jsonb,
      'projects', v_empty, 'clients', v_empty, 'leads', v_empty,
      'tasks', v_empty, 'documents', v_empty);
  end if;

  foreach v_tok in array regexp_split_to_array(v_query, '\s+') loop
    continue when v_tok = '' or v_tok = any(v_tokens);
    exit when coalesce(array_length(v_tokens, 1), 0) >= 8;
    v_tokens   := v_tokens || v_tok;
    v_frags    := v_frags || ('%' || replace(replace(replace(v_tok, '\', '\\'), '%', '\%'), '_', '\_') || '%');
    v_phones   := v_phones || coalesce(private.agent_normalize_discovery_phone(v_tok), '');
    v_doc_keys := v_doc_keys || regexp_replace(v_tok, '[^a-z0-9]', '', 'g');
  end loop;

  if coalesce(array_length(v_tokens, 1), 0) = 0 then
    return jsonb_build_object(
      'query', v_query, 'tokens', '[]'::jsonb,
      'projects', v_empty, 'clients', v_empty, 'leads', v_empty,
      'tasks', v_empty, 'documents', v_empty);
  end if;

  v_query_frag := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_query_key  := regexp_replace(v_query, '[^a-z0-9]', '', 'g');

  -- ── projects ──────────────────────────────────────────────────────────────
  with rows_n as materialized (
    select p.id, p.title, p.address, p.status, p.updated_at, c.name as client_name,
           private.agent_normalize_discovery_text(p.title)       as title_n,
           private.agent_normalize_discovery_text(p.address)     as address_n,
           private.agent_normalize_discovery_text(p.notes)       as notes_n,
           private.agent_normalize_discovery_text(p.description) as description_n,
           private.agent_normalize_discovery_text(p.trade)       as trade_n,
           private.agent_normalize_discovery_text(c.name)        as client_n
    from public.projects p
    left join public.clients c on c.id = p.client_id
    where p.company_id = v_company and p.deleted_at is null
  ), matched as (
    select r.*,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where r.title_n not like f escape '\') then 2
        else 3
      end as rank
    from rows_n r
    where not exists (
      select 1 from unnest(v_frags, v_phones) as t(frag, phone)
      where not (
           r.title_n       like t.frag escape '\'
        or r.address_n     like t.frag escape '\'
        or r.notes_n       like t.frag escape '\'
        or r.description_n like t.frag escape '\'
        or r.trade_n       like t.frag escape '\'
        or r.client_n      like t.frag escape '\'
      )
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'address', m.address, 'status', m.status,
        'client_name', m.client_name, 'updated_at', m.updated_at)
        order by m.rank, m.updated_at desc nulls last, m.id)
      from (select * from matched order by rank, updated_at desc nulls last, id limit v_limit) m
    ), '[]'::jsonb))
  into v_projects;

  -- ── clients ───────────────────────────────────────────────────────────────
  with rows_n as materialized (
    select c.id, c.name, c.email, c.phone_number, c.address, c.updated_at,
           private.agent_normalize_discovery_text(c.name)          as name_n,
           private.agent_normalize_discovery_text(c.email)         as email_n,
           private.agent_normalize_discovery_text(c.phone_number)  as phone_text_n,
           private.agent_normalize_discovery_phone(c.phone_number) as phone_n,
           private.agent_normalize_discovery_text(c.address)       as address_n,
           private.agent_normalize_discovery_text(c.notes)         as notes_n
    from public.clients c
    where c.company_id = v_company and c.deleted_at is null and c.merged_into_client_id is null
  ), matched as (
    select r.*,
      case
        when r.name_n = v_query then 0
        when r.name_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where r.name_n not like f escape '\') then 2
        else 3
      end as rank
    from rows_n r
    where not exists (
      select 1 from unnest(v_frags, v_phones) as t(frag, phone)
      where not (
           r.name_n       like t.frag escape '\'
        or r.email_n      like t.frag escape '\'
        or r.phone_text_n like t.frag escape '\'
        or (t.phone <> '' and r.phone_n like '%' || t.phone || '%')
        or r.address_n    like t.frag escape '\'
        or r.notes_n      like t.frag escape '\'
      )
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone_number,
        'address', m.address, 'updated_at', m.updated_at)
        order by m.rank, m.updated_at desc nulls last, m.id)
      from (select * from matched order by rank, updated_at desc nulls last, id limit v_limit) m
    ), '[]'::jsonb))
  into v_clients;

  -- ── leads (opportunities) ─────────────────────────────────────────────────
  with rows_n as materialized (
    select o.id, o.title, o.contact_name, o.stage, o.address, o.updated_at,
           private.agent_normalize_discovery_text(o.title)          as title_n,
           private.agent_normalize_discovery_text(o.description)    as description_n,
           private.agent_normalize_discovery_text(o.contact_name)   as contact_n,
           private.agent_normalize_discovery_text(o.contact_email)  as email_n,
           private.agent_normalize_discovery_text(o.contact_phone)  as phone_text_n,
           private.agent_normalize_discovery_phone(o.contact_phone) as phone_n,
           private.agent_normalize_discovery_text(o.address)        as address_n
    from public.opportunities o
    where o.company_id = v_company and o.deleted_at is null and o.merged_into_opportunity_id is null
  ), matched as (
    select r.*,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where r.title_n not like f escape '\') then 2
        else 3
      end as rank
    from rows_n r
    where not exists (
      select 1 from unnest(v_frags, v_phones) as t(frag, phone)
      where not (
           r.title_n       like t.frag escape '\'
        or r.description_n like t.frag escape '\'
        or r.contact_n     like t.frag escape '\'
        or r.email_n       like t.frag escape '\'
        or r.phone_text_n  like t.frag escape '\'
        or (t.phone <> '' and r.phone_n like '%' || t.phone || '%')
        or r.address_n     like t.frag escape '\'
      )
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'contact_name', m.contact_name, 'stage', m.stage,
        'address', m.address, 'updated_at', m.updated_at)
        order by m.rank, m.updated_at desc nulls last, m.id)
      from (select * from matched order by rank, updated_at desc nulls last, id limit v_limit) m
    ), '[]'::jsonb))
  into v_leads;

  -- ── tasks ─────────────────────────────────────────────────────────────────
  with rows_n as materialized (
    select t.id, coalesce(t.custom_title, tt.display) as title, t.project_id, p.title as project_title,
           tt.display as task_type, t.status, t.updated_at,
           private.agent_normalize_discovery_text(coalesce(t.custom_title, tt.display)) as title_n,
           private.agent_normalize_discovery_text(t.task_notes) as notes_n,
           private.agent_normalize_discovery_text(tt.display)   as type_n,
           private.agent_normalize_discovery_text(p.title)      as project_n
    from public.project_tasks t
    join public.projects p on p.id = t.project_id and p.deleted_at is null
    left join public.task_types tt on tt.id = t.task_type_id
    where t.company_id = v_company and t.deleted_at is null
  ), matched as (
    select r.*,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where r.title_n not like f escape '\') then 2
        else 3
      end as rank
    from rows_n r
    where not exists (
      select 1 from unnest(v_frags) as t(frag)
      where not (
           r.title_n   like t.frag escape '\'
        or r.notes_n   like t.frag escape '\'
        or r.type_n    like t.frag escape '\'
        or r.project_n like t.frag escape '\'
      )
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'project_id', m.project_id, 'project_title', m.project_title,
        'task_type', m.task_type, 'status', m.status, 'updated_at', m.updated_at)
        order by m.rank, m.updated_at desc nulls last, m.id)
      from (select * from matched order by rank, updated_at desc nulls last, id limit v_limit) m
    ), '[]'::jsonb))
  into v_tasks;

  -- ── documents (invoices ∪ estimates) ──────────────────────────────────────
  with rows_n as materialized (
    select i.id, 'invoice'::text as kind, i.invoice_number as number, i.subject as title,
           c.name as client_name, i.total, i.status, i.updated_at,
           regexp_replace(lower(coalesce(i.invoice_number, '')), '[^a-z0-9]', '', 'g') as number_key,
           private.agent_normalize_discovery_text(i.subject) as title_n,
           private.agent_normalize_discovery_text(c.name)    as client_n
    from public.invoices i
    left join public.clients c on c.id = i.client_id
    where i.company_id = v_company and i.deleted_at is null
    union all
    select e.id, 'estimate', e.estimate_number, e.title,
           c.name, e.total, e.status, e.updated_at,
           regexp_replace(lower(coalesce(e.estimate_number, '')), '[^a-z0-9]', '', 'g'),
           private.agent_normalize_discovery_text(e.title),
           private.agent_normalize_discovery_text(c.name)
    from public.estimates e
    left join public.clients c on c.id = e.client_id
    where e.company_id = v_company and e.deleted_at is null
  ), matched as (
    select r.*,
      case
        when v_query_key <> '' and r.number_key = v_query_key then 0
        when v_query_key <> '' and r.number_key like v_query_key || '%' then 1
        when not exists (select 1 from unnest(v_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as rank
    from rows_n r
    where not exists (
      select 1 from unnest(v_frags, v_doc_keys) as t(frag, key)
      where not (
           (t.key <> '' and r.number_key like t.key || '%')
        or r.title_n  like t.frag escape '\'
        or r.client_n like t.frag escape '\'
      )
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'number', m.number, 'title', m.title, 'client_name', m.client_name,
        'total', m.total, 'status', m.status, 'updated_at', m.updated_at)
        order by m.rank, m.updated_at desc nulls last, m.id)
      from (select * from matched order by rank, updated_at desc nulls last, id limit v_limit) m
    ), '[]'::jsonb))
  into v_documents;

  return jsonb_build_object(
    'query', v_query, 'tokens', to_jsonb(v_tokens),
    'projects', v_projects, 'clients', v_clients, 'leads', v_leads,
    'tasks', v_tasks, 'documents', v_documents);
end;
$$;
```

Notes the executor must honour: `like … escape '\'` inside `$$` is a single backslash (standard_conforming_strings is on); `null like …` is null, so a null field never matches — that is the intended behaviour; `unnest(a, b)` with aligned arrays is the multi-array form; keep `as materialized` so each row's normalization runs once. If `agent_normalize_discovery_text` returns null for empty/whitespace input, `coalesce` is unnecessary except where written.

**Step 3: Probes (all inside `begin; … rollback;` — nothing persists), as the founder**

Preamble for every probe run:
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select coalesce(auth_id, firebase_uid) from public.users where id = '283d49df-90a1-4abb-b94c-3e9f17f02c0d'), 'role', 'authenticated')::text, true);
set local role authenticated;
-- <create or replace function … from Step 2>
-- <probes>
rollback;
```
Probes (record each result verbatim in the probes doc):
1. `select search_workspace('hidden oaks')` → projects.items[0].title contains "Hidden Oaks"; every group present; `tokens = ["hidden","oaks"]`.
2. Tier proof: pick a real Canpro project title `T`; run exact (`T`), prefix (first word of `T`), all-tokens (words of `T` reversed), scattered (a word from its address + a word from its client name) — confirm the project ranks first in the first three and is present in the fourth; show `rank` by adding a debug `select` over the `matched` CTE if needed (dry-run only).
3. Phone: a real client phone in `(250) 555-…` form searched as its bare digits → that client returned.
4. Documents: an invoice number `INV-####` searched as `inv####`, `INV-####`, and its numeric part → invoice returned with `kind = 'invoice'`; an estimate likewise.
5. Wildcards: `select search_workspace('100%')` and `('a_b')` → no error, treated literally.
6. Token cap: a 9-word query → `tokens` has 8 entries.
7. Short: `select search_workspace('h')` → envelope with `tokens = []` and all totals 0. `select search_workspace(null)` → same.
8. Limit clamp: `search_workspace('a', 999)` returns ≤ 25 items per kind; `('a', 0)` returns ≤ 1.
9. Scoping: repeat probe 1 as a persona-pool user whose `projects.view` scope is `assigned` (find one: `select u.id, u.email from users u … join role_permissions …` — or the `PERSONA TEST POOL` memory names 30 synthetic prod users); `projects.total` must be ≤ the founder's and only assigned projects appear. Also confirm no error when a kind is unreadable (`documents.total = 0`, not 42501).
10. Performance: `explain (analyze, buffers) select search_workspace('hidden oaks cres')` as the founder — record total time; must be well under 150 ms.

**Step 4: Write the migration file** (`supabase/migrations/pending_search_workspace_rpc.sql`) in the repo's guarded style:
```sql
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'SEARCH_WORKSPACE_PG_TRGM_MISSING';
  end if;
  if not (has_function_privilege('anon', 'private.get_user_company_id()', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.get_user_company_id()', 'EXECUTE')
      and has_function_privilege('anon', 'private.agent_normalize_discovery_text(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.agent_normalize_discovery_text(text)', 'EXECUTE')
      and has_function_privilege('anon', 'private.agent_normalize_discovery_phone(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.agent_normalize_discovery_phone(text)', 'EXECUTE')) then
    raise exception 'SEARCH_WORKSPACE_HELPER_NOT_EXECUTABLE_BY_API_ROLES';
  end if;
end $$;

-- <create or replace function public.search_workspace … exactly as dry-run>

revoke all on function public.search_workspace(text, integer) from public;
grant execute on function public.search_workspace(text, integer) to anon, authenticated, service_role;

comment on function public.search_workspace(text, integer) is
  'Ranked, RLS-scoped universal search for the OPS-Web palette across projects, clients, leads, tasks and documents. SECURITY INVOKER on purpose: row visibility is the caller''s RLS. Every helper it calls is executable by anon/authenticated (asserted above).';

do $$
begin
  if not has_function_privilege('authenticated', 'public.search_workspace(text, integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.search_workspace(text, integer)', 'EXECUTE') then
    raise exception 'SEARCH_WORKSPACE_GRANT_MISSING';
  end if;
end $$;

commit;
```
The functional smoke under `set local role authenticated` is done in Step 3 (rolled back) rather than inside the migration — a migration must not depend on a specific user's claims.

**Step 5: Apply, mirror, commit**
- Apply via MCP `apply_migration` with name `search_workspace_rpc` and the file's exact content.
- Read back: `select version, name, md5(statements[1]), length(statements[1]) from supabase_migrations.schema_migrations where name = 'search_workspace_rpc'`. Rename the file to `<version>_search_workspace_rpc.sql`; verify `md5` of the file with its trailing newline stripped equals the ledger md5 (if not, write the ledger's `statements[1]` to the file — the ledger is the authority).
- Copy the file byte-exact to the bible archive `/Users/jacksonsweet/Projects/OPS/ops-software-bible/migrations/<version>_search_workspace_rpc.sql`; in the bible commit ONLY that file (`git add` by name — a sibling session has chapter 07 dirty).
- Re-run probes 1, 3, 4, 9 against the live function (rolled-back transaction, no `create`) and record them.
- Commit in ops-web: `git add supabase/migrations/<version>_search_workspace_rpc.sql docs/superpowers/plans/2026-09-08-search-workspace-probes.md && git commit -m "feat(search): add the search_workspace RPC"` (message body: what it searches and why it is SECURITY INVOKER).

---

### Task 2: Types, parser, service, hook

**Skills:** none beyond the repo conventions. Read `src/lib/api/services/project-views-service.ts` (RPC call style) and `src/lib/hooks/projects-table/use-projects-table-data.ts` (query key + `placeholderData` style) first.

**Files:**
- Modify: `src/lib/types/database.types.ts` — add under `public.Functions`, alphabetically: `search_workspace: { Args: { p_query: string; p_limit_per_kind?: number }; Returns: Json }`
- Create: `src/lib/types/workspace-search.ts`
- Create: `src/lib/api/services/workspace-search-service.ts`
- Create: `src/lib/hooks/use-workspace-search.ts`
- Test: `tests/unit/api/workspace-search-service.test.ts`, `tests/unit/hooks/use-workspace-search.test.tsx`
- Modify: `src/lib/api/query-client.ts` — add `queryKeys.search.workspace(companyId, query)` next to the existing key factories.

**Step 1: Types + parser (write the test first)**

`tests/unit/api/workspace-search-service.test.ts` — first describe block tests `parseWorkspaceSearchResult`:
```ts
import { describe, it, expect } from "vitest";
import { parseWorkspaceSearchResult, emptyWorkspaceSearchResult } from "@/lib/types/workspace-search";

describe("parseWorkspaceSearchResult", () => {
  it("returns the empty envelope for anything that is not an envelope", () => {
    expect(parseWorkspaceSearchResult(null)).toEqual(emptyWorkspaceSearchResult());
    expect(parseWorkspaceSearchResult("nope")).toEqual(emptyWorkspaceSearchResult());
  });
  it("keeps well-formed items and drops malformed ones without throwing", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "hidden", tokens: ["hidden"],
      projects: { total: 2, items: [
        { id: "p1", title: "Hidden Oaks", address: null, status: "in_progress", client_name: "A", updated_at: "2026-09-01T00:00:00Z" },
        { title: "no id" },
      ] },
      clients: { total: 0, items: [] }, leads: { total: 0, items: [] },
      tasks: { total: 0, items: [] }, documents: { total: 1, items: [
        { id: "i1", kind: "invoice", number: "INV-1042", title: null, client_name: "A", total: "4812.50", status: "sent", updated_at: null },
      ] },
    });
    expect(parsed.projects.items).toHaveLength(1);
    expect(parsed.projects.total).toBe(2);
    expect(parsed.documents.items[0]).toMatchObject({ kind: "invoice", number: "INV-1042", total: 4812.5 });
  });
});
```
Run: `npx vitest run tests/unit/api/workspace-search-service.test.ts | grep -E "Test Files|Tests  "` → FAIL (module missing).

Implement `src/lib/types/workspace-search.ts`: `WorkspaceSearchKind`, item interfaces (`WorkspaceProjectHit`, `WorkspaceClientHit`, `WorkspaceLeadHit`, `WorkspaceTaskHit`, `WorkspaceDocumentHit` with `kind: "invoice" | "estimate"`), `WorkspaceSearchGroup<T> = { total: number; items: T[] }`, `WorkspaceSearchResult`, `emptyWorkspaceSearchResult()` (a fresh envelope per call — no shared mutable constant), and `parseWorkspaceSearchResult(json: unknown)` — every item validated field-by-field (`id` string required; `total` coerced only from a number or numeric string, else the kept item count; nulls preserved as `null`), malformed items dropped, groups defaulted to empty. No external schema library unless the repo already uses `zod` in client code (it does under `src/lib/agent-control-plane`; using `zod` here is acceptable — pick one and be consistent).

Run the test → PASS. Commit: `feat(search): workspace search result types and parser`.

**Step 2: Service (test first)** — second describe block:
```ts
vi.mock("@/lib/supabase/helpers", () => ({ requireSupabase: () => supabase }));
const rpc = vi.fn();
const supabase = { rpc } as unknown as SupabaseClient;

it("calls search_workspace with the query and limit and parses the envelope", async () => {
  rpc.mockResolvedValue({ data: { query: "hidden", tokens: ["hidden"], projects: { total: 0, items: [] }, clients: { total: 0, items: [] }, leads: { total: 0, items: [] }, tasks: { total: 0, items: [] }, documents: { total: 0, items: [] } }, error: null });
  const result = await WorkspaceSearchService.search("Hidden", 8);
  expect(rpc).toHaveBeenCalledWith("search_workspace", { p_query: "Hidden", p_limit_per_kind: 8 });
  expect(result.query).toBe("hidden");
});
it("throws the PostgREST message on error", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function search_workspace", code: "42501" } });
  await expect(WorkspaceSearchService.search("x")).rejects.toThrow(/permission denied/);
});
```
Implement `workspace-search-service.ts` accordingly (`requireSupabase().rpc(...)`, destructure `{ data, error }`, throw on error with the message — never swallow, per the PGRST204 lesson). Run → PASS. Commit: `feat(search): workspace search service`.

**Step 3: Hook (test first)** — `tests/unit/hooks/use-workspace-search.test.tsx` using `renderHook` with a fresh `QueryClient` per test, `vi.useFakeTimers()` for the debounce, and a mocked `WorkspaceSearchService.search`:
- typing "h" never calls the service; "hi" calls once after 150 ms; "hidden" typed within 150 ms calls once with "hidden".
- the query key is `["search", "workspace", companyId, "hidden"]` (lower-cased, trimmed).
- with `enabled: false` nothing is called.
- when the query changes and the new request is in flight, `result` still holds the previous envelope (`placeholderData: keepPreviousData`) and `isFetching` is true.

Implement `use-workspace-search.ts`:
```ts
export function useWorkspaceSearch(rawQuery: string, opts: { enabled: boolean; limitPerKind?: number }) {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const debounced = useDebouncedValue(rawQuery.trim(), 150);
  const normalized = debounced.toLowerCase();
  const enabled = opts.enabled && !!companyId && normalized.length >= 2;
  const query = useQuery({
    queryKey: queryKeys.search.workspace(companyId, normalized),
    queryFn: () => WorkspaceSearchService.search(debounced, opts.limitPerKind ?? 8),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  return { result: query.data ?? null, activeQuery: normalized, isFetching: query.isFetching, isError: query.isError, error: query.error, refetch: query.refetch, enabled };
}
```
Run → PASS. Commit: `feat(search): debounced workspace search hook`.

---

### Task 3: Palette copy and dictionary namespace

**Skills:** `ops-copywriter:ops-copywriter` (invoke it; the drafts below are the starting point, not the answer).

**Files:**
- Create: `src/i18n/dictionaries/en/command-palette.json`, `src/i18n/dictionaries/es/command-palette.json`
- Modify: wherever dictionary namespaces are registered (find how `agent-queue` was added: `grep -rn "agent-queue" src/i18n` — mirror it exactly for `command-palette`).

Keys (values are drafts in the product register — terse, no exclamation points, `//` for section titles, UPPERCASE for authority):
```json
{
  "input.placeholder": "Search projects, clients, leads, tasks, documents — or a command",
  "group.projects": "Projects",
  "group.clients": "Clients",
  "group.leads": "Leads",
  "group.tasks": "Tasks",
  "group.documents": "Documents",
  "group.countSeparator": "·",
  "group.create": "Create",
  "group.navigation": "Navigation",
  "group.settings": "Settings",
  "group.system": "System",
  "empty.title": "// NO MATCHES",
  "empty.body": "Try fewer words, a phone number, or a document number.",
  "error.title": "// SEARCH UNAVAILABLE",
  "error.retry": "RETRY",
  "footer.navigate": "Navigate",
  "footer.select": "Select",
  "footer.close": "Close",
  "row.invoice": "Invoice",
  "row.estimate": "Estimate"
}
```
Also move every currently hardcoded settings/system label in `command-palette.tsx` (`Profile`, `Appearance`, … `Sign Out`, `Sync Data`, `Report a bug`, `Keyboard Shortcuts`) into this namespace (`settings.profile`, …, `system.signOut`, …). Spanish values through the copywriter. Test: extend `tests/unit/i18n/*` if a dictionary-parity test exists (`grep -rln "dictionaries" tests/unit | head`) so `en` and `es` key sets match; otherwise add `tests/unit/i18n/command-palette-dictionary.test.ts` asserting key parity. Commit: `feat(palette): localize the command palette copy`.

---

### Task 4: Palette rewrite (entity section)

**Skills:** `ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`. Tokens: see header. Read `reference_cmdk_forcemount_group_hidden` (memory) — groups stay `forceMount`.

**Files:**
- Modify: `src/components/ops/command-palette.tsx` (replace lines from the `useProjects` import through the `entityResults` block and the four entity groups)
- Create: `src/components/ops/command-palette-rows.tsx` (five row components — keeps the palette file focused)
- Create: `src/lib/utils/status-tag-variant.ts` ONLY if no shared status→`Tag` variant mapping exists (check `src/components/books/segments/invoices-segment.tsx` for document statuses and `src/app/(dashboard)/projects/_components/table-v2/cells/cell-status.tsx` / pipeline stage chips for project status + lead stage; reuse or lift — never a second mapping)
- Test: `src/components/ops/__tests__/command-palette.test.tsx` (extend; mock `@/lib/hooks/use-workspace-search` instead of the four entity hooks)

**Step 1: Tests first (red).** Replace the entity-hook mocks with a mocked `useWorkspaceSearch` returning a fixture envelope with one hit per kind (`Hidden Oaks Cres` project, `Fightertown Hangars` client, `Deck rebuild` lead, `Frame stairs` task, `INV-1042` invoice with total 4812.5) and `total: 12` for projects. Assertions:
- typing "hidden" renders groups in the order Projects, Clients, Leads, Tasks, Documents (query the `[cmdk-group-heading]` texts in DOM order) and the Projects heading reads `Projects · 12`.
- each row shows its primary and secondary text (`3556 Hidden Oaks Cres`, `(250) 555-1234`, `Rick Heatherly`, `Hidden Oaks Cres` for the task's project, `$4,812.50`).
- Documents group is absent when `can("invoices.view")` and `can("estimates.view")` are both false.
- with `isFetching: true` and a previous result, rows stay visible; with an empty envelope and `isFetching: false`, `// NO MATCHES` is visible; with `isError: true`, `// SEARCH UNAVAILABLE` and a `RETRY` control that calls `refetch`.
- Enter on each kind: project → `openProjectWindow({ projectId: "p1", mode: "viewing" })`; client → `openClientWindow({ clientId: "c1", mode: "viewing" })`; lead → `router.push("/pipeline?opportunity=l1")`; task → `openProjectWindow({ projectId: "p1", mode: "viewing" })`; invoice → `router.push("/books?segment=invoices&invoice=i1")`; estimate → `router.push("/books?segment=estimates&estimate=e1")`.
Run: `npx vitest run src/components/ops/__tests__/command-palette.test.tsx | grep -E "Test Files|Tests  "` → FAIL.

**Step 2: Rows.** `command-palette-rows.tsx` exports `ProjectRow`, `ClientRow`, `LeadRow`, `TaskRow`, `DocumentRow`, each a `CommandItem` with `forceMount`, `value` = `"<kind> <primary> <secondary>"` (no ids), glyph `h-icon-16 w-icon-16 text-text-3` (lucide: `FolderKanban`, `Users`, `Target`, `ClipboardList`, `FileText` for invoice / `FileSpreadsheet` for estimate), primary `<span className="font-mohave text-body-sm text-text truncate">`, secondary `<span className="ml-auto flex items-center gap-[6px] font-mono text-micro text-text-3 truncate max-w-[220px]">` containing the secondary text and, where the spec says so, `<Tag variant={…}>` at its default size. Money via `formatCurrency` from `src/lib/utils/format.ts`. Empty secondary values render `—` (design rule), never "N/A".

**Step 3: Palette wiring.** In `command-palette.tsx`: delete the four hook imports and `entityResults`; `const search = useWorkspaceSearch(searchText, { enabled: open })`; `const hits = search.result`; `hasHits = kinds.some(k => hits?.[k].items.length)`; `showDocuments = can("invoices.view") || can("estimates.view")`. Render:
```tsx
{search.isError && <PaletteErrorRow onRetry={() => void search.refetch()} />}
{hasHits && (<>
  <EntityGroup kind="projects" … forceMount />  {/* heading: t("group.projects") + (total > items.length ? ` ${t("group.countSeparator")} ${total}` : "") */}
  … clients, leads, tasks, (showDocuments && documents)
  <CommandSeparator />
</>)}
{!hasHits && search.activeQuery.length >= 2 && !search.isFetching && !search.isError && (
  <CommandEmpty>…t("empty.title") / t("empty.body")…</CommandEmpty>
)}
```
Keep `CommandEmpty` out of the tree whenever hits exist (cmdk counts only registered items). All strings via `useDictionary("command-palette")`. Run the test → PASS. Run the existing top-bar / inbox palette tests that import the palette. Commit: `feat(palette): search the database for projects, clients, leads, tasks and documents`.

**Step 4: Design audit.** Invoke `custom-skills:audit-design-system` on `command-palette.tsx` and `command-palette-rows.tsx`; zero hardcoded colour/spacing/radius/font values (the legacy `text-[11px]` in the empty state becomes `text-micro`; `w-[24px] h-[24px]` becomes `h-icon-24 w-icon-24`). Commit fixes if any.

---

### Task 5: Books open-by-link (invoices + estimates)

**Skills:** `custom-skills:interface-design` (no new UI — the existing detail modal), `ops-copywriter:ops-copywriter` (two toast lines).

**Files:**
- Modify: `src/components/books/segments/invoices-segment.tsx` (near line 170 `editingInvoice` state) and `src/components/books/segments/estimates-segment.tsx` (near line 141)
- Create: `src/components/books/use-open-document-from-url.ts` — one hook used by both segments
- Modify: `src/i18n/dictionaries/{en,es}/books.json` — `openByLink.invoiceNotFound`, `openByLink.estimateNotFound`
- Test: `tests/unit/books/open-document-from-url.test.tsx`

**Step 1: Test first.** Render a harness component using the hook with mocked `next/navigation` (`useSearchParams` returning `?segment=invoices&invoice=i1`, `useRouter().replace` as a spy), a mocked fetcher resolving `{ id: "i1", … }`, and an `onOpen` spy:
- calls `onOpen` once with the fetched document, then `router.replace("/books?segment=invoices")` (param removed, others kept);
- does not call `onOpen` again on re-render;
- when the fetcher resolves `null` (or rejects), calls the toast with the not-found copy and still clears the param;
- no param → nothing happens.
Run → FAIL.

**Step 2: Hook.**
```ts
export function useOpenDocumentFromUrl<T>(opts: { param: "invoice" | "estimate"; useDocument: (id?: string) => { data: T | null | undefined; isError: boolean; isLoading: boolean }; onOpen: (doc: T) => void; notFoundMessage: string }) { … }
```
Read the id from `useSearchParams().get(opts.param)`; call `opts.useDocument(id ?? undefined)`; in an effect keyed on `[id, data, isError]`, once `data` resolves call `onOpen(data)` then clear the param via `router.replace(pathname + "?" + remainingParams)`; on `isError` or `data === null` after loading, toast `notFoundMessage` and clear the param; guard with a ref so it fires once per id.

**Step 3: Wire both segments.** `useOpenDocumentFromUrl({ param: "invoice", useDocument: useInvoice, onOpen: setEditingInvoice, notFoundMessage: t("openByLink.invoiceNotFound") })` in the invoices segment; the estimate twin in the estimates segment. Verify the detail modal's `open` prop is already `!!editingInvoice` (it is, line 457) so nothing else changes. Run tests → PASS; run the segments' existing tests. Commit: `feat(books): open an invoice or estimate from a link`.

---

### Task 6: Loading cue and easing token

**Skills:** `animation-studio:animation-architect` then `custom-skills:elite-animations` (micro-interaction; CSS only; 60 fps trivially — colour transition on one glyph; no `will-change` needed).

**Files:**
- Modify: `tailwind.config.ts` — add `transitionTimingFunction: { ops: "cubic-bezier(0.22, 1, 0.36, 1)" }` inside `theme.extend` (verify no such key already exists: `grep -n transitionTimingFunction tailwind.config.ts`)
- Modify: `src/components/ui/command.tsx` — `CommandInput` accepts `searching?: boolean` and renders its `Search` glyph with `className={cn("h-icon-16 w-icon-16 transition-colors duration-200 ease-ops motion-reduce:transition-none", searching ? "text-text-mute" : "text-text-3")}` (check the glyph's current classes and keep everything else)
- Modify: `command-palette.tsx` — `<CommandInput searching={search.isFetching && search.activeQuery.length >= 2} … />`
- Test: in the palette RTL suite, assert the glyph carries `text-text-mute` while `isFetching` and `text-text-3` otherwise.

Commit: `feat(palette): quiet search-in-flight cue with the design-system easing`.

---

### Task 7: Integration, gates, observation, documentation

**Skills:** `custom-skills:audit-design-system` (final pass over every touched `.tsx`).

**Step 1: Gates on the branch head.**
- Every touched/added test file in isolation (list them; one command each): all green.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit > /tmp/us-tsc.txt 2>&1; echo exit=$?` → `exit=0` and an empty file (a grep count of "0 errors" is not proof; the exit code and empty output are).
- `npx eslint` on every touched file → clean.

**Step 2: Live observation** (standalone Playwright; dev server `npm run dev -- -p 3510` started with the Bash `run_in_background` option; demo user pete signs in on `/dashboard`; do NOT use MCP browser tools). Viewport 1440×900. Screenshots to `/private/tmp/claude-501/-Users-jacksonsweet-Projects-OPS/cb9542c8-e214-4e59-8fff-772062d90f4b/scratchpad/universal-search/`. Record a JSON summary:
- "detail" → Projects group with `MIG Detailing`, a Leads group; headings in order; `[cmdk-group]` `hidden` attributes false for entity groups.
- "fightertown" → Clients group with `Fightertown Hangars LLC`.
- a Maverick phone number's bare digits → the client.
- a Maverick invoice number (read one via SQL: `select invoice_number from invoices where company_id = 'ddee107c-33cd-483e-8278-0f8d8a180181' and deleted_at is null limit 1`) typed without its dashes → Documents group with the invoice; ArrowDown+Enter → URL becomes `/books?segment=invoices` (param consumed) and the invoice detail modal is visible with that number.
- "zzqzqzqx" → `// NO MATCHES`.
- Network: exactly one `rpc/search_workspace` request per settled query (from `performance.getEntriesByType('resource')`), none for queries under 2 characters.
Stop the server afterwards (`lsof -tiTCP:3510 -sTCP:LISTEN | xargs kill`).

**Step 3: Documentation.**
- Bible `03_DATA_ARCHITECTURE.md`: under the RPC/permission section that documents `has_permission`, add a `### search_workspace RPC` block: contract, kinds and fields, ranking tiers, SECURITY INVOKER rationale + helper ACL dependency, ledger version.
- Bible `02_USER_EXPERIENCE_AND_WORKFLOWS.md` (the ⌘K / command palette paragraph — locate with `grep -n "⌘K\|command palette"`; if that lives in `07_SPECIALIZED_FEATURES.md`, check `git status` first — chapter 07 is dirty in a sibling session; if dirty, add the section to 02 instead and say so): what universal search covers, matching + ranking in one paragraph, the Books open-by-link contract (`/books?segment=invoices&invoice=<id>` / `…estimates&estimate=<id>`).
- Commit the bible by file name only.

**Step 4: Report** (to the principal): commit list (`git log --oneline fix/sweep0908-load-failures..HEAD`), each gate's verbatim summary line, the probes doc path, the Playwright JSON + screenshot paths, anything unproven stated plainly, and any place the implementation deviated from the spec with the reason.
